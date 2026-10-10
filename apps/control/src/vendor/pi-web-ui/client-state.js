// MIT pi-web-ui 0.97.0, copyright 2026 xing-shuyin. See docs/pi-web-ui-LICENSE.txt.
/**
 * client-state — 每浏览器客户端的持久化 UI 状态（<dataDir>/client-state.json）：
 * 最近项目/工作目录、目标审查偏好、设置面板状态（提示词模式 + 技能/插件开关 +
 * 视觉桥偏好）、命名预设。文件 I/O 一律 best-effort：持久化故障绝不能
 * 弄崩 server 或阻塞会话。
 *
 * 从 agent-service.ts 抽出，行为保持不变。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { normalizeSoftCapByModel, normalizeSoftCapTokens } from "./soft-cap.js";
import { deriveLegacy, legacyToDisabled, normalizeDisabledAgentTools } from "./tool-manager.js";
/** 大模型 API 出错自动重试次数的默认值（SDK 默认 3）。 */
export const DEFAULT_RETRY_MAX_ATTEMPTS = 6;
/** 工具执行看门狗超时的默认值（默认 20 分钟；环境变量 PI_WEB_TOOL_TIMEOUT_MS 覆盖）。 */
export const DEFAULT_TOOL_WATCHDOG_TIMEOUT_MS = (() => {
    const v = Number(process.env.PI_WEB_TOOL_TIMEOUT_MS);
    return Number.isFinite(v) && v >= 0 ? v : 20 * 60_000;
})();
/** 归一化工具看门狗超时（毫秒）：0 = 禁用；非数值、负数或空值回落默认值，非负整数保留。 */
export function normalizeToolWatchdogTimeoutMs(v) {
    if (v === null || v === undefined || v === "")
        return DEFAULT_TOOL_WATCHDOG_TIMEOUT_MS;
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 0)
        return DEFAULT_TOOL_WATCHDOG_TIMEOUT_MS;
    return n;
}
/** 工具自己声明超时时留给它的余量（毫秒）：让工具先自己超时并返回错误，
 *  而不是看门狗先下手把整轮对话 abort 掉。 */
export const TOOL_WATCHDOG_EXPLICIT_GRACE_MS = 5_000;
/** 计算单次工具调用的有效看门狗超时（毫秒；≤0 = 不布看门狗）。
 *  基础值来自设置/环境变量（见 DEFAULT_TOOL_WATCHDOG_TIMEOUT_MS）；**若工具调用
 *  自己声明了更长的超时**（目前只有 bash 的 `args.timeout`，单位秒），自动顺延到
 *  「工具超时 + 余量」—— 否则 AI 明确要求跑 90 分钟的命令，会被 20 分钟的看门狗
 *  连同整轮对话一起剁掉。纯函数，可单测。 */
export function effectiveToolWatchdogMs(baseMs, toolName, args) {
    if (!Number.isFinite(baseMs) || baseMs <= 0)
        return 0;
    let ms = baseMs;
    if (toolName === "bash" && args && typeof args === "object") {
        const raw = args.timeout;
        const sec = typeof raw === "number" ? raw : Number(raw);
        if (Number.isFinite(sec) && sec > 0)
            ms = Math.max(ms, sec * 1000 + TOOL_WATCHDOG_EXPLICIT_GRACE_MS);
    }
    return ms;
}
/** 归一化插件 AI 工具禁用名单：只收非空字符串（去重，上限 256 个）。
 *  与 disabledAgentTools 不同——插件工具名是动态的（注册才知道），不能按
 *  固定目录校验；未知/已卸载插件的条目刻意保留（重装后仍保持关闭）。
 *  纯函数，可单测。 */
export function normalizeDisabledPluginTools(v) {
    if (!Array.isArray(v))
        return [];
    const out = [];
    for (const x of v) {
        if (typeof x !== "string")
            continue;
        const name = x.trim();
        if (!name || name.length > 128 || out.includes(name))
            continue;
        out.push(name);
        if (out.length >= 256)
            break;
    }
    return out;
}
/** 归一化重试次数：非数值回落默认，钳制到 [0, 100] 整数。 */
export function normalizeRetryMaxAttempts(v) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n))
        return DEFAULT_RETRY_MAX_ATTEMPTS;
    return Math.min(100, Math.max(0, n));
}
/**
 * 归一化 UI 布局偏好（UiLayoutPrefs）：只收字符串数组 / 字符串字典，去重 + 长度上限。
 * 脏数据（数字、对象、超长 key、嵌套）一律丢弃而不是整份回落 —— 用户手动调过的那部分
 * 不该因为插件写坏了一个字段就全丢。
 */
