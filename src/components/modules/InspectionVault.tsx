import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Building2, CheckCircle2, Cloud, CloudOff, Download, FileJson, FileSpreadsheet, KeyRound, Lock, Plus, RefreshCw, ShieldCheck, Trash2, Unlock } from 'lucide-react';
import { BatteryMeter, GlassCard, Metric, SectionTitle, spring } from '../ui';
import { meetsTier, useApp } from '../../state/AppState';
import {
  clearPin, db, deleteEntity, downloadText, exportAll, pinIsSet, setPin, toCsv, upsertCheck, verifyPin,
} from '../../services/db';
import type { CheckItemRecord, LeakRecord, RoomRecord, SyncMutation, WallScanRecord } from '../../types';

const PROTOCOL: { room: string; label: string; need: 'impact' | 'hydro' | 'rt60' | 'level' }[] = [
  { room: 'Living room', label: 'Floor slope & foundation settling check (≤ 0.5 % / 6 mm per m)', need: 'level' },
  { room: 'Living room', label: 'TV wall stud & conduit scan before drilling', need: 'impact' },
  { room: 'Living room', label: 'Wall flatness / plaster delamination tap sweep', need: 'impact' },
  { room: 'Bathroom', label: 'Tile delamination tap-test on shower surround', need: 'impact' },
  { room: 'Bathroom', label: 'Under-sink pipe acoustic sweep for pinhole leak', need: 'hydro' },
  { room: 'Bathroom', label: 'Shower pan drainage slope (1.5–4 %)', need: 'level' },
  { room: 'Kitchen', label: 'Dishwasher / supply-line leak listen', need: 'hydro' },
  { room: 'Kitchen', label: 'Cabinet & shelf level alignment', need: 'level' },
  { room: 'Home office', label: 'RT60 echo rating vs. 0.40 s Zoom target', need: 'rt60' },
  { room: 'Whole home', label: 'Water meter creep test with all fixtures closed', need: 'hydro' },
];

type Tab = 'checklist' | 'records' | 'queue';

const PROPERTIES = [
  '12 Maple St · Primary residence',
  '48 Copperfield Ave · Rental unit 2B',
  'The Foundry Lofts · Unit 7 (pre-lease)',
  'Northgate Medical · Suite 210 (commercial)',
];

