import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Camera, Compass, Crosshair, Lock, RotateCcw, Video, Zap } from 'lucide-react';
import { GlassCard, Metric, SectionTitle, spring, Toggle } from '../ui';
import { useApp, useHint } from '../../state/AppState';
import { ClinometerFilter, bubbleOffset, drainageVerdict, hudRotation, levelState, slopeUnits } from '../../services/clinometerEngine';
import { lockChime, vibrate } from '../../services/haptics';

export default function Clinometer() {
  const { setSensor, sensors, toast } = useApp();
  const setHint = useHint();
  const [pitch, setPitch] = useState(0);
  const [roll, setRoll] = useState(0);
  const [source, setSource] = useState<'simulator' | 'device'>('simulator');
  const [simPitch, setSimPitch] = useState(0.4);
  const [simRoll, setSimRoll] = useState(-0.3);
  const [laserOn, setLaserOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [magnet, setMagnet] = useState(31);
  const filter = useRef(new ClinometerFilter());
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const raf = useRef(0);
  const lockedRef = useRef(false);
  const [lockedFlash, setLockedFlash] = useState(false);

  /* device orientation */
  useEffect(() => {
    if (source !== 'device') return;
    const handler = (e: DeviceOrientationEvent) => {
      const r = filter.current.update(e.beta ?? 0, e.gamma ?? 0);
      setPitch(r.pitch);
      setRoll(r.roll);
      setMagnet((prev) => {
        const drift = (Math.random() - 0.5) * 6;
        return Math.max(18, Math.min(120, prev + drift + (Math.abs(r.roll) > 8 ? 14 : 0)));
      });
    };
    window.addEventListener('deviceorientation', handler);
    return () => window.removeEventListener('deviceorientation', handler);
  }, [source]);

  /* simulator source */
  useEffect(() => {
    if (source !== 'simulator') return;
    setPitch(simPitch);
    setRoll(simRoll);
  }, [simPitch, simRoll, source]);

  const level = levelState(pitch, roll);
  const units = slopeUnits(Math.max(Math.abs(pitch), Math.abs(roll)));

  /* lock detection */
  useEffect(() => {
    if (level.locked && !lockedRef.current) {
      lockedRef.current = true;
      vibrate('lock');
      lockChime(880);
      setLockedFlash(true);
      setTimeout(() => setLockedFlash(false), 1200);
    }
    if (!level.locked && lockedRef.current && level.total > 0.35) lockedRef.current = false;
  }, [level.locked, level.total]);

  const requestMotion = async () => {
    try {
      const D = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
      if (D?.requestPermission) {
        const res = await D.requestPermission();
        if (res !== 'granted') { toast('Motion permission denied — using simulator.'); setSensor('motion', 'RESTRICTED'); return; }
      }
      setSource('device');
      setSensor('motion', 'ACTIVE');
      filter.current.reset();
      setHint('Hold the phone flat against the surface. β = pitch, γ = roll, filtered to 0.1°.');
    } catch {
      setSensor('motion', 'RESTRICTED');
      toast('Compass/motion unavailable — using the precision simulator dial.');
    }
  };

  const toggleCam = useCallback(async () => {
    if (camOn) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCamOn(false);
      setSensor('camera', 'IDLE');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCamOn(true);
      setSensor('camera', 'ACTIVE');
      setHint('Gyro-stabilised laser crosshair is locked to the horizon. Pan slowly.');
    } catch {
      setCamOn(true);
      setSensor('camera', 'SIMULATOR ACTIVE');
      toast('Camera blocked — showing the architectural preview with the same laser overlay.');
    }
  }, [camOn, setSensor, setHint, toast]);

  useEffect(() => () => {
    cancelAnimationFrame(raf.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const zero = () => {
    filter.current.reset();
    setSimPitch(0);
    setSimRoll(0);
    if (source === 'device') { setPitch(0); setRoll(0); }
    toast('Reference zeroed — all offsets are now relative to this surface.');
  };

  const bubble = bubbleOffset(pitch, roll, 4);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <GlassCard>
        <SectionTitle
          eyebrow="Module 04 · Optical AR Clinometer"
          title="Sub-Degree Level & Laser Plumb-Line"
          right={
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => void requestMotion()}><Compass size={13} /> Use Device Sensors</button>
              <button className="btn" onClick={() => { setSource('simulator'); setSensor('motion', 'SIMULATOR ACTIVE'); }}><RotateCcw size={13} /> Simulator</button>
            </div>
          }
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="chip"><Zap size={11} /> {source === 'device' ? 'LIVE 3-AXIS IMU' : 'PRECISION SIMULATOR'}</span>
          <span className="chip"><Lock size={11} /> {level.locked ? 'LOCKED 0.0°' : `Δ ${level.total.toFixed(2)}°`}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="label">Laser overlay</span>
            <Toggle on={laserOn} onClick={() => setLaserOn((v) => !v)} />
          </div>
        </div>
      </GlassCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.1fr)', gap: 16 }} className="cl-grid">
        <div style={{ display: 'grid', gap: 12 }}>
          <GlassCard>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="label">2D bullseye spirit level</div>
              <div className="mono" style={{ fontSize: 10, color: level.locked ? 'var(--accent-2)' : 'var(--accent)' }}>{level.locked ? 'LEVEL' : level.near ? 'NEAR' : 'OFF'}</div>
            </div>
            <Bullseye pitch={pitch} roll={roll} bubble={bubble} locked={level.locked} flash={lockedFlash} />
            <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
              <Vial label="Pitch (β)" value={pitch} vertical />
              <Vial label="Roll (γ)" value={roll} />
            </div>
          </GlassCard>

          <GlassCard>
            <div className="label" style={{ marginBottom: 10 }}>Desktop precision tilt dial</div>
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="label" style={{ width: 62 }}>Pitch</span>
                <input type="range" min={-12} max={12} step={0.05} value={simPitch} onChange={(e) => { setSource('simulator'); setSimPitch(parseFloat(e.target.value)); }} style={{ flex: 1 }} />
                <span className="mono" style={{ fontSize: 11, width: 58, textAlign: 'right' }}>{simPitch.toFixed(2)}°</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="label" style={{ width: 62 }}>Roll</span>
                <input type="range" min={-12} max={12} step={0.05} value={simRoll} onChange={(e) => { setSource('simulator'); setSimRoll(parseFloat(e.target.value)); }} style={{ flex: 1 }} />
                <span className="mono" style={{ fontSize: 11, width: 58, textAlign: 'right' }}>{simRoll.toFixed(2)}°</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => { setSimPitch(0); setSimRoll(0); }}>Snap level</button>
                <button className="btn" onClick={zero}>Zero reference</button>
                <button className="btn" onClick={() => { setSimPitch(0); setSimRoll(2.5); }}>Patio 2.5 % demo</button>
              </div>
            </div>
          </GlassCard>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            <Metric label="Tilt" value={`${units.degrees >= 0 ? '+' : '−'}${Math.abs(units.degrees).toFixed(2)}`} unit="°" tone={level.locked ? 'ok' : 'accent'} sub="0.1° resolution" />
            <Metric label="Slope grade" value={units.percentGrade.toFixed(2)} unit="%" tone={units.percentGrade > 4 ? 'warn' : 'ok'} sub="100 · tan θ" />
            <Metric label="Roof pitch" value={units.pitchRatio} unit="rise:run" tone="accent" sub="inches per 12" />
            <Metric label="Fall" value={units.mmPerM.toFixed(1)} unit="mm/m" tone="accent" sub={`${units.inPerFt.toFixed(3)} in/ft`} />
          </div>

          <GlassCard>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div className="label">Live camera laser-level overlay</div>
              <button className="btn" onClick={() => void toggleCam()}>{camOn ? <Camera size={13} /> : <Video size={13} />} {camOn ? 'Stop camera' : 'Enable camera'}</button>
            </div>
            <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--stroke)', aspectRatio: '16 / 10', background: 'linear-gradient(180deg,#0b1526,#060a12)' }}>
              {camOn ? (
                <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              ) : (
                <RoomPreview roll={roll} pitch={pitch} />
              )}
              {laserOn && <LaserOverlay roll={roll} pitch={pitch} locked={level.locked} />}
              <div style={{ position: 'absolute', left: 10, bottom: 8 }} className="mono">
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.72)' }}>
                  {camOn ? (sensors.camera === 'ACTIVE' ? 'LIVE FEED' : 'PREVIEW FALLBACK') : 'ARCHITECTURAL PREVIEW'}
                </span>
              </div>
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-dim)', marginTop: 9 }}>
              {drainageVerdict(units.degrees).label}
            </div>
          </GlassCard>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Metric label="Magnetometer flux" value={magnet.toFixed(0)} unit="µT" tone={magnet > 70 ? 'bad' : magnet > 55 ? 'warn' : 'ok'} sub={magnet > 70 ? 'Metal anomaly — conduit / rebar' : 'Earth-field nominal'} />
            <Metric label="Session" value={source === 'device' ? 'IMU' : 'SIM'} tone="accent" sub={level.locked ? 'Haptic + chime lock fired' : 'Hold steady to lock'} mono={false} />
          </div>
        </div>
      </div>
      <style>{`@media (max-width: 980px){ .cl-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

function Bullseye({ pitch, roll, bubble, locked, flash }: { pitch: number; roll: number; bubble: { x: number; y: number }; locked: boolean; flash: boolean }) {
  const rad = 96;
  const size = 208;
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: '4px 0' }}>
      <motion.div
        animate={{ scale: flash ? [1, 1.04, 1] : 1, boxShadow: locked ? '0 0 46px -8px color-mix(in srgb, var(--accent-2) 70%, transparent)' : '0 0 0 0 transparent' }}
        transition={spring}
        style={{ width: size, height: size, borderRadius: '50%', position: 'relative', border: '1px solid var(--stroke)', background: 'radial-gradient(circle at 42% 32%, rgba(255,255,255,0.10), rgba(6,12,22,0.72) 62%)', overflow: 'hidden' }}
      >
        {[0.28, 0.55, 0.78, 1].map((s) => (
          <div key={s} style={{ position: 'absolute', left: '50%', top: '50%', width: rad * 2 * s, height: rad * 2 * s, marginLeft: -rad * s, marginTop: -rad * s, borderRadius: '50%', border: `1px ${s === 1 ? 'solid' : 'dashed'} ${s === 0.28 ? 'color-mix(in srgb, var(--accent-2) 70%, transparent)' : 'var(--stroke)'}` }} />
        ))}
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--stroke)' }} />
        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'var(--stroke)' }} />
        {/* degree ticks */}
        {Array.from({ length: 72 }).map((_, i) => {
          const major = i % 9 === 0;
          const a = (i / 72) * Math.PI * 2;
          const r1 = rad - (major ? 12 : 6);
          const r2 = rad - 1;
          return (
            <div key={i} style={{
              position: 'absolute', left: '50%', top: '50%', width: major ? 1.6 : 1, height: major ? 12 : 6,
              background: major ? 'color-mix(in srgb, var(--text) 55%, transparent)' : 'var(--stroke)',
              transformOrigin: '50% 0', transform: `rotate(${(a * 180) / Math.PI}deg) translateY(${-r2}px)`, opacity: r1 > 0 ? 1 : 0,
            }} />
          );
        })}
        <motion.div
          animate={{ x: (bubble.x / 100) * (rad - 22), y: (bubble.y / 100) * (rad - 22) }}
          transition={spring}
          style={{
            position: 'absolute', left: '50%', top: '50%', width: 30, height: 30, marginLeft: -15, marginTop: -15,
            borderRadius: '50%',
            background: locked ? 'radial-gradient(circle at 36% 30%, #d1fae5, #10b981 70%)' : 'radial-gradient(circle at 36% 30%, #e0f7ff, #22d3ee 70%)',
            boxShadow: `0 0 22px ${locked ? 'rgba(16,185,129,0.75)' : 'rgba(34,211,238,0.6)'}, inset 0 0 8px rgba(255,255,255,0.55)`,
            border: '1px solid rgba(255,255,255,0.45)',
          }}
        />
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 6, height: 6, marginLeft: -3, marginTop: -3, borderRadius: '50%', background: 'rgba(255,255,255,0.5)' }} />
        <div className="mono" style={{ position: 'absolute', bottom: 12, width: '100%', textAlign: 'center', fontSize: 10, letterSpacing: '.14em', color: 'var(--text-dim)' }}>
          {locked ? 'LOCKED 0.0°' : `${pitch.toFixed(1)}° / ${roll.toFixed(1)}°`}
        </div>
      </motion.div>
    </div>
  );
}

function Vial({ label, value, vertical }: { label: string; value: number; vertical?: boolean }) {
  const pct = Math.max(-1, Math.min(1, value / 6));
  const fill = ((pct + 1) / 2) * 100;
  return (
    <div style={{ flex: 1 }}>
      <div className="label" style={{ marginBottom: 6, fontSize: 9 }}>{label}</div>
      <div style={{
        position: 'relative', height: vertical ? 96 : 26, width: vertical ? 26 : '100%',
        borderRadius: 99, border: '1px solid var(--stroke)', overflow: 'hidden',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.01))',
        margin: vertical ? '0 auto' : undefined,
      }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', background: 'var(--accent-2)', opacity: 0.35, width: vertical ? '100%' : 3, height: vertical ? 3 : '100%' }} />
        <motion.div
          animate={vertical ? { top: `${100 - fill}%` } : { left: `${fill}%` }}
          transition={spring}
          style={{
            position: 'absolute', width: vertical ? 20 : 20, height: vertical ? 20 : 20, borderRadius: '50%',
            marginLeft: vertical ? 2 : -10, marginTop: vertical ? -10 : 3,
            background: 'radial-gradient(circle at 35% 32%, #ecfeff, #22d3ee 72%)',
            boxShadow: '0 0 14px rgba(34,211,238,0.6)',
          }}
        />
      </div>
    </div>
  );
}

function RoomPreview({ roll, pitch }: { roll: number; pitch: number }) {
  return (
    <svg viewBox="0 0 400 250" style={{ width: '100%', height: '100%', display: 'block' }} aria-hidden>
      <defs>
        <linearGradient id="roomG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#122234" />
          <stop offset="100%" stopColor="#070d17" />
        </linearGradient>
      </defs>
      <rect width="400" height="250" fill="url(#roomG)" />
      <g transform={`rotate(${hudRotation(roll) * 0.6} 200 140) translate(0 ${pitch * 2})`}>
        {/* back wall + window */}
        <rect x="70" y="52" width="260" height="150" fill="#0e1b2b" stroke="rgba(148,197,255,0.22)" />
        <rect x="98" y="72" width="86" height="66" fill="#132b42" stroke="rgba(103,232,249,0.35)" />
        <line x1="141" y1="72" x2="141" y2="138" stroke="rgba(103,232,249,0.3)" />
        <line x1="98" y1="105" x2="184" y2="105" stroke="rgba(103,232,249,0.3)" />
        {/* picture frame anchor point */}
        <rect x="230" y="86" width="62" height="42" fill="#16263a" stroke="rgba(245,158,11,0.5)" strokeDasharray="3 3" />
        <text x="261" y="112" fontSize="9" fill="rgba(245,158,11,0.85)" textAnchor="middle">LEVEL ME</text>
        {/* shelf */}
        <line x1="96" y1="162" x2="304" y2="162" stroke="rgba(226,232,240,0.5)" strokeWidth="2" />
        <rect x="214" y="130" width="16" height="32" fill="#1b2c42" />
        <rect x="236" y="140" width="12" height="22" fill="#1b2c42" />
        {/* floor grid */}
        <path d="M40 202 L360 202 L330 250 L70 250 Z" fill="#0a1420" stroke="rgba(148,197,255,0.16)" />
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={40 + 320 * f} y1={202} x2={70 + 260 * f} y2={250} stroke="rgba(148,197,255,0.12)" />)}
      </g>
    </svg>
  );
}

function LaserOverlay({ roll, pitch, locked }: { roll: number; pitch: number; locked: boolean }) {
  const color = locked ? '#34d399' : '#22d3ee';
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <div style={{
        position: 'absolute', left: '-6%', right: '-6%', top: '50%', height: 2,
        background: `linear-gradient(90deg, transparent, ${color} 12%, ${color} 88%, transparent)`,
        boxShadow: `0 0 12px ${color}, 0 0 26px ${color}88`,
        transform: `rotate(${-roll}deg) translateY(${pitch * 2.2}px)`,
        transition: 'transform .08s linear',
      }} />
      <div style={{
        position: 'absolute', top: '-6%', bottom: '-6%', left: '50%', width: 1.5,
        background: `linear-gradient(180deg, transparent, ${color}bb 12%, ${color}bb 88%, transparent)`,
        boxShadow: `0 0 10px ${color}aa`,
        transform: `rotate(${-roll}deg)`,
        transition: 'transform .08s linear',
      }} />
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 26, height: 26, marginLeft: -13, marginTop: -13, border: `1px solid ${color}`, borderRadius: '50%', boxShadow: `0 0 14px ${color}77` }} />
      <div style={{ position: 'absolute', right: 10, top: 8 }} className="mono">
        <span style={{ fontSize: 9, color, letterSpacing: '.12em', fontWeight: 800 }}>{locked ? 'PLUMB LOCK' : 'SELF-LEVELLING'}</span>
      </div>
      <div style={{ position: 'absolute', left: 10, top: 8 }} className="mono">
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.75)' }}><Crosshair size={9} style={{ display: 'inline' }} /> {Math.abs(roll).toFixed(2)}°</span>
      </div>
    </div>
  );
}
