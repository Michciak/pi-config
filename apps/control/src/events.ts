import { EventEmitter } from "node:events";
import type { PiEvent } from "@pi-local/protocol";
import { StateStore } from "./store.js";

export class EventBus {
  private readonly emitter = new EventEmitter();
  constructor(private readonly store: StateStore) { this.emitter.setMaxListeners(100); }
  publish(type: string, payload: unknown, sessionId?: string): PiEvent {
    const event = this.store.appendEvent(type, payload, sessionId);
    this.emitter.emit("event", event);
    return event;
  }
  subscribe(listener: (event: PiEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }
  after(seq: number): PiEvent[] { return this.store.eventsAfter(seq); }
}
