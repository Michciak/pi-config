import { SettingsManager } from '@earendil-works/pi-coding-agent';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function settingsManager(cwd: string, agentDir = join(homedir(), '.pi', 'agent')) {
  return SettingsManager.create(cwd, agentDir);
}
export async function scopeSnapshot(cwd: string, models: any[] = []) {
  const manager = settingsManager(cwd);
  const patterns = manager.getGlobalSettings().enabledModels ?? [];
  const entry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'));
  const { resolveModelScopeFromModels } = await import(pathToFileURL(join(dirname(entry), 'core', 'model-resolver.js')).href);
  const result = patterns.length ? resolveModelScopeFromModels(patterns, models) : {scopedModels:models.map(model => ({model})), diagnostics:[]};
  return { patterns, resolved: result.scopedModels.map((item:any) => `${item.model.provider}/${item.model.id}`), diagnostics: result.diagnostics, appliesTo: 'new-or-resumed-sessions' };
}
export async function saveScope(cwd: string, patterns: unknown, expected: unknown, agentDir?: string) {
  if (!Array.isArray(patterns) || patterns.length > 500 || patterns.some(p => typeof p !== 'string' || !p.trim() || p.length > 300)) throw Object.assign(new Error('Invalid model scope'), {statusCode:400});
  const manager = settingsManager(cwd, agentDir);
  if (JSON.stringify(manager.getGlobalSettings().enabledModels ?? []) !== JSON.stringify(expected)) throw Object.assign(new Error('Scope changed elsewhere. Reopen settings before saving.'), {statusCode:409});
  manager.setEnabledModels([...new Set(patterns.map(p => p.trim()))]);
  await manager.flush();
  if (manager.drainErrors().length) throw new Error('Could not save Pi model scope');
}
