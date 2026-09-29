import { randomUUID, createHash } from "node:crypto";
import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Approval, PiEvent, SessionSummary, UserAnswer, UserQuestion } from "@pi-local/protocol";

function now(): string { return new Date().toISOString(); }
function json(value: unknown): string { return JSON.stringify(value); }
function parse<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export class StateStore {
  readonly db: DatabaseSync;
  readonly serverId: string;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS subagent_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, metadata TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, session_id TEXT,
        type TEXT NOT NULL, payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, workspace TEXT NOT NULL, status TEXT NOT NULL,
        session_file TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, source TEXT NOT NULL, question TEXT NOT NULL,
        details TEXT, mode TEXT NOT NULL, options TEXT NOT NULL, allow_other INTEGER NOT NULL,
        status TEXT NOT NULL, answers TEXT NOT NULL, external_request_id TEXT,
        created_at TEXT NOT NULL, resolved_at TEXT
      );
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL,
        status TEXT NOT NULL, external_request_id TEXT, created_at TEXT NOT NULL, resolved_at TEXT
      );
      CREATE TABLE IF NOT EXISTS pairing_codes (
        code_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, used_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, public_key TEXT NOT NULL, fcm_token TEXT,
        created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS nonces (
        device_id TEXT NOT NULL, nonce TEXT NOT NULL, seen_at INTEGER NOT NULL,
        PRIMARY KEY (device_id, nonce)
      );
      CREATE TABLE IF NOT EXISTS web_tokens (
        token_hash TEXT PRIMARY KEY, device_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
        exchanged_at INTEGER, session_hash TEXT, session_expires_at INTEGER
      );
    `);
    try { chmodSync(path, 0o600); } catch {}
    const row = this.db.prepare("SELECT value FROM metadata WHERE key='server_id'").get() as { value?: string } | undefined;
    this.serverId = row?.value ?? randomUUID();
    if (!row) this.db.prepare("INSERT INTO metadata(key,value) VALUES('server_id',?)").run(this.serverId);
    this.invalidatePending("Control Service restarted");
    this.db.prepare("UPDATE sessions SET status='interrupted', updated_at=? WHERE status IN ('idle','running','waiting')").run(now());
  }

  close(): void { this.db.close(); }

  appendEvent(type: string, payload: unknown, sessionId?: string): PiEvent {
    const timestamp = now();
    const result = this.db.prepare("INSERT INTO events(timestamp,session_id,type,payload) VALUES(?,?,?,?)")
      .run(timestamp, sessionId ?? null, type, json(payload));
    return { seq: Number(result.lastInsertRowid), timestamp, serverId: this.serverId, sessionId, type, payload };
  }

  eventsAfter(seq: number, limit = 1000): PiEvent[] {
    const rows = this.db.prepare("SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT ?").all(seq, limit) as any[];
    return rows.map((row) => ({
      seq: row.seq, timestamp: row.timestamp, serverId: this.serverId,
      sessionId: row.session_id ?? undefined, type: row.type, payload: parse(row.payload, null),
    }));
  }

  event(seq: number): PiEvent | undefined {
    return this.eventsAfter(seq - 1, 1).find((item) => item.seq === seq);
  }

  upsertSession(session: SessionSummary): void {
    this.db.prepare(`INSERT INTO sessions(id,name,workspace,status,session_file,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, workspace=excluded.workspace,
      status=excluded.status, session_file=excluded.session_file, updated_at=excluded.updated_at`)
      .run(session.id, session.name, session.workspace, session.status, session.sessionFile ?? null, session.createdAt, session.updatedAt);
  }

  sessions(): SessionSummary[] {
    return (this.db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all() as any[]).map((row) => ({
      id: row.id, name: row.name, workspace: row.workspace, status: row.status,
      sessionFile: row.session_file ?? undefined, createdAt: row.created_at, updatedAt: row.updated_at,
    }));
  }

  session(id: string): SessionSummary | undefined { return this.sessions().find((item) => item.id === id); }

  deleteSession(id: string): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM questions WHERE session_id=?").run(id);
      this.db.prepare("DELETE FROM approvals WHERE session_id=?").run(id);
      this.db.prepare("DELETE FROM events WHERE session_id=?").run(id);
      const removed = this.db.prepare("DELETE FROM sessions WHERE id=?").run(id).changes === 1;
      this.db.exec("COMMIT");
      return removed;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createQuestion(question: UserQuestion): void {
    this.db.prepare(`INSERT INTO questions(id,session_id,source,question,details,mode,options,allow_other,status,
      answers,external_request_id,created_at,resolved_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(question.id, question.sessionId, json(question.source), question.question, question.details ?? null,
        question.mode, json(question.options), question.allowOther ? 1 : 0, question.status, json(question.answers),
        question.externalRequestId ?? null, question.createdAt, question.resolvedAt ?? null);
  }

  questions(status?: string): UserQuestion[] {
    const rows = (status
      ? this.db.prepare("SELECT * FROM questions WHERE status=? ORDER BY created_at").all(status)
      : this.db.prepare("SELECT * FROM questions ORDER BY created_at DESC LIMIT 200").all()) as any[];
    return rows.map((row) => this.mapQuestion(row));
  }

  question(id: string): UserQuestion | undefined {
    const row = this.db.prepare("SELECT * FROM questions WHERE id=?").get(id) as any;
    return row ? this.mapQuestion(row) : undefined;
  }

  firstPendingQuestion(sessionId: string): UserQuestion | undefined {
    const row = this.db.prepare("SELECT * FROM questions WHERE session_id=? AND status='pending' ORDER BY created_at LIMIT 1")
      .get(sessionId) as any;
    return row ? this.mapQuestion(row) : undefined;
  }

  resolveQuestion(id: string, status: "answered" | "cancelled" | "invalidated", answers: UserAnswer[] = []): boolean {
    const result = this.db.prepare("UPDATE questions SET status=?, answers=?, resolved_at=? WHERE id=? AND status='pending'")
      .run(status, json(answers), now(), id);
    return result.changes === 1;
  }

  createApproval(approval: Approval): void {
    this.db.prepare(`INSERT INTO approvals(id,session_id,title,message,status,external_request_id,created_at,resolved_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(approval.id, approval.sessionId, approval.title, approval.message,
        approval.status, approval.externalRequestId ?? null, approval.createdAt, approval.resolvedAt ?? null);
  }

  approvals(status?: string): Approval[] {
    const rows = (status
      ? this.db.prepare("SELECT * FROM approvals WHERE status=? ORDER BY created_at").all(status)
      : this.db.prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT 200").all()) as any[];
    return rows.map((row) => ({ id: row.id, sessionId: row.session_id, title: row.title, message: row.message,
      status: row.status, externalRequestId: row.external_request_id ?? undefined,
      createdAt: row.created_at, resolvedAt: row.resolved_at ?? undefined }));
  }

  approval(id: string): Approval | undefined { return this.approvals().find((item) => item.id === id); }

  resolveApproval(id: string, status: "approved" | "rejected" | "invalidated"): boolean {
    return this.db.prepare("UPDATE approvals SET status=?, resolved_at=? WHERE id=? AND status='pending'")
      .run(status, now(), id).changes === 1;
  }

  invalidatePending(_reason: string): void {
    const timestamp = now();
    this.db.prepare("UPDATE questions SET status='invalidated', resolved_at=? WHERE status='pending'").run(timestamp);
    this.db.prepare("UPDATE approvals SET status='invalidated', resolved_at=? WHERE status='pending'").run(timestamp);
  }

  createPairingCode(code: string, expiresAt: number): void {
    const hash = StateStore.hash(code);
    this.db.prepare("INSERT OR REPLACE INTO pairing_codes(code_hash,expires_at,used_at) VALUES(?,?,NULL)").run(hash, expiresAt);
  }

  consumePairingCode(code: string, at = Date.now()): boolean {
    const hash = StateStore.hash(code);
    const row = this.db.prepare("SELECT expires_at,used_at FROM pairing_codes WHERE code_hash=?").get(hash) as any;
    if (!row || row.used_at || row.expires_at < at) return false;
    return this.db.prepare("UPDATE pairing_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL").run(at, hash).changes === 1;
  }

  upsertDevice(device: { id: string; name: string; publicKey: string; fcmToken?: string }): void {
    const timestamp = now();
    this.db.prepare(`INSERT INTO devices(id,name,public_key,fcm_token,created_at,last_seen_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, public_key=excluded.public_key,
      fcm_token=COALESCE(excluded.fcm_token,devices.fcm_token), last_seen_at=excluded.last_seen_at`)
      .run(device.id, device.name, device.publicKey, device.fcmToken ?? null, timestamp, timestamp);
  }

  device(id: string): any { return this.db.prepare("SELECT * FROM devices WHERE id=?").get(id); }
  devices(): any[] { return this.db.prepare("SELECT * FROM devices ORDER BY created_at").all() as any[]; }
  updateDeviceToken(id: string, token: string): void {
    this.db.prepare("UPDATE devices SET fcm_token=?, last_seen_at=? WHERE id=?").run(token, now(), id);
  }

  rememberNonce(deviceId: string, nonce: string, timestamp: number): boolean {
    this.db.prepare("DELETE FROM nonces WHERE seen_at<?").run(Date.now() - 10 * 60_000);
    try {
      this.db.prepare("INSERT INTO nonces(device_id,nonce,seen_at) VALUES(?,?,?)").run(deviceId, nonce, timestamp);
      return true;
    } catch { return false; }
  }

  hasNonce(deviceId: string, nonce: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM nonces WHERE device_id=? AND nonce=?").get(deviceId, nonce);
  }

  createWebToken(deviceId: string, raw: string, expiresAt: number): void {
    this.db.prepare("INSERT INTO web_tokens(token_hash,device_id,expires_at) VALUES(?,?,?)")
      .run(StateStore.hash(raw), deviceId, expiresAt);
  }

  exchangeWebToken(raw: string): string | null {
    const hash = StateStore.hash(raw);
    const row = this.db.prepare("SELECT * FROM web_tokens WHERE token_hash=?").get(hash) as any;
    if (!row || row.exchanged_at || row.expires_at < Date.now()) return null;
    const session = randomUUID() + randomUUID();
    const sessionHash = StateStore.hash(session);
    const expires = Date.now() + 12 * 60 * 60_000;
    const changed = this.db.prepare("UPDATE web_tokens SET exchanged_at=?,session_hash=?,session_expires_at=? WHERE token_hash=? AND exchanged_at IS NULL")
      .run(Date.now(), sessionHash, expires, hash).changes;
    return changed === 1 ? session : null;
  }

  validWebSession(raw: string): boolean {
    const row = this.db.prepare("SELECT session_expires_at FROM web_tokens WHERE session_hash=?").get(StateStore.hash(raw)) as any;
    return !!row && row.session_expires_at > Date.now();
  }

  private mapQuestion(row: any): UserQuestion {
    return { id: row.id, sessionId: row.session_id, source: parse(row.source, { kind: "extension" }),
      question: row.question, details: row.details ?? undefined, mode: row.mode,
      options: parse(row.options, []), allowOther: row.allow_other === 1, status: row.status,
      answers: parse(row.answers, []), createdAt: row.created_at, resolvedAt: row.resolved_at ?? undefined,
      externalRequestId: row.external_request_id ?? undefined };
  }

  static hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
}
