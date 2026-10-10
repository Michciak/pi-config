import { ensureRuntimeDirectories, loadConfig } from "./config.js";
import { EngineManager } from "./engine.js";
import { EventBus } from "./events.js";
import { FirebaseNotifier } from "./firebase.js";
import { InteractionBroker } from "./interactions.js";
import { buildServer } from "./server.js";
import { StateStore } from "./store.js";
import { TerminalManager } from "./terminals.js";
import { PluginStore } from "./extensions.js";
import { acquireRuntimeLock } from "./runtime-lock.js";
import {consumeControlRestart} from "./control-restart.js";
import {notificationCategory} from "./notification-policy.js";

const config = loadConfig();
ensureRuntimeDirectories(config);
const releaseRuntimeLock = await acquireRuntimeLock(config.runtimeDir);
const store = new StateStore(config.databasePath);
store.recoverAfterRestart();
const events = new EventBus(store);
const notifier = new FirebaseNotifier(store, config.firebaseKeychainService);
await notifier.initialize();
const interactions = new InteractionBroker(store, events, notifier);
await interactions.listen(config.socketPath);
const engine = new EngineManager(config, store, events, interactions);
const terminals = new TerminalManager();
const plugins = new PluginStore(config.runtimeDir);
const app = await buildServer({ config, store, events, notifier, interactions, engine, terminals, plugins });

const recentAlerts = new Map<string,number>();
const unsubscribeNotifications = events.subscribe((event) => {
  const category = notificationCategory(event);
  if (!category || ["approvals", "questions"].includes(category) || event.type === "notification.test") return;
  if (category === "engine") { void notifier.send(String(event.seq)); return; }
  if (!notifier.preferences()[category]) return;
  const key=`${event.sessionId}:${event.type}:${(event.payload as any)?.id ?? ""}`;
  if (category === "errors" && (recentAlerts.get(key) ?? 0) > Date.now()-60_000) return;
  recentAlerts.set(key,Date.now());
  if(recentAlerts.size>256)recentAlerts.delete(recentAlerts.keys().next().value!);
  // Do not include stderr, prompts, paths or credentials in phone alerts.
  const alert = events.publish("notification.test", {
    category, sourceEventId: event.seq,
    title: category === "errors" ? "Pi Remote · błąd" : "Pi zakończyło odpowiedź",
    message: category === "errors" ? "Sesja lub agent napotkał błąd. Otwórz Pi Remote i sprawdź Diagnostykę." : "Odpowiedź jest gotowa w Pi Remote.",
  }, event.sessionId);
  void notifier.send(String(alert.seq));
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  unsubscribeNotifications();
  await engine.stop(`Control Service stopped (${signal})`);
  await interactions.close();
  terminals.closeAll();
  await app.close();
  store.close();
  await releaseRuntimeLock();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.host, port: config.port });
try {
  const resume=consumeControlRestart(config.runtimeDir);
  if(resume){await engine.start();for(const id of resume){try{await engine.resumeSession(id);}catch(error){app.log.error({sessionId:id,error:String(error)},"session resume after Control restart failed");}}}
}catch(error){app.log.error({error:String(error)},"Control restart recovery failed");}
