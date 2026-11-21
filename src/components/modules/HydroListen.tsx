import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Droplets, Gauge, Headphones, Mic, Save, ShieldAlert, Square, Thermometer, Waves } from 'lucide-react';
import { GlassCard, Locked, Metric, SectionTitle, Toggle } from '../ui';
import { useApp, useHint, meetsTier } from '../../state/AppState';
import { LEAK_SCENARIOS, LeakStethoscope, waterWaste, type LeakScenario } from '../../services/hydroLeakEngine';
import { saveLeak } from '../../services/db';
import { micDebugLine } from '../../services/format';
import { openMic } from '../../services/audio';

export default function HydroListen() {
  const { role, toast, refreshCounts, setPrivOpen, property } = useApp();
  const setHint = useHint();
  const pro = meetsTier(role, 'inspector');
  const [scenario, setScenario] = useState<LeakScenario>(LEAK_SCENARIOS[0]);
  const [playing, setPlaying] = useState(false);
  const [restrictBand, setRestrictBand] = useState(true);
  const [notchOn, setNotchOn] = useState(true);
  const [magnify, setMagnify] = useState(1);
  const [spectrum, setSpectrum] = useState<Float32Array>(new Float32Array(0));
  const [peak, setPeak] = useState(0);
  const [bandLevel, setBandLevel] = useState(-100);
  const scope = useRef<LeakStethoscope | null>(null);
  const raf = useRef(0);
  const [liveOn, setLiveOn] = useState(false);
  const [liveState, setLiveState] = useState<'idle' | 'requesting' | 'live' | 'blocked'>('idle');
  const liveStream = useRef<MediaStream | null>(null);

  const [flowLpm, setFlowLpm] = useState(1.9);
  const [hours, setHours] = useState(24);
  const [price, setPrice] = useState(2.4);
  const [currency, setCurrency] = useState('$');
  const [tempC, setTempC] = useState(24);
  const [rh, setRh] = useState(66);
  const [unit, setUnit] = useState<'C' | 'F'>('C');

  useEffect(() => {
    if (!scope.current) scope.current = new LeakStethoscope();
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    scope.current?.stop();
    setPlaying(false);
  }, []);

  /** Shared analyser polling loop for both simulator and live-mic paths. */
  const trackAnalyser = useCallback((an: AnalyserNode) => {
    const freq = new Float32Array(an.frequencyBinCount);
    const sr = an.context.sampleRate;
    const fft = an.fftSize;
    const b0 = Math.floor((350 * fft) / sr);
    const b1 = Math.floor((2800 * fft) / sr);
    const loop = () => {
      an.getFloatFrequencyData(freq);
      setSpectrum(new Float32Array(freq));
      let mx = -160, at = 0;
      for (let i = b0; i <= b1; i++) if (freq[i] > mx) { mx = freq[i]; at = (i * sr) / fft; }
      setBandLevel(mx);
      setPeak(at);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
  }, []);

  const play = useCallback((sc: LeakScenario) => {
    cancelAnimationFrame(raf.current);
    const st = scope.current ?? new LeakStethoscope();
    scope.current = st;
    const an = st.start(sc, magnify, { bandLimit: restrictBand, notch: notchOn });
    setPlaying(true);
    setHint(`Listening: ${sc.label}. The chain keeps 350–2800 Hz and notches 50/60 Hz.`);
    trackAnalyser(an);
  }, [magnify, setHint, restrictBand, notchOn, trackAnalyser]);

  const startLive = useCallback(async () => {
    setLiveState('requesting');
    try {
      const handle = await openMic(2048, 0.6);
      liveStream.current = handle.stream;
      cancelAnimationFrame(raf.current);
      const st = scope.current ?? new LeakStethoscope();
      scope.current = st;
      const an = st.startLive(handle.stream, { bandLimit: restrictBand, notch: notchOn }, magnify);
      setLiveOn(true);
      setLiveState('live');
      setPlaying(false);
      setHint('Hold the phone flat against the wall or floor. Headphones recommended — the mic is amplified through the same filter chain.');
      trackAnalyser(an);
    } catch {
      setLiveState('blocked');
      toast('Microphone blocked — the four plumbing simulators still work.');
    }
  }, [magnify, restrictBand, notchOn, setHint, toast, trackAnalyser]);

  const stopLive = useCallback(() => {
    cancelAnimationFrame(raf.current);
    scope.current?.stop();
    liveStream.current?.getTracks().forEach((t) => t.stop());
    liveStream.current = null;
    setLiveOn(false);
    setLiveState('idle');
    setSpectrum(new Float32Array(0));
    setPeak(0);
    setBandLevel(-100);
  }, []);

  useEffect(() => { scope.current?.setGain(magnify); }, [magnify]);
  useEffect(() => {
    if (liveOn && liveStream.current) {
      cancelAnimationFrame(raf.current);
      const an = scope.current?.startLive(liveStream.current, { bandLimit: restrictBand, notch: notchOn }, magnify);
      if (an) trackAnalyser(an);
      return;
    }
    if (playing) play(scenario);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restrictBand, notchOn]);
  useEffect(() => () => { cancelAnimationFrame(raf.current); scope.current?.stop(); liveStream.current?.getTracks().forEach((t) => t.stop()); }, []);

  useEffect(() => {
    if (scenario) setFlowLpm(scenario.flowLpm);
  }, [scenario]);

  const tempCC = unit === 'C' ? tempC : ((tempC - 32) * 5) / 9;
  const waste = waterWaste({ flowLpm: pro ? flowLpm : scenario.flowLpm, dripHoursPerDay: hours, pricePerM3: price, currency, tempC: tempCC, rhPct: rh });

  const save = async () => {
    await saveLeak({
      property,
      createdAt: Date.now(),
      scenario: scenario.label,
      peakHz: Math.round(peak || scenario.centerHz),
      bandDb: Math.round(bandLevel),
      flowLpm,
      gallonsMonth: +waste.gallonsMonth.toFixed(1),
      costYear: +waste.costYear.toFixed(2),
      dewPointC: +waste.dewPointC.toFixed(1),
      moldRisk: waste.moldRisk,
      notes: `${waste.litresMonth.toFixed(0)} L/mo · ${currency}${waste.costYear.toFixed(0)}/yr · dew ${waste.dewPointC.toFixed(1)}°C`,
    });
    await refreshCounts();
    toast('Leak report saved to the plumbing ledger.');
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <GlassCard>
        <SectionTitle
          eyebrow="Module 02 · Hydro-Listen Lab"
          title="Sub-Surface Leak Stethoscope"
          right={
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="chip"><Headphones size={11} /> 350–2800 Hz BPF</span>
              <button
                className={`btn ${liveOn ? 'btn-primary' : ''}`}
                onClick={() => (liveOn ? stopLive() : void startLive())}
                disabled={liveState === 'requesting'}
              >
                {liveOn ? <Square size={13} /> : <Mic size={13} />}
                {liveState === 'requesting' ? 'Opening mic…' : liveOn ? 'Stop live listen' : 'Live listen through wall'}
              </button>
            </div>
          }
        />
        <div className="dim" style={{ fontSize: 12, lineHeight: 1.55, maxWidth: 780 }}>
          A real <b>BiquadFilterNode</b> chain isolates turbulent cavitation: high-pass at 350 Hz rejects footfall and HVAC rumble, low-pass at 2.8 kHz rejects hiss from air leaks, and 50/60 Hz notches kill electrical hum. Inject a plumbing signature below, or switch to live mic to listen through a wall.
        </div>
        {liveOn && (
          <div className="glass" style={{ marginTop: 12, padding: '9px 12px', borderRadius: 12, display: 'flex', gap: 9, alignItems: 'center', borderColor: 'color-mix(in srgb, var(--accent-2) 45%, transparent)' }}>
            <Mic size={13} color="var(--accent-2)" />
            <span style={{ fontSize: 11, fontWeight: 700 }}>LIVE STETHOSCOPE</span>
            <span className="dim" style={{ fontSize: 10.5 }}>amplified mic → HP 350 / LP 2800 / notch 50–60 Hz → speakers. Use headphones to avoid feedback.</span>
            <span className="mono" style={{ marginLeft: 'auto', fontSize: 9.5, color: 'var(--accent-2)' }}>{bandLevel.toFixed(0)} dBFS</span>
          </div>
        )}
        {liveState === 'blocked' && (
          <div className="dim" style={{ marginTop: 10, fontSize: 10.5 }}>Mic blocked — grant permission in the privileges drawer, or keep using the simulators.</div>
        )}
        <div style={{ display: 'flex', gap: 18, marginTop: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="label">Band limiting</span><Toggle on={restrictBand} onClick={() => setRestrictBand((v) => !v)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="label">Hum notch</span><Toggle on={notchOn} onClick={() => setNotchOn((v) => !v)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <span className="label">Magnify</span>
            <input type="range" min={0.5} max={4} step={0.1} value={magnify} onChange={(e) => setMagnify(parseFloat(e.target.value))} style={{ width: 110 }} />
            <span className="mono" style={{ fontSize: 11 }}>{magnify.toFixed(1)}×</span>
          </div>
        </div>
      </GlassCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.15fr)', gap: 16 }} className="hy-grid">
        <div style={{ display: 'grid', gap: 12 }}>
          {LEAK_SCENARIOS.map((sc) => {
            const active = playing && scenario.id === sc.id;
            return (
              <motion.div key={sc.id} whileHover={{ scale: 1.01, y: -1 }} whileTap={{ scale: 0.985 }} transition={{ type: 'spring', stiffness: 320, damping: 26 }}>
                <div
                  className="glass"
                  role="button"
                  tabIndex={0}
                  onClick={() => { stopLive(); setScenario(sc); if (active) stop(); else play(sc); }}
                  style={{
                    padding: 14, cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center',
                    borderColor: active ? sc.color : undefined,
                    boxShadow: active ? `0 0 30px -10px ${sc.color}` : undefined,
                  }}
                >
                  <div style={{
                    width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', flexShrink: 0,
                    background: `${sc.color}22`, border: `1px solid ${sc.color}55`,
                  }}>
                    {active ? <Waves size={17} color={sc.color} /> : <Droplets size={17} color={sc.color} />}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 750 }}>{sc.label}</div>
                    <div className="dim" style={{ fontSize: 10.5, marginTop: 2 }}>{sc.detail}</div>
                  </div>
                  <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                    <div className="mono" style={{ fontSize: 12, fontWeight: 800, color: sc.color }}>{sc.centerHz} Hz</div>
                    <div className="mono dim" style={{ fontSize: 9.5 }}>{sc.levelDb} dBFS</div>
                  </div>
                </div>
              </motion.div>
            );
          })}
          <button className="btn" onClick={() => setPrivOpen(true)}><Gauge size={13} /> Sensor permissions & live mic</button>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <GlassCard>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div className="label">Stethoscope spectrum</div>
              <div className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>peak {Math.round(peak)} Hz · {bandLevel.toFixed(0)} dBFS</div>
            </div>
            <Spectrum data={spectrum} />
            <div className="mono dim" style={{ fontSize: 9.5, marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
              <span>0</span><span>350 Hz</span><span>1.4k</span><span>2.8k</span><span>6k</span>
            </div>
          </GlassCard>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Metric label="Detected peak" value={Math.round(peak)} unit="Hz" tone="accent" sub={scenario.label} />
            <Metric label="Band level" value={bandLevel.toFixed(0)} unit="dBFS" tone={bandLevel > -30 ? 'bad' : 'ok'} sub="350–2800 Hz window" />
          </div>
          <GlassCard>
            <div className="label" style={{ marginBottom: 6 }}>Water waste & psychrometric model</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Leak flow (L/min)">
                <input type="number" min={0} max={30} step={0.1} value={flowLpm} disabled={!pro} onChange={(e) => setFlowLpm(parseFloat(e.target.value) || 0)} />
              </Field>
              <Field label="Active hours / day">
                <input type="number" min={1} max={24} value={hours} onChange={(e) => setHours(parseFloat(e.target.value) || 1)} />
              </Field>
              <Field label={`Water price (${currency}/m³)`}>
                <input type="number" min={0} step={0.1} value={price} onChange={(e) => setPrice(parseFloat(e.target.value) || 0)} />
              </Field>
              <Field label="Currency">
                <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {['$', '€', '£', 'KSh', 'R', '₦', '₹', 'A$'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label={`Room temp (°${unit})`}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="number" step={0.5} value={tempC} onChange={(e) => setTempC(parseFloat(e.target.value) || 0)} />
                  <button className="btn" style={{ padding: '0 9px' }} onClick={() => { setTempC(unit === 'C' ? Math.round((tempC * 9) / 5 + 32) : Math.round(((tempC - 32) * 5) / 9)); setUnit(unit === 'C' ? 'F' : 'C'); }}>{unit}</button>
                </div>
              </Field>
              <Field label={`Relative humidity ${rh}%`}>
                <input type="range" min={20} max={99} value={rh} onChange={(e) => setRh(parseInt(e.target.value, 10))} />
              </Field>
            </div>
            <div style={{ fontSize: 9.5, color: 'var(--text-dim)', marginTop: 8 }} className="mono">{micDebugLine()}</div>
          </GlassCard>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <Metric label="Gallons / month" value={waste.gallonsMonth.toFixed(0)} unit="gal" tone={waste.gallonsMonth > 2000 ? 'bad' : 'warn'} sub={`${waste.litresMonth.toFixed(0)} L / 30.4 d`} />
        <Metric label="Annual cost" value={`${currency}${waste.costYear.toFixed(2)}`} tone={waste.costYear > 120 ? 'bad' : 'accent'} sub={`${currency}${waste.costMonth.toFixed(2)} per month`} />
        <Metric label="Dew point" value={waste.dewPointC.toFixed(1)} unit="°C" tone="accent" sub={`${((waste.dewPointC * 9) / 5 + 32).toFixed(1)} °F · ${waste.absHumidity.toFixed(1)} g/m³`} />
        <Metric
          label="Mold spore risk"
          value={waste.moldRisk}
          tone={waste.moldRisk === 'CRITICAL' ? 'bad' : waste.moldRisk === 'MODERATE' ? 'warn' : 'ok'}
          sub={waste.moldNote}
          mono={false}
        />
      </div>

      <GlassCard>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <ShieldAlert size={18} color={waste.moldRisk === 'CRITICAL' ? 'var(--danger)' : 'var(--warn)'} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text-dim)' }}>
            <b style={{ color: 'var(--text)' }}>Psychrometric finding.</b> {waste.moldNote} Cavity surface estimated at {(tempCC - 3.5).toFixed(1)} °C (drywall over an exterior stud bay loses ~3.5 °C), dew point {waste.dewPointC.toFixed(1)} °C.
          </div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => void save()}><Save size={13} /> Commit leak report</button>
      </GlassCard>

      {!pro && (
        <GlassCard padded={false}>
          <Locked need="BUILDING INSPECTOR PRO" role={role}>
            <div style={{ padding: 16, fontSize: 12 }}>Custom leak-flow entry, dew-point tuning, and the full psychrometric waste calculator unlock at Inspector Pro.</div>
          </Locked>
        </GlassCard>
      )}

      <style>{`@media (max-width: 980px){ .hy-grid{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span className="label" style={{ display: 'block', marginBottom: 5 }}>{label}</span>
      {children}
    </label>
  );
}

function Spectrum({ data }: { data: Float32Array }) {
  const bins = 96;
  if (data.length === 0) {
    return (
      <div style={{ height: 132, display: 'grid', placeItems: 'center', border: '1px dashed var(--stroke)', borderRadius: 12, fontSize: 11, color: 'var(--text-dim)' }}>
        Tap a plumbing signature to begin listening
      </div>
    );
  }
  const stride = Math.floor(data.length / bins);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 132 }}>
      {Array.from({ length: bins }).map((_, i) => {
        const db = data[i * stride];
        const norm = Math.max(0, (db + 105) / 105);
        return (
          <motion.div
            key={i}
            animate={{ height: Math.max(2, norm * 132) }}
            transition={{ duration: 0.08 }}
            style={{
              flex: 1, borderRadius: 2,
              background: `hsl(${200 - norm * 180} 88% ${52 + norm * 12}%)`,
              opacity: 0.5 + norm * 0.5,
            }}
          />
        );
      })}
    </div>
  );
}
