import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity, AlertTriangle, Magnet, Mic, Radar, ShieldCheck, Sparkles, Square, Volume2, Waves } from 'lucide-react';
import { BatteryMeter, GlassCard, Metric, SectionTitle, spring, Toggle } from '../ui';
import { useApp, useHint } from '../../state/AppState';
import {
  SPAN_INCHES, SPAN_INCHES as SPAN, ThumpEmitter, WALL_MATERIALS, classify, playKnock,
  sampleWall, studCenters, type MaterialProfile,
} from '../../services/impactEchoEngine';
import { bandEnergyDb, openMic, spectralCentroidFromDb, type MicHandle } from '../../services/audio';
import { saveScan } from '../../services/db';
import type { EchoReading, MaterialKind } from '../../types';
import { vibrate } from '../../services/haptics';

export default function ImpactEcho() {
  const { setPulse, refreshCounts, toast, sensors, setSensor, setPrivOpen, property } = useApp();
  const setHint = useHint();
  const [x, setX] = useState(7.2);
  const [mode, setMode] = useState<'sim' | 'mic'>('sim');
  const [autoSweep, setAutoSweep] = useState(false);
  const [thumpOn, setThumpOn] = useState(false);
  const [mic, setMic] = useState<MicHandle | null>(null);
  const [reading, setReading] = useState<EchoReading | null>(null);
  const [liveSpectrum, setLiveSpectrum] = useState<Float32Array>(new Float32Array(0));
  const [micCentroid, setMicCentroid] = useState(0);
  const [micDecay, setMicDecay] = useState(0);
  const [thumpHz, setThumpHz] = useState(120);
  const [spanScans, setSpanScans] = useState<{ x: number; kind: MaterialKind }[]>([]);
  const [name, setName] = useState('TV wall — living room');
  const emitter = useRef(new ThumpEmitter());
  const sweepDir = useRef(1);
  const analyzerRaf = useRef<number>(0);
  const peakRef = useRef<{ t: number; centroid: number; amp: number }>({ t: 0, centroid: 0, amp: 0 });
  const lastStudZone = useRef(false);

  const profile = useMemo(() => sampleWall(x), [x]);
  const studs = useMemo(() => studCenters(), []);

  /* ---------------- simulator: knob follows sensor position ---------------- */
  useEffect(() => {
    if (mode !== 'sim') return;
    const r = classify(profile.centroidHz, profile.decayMs, profile.magnetUt, profile.kind === 'conduit' ? 0.62 : 0.03);
    setReading(r);
    setPulse(r.severity === 'danger' ? 'danger' : r.kind === 'stud' ? 'stud' : 'safe');
    if (r.severity === 'danger' && Math.random() < 0.55) vibrate('heavy');
    setSpanScans((prev) => {
      const idx = Math.round(x * 2);
      const next = [...prev];
      next[idx] = { x, kind: r.kind };
      return next.filter(Boolean);
    });
    if (r.kind !== 'pipe' && r.kind !== 'conduit') setThumpHz(Math.round(profile.carrierHz * 0.42));
  }, [profile, mode, setPulse, x]);

  /* ---------------- auto sweep ---------------- */
  useEffect(() => {
    if (!autoSweep) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setX((prev) => {
        let next = prev + sweepDir.current * dt * 3.2;
        if (next >= SPAN) { next = SPAN; sweepDir.current = -1; }
        if (next <= 0) { next = 0; sweepDir.current = 1; }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [autoSweep]);

  /* ---------------- thump emitter ---------------- */
  useEffect(() => {
    if (thumpOn) {
      emitter.current.start(thumpHz, 0.22);
    } else {
      emitter.current.stop();
    }
    return () => emitter.current.stop();
  }, [thumpOn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (thumpOn) emitter.current.setFreq(thumpHz);
  }, [thumpHz, thumpOn]);

  /* ---------------- live mic ---------------- */
  const startMic = useCallback(async () => {
    try {
      const handle = await openMic(2048, 0.4);
      setMic(handle);
      setSensor('mic', 'ACTIVE');
      setMode('mic');
      setHint('Tap the wall 10–20 cm from the phone. Analyser tracks centroid + decay.');
      const freq = new Float32Array(handle.analyser.frequencyBinCount);
      const time = new Float32Array(handle.analyser.fftSize);
      let quietSince = performance.now();
      let decayStart = 0;
      const loop = () => {
        handle.analyser.getFloatFrequencyData(freq);
        handle.analyser.getFloatTimeDomainData(time);
        let amp = 0;
        for (let i = 0; i < time.length; i++) amp += time[i] * time[i];
        amp = Math.sqrt(amp / time.length);
        const centroid = spectralCentroidFromDb(freq, handle.analyser.context.sampleRate, handle.analyser.fftSize);
        setMicCentroid(centroid);
        setLiveSpectrum(new Float32Array(freq));

        const now = performance.now();
        if (amp > 0.055) {
          peakRef.current = { t: now, centroid, amp };
          quietSince = now;
          decayStart = decayStart || now;
          const hum = bandEnergyDb(freq, 45, 65, handle.analyser.context.sampleRate, handle.analyser.fftSize)
            - bandEnergyDb(freq, 300, 900, handle.analyser.context.sampleRate, handle.analyser.fftSize);
          const r = classify(centroid, Math.max(8, now - decayStart), hum > -8 ? 76 : 12, hum > -8 ? 0.5 : 0.02);
          setReading(r);
          setPulse(r.severity === 'danger' ? 'danger' : r.kind === 'stud' ? 'stud' : 'safe');
        } else if (peakRef.current.amp > 0) {
          const silentFor = now - quietSince;
          if (silentFor > 30 && silentFor < 900) {
            const decayMs = now - quietSince + 12;
            setMicDecay(decayMs);
            const r = classify(peakRef.current.centroid, decayMs, 12, 0.02);
            setReading(r);
            setPulse(r.severity === 'danger' ? 'danger' : r.kind === 'stud' ? 'stud' : 'safe');
          }
          if (silentFor > 900) { peakRef.current = { t: 0, centroid: 0, amp: 0 }; decayStart = 0; }
        }
        analyzerRaf.current = requestAnimationFrame(loop);
      };
      analyzerRaf.current = requestAnimationFrame(loop);
    } catch {
      setSensor('mic', 'RESTRICTED');
      toast('Microphone blocked — staying in simulator mode. Grant mic access in the browser.');
    }
  }, [setSensor, setHint, setPulse, toast]);

  const stopMic = useCallback(() => {
    cancelAnimationFrame(analyzerRaf.current);
    mic?.stop();
    setMic(null);
    setSensor('mic', 'IDLE');
    setMode('sim');
  }, [mic, setSensor]);

  useEffect(() => () => { cancelAnimationFrame(analyzerRaf.current); mic?.stop(); emitter.current.stop(); }, [mic]);

  /* ---------------- haptic stud lock ---------------- */
  useEffect(() => {
    if (!reading) return;
    const inZone = reading.kind === 'stud';
    if (inZone && !lastStudZone.current) vibrate('lock');
    lastStudZone.current = inZone;
  }, [reading]);

  const onWallPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const nx = ratio * SPAN;
    setX(nx);
    const p = sampleWall(nx);
    playKnock(p, 0.42);
  };

  const save = async () => {
    const verdicts = spanScans.filter(Boolean).map((s) => ({ x: +s.x.toFixed(2), kind: s.kind, centroidHz: Math.round(sampleWall(s.x).centroidHz) }));
    await saveScan({
      name,
      property,
      createdAt: Date.now(),
      spanInches: SPAN_INCHES,
      verdicts,
      studCenters: studs,
      hazards: verdicts.filter((v) => v.kind === 'pipe' || v.kind === 'conduit').length,
      notes: `Scanned ${verdicts.length} sample points. Sensor final position ${x.toFixed(1)}".`,
    });
    await refreshCounts();
    toast('Wall scan committed to the IndexedDB vault + sync queue.');
  };

  const tone = reading?.severity === 'danger' ? 'bad' : reading?.kind === 'stud' ? 'ok' : 'accent';

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <GlassCard>
        <SectionTitle
          eyebrow="Module 01 · Impact-Echo NDT"
          title="Wall / Stud / Conduit Scanner"
          right={
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => { setMode('sim'); stopMic(); }}>
                <Radar size={14} /> Simulator
              </button>
              <button className={`btn ${mode === 'mic' ? 'btn-primary' : ''}`} onClick={() => (mic ? stopMic() : void startMic())}>
                <Mic size={14} /> {mic ? 'Stop Live Mic' : 'Live Mic Tap'}
              </button>
            </div>
          }
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="chip"><Activity size={11} /> {mode === 'mic' ? 'LIVE UNCOMPRESSED INPUT' : 'PHYSICS SIMULATOR'}</span>
          <span className="chip"><Magnet size={11} /> Flux {reading ? reading.magnetUt.toFixed(0) : '—'} µT</span>
          <span className="chip">FFT 2048</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="label">Auto-sweep</span>
            <Toggle on={autoSweep} onClick={() => setAutoSweep((v) => !v)} label="Auto sweep" />
          </div>
        </div>
      </GlassCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.55fr) minmax(0,1fr)', gap: 16, alignItems: 'start' }} className="ie-grid">
        <div style={{ display: 'grid', gap: 16 }}>
          <GlassCard>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div className="label">Draggable cross-section · 24 in wall span</div>
              <div className="mono dim" style={{ fontSize: 11 }}>sensor {x.toFixed(2)} in</div>
            </div>
            <div
              onPointerDown={onWallPointer}
              onPointerMove={(e) => { if (e.buttons === 1) onWallPointer(e); }}
              style={{
                position: 'relative', height: 208, borderRadius: 18, overflow: 'hidden', cursor: 'crosshair',
                touchAction: 'none', border: '1px solid var(--stroke)',
                background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-1) 80%, transparent), color-mix(in srgb, var(--bg-0) 92%, transparent))',
              }}
            >
              {/* drywall skin */}
              <div style={{ position: 'absolute', inset: '0 0 46% 0', background: 'linear-gradient(180deg, rgba(226,232,240,0.09), rgba(148,163,184,0.04))' }} />
              {/* studs / pipes / conduit layer */}
              <div style={{ position: 'absolute', inset: '30% 0 34% 0' }}>
                {WALL_MATERIALS.filter((m) => m.xRange[1] - m.xRange[0] > 1.2).map((m, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: `${(m.xRange[0] / SPAN) * 100}%`,
                      width: `${((m.xRange[1] - m.xRange[0]) / SPAN) * 100}%`,
                      top: 0, bottom: 0, borderRadius: 4,
                      background: m.severity === 'danger'
                        ? 'linear-gradient(180deg, rgba(239,68,68,0.30), rgba(239,68,68,0.10))'
                        : m.kind === 'stud'
                          ? 'linear-gradient(180deg, rgba(16,185,129,0.32), rgba(16,185,129,0.12))'
                          : m.kind === 'hollow'
                            ? 'linear-gradient(180deg, rgba(56,189,248,0.10), transparent)'
                            : 'linear-gradient(180deg, rgba(167,139,250,0.28), rgba(167,139,250,0.10))',
                      border: `1px solid ${m.color}44`,
                    }}
                  >
                    <span style={{
                      position: 'absolute', top: 4, left: 4, fontSize: 8, letterSpacing: '.08em',
                      color: m.color, fontWeight: 800, whiteSpace: 'nowrap', opacity: 0.9,
                    }}>{m.short}</span>
                  </div>
                ))}
              </div>
              {/* measurement ruler */}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 30, display: 'flex' }}>
                {Array.from({ length: 25 }).map((_, i) => (
                  <div key={i} style={{ flex: 1, borderLeft: '1px solid var(--stroke)', position: 'relative' }}>
                    {i % 4 === 0 && <span className="mono" style={{ position: 'absolute', top: 9, left: 3, fontSize: 8, color: 'var(--text-dim)' }}>{i}"</span>}
                  </div>
                ))}
              </div>
              {/* sensor head */}
              <motion.div
                animate={{ left: `${(x / SPAN) * 100}%` }}
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                style={{ position: 'absolute', top: 0, bottom: 0, width: 2, background: 'var(--accent)', boxShadow: '0 0 18px var(--accent)', transform: 'translateX(-1px)' }}
              >
                <div style={{
                  position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)',
                  width: 26, height: 26, borderRadius: 99, background: 'var(--glass-strong)',
                  border: '1px solid var(--accent)', display: 'grid', placeItems: 'center', fontSize: 12,
                }}>📡</div>
                <div style={{ position: 'absolute', bottom: 34, left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>
                  <span className="chip mono" style={{ fontSize: 9 }}>{profile.short}</span>
                </div>
              </motion.div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
              <input type="range" min={0} max={SPAN} step={0.05} value={x} onChange={(e) => { setX(parseFloat(e.target.value)); }} style={{ flex: 1 }} />
              <button className="btn" onClick={() => playKnock(profile, 0.5)}><Volume2 size={13} /> Knock</button>
            </div>
            <div className="dim" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.45 }}>
              Drag anywhere on the wall (or the slider) — each material plays its real impact response: hollow cavities ring long and low, studs damp fast and bright, copper pipe and live Romex spike magnetic flux.
            </div>
          </GlassCard>

          <GlassCard>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div className="label">Subsurface density radar</div>
              <div className="chip mono" style={{ fontSize: 9 }}>60 fps</div>
            </div>
            <DensityRadar x={x} reading={reading} scans={spanScans} />
            <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
              {[['Hollow', '#38bdf8'], ['Stud', '#34d399'], ['Pipe', '#f43f5e'], ['Conduit', '#f59e0b'], ['Tile', '#a78bfa']].map(([l, c]) => (
                <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-dim)' }}>
                  <i style={{ width: 8, height: 8, borderRadius: 2, background: c }} /> {l}
                </span>
              ))}
            </div>
          </GlassCard>

          <GlassCard>
            <div className="label" style={{ marginBottom: 10 }}>Active acoustic thump emitter (80–450 Hz)</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className={`btn ${thumpOn ? 'btn-primary' : ''}`} onClick={() => setThumpOn((v) => !v)}>
                {thumpOn ? <Square size={13} /> : <Waves size={13} />} {thumpOn ? 'Stop emitter' : 'Emit thump'}
              </button>
              <input type="range" min={80} max={450} step={1} value={thumpHz} onChange={(e) => setThumpHz(parseInt(e.target.value, 10))} style={{ flex: 1, minWidth: 140 }} />
              <span className="mono" style={{ fontSize: 12, minWidth: 63 }}>{thumpHz} Hz</span>
            </div>
            <div className="dim" style={{ fontSize: 11, marginTop: 8 }}>
              Place the phone against the wall and sweep 80–450 Hz. Solid studs transmit the tone; cavities swallow it. Use the mic to watch the response.
            </div>
          </GlassCard>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <GlassCard style={{ padding: 20 }}>
            <div className="label">Classifier verdict</div>
            <AnimatePresence mode="wait">
              <motion.div
                key={reading?.verdict ?? 'none'}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={spring}
                style={{ marginTop: 10 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {reading?.severity === 'danger'
                    ? <AlertTriangle size={22} color="var(--danger)" />
                    : reading?.kind === 'stud'
                      ? <ShieldCheck size={22} color="var(--accent-2)" />
                      : <Sparkles size={22} color="var(--accent)" />}
                  <div style={{ fontSize: 17, fontWeight: 850, letterSpacing: '-0.01em', lineHeight: 1.2 }}>
                    {reading ? labelFor(reading.kind) : 'Awaiting impulse'}
                  </div>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.5 }}>{reading?.note ?? 'Tap or drag to capture an impulse response.'}</div>
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }} className="label">
                    <span>Confidence</span><span className="mono">{reading ? (reading.confidence * 100).toFixed(0) : 0}%</span>
                  </div>
                  <div style={{ marginTop: 6 }}><BatteryMeter value={(reading?.confidence ?? 0) * 100} tone={reading?.severity === 'danger' ? 'bad' : 'accent'} /></div>
                </div>
              </motion.div>
            </AnimatePresence>
          </GlassCard>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Metric label="Spectral centroid" value={reading ? Math.round(mode === 'mic' ? micCentroid || reading.centroidHz : reading.centroidHz) : '—'} unit="Hz" tone={tone} sub="Σ(f·A)/ΣA over 2048-pt FFT" />
            <Metric label="Impulse decay τ" value={reading ? (mode === 'mic' ? Math.round(micDecay || reading.decayMs) : Math.round(reading.decayMs)) : '—'} unit="ms" tone={reading?.severity === 'danger' ? 'bad' : 'accent'} sub="−60 dB ring-down estimate" />
            <Metric label="Magnetics" value={reading ? reading.magnetUt.toFixed(0) : '—'} unit="µT" tone={(reading?.magnetUt ?? 0) > 70 ? 'bad' : 'ok'} sub="Earth field ≈ 25–65 µT" />
            <Metric label="50/60 Hz hum" value={reading ? (reading.hum60 * 100).toFixed(0) : '—'} unit="%" tone={(reading?.hum60 ?? 0) > 0.4 ? 'bad' : 'ok'} sub="Live-conduit signature" />
          </div>

          <GlassCard>
            <div className="label" style={{ marginBottom: 8 }}>Spectral centroid band</div>
            <CentroidGauge hz={reading ? reading.centroidHz : 0} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: 'var(--text-dim)', marginTop: 6 }} className="mono">
              <span>110</span><span>175</span><span>290</span><span>460</span><span>700+</span>
            </div>
          </GlassCard>

          {mode === 'mic' && liveSpectrum.length > 0 && (
            <GlassCard>
              <div className="label" style={{ marginBottom: 8 }}>Live spectrum (dBFS)</div>
              <SpectrumBars data={liveSpectrum} />
            </GlassCard>
          )}

          <GlassCard>
            <div className="label" style={{ marginBottom: 8 }}>Commit scan to vault</div>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Scan label" />
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 10 }} onClick={() => void save()}>
              Save wall scan ({spanScans.filter(Boolean).length} pts)
            </button>
            <button className="btn" style={{ width: '100%', marginTop: 8 }} onClick={() => setPrivOpen(true)}>
              Sensor permissions
            </button>
            <div className="dim" style={{ fontSize: 10.5, marginTop: 8 }}>
              Mic: <b>{sensors.mic}</b> · Haptics: <b>{sensors.haptics}</b>
            </div>
          </GlassCard>
        </div>
      </div>

      <style>{`@media (max-width: 980px){ .ie-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

function labelFor(kind: MaterialKind): string {
  switch (kind) {
    case 'hollow': return 'HOLLOW CAVITY — no solid backing';
    case 'stud': return 'SOLID STUD CENTER — safe to anchor';
    case 'pipe': return 'DANGER: PRESSURIZED PIPE';
    case 'conduit': return 'DANGER: LIVE METAL CONDUIT';
    case 'tile': return 'DELAMINATED TILE — hollow ring';
  }
}

function CentroidGauge({ hz }: { hz: number }) {
  const max = 800;
  const pct = Math.min(100, (hz / max) * 100);
  return (
    <div style={{ position: 'relative', height: 40, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--stroke)' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, #38bdf8 0%, #22d3ee 22%, #34d399 40%, #a78bfa 62%, #f59e0b 82%, #f43f5e 100%)', opacity: 0.28 }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, width: 3, left: `${pct}%`, background: 'var(--text)', boxShadow: '0 0 12px #fff', transition: 'left .12s linear' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <span className="mono" style={{ fontSize: 13, fontWeight: 800, textShadow: '0 1px 6px #000' }}>{Math.round(hz)} Hz</span>
      </div>
    </div>
  );
}

function SpectrumBars({ data }: { data: Float32Array }) {
  const bins = 64;
  const stride = Math.floor(data.length / bins);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 60 }}>
      {Array.from({ length: bins }).map((_, i) => {
        const db = data[i * stride];
        const h = Math.max(2, Math.min(60, ((db + 100) / 100) * 60));
        return <div key={i} style={{ flex: 1, height: h, borderRadius: 2, background: `hsl(${190 - i * 1.6} 90% 60%)`, opacity: 0.85 }} />;
      })}
    </div>
  );
}

function DensityRadar({ x, reading, scans }: { x: number; reading: EchoReading | null; scans: { x: number; kind: MaterialKind }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phase = useRef(0);
  // Live values live in refs so the rAF loop is started once instead of
  // being torn down on every pointer move / state update.
  const live = useRef({ x, reading, scans });
  live.current = { x, reading, scans };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const colors: Record<MaterialKind, string> = {
      hollow: '#38bdf8', stud: '#34d399', pipe: '#f43f5e', conduit: '#f59e0b', tile: '#a78bfa',
    };

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width, h = rect.height;
      ctx.clearRect(0, 0, w, h);
      phase.current += 0.045;

      // radar rings
      for (let r = 1; r <= 4; r++) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(148,197,255,${0.16 - r * 0.025})`;
        ctx.lineWidth = 1;
        ctx.arc(w / 2, h * 0.62, (r / 4) * Math.min(w, h) * 0.85, 0, Math.PI * 2);
        ctx.stroke();
      }
      // sweep beam
      const beam = ctx.createLinearGradient(w / 2, h * 0.62, w / 2 + Math.cos(phase.current) * w * 0.6, h * 0.62 + Math.sin(phase.current) * h * 0.6);
      beam.addColorStop(0, 'rgba(34,211,238,0.5)');
      beam.addColorStop(1, 'rgba(34,211,238,0)');
      ctx.beginPath();
      ctx.moveTo(w / 2, h * 0.62);
      ctx.lineTo(w / 2 + Math.cos(phase.current - 0.4) * w, h * 0.62 + Math.sin(phase.current - 0.4) * h);
      ctx.lineTo(w / 2 + Math.cos(phase.current) * w, h * 0.62 + Math.sin(phase.current) * h);
      ctx.closePath();
      ctx.fillStyle = beam;
      ctx.fill();

      const { x: cx, reading: rd, scans: pts } = live.current;

      // scanned density blobs
      pts.forEach((s) => {
        if (!s) return;
        const nx = s.x / SPAN;
        const px = w * (0.08 + nx * 0.84);
        const depth = s.kind === 'stud' ? 0.2 : s.kind === 'hollow' ? 0.85 : 0.45;
        const py = h * (0.3 + depth * 0.5);
        const rad = s.kind === 'hollow' ? 7 : 11;
        const g = ctx.createRadialGradient(px, py, 0, px, py, rad * 2.4);
        g.addColorStop(0, colors[s.kind]);
        g.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.fillStyle = g;
        ctx.arc(px, py, rad * 2.4, 0, Math.PI * 2);
        ctx.fill();
      });

      // live sensor pin
      const px = w * (0.08 + (cx / SPAN) * 0.84);
      const py = h * 0.62;
      const pulse = 10 + Math.sin(phase.current * 3) * 4;
      ctx.beginPath();
      ctx.strokeStyle = rd?.severity === 'danger' ? '#f43f5e' : '#22d3ee';
      ctx.lineWidth = 2;
      ctx.arc(px, py, pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = rd?.severity === 'danger' ? '#f43f5e' : '#22d3ee';
      ctx.arc(px, py, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(226,232,240,0.22)';
      ctx.setLineDash([3, 4]);
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
      ctx.setLineDash([]);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);

  return <canvas ref={canvasRef} style={{ width: '100%', height: 210, display: 'block' }} />;
}