export function normalizeUiLayout(v) {
    if (!v || typeof v !== "object" || Array.isArray(v))
        return {};
    const o = v;
    const arr = (x, max) => {
        if (!Array.isArray(x))
            return undefined;
        const out = [
            ...new Set(x.filter((s) => typeof s === "string" && s.length > 0 && s.length <= 96)),
        ].slice(0, max);
        return out.length ? out : undefined;
    };
    const dict = (x, max) => {
        if (!x || typeof x !== "object" || Array.isArray(x))
            return undefined;
        const out = {};
        for (const [k, val] of Object.entries(x).slice(0, max)) {
            if (k.length > 0 && k.length <= 96 && typeof val === "string" && val.length > 0 && val.length <= 120) {
                out[k] = val;
            }
        }
        return Object.keys(out).length ? out : undefined;
    };
    // 品牌二合一迁移：旧 host:brand-logo/host:brand-name → host:brand（去重；显式新值赢）。
    const BRAND_NEW = "host:brand";
    const isBrandOld = (id) => id === "host:brand-logo" || id === "host:brand-name";
    const mapBrandList = (list) => {
        if (!list)
            return undefined;
        const out = [];
        for (const id of list) {
            const mapped = isBrandOld(id) ? BRAND_NEW : id;
            if (!out.includes(mapped))
                out.push(mapped);
        }
        return out.length ? out : undefined;
    };
    /** 旧品牌 key 折进 host:brand：logo 优先还是名称优先由调用方定（对齐/分组跟 logo，走名称）。 */
    const foldBrandDict = (src, logoFirst) => {
        if (!src)
            return undefined;
        const out = {};
        for (const [k, val] of Object.entries(src)) {
            if (isBrandOld(k))
                continue;
            out[k] = val;
        }
        if (out[BRAND_NEW] === undefined) {
            const picked = logoFirst
                ? (src["host:brand-logo"] ?? src["host:brand-name"])
                : (src["host:brand-name"] ?? src["host:brand-logo"]);
            if (picked !== undefined)
                out[BRAND_NEW] = picked;
        }
        return Object.keys(out).length ? out : undefined;
    };
    const hidden = mapBrandList(arr(o.hidden, 200));
    const shown = mapBrandList(arr(o.shown, 200));
    const order = mapBrandList(arr(o.order, 200));
    const groups = foldBrandDict(dict(o.groups, 200), true);
    const labels = foldBrandDict(dict(o.labels, 200), false);
    // 用户对齐：只收 start/center/end（手改脏值回落丢弃，不污染合并结果）。
    let align;
    if (o.align && typeof o.align === "object" && !Array.isArray(o.align)) {
        align = {};
        for (const [k, val] of Object.entries(o.align).slice(0, 200)) {
            if (k.length > 0 && k.length <= 96 && (val === "start" || val === "center" || val === "end")) {
                align[k] = val;
            }
        }
        if (Object.keys(align).length === 0)
            align = undefined;
    }
    // 品牌对齐同样折进 host:brand（跟 logo 的值，显式新值赢）。
    if (align && ("host:brand-logo" in align || "host:brand-name" in align)) {
        const out = {};
        for (const [k, val] of Object.entries(align)) {
            if (k === "host:brand-logo" || k === "host:brand-name")
                continue;
            out[k] = val;
        }
        if (out[BRAND_NEW] === undefined) {
            const picked = align["host:brand-logo"] ?? align["host:brand-name"];
            if (picked !== undefined)
                out[BRAND_NEW] = picked;
        }
        align = Object.keys(out).length ? out : undefined;
    }
    // 顶栏按钮文字总开关：只收布尔值（缺席 = 显示，兼容老存档）。
    const topbarText = typeof o.topbarText === "boolean" ? o.topbarText : undefined;
    return {
        ...(hidden ? { hidden } : {}),
        ...(shown ? { shown } : {}),
        ...(order ? { order } : {}),
        ...(groups ? { groups } : {}),
        ...(align ? { align } : {}),
        ...(labels ? { labels } : {}),
        ...(topbarText !== undefined ? { topbarText } : {}),
    };
}
/** 归一化技能名单：字符串数组原样过滤；其他（含旧 bool 开关）回落空数组。 */
export function normalizeSkillList(v) {
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}
/** Stable identity of an extension for the enable/disable toggle: the npm
 *  spec for packages (survives version bumps), the resolved entry path
 *  otherwise. */
export function extensionKey(e) {
    const src = e.sourceInfo;
    if (src?.origin === "package" && src.source)
        return src.source;
    return src?.path ?? e.path;
}
/** All identities an extension may be disabled by. The SDK applies
 *  `sourceInfo` only AFTER extensionsOverride runs (resource-loader reload():
 *  override first, applyExtensionSourceInfo second), so inside the override a
 *  package extension still has no sourceInfo and extensionKey() falls back to
 *  the raw entry path — which never matches the "npm:<pkg>" id the settings
 *  panel stores. Derive the package name from the entry path
 *  (.../node_modules/<pkg>/... or .../node_modules/@scope/<pkg>/...) so both
 *  sides agree. */
export function extensionKeyCandidates(e) {
    const keys = new Set([extensionKey(e)]);
    const norm = e.path.replace(/\\/g, "/");
    const marker = "/node_modules/";
    const idx = norm.lastIndexOf(marker);
    if (idx !== -1) {
        const segs = norm.slice(idx + marker.length).split("/");
        // Scoped package @scope/name spans two segments.
        const name = segs[0]?.startsWith("@") && segs[1] ? `${segs[0]}/${segs[1]}` : segs[0];
        if (name)
            keys.add(`npm:${name}`);
    }
    return [...keys];
}
/** Whether an extension is covered by the disabled list (any identity match). */
export function isExtensionDisabled(e, disabled) {
    if (disabled.length === 0)
        return false;
    const keys = extensionKeyCandidates(e);
    return disabled.some((d) => keys.includes(d));
}
/** Whether an extension is covered by an ENABLED whitelist (any identity
 *  match). Empty whitelist = not whitelisting = everything allowed. Used by
 *  subagent templates（白名单语义：模板勾选 = 子代理只加载这些扩展）。 */
export function isExtensionEnabled(e, enabled) {
    if (enabled.length === 0)
        return true;
    const keys = extensionKeyCandidates(e);
    return enabled.some((d) => keys.includes(d));
}
/** 额外工作区根（宿主侧多根，issue #146）上限：右栏文件树可切换的根数量。 */
export const MAX_WORKSPACE_ROOTS = 8;
/**
 * 归一化「额外工作区根」列表：只收**绝对路径**（相对路径在服务端没有任何可靠基准）、
 * 去重（win32 折大小写）、上限 MAX_WORKSPACE_ROOTS，并 resolve 成规范形式以便与工作区
 * 做前缀比较。脏数据（数字/空串/对象）逐个丢弃而不是整份回落 —— 用户加过的根不该因为
 * 前端传坏了一个元素就全丢。
 */
