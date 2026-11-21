import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ModuleId, Role, SensorKey, SensorState, ThemeId, ViewMode } from '../types';
import { drainQueue, pendingCount, vaultCounts } from '../services/db';
import { cloudEnabled, cloudStatus, type CloudStatus } from '../services/cloudSync';

export interface VaultCounts { scans: number; leaks: number; rooms: number; checks: number; pending: number }

interface AppCtx {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
  role: Role;
  setRole: (r: Role) => void;
  module: ModuleId;
  setModule: (m: ModuleId) => void;
  view: ViewMode;
  setView: (v: ViewMode) => void;
  sensors: Record<SensorKey, SensorState>;
  setSensor: (k: SensorKey, s: SensorState) => void;
  hint: string;
  pulse: 'safe' | 'stud' | 'danger' | 'idle';
  setPulse: (p: AppCtx['pulse']) => void;
  online: boolean;
  counts: VaultCounts;
  refreshCounts: () => Promise<void>;
  syncNow: () => Promise<{ synced: number; total: number }>;
  syncing: boolean;
  cloud: CloudStatus & { configured: boolean };
  apkOpen: boolean;
  setApkOpen: (v: boolean) => void;
  privOpen: boolean;
  setPrivOpen: (v: boolean) => void;
  locked: boolean;
  setLocked: (v: boolean) => void;
  property: string;
  setProperty: (p: string) => void;
  toast: (msg: string) => void;
  toastMsg: string | null;
}

const Ctx = createContext<AppCtx | null>(null);

const ROLE_ORDER: Record<Role, number> = { homeowner: 0, inspector: 1, director: 2 };
export const roleRank = (r: Role): number => ROLE_ORDER[r];
export const meetsTier = (r: Role, need: Role): boolean => ROLE_ORDER[r] >= ROLE_ORDER[need];

