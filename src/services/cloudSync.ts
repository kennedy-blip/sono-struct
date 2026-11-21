/**
 * cloudSync — optional Supabase (PostgREST) sink for the offline mutation queue.
 *
 * Design rules:
 *  - Never required. With no VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY the app
 *    behaves exactly as before: queue stays local and the UI says LOCAL ONLY.
 *  - Push is idempotent: every mutation carries its client uuid so a retry after
 *    a flaky uplink cannot duplicate a row (the table has a unique constraint).
 *  - Pull only reads counts/metadata, never audio, video or raw sensor buffers.
 */

export interface CloudConfig {
  url: string;
  anonKey: string;
  table: string;
}

export interface CloudMutation {
  client_id: string;
  device_id: string;
  entity: string;
  action: string;
  payload: unknown;
  created_at: string;
}

const TABLE = 'sonostruct_mutations';

export function cloudConfig(): CloudConfig | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const url = (env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
  const anonKey = env.VITE_SUPABASE_ANON_KEY ?? '';
  if (!url || !anonKey) return null;
  return { url, anonKey, table: TABLE };
}

export const cloudEnabled = (): boolean => cloudConfig() !== null;

/* ------------------------------ device identity ------------------------------ */

const DEVICE_KEY = 'sonostruct.deviceId';

export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    id = rnd;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

/** Stable client id so retries are idempotent on the server side. */
export function mutationClientId(device: string, createdAt: number, entity: string, action: string): string {
  return `${device}:${createdAt}:${entity}:${action}`;
}

/* --------------------------------- transport -------------------------------- */

async function request(cfg: CloudConfig, path: string, init: RequestInit): Promise<Response> {
  return fetch(`${cfg.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${cfg.anonKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

export interface PushResult {
  ok: boolean;
  pushed: number;
  error?: string;
}

/**
 * Upserts a batch of queued mutations. `onConflict=client_id&ignoreDuplicates`
 * makes a replay after network loss a no-op instead of a duplicate row.
 */
export async function pushMutations(rows: CloudMutation[]): Promise<PushResult> {
  const cfg = cloudConfig();
  if (!cfg) return { ok: false, pushed: 0, error: 'cloud-not-configured' };
  if (rows.length === 0) return { ok: true, pushed: 0 };
  try {
    const res = await request(cfg, `${cfg.table}?on_conflict=client_id`, {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return { ok: false, pushed: 0, error: `HTTP ${res.status}: ${detail}` };
    }
    return { ok: true, pushed: rows.length };
  } catch (err) {
    return { ok: false, pushed: 0, error: err instanceof Error ? err.message : 'network-error' };
  }
}

export interface CloudStatus {
  reachable: boolean;
  remoteRows: number;
  lastSyncedAt: string | null;
  error?: string;
}

/** Cheap health probe: HEAD the table with a count header, scoped to this device. */
export async function cloudStatus(): Promise<CloudStatus> {
  const cfg = cloudConfig();
  if (!cfg) return { reachable: false, remoteRows: 0, lastSyncedAt: null, error: 'cloud-not-configured' };
  try {
    const res = await request(
      cfg,
      `${cfg.table}?select=created_at&device_id=eq.${encodeURIComponent(deviceId())}&order=created_at.desc&limit=1`,
      { method: 'GET', headers: { Prefer: 'count=exact' } },
    );
    if (!res.ok) return { reachable: false, remoteRows: 0, lastSyncedAt: null, error: `HTTP ${res.status}` };
    const range = res.headers.get('content-range') ?? '';
    const total = Number(range.split('/')[1] ?? '0');
    const rows = (await res.json()) as { created_at?: string }[];
    return { reachable: true, remoteRows: Number.isFinite(total) ? total : rows.length, lastSyncedAt: rows[0]?.created_at ?? null };
  } catch (err) {
    return { reachable: false, remoteRows: 0, lastSyncedAt: null, error: err instanceof Error ? err.message : 'network-error' };
  }
}
