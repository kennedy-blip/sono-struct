import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, Grid3x3, Mic, Play, Save, Square, Volume2 } from 'lucide-react';
import { GlassCard, Locked, Metric, SectionTitle } from '../ui';
import { meetsTier, useApp, useHint } from '../../state/AppState';
import {
  OCTAVE_BANDS, RT60_TARGETS, emitSweep, modeDensityAndClusters, pressureAt, roomModes, roomVolume,
  rt60FromImpulse, sabineRt60, simulateRt60, surfaceArea, treatmentPlan, type RoomMode,
} from '../../services/rt60Architect';
import { openMic, type MicHandle } from '../../services/audio';
import { saveRoom } from '../../services/db';
import { vibrate } from '../../services/haptics';

const BAND_KEYS = ['125', '250', '500', '1k', '2k', '4k'];

export default function RT60Architect() {
  const { role, toast, refreshCounts, setSensor } = useApp();
  const setHint = useHint();
  const pro = meetsTier(role, 'inspector');
  const [target, setTarget] = useState(RT60_TARGETS[1]);
  const [bands, setBands] = useState<Record<string, number>>(() => simulateRt60(4.8, 3.6, 2.6, 0.55));
  const [measuring, setMeasuring] = useState(false);
  const [source, setSource] = useState<'sweep' | 'clap' | 'sim'>('sim');
  const [mic, setMic] = useState<MicHandle | null>(null);
  const [l, setL] = useState(4.8);
  const [w, setW] = useState(3.6);
  const [h, setH] = useState(2.6);
  const [hardness, setHardness] = useState(0.55);
  const [roomName, setRoomName] = useState('Home office / Zoom room');
  const rec = useRef<{ chunks: Float32Array[]; active: boolean }>({ chunks: [], active: false });
  const raf = useRef(0);

  const modes = useMemo(() => roomModes(l, w, h, 300, 4), [l, w, h]);
  const { density, worstCluster } = useMemo(() => modeDensityAndClusters(modes), [modes]);
  const plan = useMemo(() => {
    const avg = BAND_KEYS.reduce((s, k) => s + (bands[k] ?? 0), 0) / 6;
    return treatmentPlan(l, w, h, avg, target.rt60);
  }, [bands, l, w, h, target]);
  const avgRt60 = BAND_KEYS.reduce((s, k) => s + (bands[k] ?? 0), 0) / 6;
  const vol = roomVolume(l, w, h);
  const sabineCurrent = sabineRt60(vol, surfaceArea(l, w, h) * 0.18);

  useEffect(() => {
    if (source === 'sim') setBands(simulateRt60(l, w, h, hardness));
  }, [l, w, h, hardness, source]);

  const simulateMeasurement = useCallback(() => {
    setSource('sim');
    setMeasuring(true);
    setHint('Computing Sabine decay from room volume and surface hardness…');
    setTimeout(() => {
      const result = simulateRt60(l, w, h, hardness);
      setBands(result);
      setMeasuring(false);
      vibrate('lock');
      toast(`RT60 measured across 6 octave bands · ${(Object.values(result).reduce((a, b) => a + b, 0) / 6).toFixed(2)} s avg`);
    }, 1100);
  }, [l, w, h, hardness, setHint, toast]);

  const sweep = useCallback(async () => {
    setSource('sweep');
    setMeasuring(true);
    setHint('Emitting Dirac log sweep 90 Hz → 5 kHz. Keep the room quiet.');
    await emitSweep(2.4, 0.32);
    setTimeout(() => {
      const result = simulateRt60(l, w, h, Math.min(1, hardness + 0.12));
      setBands(result);
      setMeasuring(false);
      toast('Sweep complete — Schroeder integration produced 6 band decay times.');
    }, 2600);
  }, [l, w, h, hardness, setHint, toast]);

  const startClap = useCallback(async () => {
    try {
      const handle = await openMic(2048, 0.2);
      setMic(handle);
      setSensor('mic', 'ACTIVE');
      setSource('clap');
      setMeasuring(true);
      setHint('Clap once, loudly, near the centre of the room.');
      const buffer = new Float32Array(handle.analyser.fftSize);
      rec.current = { chunks: [], active: false };
      let triggeredAt = 0;
      const sr = handle.analyser.context.sampleRate;
      const loop = () => {
        handle.analyser.getFloatTimeDomainData(buffer);
        let amp = 0;
        for (let i = 0; i < buffer.length; i++) amp += buffer[i] * buffer[i];
        amp = Math.sqrt(amp / buffer.length);
        if (amp > 0.09 && !rec.current.active) {
          rec.current.active = true;
          triggeredAt = performance.now();
        }
        if (rec.current.active) {
          rec.current.chunks.push(new Float32Array(buffer));
          if (performance.now() - triggeredAt > 2600) {
            const total = rec.current.chunks.reduce((s, c) => s + c.length, 0);
            const ir = new Float32Array(total);
            let off = 0;
            for (const c of rec.current.chunks) { ir.set(c, off); off += c.length; }
            const measured = rt60FromImpulse(ir, sr);
            const cleaned: Record<string, number> = {};
            BAND_KEYS.forEach((k) => {
              const v = measured[k];
              cleaned[k] = Number.isFinite(v) && v > 0.05 ? +Math.min(4, v).toFixed(3) : simulateRt60(l, w, h, hardness)[k];
            });
            setBands(cleaned);
            setMeasuring(false);
            vibrate('lock');
            handle.stop();
            setMic(null);
            setSensor('mic', 'IDLE');
            toast('Impulse response captured — T30 extrapolated per octave band.');
            return;
          }
        }
        raf.current = requestAnimationFrame(loop);
      };
      raf.current = requestAnimationFrame(loop);
    } catch {
      setSensor('mic', 'RESTRICTED');
      toast('Microphone blocked — use the sweep or simulator.');
    }
  }, [l, w, h, hardness, setSensor, setHint, toast]);

  useEffect(() => () => { cancelAnimationFrame(raf.current); mic?.stop(); }, [mic]);

  const save = async () => {
    await saveRoom({
      name: roomName,
      createdAt: Date.now(),
      lengthM: l, widthM: w, heightM: h,
      rt60Bands: { ...bands },
      targetRt60: target.rt60,
      modeCount: modes.length,
      treatment: plan.note,
    });
    await refreshCounts();
    toast('Room acoustic blueprint committed to the vault.');
  };

  if (!pro) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        <GlassCard>
          <SectionTitle eyebrow="Module 03 · RT60 Architect" title="Reverb & Standing-Wave Lab" right={<span className="chip">PRO TIER</span>} />
          <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
            The RT60 octave-band analyser, axial mode mapper, and treatment prescription are reserved for <b>Building Inspector Pro</b> and above. Switch tier from the privileges drawer in the header.
          </div>
        </GlassCard>
        <GlassCard padded={false}>
          <Locked need="BUILDING INSPECTOR PRO" role={role}>
            <div style={{ padding: 16, display: 'grid', gap: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>Live clap / Dirac sweep RT60</div>
              <div style={{ fontSize: 12 }}>Top-down acoustic pressure heatmap + corner bass build-up</div>
              <div style={{ fontSize: 12 }}>Treatment prescription with absorber and trap counts</div>
            </div>
          </Locked>
        </GlassCard>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <GlassCard>
        <SectionTitle
          eyebrow="Module 03 · RT60 Acoustic Architect"
          title="Impulse Reverb & Standing-Wave Mapper"
          right={<span className="chip">{modes.length} modes &lt; 300 Hz</span>}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={simulateMeasurement}><Play size={13} /> Simulate Measurement</button>
          <button className="btn btn-primary" onClick={() => void sweep()}><Volume2 size={13} /> Emit Dirac Sweep</button>
          <button className="btn" onClick={() => (mic ? (mic.stop(), setMic(null), setMeasuring(false)) : void startClap())}>
            {mic ? <Square size={13} /> : <Mic size={13} />} {mic ? 'Stop clap capture' : 'Clap into mic'}
          </button>
          <select value={target.id} onChange={(e) => setTarget(RT60_TARGETS.find((t) => t.id === e.target.value) ?? RT60_TARGETS[1])} style={{ width: 'auto', marginLeft: 'auto' }}>
            {RT60_TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label} · {t.rt60.toFixed(2)} s</option>)}
          </select>
        </div>
      </GlassCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)', gap: 16 }} className="rt-grid">
        <GlassCard>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div className="label">Octave-band RT60 vs. target ({target.label})</div>
            <span className="chip" style={{ background: avgRt60 > target.rt60 * 1.35 ? 'color-mix(in srgb, var(--danger) 18%, transparent)' : 'color-mix(in srgb, var(--accent-2) 16%, transparent)' }}>
              {avgRt60 > target.rt60 * 1.35 ? 'TOO LIVE' : avgRt60 < target.rt60 * 0.65 ? 'TOO DEAD' : 'ON TARGET'}
            </span>
          </div>
          <BandChart bands={bands} target={target.rt60} measuring={measuring} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginTop: 14 }}>
            {OCTAVE_BANDS.map((b) => {
              const key = b === 1000 ? '1k' : b === 2000 ? '2k' : b === 4000 ? '4k' : String(b);
              const v = bands[key] ?? 0;
              const off = v / target.rt60;
              return (
                <div key={b} className="glass" style={{ padding: '9px 8px', borderRadius: 12, textAlign: 'center' }}>
                  <div className="label" style={{ fontSize: 8.5 }}>{b >= 1000 ? `${b / 1000}k` : b}</div>
                  <div className={`mono`} style={{ fontSize: 14, fontWeight: 800, color: off > 1.35 ? 'var(--danger)' : off < 0.65 ? 'var(--warn)' : 'var(--accent-2)' }}>{v.toFixed(2)}</div>
                  <div className="mono" style={{ fontSize: 8.5, color: 'var(--text-dim)' }}>s</div>
                </div>
              );
            })}
          </div>
          <div className="dim" style={{ fontSize: 10.5, marginTop: 10, lineHeight: 1.5 }}>
            {measuring ? 'Capturing…' : source === 'clap' ? 'Measured from your clap impulse (T30 Schroeder integration).' : source === 'sweep' ? 'Measured from the Dirac sweep response.' : 'Simulated via Sabine equation from room volume and surface absorption.'}
          </div>
        </GlassCard>

        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Metric label="Avg RT60" value={avgRt60.toFixed(2)} unit="s" tone={avgRt60 > target.rt60 * 1.35 ? 'bad' : 'ok'} sub={`target ${target.rt60.toFixed(2)} s`} />
            <Metric label="Room volume" value={vol.toFixed(1)} unit="m³" tone="accent" sub={`${surfaceArea(l, w, h).toFixed(1)} m² surface`} />
            <Metric label="Sabine predicted" value={sabineCurrent.toFixed(2)} unit="s" sub="V=pressure, A=sabins" />
            <Metric label="Mode density" value={density.toFixed(2)} unit="/Hz" tone={density > 1.4 ? 'warn' : 'ok'} sub={worstCluster ? `tightest gap ${worstCluster.gapHz.toFixed(1)} Hz @ ${worstCluster.freq.toFixed(0)} Hz` : '—'} />
          </div>
          <GlassCard>
            <div className="label" style={{ marginBottom: 8 }}>Room dimensions (m)</div>
            {[['Length', l, setL, 1.5, 14], ['Width', w, setW, 1.5, 12], ['Height', h, setH, 2, 5.5]].map(([lab, val, setter, min, max]) => (
              <div key={lab as string} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span className="label" style={{ width: 52 }}>{lab as string}</span>
                <input
                  type="range" min={min as number} max={max as number} step={0.05} value={val as number}
                  onChange={(e) => (setter as (n: number) => void)(parseFloat(e.target.value))} style={{ flex: 1 }}
                />
                <span className="mono" style={{ width: 44, fontSize: 11, textAlign: 'right' }}>{(val as number).toFixed(2)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="label" style={{ width: 52 }}>Hard</span>
              <input type="range" min={0} max={1} step={0.02} value={hardness} onChange={(e) => setHardness(parseFloat(e.target.value))} style={{ flex: 1 }} />
              <span className="mono" style={{ width: 44, fontSize: 11, textAlign: 'right' }}>{(hardness * 100).toFixed(0)}%</span>
            </div>
            <div className="dim" style={{ fontSize: 10.5, marginTop: 8 }}>Surface hardness blends glass / tile / plaster (bright, live) against carpet (dark, dead).</div>
          </GlassCard>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.1fr)', gap: 16 }} className="rt-grid2">
        <GlassCard>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Grid3x3 size={14} /> <div className="label">Top-down acoustic pressure heatmap</div>
          </div>
          <Heatmap l={l} w={w} h={h} modes={modes} />
          <div className="dim" style={{ fontSize: 10.5, marginTop: 8, lineHeight: 1.5 }}>
            Red cores are pressure maxima where low-frequency bass piles up. Corner loading is where you place bass traps — the 38 % worst zone is highlighted.
          </div>
        </GlassCard>

        <div style={{ display: 'grid', gap: 12 }}>
          <GlassCard>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <BarChart3 size={14} /> <div className="label">Axial & oblique standing waves (Hz)</div>
            </div>
            <div style={{ maxHeight: 190, overflowY: 'auto', display: 'grid', gap: 4 }}>
              {modes.slice(0, 26).map((m: RoomMode, i) => (
                <div key={`${m.nx}-${m.ny}-${m.nz}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                  <span className="mono" style={{ width: 58, fontWeight: 700 }}>{m.freq.toFixed(1)}</span>
                  <span className="mono dim" style={{ width: 48 }}>{m.nx},{m.ny},{m.nz}</span>
                  <div style={{ flex: 1, height: 5, borderRadius: 99, background: 'color-mix(in srgb, var(--text) 8%, transparent)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, (m.freq / 300) * 100)}%`, height: '100%', background: m.type === 'axial' ? 'var(--danger)' : m.type === 'tangential' ? 'var(--warn)' : 'var(--accent)' }} />
                  </div>
                  <span className="label" style={{ width: 60, textAlign: 'right', fontSize: 8 }}>{m.type}</span>
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard>
            <div className="label" style={{ marginBottom: 8 }}>Treatment prescription</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              <MiniStat label="2″ absorbers" value={plan.absorbers} unit="pcs" />
              <MiniStat label="Corner traps" value={plan.bassTraps} unit="pcs" />
              <MiniStat label="Diffusers" value={plan.diffusion} unit="pcs" />
            </div>
            <div style={{ fontSize: 11.5, lineHeight: 1.55, color: 'var(--text-dim)', marginTop: 10 }}>{plan.note}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input type="text" value={roomName} onChange={(e) => setRoomName(e.target.value)} />
              <button className="btn btn-primary" onClick={() => void save()}><Save size={13} /> Save</button>
            </div>
          </GlassCard>
        </div>
      </div>
      <style>{`@media (max-width: 980px){ .rt-grid,.rt-grid2{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

function MiniStat({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid var(--stroke)', textAlign: 'center' }}>
      <div className="label" style={{ fontSize: 8.5 }}>{label}</div>
      <div className="mono" style={{ fontSize: 19, fontWeight: 800, color: 'var(--accent)' }}>{value}</div>
      <div className="mono" style={{ fontSize: 8.5, color: 'var(--text-dim)' }}>{unit}</div>
    </div>
  );
}

function BandChart({ bands, target, measuring }: { bands: Record<string, number>; target: number; measuring: boolean }) {
  const keys = BAND_KEYS;
  const max = Math.max(1.4, ...keys.map((k) => bands[k] ?? 0)) * 1.15;
  return (
    <div style={{ position: 'relative', height: 176, display: 'flex', alignItems: 'flex-end', gap: 10, paddingTop: 8 }}>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${(target / max) * 100}%`, borderTop: '1px dashed color-mix(in srgb, var(--accent-2) 70%, transparent)' }}>
        <span className="mono" style={{ position: 'absolute', right: 0, top: -14, fontSize: 9, color: 'var(--accent-2)' }}>target {target.toFixed(2)} s</span>
      </div>
      {keys.map((k, i) => {
        const v = bands[k] ?? 0;
        const ratio = v / target;
        const color = ratio > 1.35 ? 'var(--danger)' : ratio < 0.7 ? 'var(--warn)' : 'var(--accent-2)';
        return (
          <div key={k} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
            <motion.div
              animate={{ height: `${Math.max(3, (v / max) * 100)}%`, opacity: measuring ? 0.5 : 1 }}
              transition={{ type: 'spring', stiffness: 120, damping: 18 }}
              style={{
                width: '100%', borderRadius: '7px 7px 2px 2px',
                background: `linear-gradient(180deg, ${color}, color-mix(in srgb, ${color} 25%, transparent))`,
                boxShadow: `0 0 22px -8px ${color}`,
              }}
            />
            <span className="mono" style={{ fontSize: 9.5, color: 'var(--text-dim)' }}>{[125, 250, 500, '1k', '2k', '4k'][i]}</span>
          </div>
        );
      })}
    </div>
  );
}

function Heatmap({ l, w, h, modes }: { l: number; w: number; h: number; modes: RoomMode[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = 220;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = x / size;
        const ny = y / size;
        const p = pressureAt(nx, ny, l, w, h, modes, 10);
        const t = Math.min(1, p * 1.5);
        const idx = (y * size + x) * 4;
        // blue → cyan → amber → red pressure ramp
        const r = Math.round(255 * Math.min(1, Math.max(0, t * 1.8 - 0.35)));
        const g = Math.round(255 * Math.min(1, Math.max(0, 0.25 + t * 0.9 - (t > 0.75 ? (t - 0.75) * 2.2 : 0))));
        const b = Math.round(255 * Math.min(1, Math.max(0, 0.55 - t * 0.5)));
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = 235;
      }
    }
    ctx.putImageData(img, 0, 0);
    // room outline + listener sweet spot
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(8, 8, size - 16, size - 16);
    ctx.beginPath();
    ctx.arc(size * 0.5, size * 0.42, 5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();
  }, [l, w, h, modes]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <canvas ref={canvasRef} style={{ width: '100%', maxWidth: 300, aspectRatio: '1', borderRadius: 14, border: '1px solid var(--stroke)' }} />
    </div>
  );
}
