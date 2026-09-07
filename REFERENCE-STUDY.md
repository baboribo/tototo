# Terrace motion study

Reference: https://www.youtube.com/watch?v=yHKMPtL2kf8 (179.781 seconds)

## Evidence and limits

Browser screenshots are discrete samples of a playing video, not continuous perception. Pixel steps below use the paused YouTube frame-step control. Observations describe visible motion; assignment to frequency bands is an implementation hypothesis, not a claim about the author's original processing or instrument stems. No lyrics are transcribed or generated as if they belonged to an uploaded track.

## First pass

- 0 s: muted gray-green 4:3 field, centered dotted square, eraser at lower left and upward pen nib at lower right. No orbiting circle or diagnostic graphics.
- 7.55 s: fixed-size blocks inside central crop, mixed solid and stippled cells; separate thick horizontal/vertical perimeter fragments; small marks along the pen-tip baseline.
- 21.91 s: same anchored square/pen/eraser composition. Vertical side text can appear separately from the geometric system. Perimeter fragments are asymmetrical, not four uniformly expanding brackets.
- 36.03 s: partial blocks clipped at the square edge show horizontal offset from the nominal cell grid. Central frame remains fixed. This supports horizontal transport rather than sixteen independently scaling tiles.
- 49.18 s: nested stippled borders appear; lower marks vary from tiny dots to denser crosses. Both text columns can be present. Stipple/solid are distinct fill states.
- 71.91 s, 84.99 s: stippled multiple square outlines with stable central crop; thicker lower ink events; optional side text remains separate.
- 89.89 s, 110.62 s, 118.34 s, 125.85 s, 135.35 s: asymmetric cropped blocks, mixed solid/stipple; base positions unchanged. Nib and eraser remain anchored with tiny local changes.
- 143.8, 148.8, 153.8, 158.8, 163.8, 168.8, 173.8, 176.8 s: late section retains the same visual grammar; no independent orbiting circular dots.
- 178–179 s: central square, blocks, and perimeter disappear; the lower trace still carries a long dense ink event leftward between the tools. Treat this as an independent layer, not a global fade.
- Six successive frame steps around 161.8–162.1 s: central block edges progress left in small pixel increments; trace marks progress left much farther per frame. The central crop stays fixed. Texture moves with the blocks rather than re-randomizing each frame. Approximate transport-speed ratio is 4–5×. These are actual frame-step observations, not fabricated interpolation.

The entire duration was surveyed across time samples, including the final displayed second; this is not a claim that all source frames were inspected. Browsing autoplay advanced to another video once; the reference was reopened and the missed middle/ending ranges were explicitly sought and inspected.

## Measured layout, normalized to 960 × 720

Video picture occupies approximately 840 × 628 in the observed browser screenshot (excluding YouTube controls). Central square: x≈390..570, y≈270..450. Center≈(480,360). Outer fragment path≈(350,230)..(610,490), line width≈10. Eraser≈(165,550), 45×54 body with a small outlined cap. Pen centered≈(785,565), tip near y=535 and short dark base near y=585. Trace baseline≈y=528, travelling between the two tools. Large empty margins are part of the design.

## Corrections required

Remove invented orbit, expansion/zoom, thin empty tile outlines, random texture flicker, and bouncing sinusoidal dots. Restore fixed geometry and proportions; move content within clipped bounds. Use an audio-driven history so the right pen lays down marks and the left eraser removes old ones. Keep the source text optional and user-authored. Keep transport, analysis, and drawing separate so drawing frequency cannot alter history.

## Implemented interpretation

- 320×240 raster scaled without smoothing to 960×720. Central 60×60 mask centered at (160,120); 15×15 cells, sparse dots/dense stipple/solid states; fixed 86×86 outer path.
- Central transport 35.7 raster px/s and bottom trace 160 px/s. Both are driven by audio time. Cell styles are sampled from past frequency energy and retained while moving; no preset cue schedule or random animation.
- Five FFT energy bands plus RMS and onset envelope are precomputed in a worker at 50 Hz. A shared loudness reference avoids amplifying empty frequency bands. The more energetic stereo channel is analysed (not source separation); both channels still play normally.
- Outer segments use differing band histories; extra dotted frames respond to onsets/high-band activity. These audio mappings are design hypotheses grounded in the observed layers, not recovered original authoring rules.
- Present silence hides central active layers; ink already written continues to travel until its finite history clears. Pause freezes the complete frame. Scrubbing to the same time gives the same plan, regardless of previous playback or refresh rate.

## User-directed timing refinement

The user subsequently identified the apparent motion cadence as approximately 10 FPS and requested more tile flashing and automatic beat synchronization. The renderer now holds every frame for 100 ms by default, while sound plays continuously. Present beat/onset ink flashes overlay the travelling printed cells; this supersedes the earlier strictly invariant cell-tone rule. Cell dimensions and paths are still preserved. Central transport now derives its sampling interval/phase from the estimated beat grid, with the original 0.42 s interval as fallback. The reference's actual encoded FPS and exact beat mapping remain unverified.
