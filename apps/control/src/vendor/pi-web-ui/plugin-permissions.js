// MIT pi-web-ui 0.97.0, copyright 2026 xing-shuyin. See docs/pi-web-ui-LICENSE.txt.
/**
 * 插件能力动态授权表（host.requestPermission 的底层）。
 *
 * 定位：manifest.permissions 管“有没有这个能力族”（静态、装时定），这张表管
 * “运行时的具体范围”（动态、用户随时批）：
 * - net：在 manifest netAllowlist 之外，用户额外批准的主机（免改 manifest 重装）；
 * - llm：用户批准的模型作用域（空 = 不限模型），花 token 前插件可主动来问一次。
 * 基础族未声明时 requestPermission 直接回 false（不弹框）——与 requestAccess
 * 要求 fs:read 同口径，fail-closed。
 *
 * 两层存储：
 * - 磁盘 `<dataDir>/plugin-permissions.json`（记住的授权，设置面板可审计/撤销）；
 * - 内存 session 授权（仅本次运行，进程结束即失）。
 * 读坏/形状不对当空表，且不在读路径回写；只有真正变更的写才落盘（tmp+rename 原子写）。
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
/** 主机匹配（与 manifest netAllowlist 同口径）：全等或点号后缀。纯函数，单测覆盖。 */
export function permissionHostMatches(hostname, entry) {
    const h = String(hostname ?? "").toLowerCase();
    const e = String(entry ?? "")
        .toLowerCase()
        .trim();
    if (!h || !e)
        return false;
    return h === e || h.endsWith(`.${e}`);
}
function normalizeHosts(hosts) {
    if (!Array.isArray(hosts))
        return undefined;
    const out = [
        ...new Set(hosts.filter((x) => typeof x === "string" && x.trim() !== "").map((x) => x.trim().toLowerCase())),
    ];
    return out.length > 0 ? out.slice(0, 32) : undefined;
}
function normalizeModels(models) {
    if (!Array.isArray(models))
        return undefined;
    const out = [
        ...new Set(models.filter((x) => typeof x === "string" && x.includes("/")).map((x) => x.trim())),
    ];
    return out.length > 0 ? out.slice(0, 32) : undefined;
}
export class PluginPermissionStore {
    dataDir;
    sessionGrants = [];
    constructor(dataDir) {
        this.dataDir = dataDir;
    }
    file() {
        return join(this.dataDir, "plugin-permissions.json");
    }
    read() {
        try {
            const parsed = JSON.parse(readFileSync(this.file(), "utf8"));
            if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.grants))
                return { v: 1, grants: [] };
            return { v: 1, grants: parsed.grants };
        }
        catch {
            return { v: 1, grants: [] };
        }
    }
    write(grants) {
        try {
            mkdirSync(dirname(this.file()), { recursive: true });
            const tmp = `${this.file()}.tmp-${process.pid}`;
            writeFileSync(tmp, JSON.stringify({ v: 1, grants }));
            renameSync(tmp, this.file());
        }
        catch (err) {
            console.error(`[plugin-permissions] persist failed (${this.file()}):`, err);
        }
    }
    static validId(id) {
        return /^[A-Za-z0-9_-]+$/.test(id);
    }
    /** 是否有有效授权（磁盘 + 内存；host/model 命中才算）。 */
    has(pluginId, family, scope) {
        if (!PluginPermissionStore.validId(pluginId))
            return false;
        const all = [...this.read().grants, ...this.sessionGrants];
        return all.some((g) => {
            if (g.pluginId !== pluginId || g.family !== family)
                return false;
            if (family === "net") {
                const host = String(scope?.host ?? "").toLowerCase();
                if (!host || !g.hosts)
                    return false;
                return g.hosts.some((entry) => permissionHostMatches(host, entry));
            }
            if (family === "llm" && scope?.model) {
                if (!g.models || g.models.length === 0)
                    return true; // 不限模型
                return g.models.includes(scope.model);
            }
            return true;
        });
    }
    /** 写入一条授权（remember=true 落盘，false 只记内存）。同插件同族同范围覆盖旧条。 */
    grant(pluginId, family, opts) {
        if (!PluginPermissionStore.validId(pluginId))
            throw new Error(`非法插件 id：${pluginId}`);
        if (family !== "net" && family !== "llm")
            throw new Error(`不支持的能力族：${String(family)}`);
        const grant = {
            pluginId,
            family,
            ...(family === "net" && normalizeHosts(opts?.hosts) ? { hosts: normalizeHosts(opts?.hosts) } : {}),
            ...(family === "llm" && normalizeModels(opts?.models) ? { models: normalizeModels(opts?.models) } : {}),
            ...(typeof opts?.reason === "string" && opts.reason.trim() ? { reason: opts.reason.trim().slice(0, 200) } : {}),
            grantedAt: Date.now(),
        };
        if (opts?.remember === true) {
            const grants = this.read().grants.filter((g) => !(g.pluginId === pluginId && g.family === family && sameScope(g, grant)));
            grants.push(grant);
            this.write(grants);
        }
        else {
            this.sessionGrants = this.sessionGrants.filter((g) => !(g.pluginId === pluginId && g.family === family && sameScope(g, grant)));
            this.sessionGrants.push(grant);
        }
    }
    /** 撤销：都不给 = 清空整表；返回删掉的条数（磁盘 + 内存）。 */
    revoke(pluginId, family, scope) {
        let removed = 0;
        const drop = (g) => {
            if (pluginId && g.pluginId !== pluginId)
                return false;
            if (family && g.family !== family)
                return false;
            if (scope?.host && !(g.hosts ?? []).some((entry) => permissionHostMatches(scope.host, entry)))
                return false;
            if (scope?.model && g.models && g.models.length > 0 && !g.models.includes(scope.model))
                return false;
            return true;
        };
        const disk = this.read().grants;
        const kept = disk.filter((g) => !drop(g));
        if (kept.length !== disk.length) {
            removed += disk.length - kept.length;
            this.write(kept);
        }
        const before = this.sessionGrants.length;
        this.sessionGrants = this.sessionGrants.filter((g) => !drop(g));
        removed += before - this.sessionGrants.length;
        return removed;
    }
    /** 模型是否在批准作用域内：无 llm 授权 → 不限（调用方先判声明）；有授权时，
     *  至少一条「不限模型」或命中模型才放行。空 model（走默认模型）不卡。 */
    modelAllowed(pluginId, model) {
        if (!PluginPermissionStore.validId(pluginId))
            return false;
        const scoped = [...this.read().grants, ...this.sessionGrants].filter((g) => g.pluginId === pluginId && g.family === "llm");
        if (scoped.length === 0)
            return true;
        if (!model)
            return true;
        return scoped.some((g) => !g.models || g.models.length === 0 || g.models.includes(model));
    }
    /** 全量快照（设置面板审计用；session 授权带 session:true 标记）。 */
    list() {
        return [
            ...this.read().grants.map((g) => ({ ...g })),
            ...this.sessionGrants.map((g) => ({ ...g, session: true })),
        ];
    }
}
/** 同范围判定（撤销/覆盖时去重用；范围字段都为空 = 同族整单）。 */
function sameScope(a, b) {
    const ah = [...(a.hosts ?? [])].sort().join(",");
    const bh = [...(b.hosts ?? [])].sort().join(",");
    const am = [...(a.models ?? [])].sort().join(",");
    const bm = [...(b.models ?? [])].sort().join(",");
    return ah === bh && am === bm;
}
