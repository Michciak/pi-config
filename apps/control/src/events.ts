import { EventEmitter } from "node:events";
import type { PiEvent } from "@pi-local/protocol";
import { StateStore } from "./store.js";

export class EventBus {
  private readonly emitter = new EventEmitter();
  constructor(private readonly store: StateStore) { this.emitter.setMaxListeners(100); }
  publish(type: string, payload: unknown, sessionId?: string, persistedPayload: unknown = payload): PiEvent {
    const stored = this.store.appendEvent(type, persistedPayload, sessionId);
    const event = { ...stored, payload };
    this.emitter.emit("event", event);
    return event;
  }
  subscribe(listener: (event: PiEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
  after(seq: number): PiEvent[] { return this.store.eventsAfter(seq); }
}
