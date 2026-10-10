import type { ExtensionUiState, TodoState, WorkflowRun } from "@pi-local/protocol";

export function sanitizeTerminalText(text: string): string {
  return text.replace(/\x1b\](?:[^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

export function todoSnapshot(tasks: any[]): TodoState {
  const items = tasks.filter(task => task.status !== "deleted").map(task => ({
    id: String(task.id), subject: sanitizeTerminalText(String(task.subject ?? "")),
    status: task.status, blockedBy: task.blockedBy?.map(String), activity: task.activeForm,
  }));
  return { items, completed: items.filter(item => item.status === "completed").length, total: items.length };
}

export function applyExtensionEvent(state: ExtensionUiState, event: any): boolean {
  const result = event.result ?? event.message;
  if ((event.toolName ?? result?.toolName) === "todo" && Array.isArray(result?.details?.tasks)) {
    state.todo = todoSnapshot(result.details.tasks);
    return true;
  }
  if (event.method === "setWidget" && event.widgetKey === "remote-integrations") {
    try {
      const snapshot = JSON.parse(event.widgetLines?.[0] ?? "{}");
      if (Array.isArray(snapshot.tasks)) state.todo = todoSnapshot(snapshot.tasks);
      if (Object.hasOwn(snapshot, "goal")) {
        const goal = snapshot.goal;
        state.goal = goal ? { id: goal.id, objective: sanitizeTerminalText(String(goal.text ?? goal.objective ?? "")), status: goal.status, tokenBudget: goal.tokenBudget, tokensUsed: goal.tokensUsed } : null;
      }
      if (Array.isArray(snapshot.workflows)) state.workflows = snapshot.workflows.map((run: any): WorkflowRun => ({
        id: String(run.runId ?? run.id), name: run.workflowName ?? run.name, status: run.status,
        phase: run.phase, agents: run.agents?.length ?? run.agents, activeAgents:run.activeAgents, tokens: run.tokens, cost: run.cost,
      }));
      return true;
    } catch { return false; }
  }
  return false;
}
