import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import type { Approval, ClientCapabilities, ExtensionUiState, PiEvent, UserQuestion } from "@pi-local/protocol";
import type { ControlStatus } from "./api.js";
import type { SlashCommand } from "./commandPalette.js";
import type { LiveBlocks } from "./stream.js";

export interface ChatState {
  status: ControlStatus | null;
  capabilities: ClientCapabilities | undefined;
  selectedId: string | undefined;
  extensionSnapshot: ExtensionUiState | undefined;
  childRuns: any[];
  chatTab: string;
  hiddenChildChats: Record<string, string[]>;
  messages: any[];
  sessionState: any;
  conversationStats: any;
  models: Array<{provider: string; id: string}>;
  commands: SlashCommand[];
  questions: UserQuestion[];
  approvals: Approval[];
  events: PiEvent[];
  liveBlocks: LiveBlocks;
  liveUsage: any;
  queue: {steering: string[]; followUp: string[]};
  connected: boolean;
}

/** Per-mounted-client store shared by transcript, sessions and extension panels. */
export class ChatStore {
  private state: ChatState;
  private readonly listeners = new Set<() => void>();
  constructor(hiddenChildChats: Record<string, string[]> = {}) {
    this.state = {status: null, capabilities: undefined, selectedId: undefined,
      extensionSnapshot: undefined, childRuns: [], chatTab: "main", hiddenChildChats,
      messages: [], sessionState: undefined, conversationStats: undefined, models: [], commands: [],
      questions: [], approvals: [], events: [], liveBlocks: {}, liveUsage: undefined,
      queue: {steering: [], followUp: []}, connected: false};
  }
  get = (): ChatState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  patch(patch: Partial<ChatState>): void {
    if (!Object.entries(patch).some(([key, value]) => !Object.is(this.state[key as keyof ChatState], value))) return;
    this.state = {...this.state, ...patch};
    for (const listener of this.listeners) listener();
  }
  set<K extends keyof ChatState>(key: K, action: SetStateAction<ChatState[K]>): void {
    const value = typeof action === "function" ? (action as (current: ChatState[K]) => ChatState[K])(this.state[key]) : action;
    this.patch({[key]: value} as Pick<ChatState, K>);
  }
  selectSession(selectedId?: string): void {
    this.patch({selectedId, chatTab: "main", messages: [], sessionState: undefined,
      extensionSnapshot: undefined, conversationStats: undefined, childRuns: [], models: [], commands: [],
      liveBlocks: {}, liveUsage: undefined, queue: {steering: [], followUp: []}});
  }
}

export function useChatField<K extends keyof ChatState>(store: ChatStore, key: K): [ChatState[K], Dispatch<SetStateAction<ChatState[K]>>] {
  const get = useCallback(() => store.get()[key], [store, key]);
  const set = useCallback((action: SetStateAction<ChatState[K]>) => store.set(key, action), [store, key]);
  return [useSyncExternalStore(store.subscribe, get, get), set];
}
