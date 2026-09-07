# Central drum tiles

## Current routing (2026-09-07)

Detected drum hits now drive both the central tiles and the pen. The EQ channel enable, bands and thresholds update both. The perimeter defaults to features from drums plus remainder, with a source selector in the appearance settings. Its segmented pieces move along the square, while signal energy and attacks control their ink. The eraser follows the arrival of the same written mark, about 1.244 seconds later. Historical non-drum pen descriptions below are superseded.


## Drum frequency control panel

Threshold control: a separate linear band-level history below the spectrum shows the last three seconds and detected-hit dots. Its horizontal threshold bar can be dragged vertically or adjusted with arrows (Shift for 0.1 steps, Home/End for bounds). It shares the channel's existing 0.02–1.5 numeric threshold and recalculates actual hits. This is a necessary level gate, not a replacement for attack and retrigger conditions. The linear level plot intentionally does not reuse the logarithmic per-frequency spectrum's vertical scale. Browser verification confirmed bar/number synchronization and the 445-hit result at KICK threshold 1.5.

The drum stem now carries a 128-bin logarithmic FFT energy history at 50 analysis frames/second. The EQ-style panel displays that history at the audio playhead independently of the 10 FPS artwork. KICK, SNARE, HAT, TOM and CYMBAL each have editable frequency bounds, detection gain, level/attack thresholds, retrigger interval and enable switch. Bounds can also be dragged on the graph. Changes are debounced for 150 ms, then recalculate the complete deterministic drum-hit timeline used by the central tiles. Settings persist across file changes within the current page session, not reloads.

Selected-band audition uses the actual drum PCM through Web Audio highpass/lowpass filters, synced to play, pause and seek. It temporarily mutes normal playback; leaving audition restores the original mute state. It does not modify mix playback or downloaded stems. Filter skirts are gradual, while detection uses spectral-bin overlap weights, so audition is a listening aid rather than an exact isolated instrument. FFT frequency resolution is limited by the 2048-sample window; moving a bound below that resolution cannot distinguish adjacent low-frequency instruments.

Validation: verify-drum-eq.ts tests spectral data, band changes, enable, thresholds, retrigger and silence. Browser sample test changed KICK level threshold from 0.16 to 1.5 and total hits changed from 503 to 445; reset restored 503. Solo activation, play/pause and return to normal playback were exercised. Existing stem and motion tests and production build passed.

The central 4×4 square stays in place. Each detected drum attack selects a seeded random cell **inside** that square. The printed tile then moves left one cell per estimated beat (0.42 seconds without a reliable tempo), clipped at the square boundary. Seeking to the same time reproduces the same selection and displacement. Fresh hits overprint older ink. The strong attack releases over 300 ms, but faint ink continues moving until it exits. The default is 10 FPS. Tempo sets transport speed; no metronome-only hits are generated.

In the earlier revision, drum-only features drove the tiles and the other stem drove perimeter fragments, rings, pen and eraser traces; see current routing above. BPM remains a global estimate, not a replacement for detected attacks. Instrument labels are spectral heuristics, not a trained drum transcription model.

Scroll consistency review: per-hit age-based coordinates created different subcell phases and per-tile rounding, allowing partially overlapping tiles and unequal pixel steps. Attacks now choose cells on a shared moving lattice. Transport is rounded once per frame; cells stay exactly 15 logical pixels apart and move identical distances. Re-strikes replace the same world-grid cell rather than stacking textures. Tests cover off-beat attacks at 80, 127, 149.75 and 180 BPM. Integer-pixel rendering at 10 FPS necessarily alternates whole-pixel step sizes at fractional speeds, but that step is now identical for every tile.

One-file mode uses local approximate HPSS separation, with complementary mono outputs. It can misassign piano/vocal attacks and leave drums in the other output. Original-file mix playback retains its original channels. Two-file mode accepts aligned drum and non-drum stems, sums playback with 6 dB headroom, and retains the original files for download. Solo playback uses analysis mono outputs.

Verification: build; verify-stems.ts (complementary reconstruction, silence, sustained-tone rejection, separate attack classes, all 16 central cells, 10 FPS hold, release, no synthetic metronome hits); existing verify-motion.ts regression suite. Browser rhythm demo: analysis ready, 149.75 BPM, central-cell changes at 8.1/8.4 seconds, solo switch preserves position. Direct two-file upload flow has not yet been browser-tested in this revision.
