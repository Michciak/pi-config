import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CatalogModel {
  provider: string;
  id: string;
}

interface CursorModel {
  id?: string;
  aliases?: string[];
  parameters?: Array<{ id?: string; values?: Array<{ value?: string }> }>;
  variants?: Array<{ params?: Array<{ id?: string; value?: string }> }>;
}

export function agentCatalogDir(runtimeDir: string): string {
  const parent = dirname(runtimeDir);
  if (existsSync(join(parent, "models-store.json")) || existsSync(join(parent, "settings.json"))) return parent;
  return join(homedir(), ".pi", "agent");
}

export function mergeModelCatalog(...groups: CatalogModel[][]): CatalogModel[] {
  const seen = new Set<string>();
  const models: CatalogModel[] = [];
  for (const model of groups.flat()) {
    if (!model?.provider || !model?.id) continue;
    const key = `${model.provider}/${model.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    models.push({ provider: model.provider, id: model.id });
  }
  return models;
}

function definedParameter(model: CursorModel, id: string) {
  return model.parameters?.find((parameter) => parameter.id === id);
}

function contextValues(model: CursorModel): Array<string | undefined> {
  const defined = (definedParameter(model, "context")?.values ?? [])
    .map((value) => value.value)
    .filter((value): value is string => Boolean(value));
  if (defined.length) return defined;
  const fromVariants = [...new Set((model.variants ?? []).flatMap((variant) =>
    (variant.params ?? []).filter((param) => param.id === "context").map((param) => param.value).filter((value): value is string => Boolean(value))))];
  return fromVariants.length ? fromVariants : [undefined];
}

function hasFast(model: CursorModel): boolean {
  if (definedParameter(model, "fast")) return true;
  return (model.variants ?? []).some((variant) => (variant.params ?? []).some((param) => param.id === "fast"));
}

function encodePiModelId(modelId: string, context?: string, fastOverride?: boolean): string {
  const qualified = context ? `${modelId}@${context}` : modelId;
  if (fastOverride === true) return `${qualified}:fast`;
  if (fastOverride === false) return `${qualified}:slow`;
  return qualified;
}

function ambiguousAliases(models: CursorModel[]): Set<string> {
  const owners = new Map<string, Set<string>>();
  for (const model of models) {
    if (!model.id) continue;
    for (const rawAlias of model.aliases ?? []) {
      const alias = rawAlias.trim();
      if (!alias || alias === model.id) continue;
      const current = owners.get(alias) ?? new Set<string>();
      current.add(model.id);
      owners.set(alias, current);
    }
  }
  return new Set([...owners].filter(([, ids]) => ids.size > 1).map(([alias]) => alias));
}

export function cursorModelIds(models: CursorModel[]): string[] {
  const valid = models.filter((model): model is CursorModel & { id: string } => typeof model.id === "string" && model.id.length > 0);
  const reserved = new Set(valid.map((model) => model.id));
  const ambiguous = ambiguousAliases(valid);
  const ids: string[] = [];
  const used = new Set<string>();
  for (const model of [...valid].sort((left, right) => left.id.localeCompare(right.id))) {
    const selectable = [model.id];
    for (const rawAlias of model.aliases ?? []) {
      const alias = rawAlias.trim();
      if (!alias || alias === model.id || selectable.includes(alias) || reserved.has(alias) || ambiguous.has(alias)) continue;
      selectable.push(alias);
    }
    const contexts = contextValues(model);
    const fastOverrides: Array<boolean | undefined> = hasFast(model) ? [undefined, true, false] : [undefined];
    for (const selectionId of selectable) {
      for (const context of contexts) {
        for (const fastOverride of fastOverrides) {
          const id = encodePiModelId(selectionId, context, fastOverride);
          if (used.has(id)) continue;
          used.add(id);
          ids.push(id);
        }
      }
    }
  }
  return ids;
}

function readJson(path: string): unknown {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { return undefined; }
}

export function loadStoredModels(agentDir: string): CatalogModel[] {
  const models: CatalogModel[] = [];
  const store = readJson(join(agentDir, "models-store.json"));
  if (store && typeof store === "object") {
    for (const block of Object.values(store as Record<string, { models?: CatalogModel[] }>)) {
      for (const model of block?.models ?? []) {
        if (typeof model?.provider === "string" && typeof model?.id === "string") models.push({ provider: model.provider, id: model.id });
      }
    }
  }
  const cursor = readJson(join(agentDir, "cursor-sdk-model-list.json")) as { models?: CursorModel[] } | undefined;
  for (const id of cursorModelIds(cursor?.models ?? [])) models.push({ provider: "cursor", id });
  return mergeModelCatalog(models);
}
