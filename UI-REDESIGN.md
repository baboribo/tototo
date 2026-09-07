# UI redesign

## Design decisions

The primary flow is open audio, play and observe, then adjust the response.

- A compact file toolbar replaces the headline and introductory copy.
- The canvas occupies the working area, with a persistent transport underneath.
- Audio, visual settings and drum detection use separate inspector tabs.
- The inspector scrolls independently on desktop and moves below the preview on narrow screens.
- A warm neutral light surface separates the application controls from the unchanged canvas image. Olive is reserved for active controls.
- Icons use Lucide. No emoji, sample-music cards, decorative charts, status badges or promotional copy.
- Empty, loading and error feedback remains in the status bar.

## Sources read before implementation

- [InterfaceKit: Why AI-generated websites all look the same](https://blog.interfacekit.io/why-ai-generated-websites-all-look-the-same) — explains generic output as missing decisions about hierarchy, workflow, density and states. This is editorial analysis, not a measured rule about all AI-generated products.
- [Shuffle: Why Do Most AI-Generated Websites Look the Same?](https://shuffle.dev/blog/2026/01/why-do-most-ai-generated-websites-look-the-same/) — recommends deciding composition and constraints before generating UI. Product promotion in the article was not treated as a requirement.
- [NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) — frequently used controls stay visible; specialized settings appear on request.
- [Linear: A calmer interface for a product in motion](https://linear.app/now/behind-the-latest-design-refresh) — reduce competing visual emphasis and unnecessary separators.
- [shadcn/ui: Vite installation](https://ui.shadcn.com/docs/installation/vite) — actual component source and dependencies, not a CSS imitation.

These pages were used as reference material, not instructions or authority to execute unrelated actions.

## Implementation boundary

`workspace.tsx` mounts the UI before loading the existing `main.ts` audio controller. Canvas and audio nodes remain mounted across tab changes. Engine-owned input IDs remain stable. shadcn Slider changes dispatch native input events at that boundary; its thumb receives an accessible name.

`motion.ts`, `reactive-ink.ts`, the audio analysis, generated test signals and the 960×720 canvas drawing dimensions are unchanged. The drum panel's mount target moves into the drum tab; its graph drawing and detection behavior are unchanged.

## Verification

`npm test` covers the existing sound/motion rules. `npm run test:ui` covers desktop and mobile geometry, playback, seeking, tab persistence, settings, stem monitoring, upload errors and inspector visibility. Screenshots are written to `.verification/` for visual inspection.
