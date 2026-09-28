import { ensureRuntimeDirectories, loadConfig } from "./config.js";
import { EngineManager } from "./engine.js";
import { EventBus } from "./events.js";
import { FirebaseNotifier } from "./firebase.js";
import { InteractionBroker } from "./interactions.js";
import { buildServer } from "./server.js";
import { StateStore } from "./store.js";

const config = loadConfig();
ensureRuntimeDirectories(config);
const store = new StateStore(config.databasePath);
const events = new EventBus(store);
const notifier = new FirebaseNotifier(store, config.firebaseKeychainService);
await notifier.initialize();
const interactions = new InteractionBroker(store, events, notifier);
await interactions.listen(config.socketPath);
const engine = new EngineManager(config, store, events, interactions);
const app = await buildServer({ config, store, events, notifier, interactions, engine });

const unsubscribeNotifications = events.subscribe((event) => {
  if (event.type === "engine.status_changed") void notifier.send(event.type, String(event.seq));
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  unsubscribeNotifications();
  await engine.stop(`Control Service stopped (${signal})`);
  await interactions.close();
  await app.close();
  store.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.host, port: config.port });