export default function InspectionVault() {
  const { role, counts, refreshCounts, syncNow, syncing, online, toast, locked, setLocked, property, setProperty, cloud } = useApp();
  const admin = meetsTier(role, 'director');
  const [tab, setTab] = useState<Tab>('checklist');
  const [items, setItems] = useState<Record<string, CheckItemRecord>>({});
  const [scans, setScans] = useState<WallScanRecord[]>([]);
  const [leaks, setLeaks] = useState<LeakRecord[]>([]);
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [pinInput, setPinInput] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [expanded, setExpanded] = useState<{ kind: 'scan' | 'leak' | 'room'; id: number } | null>(null);
  const [queueRows, setQueueRows] = useState<SyncMutation[]>([]);
  const [newProperty, setNewProperty] = useState('');
  const [props, setProps] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sonostruct.properties') || 'null') as string[] | null;
      return saved && saved.length ? saved : PROPERTIES;
    } catch { return PROPERTIES; }
  });

  const load = useCallback(async () => {
    const [c, s, l, r] = await Promise.all([
      db.checks.toArray(), db.scans.orderBy('createdAt').reverse().toArray(),
      db.leaks.orderBy('createdAt').reverse().toArray(), db.rooms.orderBy('createdAt').reverse().toArray(),
    ]);
    const map: Record<string, CheckItemRecord> = {};
    c.forEach((i) => { map[i.label] = i; });
    setItems(map);
    setScans(s); setLeaks(l); setRooms(r);
    await refreshCounts();
  }, [refreshCounts]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (tab !== 'queue') return;
    void db.queue.orderBy('createdAt').reverse().limit(60).toArray().then(setQueueRows);
  }, [tab, counts.pending]);

  const addProperty = (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    const next = Array.from(new Set([...props, clean]));
    setProps(next);
    localStorage.setItem('sonostruct.properties', JSON.stringify(next));
    setProperty(clean);
    setNewProperty('');
    toast(`Active property set to “${clean}”.`);
  };

  const done = PROTOCOL.filter((p) => items[p.label]?.done).length;
  const score = Math.round((done / PROTOCOL.length) * 100);

  const toggle = async (label: string, room: string) => {
    const existing = items[label];
    const doneNext = !existing?.done;
    const next: CheckItemRecord = {
      label, room,
      done: doneNext,
      score: doneNext ? 1 : 0,
      updatedAt: Date.now(),
    };
    if (existing?.id) {
      next.id = existing.id;
      await db.checks.put(next);
    } else {
      next.id = await db.checks.add(next);
    }
    setItems((prev) => ({ ...prev, [label]: next }));
    await upsertCheck(next);
    await refreshCounts();
  };

  const exportJson = async () => {
    const text = await exportAll();
    downloadText(`sonostruct-ledger-${new Date().toISOString().slice(0, 10)}.json`, text);
    toast('Full forensic ledger exported as JSON.');
  };

  const exportCsv = async () => {
    const rows = [
      ...scans.map((s) => ({ type: 'wall_scan', name: s.name, created: new Date(s.createdAt).toISOString(), hazard: s.hazards, studs: s.studCenters.length, detail: s.notes })),
      ...leaks.map((l) => ({ type: 'leak', name: l.scenario, created: new Date(l.createdAt).toISOString(), hazard: l.moldRisk, studs: '', detail: `${l.gallonsMonth} gal/mo, $${l.costYear}/yr, dew ${l.dewPointC}°C` })),
      ...rooms.map((r) => ({ type: 'room', name: r.name, created: new Date(r.createdAt).toISOString(), hazard: r.targetRt60, studs: r.modeCount, detail: r.treatment })),
    ];
    downloadText(`sonostruct-ledger-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows), 'text/csv');
    toast('Ledger exported as CSV.');
  };

  const unlock = () => {
    if (verifyPin(pinInput)) { setLocked(false); setPinInput(''); toast('Forensic vault unlocked for this session.'); }
    else toast('Incorrect PIN.');
  };

  const savePin = () => {
    if (pinInput.length !== 4 || pinInput !== pinConfirm) { toast('PINs must match and be 4 digits.'); return; }
    setPin(pinInput);
    setPinInput(''); setPinConfirm('');
    toast('4-digit forensic PIN set. Vault lock is now active.');
  };

  const totals = useMemo(() => ({ records: scans.length + leaks.length + rooms.length, checks: done }), [scans, leaks, rooms, done]);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <GlassCard>
        <SectionTitle
          eyebrow="Module 05 · Inspection Vault"
          title="10-Point Property Forensic Audit"
          right={
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={`btn ${tab === 'checklist' ? 'btn-primary' : ''}`} onClick={() => setTab('checklist')}>Protocol</button>
              <button className={`btn ${tab === 'records' ? 'btn-primary' : ''}`} onClick={() => setTab('records')}>Ledger {admin ? `(${totals.records})` : ''}</button>
              {admin && <button className={`btn ${tab === 'queue' ? 'btn-primary' : ''}`} onClick={() => setTab('queue')}>Queue ({counts.pending})</button>}
            </div>
          }
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <Metric label="Audit score" value={score} unit="%" tone={score > 79 ? 'ok' : score > 39 ? 'warn' : 'bad'} sub={`${done} / ${PROTOCOL.length} checks`} />
          <Metric label="Wall scans" value={counts.scans} tone="accent" sub="IndexedDB stored" />
          <Metric label="Leak reports" value={counts.leaks} tone="accent" sub="Plumbing ledger" />
          <Metric label="Room blueprints" value={counts.rooms} tone="accent" sub="RT60 profiles" />
        </div>
        <div style={{ marginTop: 12 }}><BatteryMeter value={score} tone={score > 79 ? 'accent' : 'warn'} /></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 14 }}>
          <span className="chip"><Building2 size={11} /> Multi-property</span>
          <select value={property} onChange={(e) => setProperty(e.target.value)} style={{ width: 'auto', maxWidth: 280, fontSize: 11.5 }}>
            {props.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {admin && (
            <>
              <input type="text" value={newProperty} onChange={(e) => setNewProperty(e.target.value)} placeholder="Add property…" style={{ width: 170, fontSize: 11.5 }} />
              <button className="btn" onClick={() => addProperty(newProperty)} style={{ padding: '6px 9px' }}><Plus size={12} /></button>
            </>
          )}
          <span className="label" style={{ marginLeft: 'auto', fontSize: 8.5 }}>new scans &amp; leak reports stamp this address</span>
        </div>
      </GlassCard>

      {tab === 'checklist' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          {Array.from(new Set(PROTOCOL.map((p) => p.room))).map((room) => (
            <GlassCard key={room}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800 }}>{room}</div>
                <span className="chip" style={{ fontSize: 9 }}>
                  {PROTOCOL.filter((p) => p.room === room && items[p.label]?.done).length}/{PROTOCOL.filter((p) => p.room === room).length}
                </span>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {PROTOCOL.filter((p) => p.room === room).map((p) => {
                  const isDone = !!items[p.label]?.done;
                  return (
                    <motion.button
                      key={p.label}
                      whileTap={{ scale: 0.97 }}
                      transition={spring}
                      onClick={() => void toggle(p.label, p.room)}
                      style={{
                        display: 'flex', gap: 10, alignItems: 'flex-start', textAlign: 'left', cursor: 'pointer',
                        padding: '10px 11px', borderRadius: 12,
                        border: `1px solid ${isDone ? 'color-mix(in srgb, var(--accent-2) 45%, transparent)' : 'var(--stroke)'}`,
                        background: isDone ? 'color-mix(in srgb, var(--accent-2) 10%, transparent)' : 'transparent',
                      }}
                    >
                      {isDone
                        ? <CheckCircle2 size={15} color="var(--accent-2)" style={{ flexShrink: 0, marginTop: 1 }} />
                        : <div style={{ width: 14, height: 14, borderRadius: 4, border: '1px solid var(--stroke)', flexShrink: 0, marginTop: 1 }} />}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11.5, lineHeight: 1.45, fontWeight: isDone ? 600 : 500, opacity: isDone ? 0.8 : 1 }}>{p.label}</div>
                        <div className="label" style={{ fontSize: 8, marginTop: 4 }}>{p.need === 'impact' ? 'Impact-Echo' : p.need === 'hydro' ? 'Hydro-Listen' : p.need === 'rt60' ? 'RT60 Pro' : 'Clinometer'}</div>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </GlassCard>
          ))}
        </div>
      ) : tab === 'queue' ? (
        <div style={{ display: 'grid', gap: 16 }}>
          <GlassCard>
            <SectionTitle eyebrow="Admin · Offline-to-online" title="Mutation Sync Queue Controller" right={<span className="chip">{online ? <Cloud size={11} /> : <CloudOff size={11} />} {online ? 'ONLINE' : 'OFFLINE'}</span>} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => void syncNow()} disabled={syncing || counts.pending === 0}>
                <RefreshCw size={13} className={syncing ? 'spin' : ''} /> {syncing ? 'Draining…' : `Drain ${counts.pending} mutation${counts.pending === 1 ? '' : 's'}`}
              </button>
              <button className="btn" onClick={() => void exportJson()}><FileJson size={13} /> Export queue + ledger</button>
              <button className="btn" onClick={() => void db.queue.clear().then(() => { void refreshCounts(); void load(); toast('Queue purged locally.'); })}>Purge queue</button>
            </div>
            <div className="dim" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.55 }}>
              Every save (scan, leak, room, checklist change, delete) is appended here first. Nothing leaves the device until you drain the queue while online; failures stay queued and retry on the next drain.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginTop: 14 }}>
              <Metric
                label="Transport"
                value={cloud.configured ? 'SUPABASE' : 'LOCAL ONLY'}
                tone={cloud.configured ? 'accent' : 'warn'}
                mono={false}
                sub={cloud.configured ? 'PostgREST · anon key' : 'add VITE_SUPABASE_URL + ANON_KEY to enable'}
              />
              <Metric
                label="Cloud reachable"
                value={cloud.configured ? (cloud.reachable ? 'YES' : 'NO') : 'N/A'}
                tone={cloud.reachable ? 'ok' : cloud.configured ? 'bad' : 'warn'}
                mono={false}
                sub={cloud.error ? cloud.error.slice(0, 46) : `${cloud.remoteRows} rows this device`}
              />
              <Metric
                label="Last remote row"
                value={cloud.lastSyncedAt ? new Date(cloud.lastSyncedAt).toLocaleTimeString() : '—'}
                tone="accent"
                sub={cloud.lastSyncedAt ? new Date(cloud.lastSyncedAt).toLocaleDateString() : 'no uploads yet'}
                mono={false}
              />
            </div>
          </GlassCard>
          <div style={{ display: 'grid', gap: 8 }}>
            {queueRows.map((q) => (
              <div key={q.id} className="glass" style={{ padding: '10px 13px', borderRadius: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 10, width: 34, color: 'var(--text-dim)' }}>#{q.id}</span>
                <span className="chip" style={{ fontSize: 8.5 }}>{q.entity}</span>
                <span className="mono dim" style={{ fontSize: 10 }}>{q.action}</span>
                <span className="mono dim" style={{ fontSize: 9.5, marginLeft: 'auto' }}>{new Date(q.createdAt).toLocaleTimeString()}</span>
                <span className="mono" style={{ fontSize: 9, fontWeight: 800, color: q.synced ? 'var(--accent-2)' : 'var(--warn)' }}>{q.synced ? 'SYNCED' : 'PENDING'}</span>
              </div>
            ))}
            {queueRows.length === 0 && <GlassCard><div className="dim" style={{ fontSize: 12 }}>Queue is empty — every mutation has been acknowledged.</div></GlassCard>}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          <GlassCard>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn" onClick={() => void exportJson()}><FileJson size={13} /> Export JSON</button>
              <button className="btn" onClick={() => void exportCsv()}><FileSpreadsheet size={13} /> Export CSV</button>
              <button className="btn" onClick={() => void syncNow()} disabled={syncing}>
                <RefreshCw size={13} className={syncing ? 'spin' : ''} /> Sync now
              </button>
              <span className="chip" style={{ marginLeft: 'auto' }}>
                {online ? <Cloud size={11} /> : <CloudOff size={11} />} {online ? 'ONLINE' : 'OFFLINE'} · {counts.pending} queued
              </span>
            </div>
            {admin ? (
              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input type="password" inputMode="numeric" maxLength={4} value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))} placeholder="4-digit PIN" style={{ width: 120 }} />
                {pinIsSet() ? (
                  <>
                    <button className="btn" onClick={unlock}><Unlock size={13} /> Unlock</button>
                    <button className="btn" onClick={() => { clearPin(); toast('PIN removed.'); }}>Clear PIN</button>
                  </>
                ) : (
                  <>
                    <input type="password" inputMode="numeric" maxLength={4} value={pinConfirm} onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ''))} placeholder="confirm" style={{ width: 110 }} />
                    <button className="btn" onClick={savePin}><KeyRound size={13} /> Set PIN</button>
                  </>
                )}
                {pinIsSet() && (
                  <button className="btn" onClick={() => { setLocked(!locked); setPinInput(''); }}>{locked ? <Unlock size={12} /> : <Lock size={12} />} {locked ? 'Unlock session' : 'Seal'}</button>
                )}
                <span className="label" style={{ marginLeft: 'auto' }}>{locked ? 'VAULT PIN-LOCKED' : 'VAULT UNLOCKED'}</span>
              </div>
            ) : (
              <div className="dim" style={{ fontSize: 10.5, marginTop: 10 }}>PIN-lock and full-ledger export unlock at Structural Forensics Director.</div>
            )}
          </GlassCard>

          {locked && (
            <GlassCard>
              <div style={{ display: 'grid', gap: 10, justifyItems: 'center', padding: '18px 0', textAlign: 'center' }}>
                <Lock size={26} color="var(--warn)" />
                <div style={{ fontSize: 14, fontWeight: 800 }}>Forensic vault is PIN-locked</div>
                <div className="dim" style={{ fontSize: 11.5, maxWidth: 380, lineHeight: 1.5 }}>
                  {totals.records} record{totals.records === 1 ? '' : 's'} are sealed. Enter the 4-digit director PIN to reveal wall scans, leak forensics and room blueprints.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="password" inputMode="numeric" maxLength={4} value={pinInput} onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))} placeholder="••••" style={{ width: 96, textAlign: 'center', letterSpacing: '.4em' }} />
                  <button className="btn btn-primary" onClick={unlock}><Unlock size={13} /> Unseal</button>
                </div>
              </div>
            </GlassCard>
          )}
          {(!locked || !pinIsSet()) && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            {scans.map((s) => (
              <GlassCard key={`s${s.id}`} hover layoutId={`scan-${s.id}`} onClick={() => setExpanded({ kind: 'scan', id: s.id as number })}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="chip">Wall scan</span>
                  <span className="mono dim" style={{ fontSize: 9.5 }}>{new Date(s.createdAt).toLocaleDateString()}</span>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 750, marginTop: 8 }}>{s.name}</div>
                <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>{s.verdicts.length} points · {s.studCenters.length} stud centers · {s.hazards} hazards</div>
                <div style={{ display: 'flex', gap: 2, marginTop: 10, height: 10 }}>
                  {s.verdicts.slice(0, 48).map((v, i) => (
                    <div key={i} style={{ flex: 1, borderRadius: 2, background: v.kind === 'stud' ? '#34d399' : v.kind === 'pipe' ? '#f43f5e' : v.kind === 'conduit' ? '#f59e0b' : v.kind === 'tile' ? '#a78bfa' : '#38bdf8' }} />
                  ))}
                </div>
              </GlassCard>
            ))}
            {leaks.map((l) => (
              <GlassCard key={`l${l.id}`} hover layoutId={`leak-${l.id}`} onClick={() => setExpanded({ kind: 'leak', id: l.id as number })}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="chip" style={{ background: 'color-mix(in srgb, var(--warn) 16%, transparent)' }}>Leak</span>
                  <span className="mono dim" style={{ fontSize: 9.5 }}>{new Date(l.createdAt).toLocaleDateString()}</span>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 750, marginTop: 8 }}>{l.scenario}</div>
                <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>{l.gallonsMonth} gal/mo · ${l.costYear.toFixed(0)}/yr</div>
                <div className="chip" style={{ marginTop: 10, background: l.moldRisk === 'CRITICAL' ? 'color-mix(in srgb, var(--danger) 18%, transparent)' : undefined }}>{l.moldRisk} mould</div>
              </GlassCard>
            ))}
            {rooms.map((r) => (
              <GlassCard key={`r${r.id}`} hover layoutId={`room-${r.id}`} onClick={() => setExpanded({ kind: 'room', id: r.id as number })}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="chip" style={{ background: 'color-mix(in srgb, var(--accent) 16%, transparent)' }}>Room</span>
                  <span className="mono dim" style={{ fontSize: 9.5 }}>{new Date(r.createdAt).toLocaleDateString()}</span>
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 750, marginTop: 8 }}>{r.name}</div>
                <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>{r.lengthM}×{r.widthM}×{r.heightM} m · {r.modeCount} modes</div>
                <div className="mono" style={{ fontSize: 10, marginTop: 8, color: 'var(--accent)' }}>
                  {Object.entries(r.rt60Bands).map(([k, v]) => `${k}:${v.toFixed(2)}`).join('  ')}
                </div>
              </GlassCard>
            ))}
            {totals.records === 0 && (
              <GlassCard>
                <div className="dim" style={{ fontSize: 12, lineHeight: 1.6 }}>
                  No records yet. Run an Impact-Echo scan, log a leak signature, or measure a room and hit save — everything lands here in IndexedDB and enters the offline sync queue.
                </div>
              </GlassCard>
            )}
          </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {expanded && !locked && (
          <BlueprintModal
            expanded={expanded}
            scans={scans} leaks={leaks} rooms={rooms}
            onClose={() => setExpanded(null)}
            onDelete={async (kind, id) => { await deleteEntity(kind, id); setExpanded(null); await load(); toast('Record deleted and queued for sync.'); }}
            canDelete={admin}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function BlueprintModal({
  expanded, scans, leaks, rooms, onClose, onDelete, canDelete,
}: {
  expanded: { kind: 'scan' | 'leak' | 'room'; id: number };
  scans: WallScanRecord[]; leaks: LeakRecord[]; rooms: RoomRecord[];
  onClose: () => void; onDelete: (kind: 'scan' | 'leak' | 'room', id: number) => Promise<void>; canDelete: boolean;
}) {
  const scan = expanded.kind === 'scan' ? scans.find((s) => s.id === expanded.id) : undefined;
  const leak = expanded.kind === 'leak' ? leaks.find((l) => l.id === expanded.id) : undefined;
  const room = expanded.kind === 'room' ? rooms.find((r) => r.id === expanded.id) : undefined;
  const title = scan?.name ?? leak?.scenario ?? room?.name ?? 'Record';

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(2,6,14,0.62)', backdropFilter: 'blur(10px)', display: 'grid', placeItems: 'center', padding: 20 }}
    >
      <motion.div
        layoutId={`${expanded.kind}-${expanded.id}`}
        transition={spring}
        onClick={(e) => e.stopPropagation()}
        className="glass"
        style={{ width: 'min(760px, 96vw)', maxHeight: '88vh', overflowY: 'auto', padding: 24, borderRadius: 24 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div className="label">Structural & acoustic engineering blueprint</div>
            <div style={{ fontSize: 20, fontWeight: 850, marginTop: 4, letterSpacing: '-0.02em' }}>{title}</div>
          </div>
          <button className="btn" onClick={onClose}>Close</button>
        </div>

        {scan && (
          <div style={{ marginTop: 18, display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
              <Metric label="Span" value={scan.spanInches} unit="in" tone="accent" />
              <Metric label="Sample points" value={scan.verdicts.length} />
              <Metric label="Stud centers" value={scan.studCenters.join('", "') || '—'} unit="in" tone="ok" />
              <Metric label="Hazards" value={scan.hazards} tone={scan.hazards ? 'bad' : 'ok'} />
            </div>
            <div className="glass" style={{ padding: 14 }}>
              <div className="label" style={{ marginBottom: 8 }}>Density profile</div>
              <div style={{ display: 'flex', gap: 2, height: 48, alignItems: 'flex-end' }}>
                {scan.verdicts.map((v, i) => (
                  <div key={i} title={`${v.x}" · ${v.kind}`} style={{
                    flex: 1, height: `${Math.min(100, (v.centroidHz / 700) * 100)}%`, borderRadius: 2,
                    background: v.kind === 'stud' ? '#34d399' : v.kind === 'pipe' ? '#f43f5e' : v.kind === 'conduit' ? '#f59e0b' : v.kind === 'tile' ? '#a78bfa' : '#38bdf8',
                  }} />
                ))}
              </div>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-dim)' }}>{scan.notes}</div>
          </div>
        )}

        {leak && (
          <div style={{ marginTop: 18, display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
              <Metric label="Peak" value={leak.peakHz} unit="Hz" tone="accent" />
              <Metric label="Band level" value={leak.bandDb} unit="dBFS" />
              <Metric label="Gallons/mo" value={leak.gallonsMonth} tone="warn" />
              <Metric label="Mould risk" value={leak.moldRisk} tone={leak.moldRisk === 'CRITICAL' ? 'bad' : 'warn'} mono={false} />
            </div>
            <div className="glass" style={{ padding: 14, fontSize: 12, lineHeight: 1.6 }}>
              Estimated loss {leak.gallonsMonth} gal/month at {leak.flowLpm.toFixed(2)} L/min — <b>${leak.costYear.toFixed(2)}/yr</b>. Dew point at the cavity wall is {leak.dewPointC.toFixed(1)} °C, {leak.moldRisk === 'CRITICAL' ? 'below surface temperature: active condensation and spore germination likely within days.' : leak.moldRisk === 'MODERATE' ? 'close to surface temperature: monitor weekly and ventilate.' : 'with a healthy dry margin.'}
            </div>
          </div>
        )}

        {room && (
          <div style={{ marginTop: 18, display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 10 }}>
              <Metric label="Volume" value={(room.lengthM * room.widthM * room.heightM).toFixed(1)} unit="m³" tone="accent" />
              <Metric label="Modes" value={room.modeCount} />
              <Metric label="Target" value={room.targetRt60.toFixed(2)} unit="s" tone="ok" />
            </div>
            <div className="glass" style={{ padding: 14 }}>
              <div className="label" style={{ marginBottom: 8 }}>RT60 octave bands</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 90 }}>
                {Object.entries(room.rt60Bands).map(([k, v]) => (
                  <div key={k} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                    <div style={{ width: '100%', height: `${Math.min(100, (v / 1.6) * 100)}%`, borderRadius: 4, background: 'linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 20%, transparent))' }} />
                    <span className="mono" style={{ fontSize: 9, color: 'var(--text-dim)' }}>{k}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-dim)' }}>{room.treatment}</div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          {canDelete && (
            <button className="btn" onClick={() => void onDelete(expanded.kind, expanded.id)} style={{ borderColor: 'color-mix(in srgb, var(--danger) 50%, transparent)' }}>
              <Trash2 size={13} /> Delete
            </button>
          )}
          <button className="btn" onClick={() => downloadText(`${title.replace(/\s+/g, '-').toLowerCase()}.json`, JSON.stringify({ scan, leak, room }, null, 2))}>
            <Download size={13} /> Export record
          </button>
          <span className="chip" style={{ marginLeft: 'auto' }}><ShieldCheck size={11} /> Offline vault</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
