# Terrace — sound in ink

Local audio motion graphics inspired by the visual geometry of テラス席. Files stay on the device. Vite + TypeScript + Web Audio decoding + a Web Worker + low-resolution Canvas 2D; no React runtime is needed for the single canvas and small control surface.

Run `npm install`, then `npm run dev`. Open the local address printed by Vite. Select or drop an audio file, wait for analysis, then press Play. The rhythm sample is original procedural audio; the test sound isolates low/mid/high/silence. Appearance settings contain sensitivity and optional user-authored vertical text.

`npm run build` generates `dist/`. The old `src/score.ts` is a historical, unused file; it is not imported and its supposed reference cues/lyrics do not drive this application.

## Audio and motion

The file signature is inspected so missing MIME or incorrect extensions do not reject valid audio. The browser must still support the codec. Audio decoding and 50 Hz windowed FFT analysis generate five band energies, RMS and transient strength. Analysis uses the more energetic stereo channel to avoid cancellation; the native player plays the original full stereo audio. This is frequency analysis, not instrument separation or vocal extraction.

`src/signal.ts` is the offline analysis and feature lookup. `src/motion.ts` maps features and audio time to a deterministic frame plan and raster drawing. `src/main.ts` owns file loading, analysis cancellation and playback. The worker keeps FFT work off the interface thread. Loading a new file invalidates and cancels previous work.

Fixed geometry: 320×240 raster, 60×60 center, 15×15 printed blocks, separate perimeter ribbons, anchored nib/eraser, faster right-to-left ink history. Same audio + same time + same sensitivity produce the same frame, independent of seek history and display refresh rate. Optional caption text does not affect analysis. The observed source geometry and inferred audio mappings are documented in `REFERENCE-STUDY.md`.

## Verification

`node --experimental-strip-types verify-audio.mjs` checks audio signatures and produces local fixtures for browser file-picker testing.

`npx esbuild verify-motion.ts --bundle --platform=node --format=esm --outfile=.verification/verify-motion.mjs` followed by `node .verification/verify-motion.mjs` checks band separation with five isolated tones, silence, valid numerical output, identical plans after seeking, leftward movement while cell patterns stay fixed, and finite ink tails. These tests check motion rules, not similarity of a static screenshot alone.

Source playback was sampled throughout its duration and stepped frame-by-frame at selected transitions; not every video frame has been inspected. Exact original audio-to-graphics mappings are unknown. The implemented mappings are explicit interpretations of the observed layers, driven by the user's audio rather than a preset soundtrack timeline.

## Frame rate and beat sync

Default motion cadence is 10 FPS (100 ms held frames), following the user's observation; source encoding FPS has not been measured. Audio playback remains continuous at its original speed. All canvas geometry and texture phases use the same quantized audio clock. The 50 Hz analysis retains peaks between visual frames.

`src/tempo.ts` estimates a global BPM (65–190 automatic range) and beat offset using onset/low-band novelty, fractional-lag autocorrelation, and phase scoring. The displayed confidence is a periodicity score, not a calibrated probability. Ambiguous/non-periodic audio falls back to actual onset reactions. This is global tempo estimation, not time-varying tempo tracking, meter/downbeat detection, or instrument separation.

Detected beats set the central column sampling period/phase. Current beats and transient peaks briefly switch existing tile ink between solid and stipple; geometry remains unchanged. Beat emphasis can be set to zero. FPS, BPM override, half/double interpretation, and phase offset can be adjusted without changing the sound. A new file resets tempo overrides to automatic.

Tempo verification covers 80/100/120/127/150/180 BPM fixtures and phase recovery, silence fallback, frame holding, and tone changes on the beat while retaining tile positions. The original rhythmic demo (150 BPM) is also checked through the browser decoder and analysis worker.