const THEME_KEY = 'sonostruct.theme';
const PROPERTY_KEY = 'sonostruct.property';
const ROLE_KEY = 'sonostruct.role';

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => (localStorage.getItem(THEME_KEY) as ThemeId) || 'obsidian');
  const [role, setRoleState] = useState<Role>(() => (localStorage.getItem(ROLE_KEY) as Role) || 'homeowner');
  const [module, setModule] = useState<ModuleId>('impact');
  const [view, setViewState] = useState<ViewMode>(() => (window.innerWidth < 820 ? 'mobile' : 'desktop'));
  const [sensors, setSensors] = useState<Record<SensorKey, SensorState>>({
    mic: 'IDLE',
    motion: 'SIMULATOR ACTIVE',
    camera: 'IDLE',
    haptics: 'ACTIVE',
  });
  const [hint, setHint] = useState('Simulator ready — drag across the 24" wall span to begin.');
  const [pulse, setPulse] = useState<AppCtx['pulse']>('idle');
  const [online, setOnline] = useState(navigator.onLine);
  const [counts, setCounts] = useState<VaultCounts>({ scans: 0, leaks: 0, rooms: 0, checks: 0, pending: 0 });
  const [syncing, setSyncing] = useState(false);
  const [cloud, setCloud] = useState<CloudStatus & { configured: boolean }>({ configured: cloudEnabled(), reachable: false, remoteRows: 0, lastSyncedAt: null });
  const [apkOpen, setApkOpen] = useState(false);
  const [privOpen, setPrivOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [property, setPropertyState] = useState(() => localStorage.getItem(PROPERTY_KEY) || '12 Maple St · Primary residence');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const setTheme = useCallback((t: ThemeId) => {
    setThemeState(t);
    localStorage.setItem(THEME_KEY, t);
  }, []);

  const setRole = useCallback((r: Role) => {
    setRoleState(r);
    localStorage.setItem(ROLE_KEY, r);
  }, []);

  const setView = useCallback((v: ViewMode) => setViewState(v), []);

  const setProperty = useCallback((p: string) => {
    setPropertyState(p);
    localStorage.setItem(PROPERTY_KEY, p);
  }, []);

  const refreshCounts = useCallback(async () => {
    const [c, pending] = await Promise.all([vaultCounts(), pendingCount()]);
    setCounts({ scans: c.scans, leaks: c.leaks, rooms: c.rooms, checks: c.checks, pending });
  }, []);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    const res = await drainQueue(navigator.onLine);
    await refreshCounts();
    if (cloudEnabled() && navigator.onLine) {
      const status = await cloudStatus();
      setCloud({ configured: true, ...status });
    }
    setSyncing(false);
    if (!navigator.onLine) setToastMsg('Offline — mutations held in the local queue.');
    else if (res.error) setToastMsg(`Cloud upload rejected (${res.error.slice(0, 90)}) — ${res.total} mutation(s) kept queued.`);
    else if (res.synced > 0) setToastMsg(`Synced ${res.synced} mutation${res.synced === 1 ? '' : 's'} to the ${res.channel === 'cloud' ? 'Supabase' : 'local'} ledger.`);
    else setToastMsg('Queue empty — vault already in sync.');
    return res;
  }, [refreshCounts]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 3000);
  }, []);

  const setSensor = useCallback((k: SensorKey, s: SensorState) => {
    setSensors((prev) => ({ ...prev, [k]: s }));
  }, []);

  useEffect(() => { void refreshCounts(); }, [refreshCounts]);

  // Probe the cloud ledger on boot so the status strip reflects reality
  // before the user ever presses "Sync queue".
  const probeCloud = useCallback(async () => {
    if (!cloudEnabled()) {
      setCloud({ configured: false, reachable: false, remoteRows: 0, lastSyncedAt: null });
      return;
    }
    const status = await cloudStatus();
    setCloud({ configured: true, ...status });
  }, []);

  useEffect(() => { void probeCloud(); }, [probeCloud]);
  useEffect(() => {
    const on = () => { void probeCloud(); };
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [probeCloud]);

  useEffect(() => {
    const on = () => { setOnline(true); setToastMsg('Back online — offline queue ready to sync.'); };
    const off = () => { setOnline(false); setToastMsg('Offline mode — all diagnostics still available.'); };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      document.documentElement.style.setProperty('--mx', `${e.clientX}px`);
      document.documentElement.style.setProperty('--my', `${e.clientY}px`);
    };
    window.addEventListener('pointermove', move);

    // Mobile / APK: sweep the specular highlight with device tilt instead of a cursor.
    let lastTs = 0;
    const tilt = (e: DeviceOrientationEvent) => {
      const now = performance.now();
      if (now - lastTs < 40) return; // ~25 fps of CSS writes is plenty
      lastTs = now;
      const g = Number.isFinite(e.gamma) ? (e.gamma as number) : 0;
      const b = Number.isFinite(e.beta) ? (e.beta as number) : 0;
      const x = Math.max(0, Math.min(1, 0.5 + g / 90)) * window.innerWidth;
      const y = Math.max(0, Math.min(1, 0.35 + b / 180)) * window.innerHeight;
      document.documentElement.style.setProperty('--mx', `${x}px`);
      document.documentElement.style.setProperty('--my', `${y}px`);
    };
    window.addEventListener('deviceorientation', tilt);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('deviceorientation', tilt);
    };
  }, []);

  useEffect(() => {
    if (toastTimer.current) return;
    if (!toastMsg) return;
    const t = window.setTimeout(() => setToastMsg(null), 3200);
    return () => window.clearTimeout(t);
  }, [toastMsg]);

  const value = useMemo<AppCtx>(() => ({
    theme, setTheme, role, setRole, module, setModule, view, setView,
    sensors, setSensor, hint, pulse,
    setPulse: (p) => setPulse(p),
    online, counts, refreshCounts, syncNow, syncing, cloud,
    apkOpen, setApkOpen, privOpen, setPrivOpen,
    locked, setLocked, property, setProperty, toast, toastMsg,
  }), [theme, setTheme, role, setRole, module, view, setView, sensors, setSensor, hint, pulse, online, counts, refreshCounts, syncNow, syncing, cloud, apkOpen, privOpen, locked, property, setProperty, toast, toastMsg]);

  // expose setter for hint via a custom event-free approach: modules use local hints
  (value as unknown as { setHint?: (s: string) => void }).setHint = setHint;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

export function useHint(): (s: string) => void {
  const v = useApp() as unknown as { setHint?: (s: string) => void };
  return v.setHint ?? (() => { /* noop */ });
}
