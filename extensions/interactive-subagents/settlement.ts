/** Resolves an error outcome so a child exit during startup cannot reject an
 * as-yet unawaited promise and terminate the orchestrator process. */
export function createSettlement() {
  let finish: (error?: Error) => void = () => {};
  const outcome = new Promise<Error | undefined>(resolve => {finish=resolve;});
  return {outcome,finish};
}
