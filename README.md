# SONO-STRUCT

Acoustic NDT workstation: impact-echo wall/stud scanner, sub-surface pipe-leak
stethoscope, RT60 room acoustics architect, and optical AR clinometer — in one
offline-first Vercel web app with a Capacitor Android replica.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build
```

## Modules

| Module | Engine | What it does |
| --- | --- | --- |
| Impact-Echo Scanner | `src/services/impactEchoEngine.ts` | Spectral centroid + impulse decay (τ) classification of hollow cavity / stud / copper pipe / live conduit / delaminated tile; magnetometer + 50–60 Hz hum fusion; draggable 24" wall cross-section simulator, thump emitter (80–450 Hz), live mic tap mode, 60 fps density radar |
| Hydro-Listen Lab | `src/services/hydroLeakEngine.ts` | Biquad chain HP 350 Hz → LP 2800 Hz → 50/60 Hz notches, four plumbing cavitation signatures, Magnus–Tetens dew point, water-waste & mould risk model |
| RT60 Architect | `src/services/rt60Architect.ts` | Dirac sweep + clap impulse capture, Schroeder T30 integration per octave band, axial/oblique mode calculator, 2D pressure heatmap, Sabine treatment prescription |
| AR Clinometer | `src/services/clinometerEngine.ts` | Complementary-filtered β/γ clinometer, bullseye + tube vials, percent grade / rise:run / mm-per-m, gyro-stabilised camera laser crosshair |
| Inspection Vault | `src/services/db.ts` | 10-point audit protocol, Dexie/IndexedDB ledger, PIN gate, JSON/CSV export, offline mutation queue |

## Android APK

`capacitor.config.ts` targets `com.sonostruct.ndt`. The APK Download Center streams
`public/releases/sonostruct-release.apk` when present, with a signed-manifest fallback.
`.github/workflows/build-and-bundle-apk.yml` builds the web bundle, syncs Capacitor,
compiles the release APK with Gradle, and publishes it to `public/releases/`.
