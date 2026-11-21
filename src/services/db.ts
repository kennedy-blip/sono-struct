/**
 * db.ts — offline-first IndexedDB vault (Dexie) + mutation queue.
 * Every write enqueues a mutation; the queue drains when the app detects
 * `navigator.onLine` and the user hits "Sync Now".
 */
import Dexie, { type Table } from 'dexie';
import type { CheckItemRecord, LeakRecord, RoomRecord, SyncMutation, WallScanRecord } from '../types';

class SonoStructDB extends Dexie {
  scans!: Table<WallScanRecord, number>;
  leaks!: Table<LeakRecord, number>;
  rooms!: Table<RoomRecord, number>;
  checks!: Table<CheckItemRecord, number>;
  queue!: Table<SyncMutation, number>;

  constructor() {
    super('sonostruct-vault');
    this.version(1).stores({
      scans: '++id, createdAt, property, name',
      leaks: '++id, createdAt, property, scenario',
      rooms: '++id, createdAt, name',
      checks: '++id, room, done, updatedAt',
      queue: '++id, createdAt, entity, synced',
    });
  }
}

export const db = new SonoStructDB();

async function enqueue(entity: SyncMutation['entity'], action: SyncMutation['action'], payload: unknown): Promise<void> {
  await db.queue.add({
    entity,
    action,
    payload: JSON.stringify(payload),
    createdAt: Date.now(),
    synced: 0,
  });
}

export async function saveScan(rec: WallScanRecord): Promise<number> {
  const id = await db.scans.add(rec);
  await enqueue('scan', 'create', { ...rec, id });
  return id;
}

export async function saveLeak(rec: LeakRecord): Promise<number> {
  const id = await db.leaks.add(rec);
  await enqueue('leak', 'create', { ...rec, id });
  return id;
}

export async function saveRoom(rec: RoomRecord): Promise<number> {
  const id = await db.rooms.add(rec);
  await enqueue('room', 'create', { ...rec, id });
  return id;
}

export async function upsertCheck(rec: CheckItemRecord): Promise<void> {
  if (rec.id) {
    await db.checks.put(rec);
    await enqueue('check', 'update', rec);
  } else {
    const id = await db.checks.add({ ...rec, id: undefined });
    await enqueue('check', 'create', { ...rec, id });
  }
}

export async function deleteEntity(entity: SyncMutation['entity'], id: number): Promise<void> {
  const table = entity === 'scan' ? db.scans : entity === 'leak' ? db.leaks : entity === 'room' ? db.rooms : db.checks;
  await table.delete(id);
  await enqueue(entity, 'delete', { id });
}

export async function pendingCount(): Promise<number> {
  return db.queue.where('synced').equals(0).count();
}

/** Drains the queue. Offline ⇒ returns before touching anything. */
export async function drainQueue(online: boolean): Promise<{ synced: number; total: number }> {
  const pending = await db.queue.where('synced').equals(0).toArray();
  if (!online || pending.length === 0) return { synced: 0, total: pending.length };
  await new Promise((r) => setTimeout(r, 420)); // simulated network round-trip
  await db.queue.bulkUpdate(pending.map((p) => ({ key: p.id as number, changes: { synced: 1 as const } })));
  return { synced: pending.length, total: pending.length };
}

export async function vaultCounts(): Promise<{ scans: number; leaks: number; rooms: number; checks: number; pending: number }> {
  const [scans, leaks, rooms, checks, pending] = await Promise.all([
    db.scans.count(), db.leaks.count(), db.rooms.count(), db.checks.count(), pendingCount(),
  ]);
  return { scans, leaks, rooms, checks, pending };
}

export async function exportAll(): Promise<string> {
  const [scans, leaks, rooms, checks, queue] = await Promise.all([
    db.scans.toArray(), db.leaks.toArray(), db.rooms.toArray(), db.checks.toArray(), db.queue.toArray(),
  ]);
  return JSON.stringify({ app: 'SONO-STRUCT', version: '1.0.0', exportedAt: new Date().toISOString(), scans, leaks, rooms, checks, queue }, null, 2);
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n');
}

/** 4-digit PIN gate for the forensic vault. */
const PIN_KEY = 'sonostruct.pin';
export function pinIsSet(): boolean { return !!localStorage.getItem(PIN_KEY); }
export function setPin(pin: string): void { localStorage.setItem(PIN_KEY, btoa(pin)); }
export function verifyPin(pin: string): boolean {
  const stored = localStorage.getItem(PIN_KEY);
  return stored ? stored === btoa(pin) : false;
}
export function clearPin(): void { localStorage.removeItem(PIN_KEY); }