export function normalizeWorkspaceRoots(v) {
    if (!Array.isArray(v))
        return [];
    const out = [];
    const seen = new Set();
    for (const raw of v) {
        if (typeof raw !== "string")
            continue;
        const p = raw.trim();
        if (!p || !isAbsolute(p))
            continue;
        const abs = resolve(p);
        const key = process.platform === "win32" ? abs.toLowerCase() : abs;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(abs);
        if (out.length >= MAX_WORKSPACE_ROOTS)
            break;
    }
    return out;
}
/** 跨平台（尤其是 Windows）路径归一化键：统一转绝对路径，并在 Windows 下转小写以消除大小写与正反斜杠差异。 */
export function normalizePathKey(p) {
    try {
        const resolved = resolve(p);
        return process.platform === "win32" ? resolved.toLowerCase() : resolved;
    }
    catch {
        return process.platform === "win32" ? p.toLowerCase() : p;
    }
}
/**
 * Persists which workspace each browser client last used + which workspaces it
 * has opened, so a server restart / page reload restores the same project and
 * the UI can offer a one-click recent-project list. File I/O is best-effort:
 * persistence problems must never crash the server or block a session.
 */
export class ClientStateStore {
    filePath;
    cache = null;
    constructor(filePath) {
        this.filePath = filePath;
    }
    /** 长期设置（设置面板 config + 预设 + 标记开关）的固定存储键。
     *
     * 为什么用固定全局键而非 per-clientId：clientId 存 sessionStorage（每标签页独立、
     * 关浏览器即失），按 clientId 存设置会在每次新会话/重启后生成新 id → 设置全部重置、
     * 且各标签页/浏览器各有一套互不同步。改为全局共享后：所有客户端（标签页/浏览器）
     * 使用同一套配置，且持久化在服务端，重启不丢（「同一套配置」）。会话级状态
     * （最近项目 / lastCwd / 项目模型与密钥等）仍按 clientId 各自保留。 */
    static GLOBAL_SETTINGS_KEY = "__settings__";
    /** <dataDir>（client-state.json 的上一级）——共享配置（子代理模板库等）落在这里。 */
    get dataDir() {
        return dirname(this.filePath);
    }
    load() {
        if (this.cache)
            return this.cache;
        try {
            const parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
            this.cache = parsed && typeof parsed === "object" ? parsed : {};
        }
        catch {
            this.cache = {};
        }
        // 历史数据迁移：老版本将 removedProjects 仅记在各自临时 clientId 下，升级后新标签页无法继承。
        // 启动/加载时自动将所有老 client 的墓碑合并到全局 __settings__，避免重启或新标签页后已删项目复活。
        let migrated = false;
        const globalState = (this.cache[ClientStateStore.GLOBAL_SETTINGS_KEY] ??= { projects: [] });
        const globalSet = new Set((globalState.removedProjects ?? []).map(normalizePathKey));
        for (const [id, cState] of Object.entries(this.cache)) {
            if (id !== ClientStateStore.GLOBAL_SETTINGS_KEY && cState.removedProjects?.length) {
                for (const p of cState.removedProjects) {
                    const key = normalizePathKey(p);
                    if (!globalSet.has(key)) {
                        globalSet.add(key);
                        (globalState.removedProjects ??= []).push(p);
                        migrated = true;
                    }
                }
            }
        }
        if (migrated) {
            this.save();
        }
        return this.cache;
    }
    save() {
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            // Atomic write (tmp + rename): a crash mid-write must never leave a
            // half-written JSON — that would wipe ALL persisted state (recent
            // projects / presets / settings / goal prefs) on next load.
            const tmp = `${this.filePath}.${process.pid}.tmp`;
            writeFileSync(tmp, JSON.stringify(this.cache, null, 2) + "\n");
            renameSync(tmp, this.filePath);
        }
        catch {
            // best effort
        }
    }
    get(clientId) {
        return this.load()[clientId] ?? { projects: [] };
    }
    /** Remember which workspace a client last used; bumps its project entry. */
    remember(clientId, cwd) {
        const all = this.load();
        const state = (all[clientId] ??= { projects: [] });
        state.lastCwd = cwd;
        const now = Date.now();
        const targetKey = normalizePathKey(cwd);
        state.projects = [
            { path: cwd, lastUsed: now },
            ...state.projects.filter((p) => normalizePathKey(p.path) !== targetKey),
        ].slice(0, 30);
        // Also persist in global settings so new tabs and sessions inherit it immediately
        const globalState = (all[ClientStateStore.GLOBAL_SETTINGS_KEY] ??= { projects: [] });
        globalState.projects = [
            { path: cwd, lastUsed: now },
            ...(globalState.projects ?? []).filter((p) => normalizePathKey(p.path) !== targetKey),
        ].slice(0, 50);
        // Opening the workspace again clears its removal tombstone across all clients and global settings.
        for (const cState of Object.values(all)) {
            if (cState.removedProjects?.length) {
                cState.removedProjects = cState.removedProjects.filter((p) => normalizePathKey(p) !== targetKey);
            }
        }
        this.save();
    }
    /** Drop one workspace from the recent-project list (user-requested removal).
     *  Records a tombstone too: pushProjects() re-discovers cwds from session
     *  files on every listing, so without it the entry would instantly reappear.
     *  Recorded in both the requesting client and GLOBAL_SETTINGS_KEY so the
     *  removal stays across all browser tabs and server restarts until the user
     *  explicitly opens that project again. */
    removeProject(clientId, cwd) {
        const all = this.load();
        const targetKey = normalizePathKey(cwd);
        const state = (all[clientId] ??= { projects: [] });
        state.projects = state.projects.filter((p) => normalizePathKey(p.path) !== targetKey);
        if (state.lastCwd && normalizePathKey(state.lastCwd) === targetKey)
            delete state.lastCwd;
        const removed = (state.removedProjects ?? []).filter((p) => normalizePathKey(p) !== targetKey);
        removed.push(cwd);
        state.removedProjects = removed;
        const globalState = (all[ClientStateStore.GLOBAL_SETTINGS_KEY] ??= { projects: [] });
        const globalRemoved = (globalState.removedProjects ?? []).filter((p) => normalizePathKey(p) !== targetKey);
        globalRemoved.push(cwd);
        globalState.removedProjects = globalRemoved;
        for (const [id, cState] of Object.entries(all)) {
            if (id !== ClientStateStore.GLOBAL_SETTINGS_KEY && cState.projects) {
                cState.projects = cState.projects.filter((p) => normalizePathKey(p.path) !== targetKey);
            }
        }
        this.save();
    }
    /** Tombstoned projects (explicitly removed by the user) for filtering the
     *  merged recent-project list across clients. */
    getRemovedProjects(clientId) {
        const all = this.load();
        const clientRemoved = all[clientId]?.removedProjects ?? [];
        const globalRemoved = all[ClientStateStore.GLOBAL_SETTINGS_KEY]?.removedProjects ?? [];
        if (globalRemoved.length === 0)
            return clientRemoved;
        if (clientRemoved.length === 0)
            return globalRemoved;
        const seen = new Set();
        const result = [];
        for (const p of [...clientRemoved, ...globalRemoved]) {
            const key = normalizePathKey(p);
            if (!seen.has(key)) {
                seen.add(key);
                result.push(p);
            }
        }
        return result;
    }
    /**
     * Get recent projects merged across the client's own history, global settings,
     * and other clients in this store, filtering out tombstoned paths and non-existent paths.
     */
    getRecentProjects(clientId) {
        const all = this.load();
        const removedKeys = new Set(this.getRemovedProjects(clientId).map(normalizePathKey));
        const map = new Map();
        const merge = (list) => {
            if (!list)
                return;
            for (const p of list) {
                if (!p?.path)
                    continue;
                const key = normalizePathKey(p.path);
                if (removedKeys.has(key))
                    continue;
                const existing = map.get(key);
                if (!existing || p.lastUsed > existing.lastUsed) {
                    map.set(key, { path: p.path, lastUsed: p.lastUsed });
                }
            }
        };
        // Merge client's own projects first, then global settings, then all other clients
        merge(all[clientId]?.projects);
        merge(all[ClientStateStore.GLOBAL_SETTINGS_KEY]?.projects);
        for (const [id, cState] of Object.entries(all)) {
            if (id !== clientId && id !== ClientStateStore.GLOBAL_SETTINGS_KEY) {
                merge(cState.projects);
            }
        }
        return [...map.values()]
            .filter((p) => {
            try {
                return existsSync(p.path);
            }
            catch {
                return false;
            }
        })
            .sort((a, b) => b.lastUsed - a.lastUsed)
            .slice(0, 30);
    }
    /** Record discovered projects into global settings cache (without clobbering tombstones). */
    mergeDiscoveredProjects(projects) {
        if (!projects.length)
            return;
        const all = this.load();
        const globalState = (all[ClientStateStore.GLOBAL_SETTINGS_KEY] ??= { projects: [] });
        const removedKeys = new Set((globalState.removedProjects ?? []).map(normalizePathKey));
        const map = new Map();
        for (const p of globalState.projects ?? []) {
            const key = normalizePathKey(p.path);
            if (!removedKeys.has(key))
                map.set(key, p);
        }
        let changed = false;
        for (const p of projects) {
            const key = normalizePathKey(p.path);
            if (removedKeys.has(key))
                continue;
            const existing = map.get(key);
            if (!existing) {
                map.set(key, p);
                changed = true;
            }
            else if (p.lastUsed > existing.lastUsed) {
                existing.lastUsed = p.lastUsed;
                changed = true;
            }
        }
        if (changed) {
            globalState.projects = [...map.values()].sort((a, b) => b.lastUsed - a.lastUsed).slice(0, 50);
            this.save();
        }
    }
    /** Last-used goal/review prefs for a client, or undefined if never set. */
    getGoalPrefs(clientId) {
        const s = this.load()[clientId];
        if (!s?.goalPrefs)
            return undefined;
        return {
            reviewModel: s.goalPrefs.reviewModel ?? null,
            maxRounds: s.goalPrefs.maxRounds ?? 0,
            locked: s.goalPrefs.locked ?? true,
            execModel: s.goalPrefs.execModel ?? null,
        };
    }
    /** 某项目当前的额外工作区根（空数组 = 单根）。 */
    getWorkspaceRoots(clientId, cwd) {
        return this.load()[clientId]?.workspaceRoots?.[cwd] ?? [];
    }
    /** 记下某项目的额外工作区根（空数组 = 清掉该项目的键，不留空壳）。 */
    saveWorkspaceRoots(clientId, cwd, roots) {
        const all = this.load();
        const state = (all[clientId] ??= { projects: [] });
        const next = normalizeWorkspaceRoots(roots);
        if (next.length === 0) {
            if (state.workspaceRoots) {
                delete state.workspaceRoots[cwd];
                if (Object.keys(state.workspaceRoots).length === 0)
                    delete state.workspaceRoots;
            }
            this.save();
            return;
        }
        (state.workspaceRoots ??= {})[cwd] = next;
        this.save();
    }
    /** Persist the client's UI locale code (hello/set_locale; best-effort). */
    saveLocale(clientId, locale) {
        const code = locale.trim().slice(0, 16);
        if (!code)
            return;
        const all = this.load();
        const state = (all[clientId] ??= { projects: [] });
        if (state.locale === code)
            return;
        state.locale = code;
        this.save();
    }
    /** Persist the client's goal/review preferences (model choice, rounds, lock). */
    saveGoalPrefs(clientId, prefs) {
        const all = this.load();
        const state = (all[clientId] ??= { projects: [] });
        state.goalPrefs = {
            reviewModel: prefs?.reviewModel ?? null,
            maxRounds: prefs?.maxRounds ?? 0,
            locked: prefs?.locked ?? true,
            execModel: prefs?.execModel ?? null,
        };
        this.save();
    }
    /** Remember conversations that were still streaming at shutdown (best-
     *  effort; called during the graceful-shutdown path). */
    saveInterrupted(clientId, list) {
        if (list.length === 0)
            return;
        const all = this.load();
        const state = (all[clientId] ??= { projects: [] });
        state.interrupted = list.slice(0, 8);
        this.save();
    }
    /** Consume the interrupted-conversation record (returns and clears it) —
     *  called once on the client's first attach after a restart. */
    takeInterrupted(clientId) {
        const all = this.load();
        const state = all[clientId];
        const list = state?.interrupted;
        if (list?.length && state) {
            delete state.interrupted;
            this.save();
        }
        return list;
    }
    /** 设置面板状态（系统提示词模式/文字 + 禁用技能/扩展）——全局共享同一套配置。 */
    getSettings(_clientId) {
        const s = this.load()[ClientStateStore.GLOBAL_SETTINGS_KEY];
        const stored = s?.settings;
        // 旧存档（promptMode/customSystemPrompt）迁移到 compose：追加文字成为独立
        // {{append}} 覆盖、替换文字成为 {{soul}} 覆盖；无自定义则用默认模板。
        let promptTemplate = "";
        let promptOverrides = {};
        if (stored?.promptTemplate !== undefined) {
            promptTemplate = stored.promptTemplate ?? "";
            promptOverrides = { ...stored?.promptOverrides };
        }
        else if (stored && typeof stored.customSystemPrompt === "string" && stored.customSystemPrompt.trim()) {
            promptOverrides = {
                [stored.promptMode === "replace" ? "soul" : "append"]: stored.customSystemPrompt,
            };
        }
        return {
            promptMode: stored?.promptMode === "replace" ? "replace" : "append",
            customSystemPrompt: stored?.customSystemPrompt ?? "",
            promptTemplate,
            promptOverrides,
            disabledSkills: stored?.disabledSkills ?? [],
            disabledExtensions: stored?.disabledExtensions ?? [],
            disabledAgentTools: legacyToDisabled(stored ?? {}),
            disabledPluginTools: normalizeDisabledPluginTools(stored?.disabledPluginTools),
            // 新字段已存在时遗留三开关以它为准推导（旧文件才读遗留值），保证两边一致。
            terminalToolsEnabled: stored?.disabledAgentTools !== undefined
                ? deriveLegacy(legacyToDisabled(stored)).terminalToolsEnabled
                : (stored?.terminalToolsEnabled ?? false),
            terminalBash: stored?.terminalBash ?? false,
            terminalBashIdleMs: stored?.terminalBashIdleMs ?? 15_000,
            terminalBashMaxForegroundMs: stored?.terminalBashMaxForegroundMs ?? 60_000,
            toolWatchdogTimeoutMs: normalizeToolWatchdogTimeoutMs(stored?.toolWatchdogTimeoutMs),
            readDirEnabled: stored?.readDirEnabled ?? true,
            toolApprovalEnabled: stored?.toolApprovalEnabled ?? true,
            editSoftEnabled: stored?.disabledAgentTools !== undefined
                ? deriveLegacy(legacyToDisabled(stored)).editSoftEnabled
                : (stored?.editSoftEnabled ?? false),
            questionnaireEnabled: stored?.disabledAgentTools !== undefined
                ? deriveLegacy(legacyToDisabled(stored)).questionnaireEnabled
                : (stored?.questionnaireEnabled ?? true),
            goalModeEnabled: stored?.goalModeEnabled ?? true,
            parallelReminderEnabled: stored?.parallelReminderEnabled ?? true,
            thinkingWrap: stored?.thinkingWrap ?? false,
            devNoCache: stored?.devNoCache,
            autoReload: stored?.autoReload,
            toolsWrap: stored?.toolsWrap ?? true,
            toolImagesEnabled: stored?.toolImagesEnabled ?? true,
            skillsFullText: normalizeSkillList(stored?.skillsFullText),
            visionBridgeEnabled: stored?.visionBridgeEnabled ?? true,
            visionBridgeModel: stored?.visionBridgeModel ?? null,
            visionBridgePromptMode: stored?.visionBridgePromptMode === "replace" ? "replace" : "append",
            visionBridgePrompt: stored?.visionBridgePrompt ?? "",
            scmCommitMsgPromptMode: stored?.scmCommitMsgPromptMode === "replace" ? "replace" : "append",
            scmCommitMsgPrompt: stored?.scmCommitMsgPrompt ?? "",
            planModePromptMode: stored?.planModePromptMode === "replace" ? "replace" : "append",
            planModePrompt: stored?.planModePrompt ?? "",
            subagentDefaultModel: stored?.subagentDefaultModel ?? null,
            retryMaxAttempts: normalizeRetryMaxAttempts(stored?.retryMaxAttempts),
            softCapTokens: normalizeSoftCapTokens(stored?.softCapTokens),
            softCapByModel: normalizeSoftCapByModel(stored?.softCapByModel),
            quickPhrases: stored?.quickPhrases ?? [],
            quickPhrasesEnabled: stored?.quickPhrasesEnabled ?? true,
            reviewPrompt: stored?.reviewPrompt ?? "",
            reviewDisabledSkills: stored?.reviewDisabledSkills ?? [],
            disabledPlugins: stored?.disabledPlugins ?? [],
            uiLayout: normalizeUiLayout(stored?.uiLayout),
            defaultAgentPreset: typeof stored?.defaultAgentPreset === "string" && stored.defaultAgentPreset
                ? stored.defaultAgentPreset
                : "standard",
            defaultPermissionPreset: typeof stored?.defaultPermissionPreset === "string" && stored.defaultPermissionPreset
                ? stored.defaultPermissionPreset
                : "workspace-write-never",
        };
    }
    /** Persist the settings-panel state (partial merge) — global shared config. */
    saveSettings(_clientId, settings) {
        const all = this.load();
        const state = (all[ClientStateStore.GLOBAL_SETTINGS_KEY] ??= { projects: [] });
        const cur = state.settings ?? {};
        state.settings = {
            promptMode: settings.promptMode ?? cur.promptMode ?? "append",
            customSystemPrompt: settings.customSystemPrompt ?? cur.customSystemPrompt ?? "",
            promptTemplate: settings.promptTemplate ?? cur.promptTemplate ?? "",
            promptOverrides: { ...(settings.promptOverrides ?? cur.promptOverrides) },
            disabledSkills: settings.disabledSkills ?? cur.disabledSkills ?? [],
            disabledExtensions: settings.disabledExtensions ?? cur.disabledExtensions ?? [],
            disabledAgentTools: normalizeDisabledAgentTools(settings.disabledAgentTools ?? cur.disabledAgentTools),
            disabledPluginTools: normalizeDisabledPluginTools(settings.disabledPluginTools ?? cur.disabledPluginTools),
            terminalToolsEnabled: settings.terminalToolsEnabled ?? cur.terminalToolsEnabled ?? false,
            terminalBash: settings.terminalBash ?? cur.terminalBash ?? false,
            terminalBashIdleMs: settings.terminalBashIdleMs ?? cur.terminalBashIdleMs ?? 15_000,
            terminalBashMaxForegroundMs: settings.terminalBashMaxForegroundMs ?? cur.terminalBashMaxForegroundMs ?? 60_000,
            toolWatchdogTimeoutMs: normalizeToolWatchdogTimeoutMs(settings.toolWatchdogTimeoutMs ?? cur.toolWatchdogTimeoutMs ?? DEFAULT_TOOL_WATCHDOG_TIMEOUT_MS),
            readDirEnabled: settings.readDirEnabled ?? cur.readDirEnabled ?? true,
            toolApprovalEnabled: settings.toolApprovalEnabled ?? cur.toolApprovalEnabled ?? true,
            editSoftEnabled: settings.editSoftEnabled ?? cur.editSoftEnabled ?? false,
            questionnaireEnabled: settings.questionnaireEnabled ?? cur.questionnaireEnabled ?? true,
            goalModeEnabled: settings.goalModeEnabled ?? cur.goalModeEnabled ?? true,
            parallelReminderEnabled: settings.parallelReminderEnabled ?? cur.parallelReminderEnabled ?? true,
            thinkingWrap: settings.thinkingWrap ?? cur.thinkingWrap ?? false,
            devNoCache: settings.devNoCache ?? cur.devNoCache,
            autoReload: settings.autoReload ?? cur.autoReload,
            toolsWrap: settings.toolsWrap ?? cur.toolsWrap ?? true,
            toolImagesEnabled: settings.toolImagesEnabled ?? cur.toolImagesEnabled ?? true,
            skillsFullText: normalizeSkillList(settings.skillsFullText ?? cur.skillsFullText),
            visionBridgeEnabled: settings.visionBridgeEnabled ?? cur.visionBridgeEnabled ?? true,
            // 按键存在性合并：null 是合法值（清除语义），`null ?? cur` 会把旧值
            // 复活到磁盘（设置面板清空后重启又回来）。settings-service 持久化
            // 时传全量对象，键总在；其他调用方传 partial，键缺 = 保持旧值。
            visionBridgeModel: "visionBridgeModel" in settings ? (settings.visionBridgeModel ?? null) : (cur.visionBridgeModel ?? null),
            subagentDefaultModel: "subagentDefaultModel" in settings
                ? (settings.subagentDefaultModel ?? null)
                : (cur.subagentDefaultModel ?? null),
            retryMaxAttempts: normalizeRetryMaxAttempts(settings.retryMaxAttempts ?? cur.retryMaxAttempts ?? DEFAULT_RETRY_MAX_ATTEMPTS),
            softCapTokens: normalizeSoftCapTokens(settings.softCapTokens ?? cur.softCapTokens ?? 0),
            softCapByModel: normalizeSoftCapByModel(settings.softCapByModel ?? cur.softCapByModel ?? {}),
            visionBridgePromptMode: settings.visionBridgePromptMode ?? cur.visionBridgePromptMode ?? "append",
            visionBridgePrompt: settings.visionBridgePrompt ?? cur.visionBridgePrompt ?? "",
            scmCommitMsgPromptMode: settings.scmCommitMsgPromptMode ?? cur.scmCommitMsgPromptMode ?? "append",
            scmCommitMsgPrompt: settings.scmCommitMsgPrompt ?? cur.scmCommitMsgPrompt ?? "",
            planModePromptMode: settings.planModePromptMode ?? cur.planModePromptMode ?? "append",
            planModePrompt: settings.planModePrompt ?? cur.planModePrompt ?? "",
            reviewPrompt: settings.reviewPrompt ?? cur.reviewPrompt ?? "",
            reviewDisabledSkills: settings.reviewDisabledSkills ?? cur.reviewDisabledSkills ?? [],
            disabledPlugins: settings.disabledPlugins ?? cur.disabledPlugins ?? [],
            uiLayout: normalizeUiLayout(settings.uiLayout ?? cur.uiLayout),
            quickPhrases: settings.quickPhrases ?? cur.quickPhrases ?? [],
            quickPhrasesEnabled: settings.quickPhrasesEnabled ?? cur.quickPhrasesEnabled ?? true,
            defaultAgentPreset: settings.defaultAgentPreset ?? cur.defaultAgentPreset ?? "standard",
            defaultPermissionPreset: settings.defaultPermissionPreset ?? cur.defaultPermissionPreset ?? "workspace-write-never",
        };
        this.save();
    }
    /** Named settings presets for a client (empty if never saved) — global shared. */
    getPresets(_clientId) {
        return (this.load()[ClientStateStore.GLOBAL_SETTINGS_KEY]?.presets ?? []).map((p) => ({
            ...p,
            // Older client-state files predate review settings.
            reviewPrompt: p.reviewPrompt ?? "",
            reviewDisabledSkills: p.reviewDisabledSkills ?? [],
            // Older presets predate the configurable retry count.
            retryMaxAttempts: normalizeRetryMaxAttempts(p.retryMaxAttempts),
            // Older presets predate the compaction soft cap (issue #229).
            softCapTokens: normalizeSoftCapTokens(p.softCapTokens),
            softCapByModel: normalizeSoftCapByModel(p.softCapByModel),
        }));
    }
    /** Persist the named settings presets — global shared config. */
    savePresets(_clientId, presets) {
        const all = this.load();
        const state = (all[ClientStateStore.GLOBAL_SETTINGS_KEY] ??= { projects: [] });
        state.presets = presets;
        this.save();
    }
    /** Get per-project provider keys for a cwd, or undefined. */
    getProjectProviderKeys(clientId, cwd) {
        return this.load()[clientId]?.projectProviderKeys?.[cwd];
    }
    /** Get a single provider's saved key for a project. */
    getProjectProviderKey(clientId, cwd, provider) {
        const all = this.load();
        const globalHit = all[ClientStateStore.GLOBAL_SETTINGS_KEY]?.projectProviderKeys?.[cwd]?.[provider];
        if (globalHit)
            return globalHit;
        const direct = all[clientId]?.projectProviderKeys?.[cwd]?.[provider];
        if (direct)
            return direct;
        for (const [id, state] of Object.entries(all)) {
            if (id === clientId || id === ClientStateStore.GLOBAL_SETTINGS_KEY)
                continue;
            const hit = state.projectProviderKeys?.[cwd]?.[provider];
            if (hit)
                return hit;
        }
        return undefined;
    }
    /** Remember which key was last used for a provider in a project. */
    saveProjectProviderKey(clientId, cwd, provider, keyName) {
        const all = this.load();
        const globalState = (all[ClientStateStore.GLOBAL_SETTINGS_KEY] ??= { projects: [] });
        const gMap = (globalState.projectProviderKeys ??= {});
        (gMap[cwd] ??= {})[provider] = keyName;
        const state = (all[clientId] ??= { projects: [] });
        const map = (state.projectProviderKeys ??= {});
        const inner = (map[cwd] ??= {});
        inner[provider] = keyName;
        this.save();
    }
    /** Delete a per-project provider key (e.g. when the key is removed). */
    deleteProjectProviderKey(clientId, cwd, provider) {
        const all = this.load();
        const gInner = all[ClientStateStore.GLOBAL_SETTINGS_KEY]?.projectProviderKeys?.[cwd];
        if (gInner && provider in gInner) {
            delete gInner[provider];
            if (Object.keys(gInner).length === 0) {
                delete all[ClientStateStore.GLOBAL_SETTINGS_KEY].projectProviderKeys[cwd];
            }
        }
        const inner = all[clientId]?.projectProviderKeys?.[cwd];
        if (!inner || !(provider in inner))
            return;
        delete inner[provider];
        if (Object.keys(inner).length === 0) {
            delete all[clientId].projectProviderKeys[cwd];
        }
        this.save();
    }
    /** Remove one provider from EVERY project's saved keys (all clients, all
     *  cwds) — e.g. the provider was cleared and returned to unconfigured.
     *  Returns the number of entries removed. */
    deleteProviderEverywhere(provider) {
        const all = this.load();
        let removed = 0;
        for (const state of Object.values(all)) {
            const map = state.projectProviderKeys;
            if (!map)
                continue;
            for (const [cwd, inner] of Object.entries(map)) {
                if (inner && provider in inner) {
                    delete inner[provider];
                    removed++;
                    if (Object.keys(inner).length === 0)
                        delete map[cwd];
                }
            }
            if (map && Object.keys(map).length === 0)
                delete state.projectProviderKeys;
        }
        if (removed > 0)
            this.save();
        return removed;
    }
    /** Fix every project that still references a deleted key: point it at the
     *  key that took over (`newActive`), or drop the reference when the
     *  provider has no keys left (`newActive` null). A key deletion made in
     *  one project must not keep haunting every other project that once used
     *  the same key on every project switch. Returns entries touched. */
    repointDeletedKeyEverywhere(provider, deletedKeyName, newActive) {
        const all = this.load();
        let touched = 0;
        for (const state of Object.values(all)) {
            const map = state.projectProviderKeys;
            if (!map)
                continue;
            for (const [cwd, inner] of Object.entries(map)) {
                if (inner?.[provider] !== deletedKeyName)
                    continue;
                if (newActive)
                    inner[provider] = newActive;
                else {
                    delete inner[provider];
                    if (Object.keys(inner).length === 0)
                        delete map[cwd];
                }
                touched++;
            }
            if (map && Object.keys(map).length === 0)
                delete state.projectProviderKeys;
        }
        if (touched > 0)
            this.save();
        return touched;
    }
    /** Get the model the user last selected in a project, or undefined. */
    getProjectModel(clientId, cwd) {
        const all = this.load();
        // 1. 全局项目模型记忆（跨标签页、跨客户端、重启浏览器共享，优先级最高）
        const globalHit = all[ClientStateStore.GLOBAL_SETTINGS_KEY]?.projectModels?.[cwd];
        if (globalHit)
            return globalHit;
        // 2. 本客户端记忆
        const direct = all[clientId]?.projectModels?.[cwd];
        if (direct)
            return direct;
        // 3. 其他客户端按最近活跃时间倒序查找兜底
        const candidates = [];
        for (const [id, state] of Object.entries(all)) {
            if (id === clientId || id === ClientStateStore.GLOBAL_SETTINGS_KEY)
                continue;
            const m = state.projectModels?.[cwd];
            if (m) {
                const p = state.projects?.find((proj) => proj.path === cwd);
                candidates.push({ model: m, lastUsed: p?.lastUsed ?? 0 });
            }
        }
        if (candidates.length > 0) {
            candidates.sort((a, b) => b.lastUsed - a.lastUsed);
            return candidates[0].model;
        }
        return undefined;
    }
    /** Remember the model last selected in a project (immediate, not after a turn). */
    saveProjectModel(clientId, cwd, modelId) {
        const all = this.load();
        // 写入全局项目记忆（保证新标签页/重启浏览器时确定可用）
        const globalState = (all[ClientStateStore.GLOBAL_SETTINGS_KEY] ??= { projects: [] });
        (globalState.projectModels ??= {})[cwd] = modelId;
        // 同时写入本客户端
        const state = (all[clientId] ??= { projects: [] });
        (state.projectModels ??= {})[cwd] = modelId;
        this.save();
    }
    /** Drop the per-project model memory for a project (e.g. when the model is
     *  removed from the catalog). */
    deleteProjectModel(clientId, cwd) {
        const all = this.load();
        const gMap = all[ClientStateStore.GLOBAL_SETTINGS_KEY]?.projectModels;
        if (gMap && cwd in gMap) {
            delete gMap[cwd];
            if (Object.keys(gMap).length === 0)
                delete all[ClientStateStore.GLOBAL_SETTINGS_KEY].projectModels;
        }
        const map = all[clientId]?.projectModels;
        if (!map || !(cwd in map))
            return;
        delete map[cwd];
        if (Object.keys(map).length === 0)
            delete all[clientId].projectModels;
        this.save();
    }
    /** 全局默认模型（跨客户端共享，存 __settings__ 键）。缺省 = 未设置。 */
    getDefaultModel() {
        return this.load()[ClientStateStore.GLOBAL_SETTINGS_KEY]?.defaultModel;
    }
    /** 设置全局默认模型（"provider/id"）。 */
    saveDefaultModel(modelId) {
        const all = this.load();
        const state = (all[ClientStateStore.GLOBAL_SETTINGS_KEY] ??= { projects: [] });
        state.defaultModel = modelId;
        this.save();
    }
    /** 清除全局默认模型（连带其 key 记忆）。 */
    clearDefaultModel() {
        const all = this.load();
        const state = all[ClientStateStore.GLOBAL_SETTINGS_KEY];
        if (!state)
            return;
        delete state.defaultModel;
        delete state.defaultProviderKeys;
        this.save();
    }
    /** 取全局默认的某 provider key。 */
    getDefaultProviderKey(provider) {
        return this.load()[ClientStateStore.GLOBAL_SETTINGS_KEY]?.defaultProviderKeys?.[provider];
    }
    /** 记全局默认的某 provider key（设全局默认模型时连带记）。 */
    saveDefaultProviderKey(provider, keyName) {
        const all = this.load();
        const state = (all[ClientStateStore.GLOBAL_SETTINGS_KEY] ??= { projects: [] });
        (state.defaultProviderKeys ??= {})[provider] = keyName;
        this.save();
    }
    /** 全局默认 key 跟随删除：被删的 key 若是全局默认记的，指到接替者（无接替则删引用）。 */
    repointDeletedKeyInDefault(provider, deletedKeyName, newActive) {
        const all = this.load();
        const map = all[ClientStateStore.GLOBAL_SETTINGS_KEY]?.defaultProviderKeys;
        if (!map || map[provider] !== deletedKeyName)
            return;
        if (newActive)
            map[provider] = newActive;
        else {
            delete map[provider];
            if (Object.keys(map).length === 0)
                delete all[ClientStateStore.GLOBAL_SETTINGS_KEY].defaultProviderKeys;
        }
        this.save();
    }
    /** 全局「快捷短语已 seed」标记（非 per-clientId）。
     *
     * 为什么全局：clientId 存 sessionStorage（每标签页独立、关浏览器即失），按
     * clientId 记 seed 会在每次新会话生成新 clientId 时误判为「从未 seed」，导致
     * 用户删掉的默认短语又被填回默认。seed 只需一次（首次见空列表），之后即为用户
     * 数据，增删改/恢复默认/关闭都走设置面板。存服务端而非浏览器 localStorage，
     * 任何浏览器/标签页/清缓存都不受影响。 */
    getQuickPhrasesSeeded() {
        const meta = this.load()[ClientStateStore.GLOBAL_SETTINGS_KEY];
        return !!meta?.quickPhrasesSeeded;
    }
    markQuickPhrasesSeeded() {
        const all = this.load();
        const meta = (all[ClientStateStore.GLOBAL_SETTINGS_KEY] ??= { projects: [] });
        if (meta.quickPhrasesSeeded)
            return;
        meta.quickPhrasesSeeded = true;
        this.save();
    }
    /** 内置标记工具开关（全局共享同一套 + 按 marker 禁用）。 */
    getMarkerSettings(_clientId) {
        const s = this.load()[ClientStateStore.GLOBAL_SETTINGS_KEY]?.markers;
        return {
            markersEnabled: s?.markersEnabled ?? true,
            disabledMarkers: s?.disabledMarkers ?? [],
        };
    }
    saveMarkerSettings(_clientId, settings) {
        const all = this.load();
        const state = (all[ClientStateStore.GLOBAL_SETTINGS_KEY] ??= { projects: [] });
        const cur = state.markers ?? { markersEnabled: true, disabledMarkers: [] };
        state.markers = {
            markersEnabled: settings.markersEnabled ?? cur.markersEnabled ?? true,
            disabledMarkers: settings.disabledMarkers ?? cur.disabledMarkers ?? [],
        };
        this.save();
    }
}
