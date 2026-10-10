import type { PiEvent } from "@pi-local/protocol";

export const notificationDefaults = { approvals: true, questions: true, errors: true, engine: true, completed: false };
export type NotificationPreferences = typeof notificationDefaults;
export function notificationCategory(event: PiEvent): keyof NotificationPreferences | undefined {
  if (event.type === "approval.created") return "approvals";
  if (event.type === "user_question.created") return "questions";
  if (["session.crashed", "session.launch_failed", "session.error"].includes(event.type)) return "errors";
  if (event.type === "pi.message_end" && (event.payload as any)?.message?.stopReason === "error") return "errors";
  if (event.type === "subagent.updated" && (event.payload as any)?.status === "error" && !(event.payload as any)?.restored) return "errors";
  if (event.type === "engine.status_changed") return (event.payload as any)?.status === "crashed" ? "errors" : "engine";
  if (event.type === "pi.agent_settled") return "completed";
  // Compatible with the installed Android client, which already renders this envelope.
  if (event.type === "notification.test") return (event.payload as any)?.category;
}
