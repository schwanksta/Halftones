# Halftones — Project Guide

Browser-based halftone image processor. React + TypeScript + Vite, no backend.

## Working Rules

- **Always commit when done.** After completing any task, run `npm run build` to verify, then `git add -A && git commit`.

## Quick Reference

```bash
npm run dev      # start dev server (Vite, port 5173)
npm run build    # typecheck (tsc -b) then bundle
```

## Architecture

```
src/
  App.tsx                     # root: state, auto-save, image load handler
  types.ts                    # all interfaces, defaults, type unions
  components/
    TopBar.tsx                # project name (editable), projects dropdown, image loader
    ControlPanel.tsx          # sidebar shell, passes settings to sub-panels
    HalftoneControls.tsx      # pattern selector, LPI, angle, dot controls, color pickers
    OutputControls.tsx        # width/height (inches), DPI, margin
    TransformControls.tsx     # crop, rotation, levels (black/white point, gamma)
    PreviewCanvas.tsx         # viewport canvas, zoom controls, drag-drop
    ExportBar.tsx             # PNG / channel PNG / PDF export buttons
    ImageLoader.tsx           # file picker
  hooks/
    useHalftonePreview.ts     # main render loop: transforms, viewport extract, halftone, compositing
    useCanvasTransform.ts     # pan/zoom viewport state (wheel, drag)
    useProjectPersistence.ts  # localStorage read/write for project snapshots
  engine/
    halftone.ts               # renderHalftone() — routes to pattern renderers
    patterns.ts               # grid-based patterns: dot, line, ellipse, diamond, hex, euclidean,
                              #   crosshatch, concentric, brick, radial, radial-lines, stochastic
    stipple.ts                # Poisson-disk stipple (Bridson's algorithm, variable spacing)
    dot-settings.ts           # applyDotSettings() — minDot/maxDot/dotGain/dotSize pipeline
    sampling.ts               # precomputeGrayscale(), sampleGray() — fast luminance sampling
    cmyk.ts                   # separateChannels(), compositeChannels()
    transform.ts              # applyTransforms() — rotation, crop, levels
    export.ts                 # exportPNG(), exportChannelPNGs(), exportPDF()
    png-metadata.ts           # setPngDpi() — inject pHYs chunk for DPI metadata
```

## Key Design Decisions

### Rendering Pipeline (preview)
1. `applyTransforms(source, transformSettings)` — rotation, crop, levels → `ImageData` (memoized)
2. Cache as `transformedCanvas` (memoized, avoids `putImageData` per frame)
3. `extractRegionFromCanvas(...)` — viewport region at render DPI
4. `renderHalftone(ctx, { source, settings, renderDpi })` — pattern-specific renderer
5. Composite onto main canvas with gutter gray + clip to image+margin rect

### Performance
- **Path2D batching**: dot/hex/diamond/ellipse all add to one `Path2D`, single `ctx.fill()` call
- **Grayscale pre-computation**: `Uint8Array` via integer math `(77*R + 150*G + 29*B) >> 8`
- **Sub-sampling**: stride 2–3 for large cellSizes in `sampleGray()`
- **Memoization**: `useMemo` for `transformed`, `transformedCanvas`, `stippleCanvas`

### Stipple (Poisson disk)
- Full-image pre-render cached at max 1200px — dots are stable across pan/zoom
- Bridson's algorithm with darkness-weighted minimum distance
- MAX_DOTS = 40,000 auto-scaling cap to keep computation under ~500ms
- Best at Density (LPI) 5–30; higher values auto-scale up spacing

### Colors (preview only)
- `fgColor`/`bgColor` in `HalftoneSettings` — ink/paper color pickers
- `invert` swaps them at render time
- **Export always uses black-on-white** — `bwSettings()` wrapper in export.ts strips colors

### Output & Export
- PDF layout: image + margin + 0.5" crop mark waste strip on all sides
- Crop marks in waste strip only — cutting along them preserves full margin
- PNG export includes DPI metadata via pHYs chunk
- Filenames: `[project-slug]-[pattern].ext`

### Project Persistence
- localStorage key `halftones_projects` → `Record<string, ProjectSnapshot>`
- Auto-save with 1-second debounce on any settings change
- Source image NOT saved (too large) — user must reload file, but all sliders restore

## Patterns

| Pattern | Type | Angle? | Notes |
|---------|------|--------|-------|
| dot | grid/batched | yes | standard AM halftone |
| euclidean | grid/unbatched | yes | <50% growing circle, >50% white punch-out |
| ellipse | grid/batched | yes | |
| diamond | grid/batched | yes | |
| hex | grid/batched | yes | sqrt(3)/2 row spacing, odd-row offset |
| line | grid/unbatched | yes | |
| crosshatch | grid/unbatched | yes | |
| concentric | standalone | no | |
| brick | standalone | no | |
| radial | standalone | no | polar dot grid from adjustable origin |
| radial-lines | standalone | no | arc segments, lineCap='round' |
| stochastic | standalone | no | FM dither, DPI-accurate preview |
| stipple | cached full-image | no | Poisson disk, density 5–40 |

## Common Gotchas
- `radialOriginX/Y` can be undefined from stale state — always `?? 0.5`
- Radial `maxRadius` must use max of all 4 corner distances (not just one)
- Circular imports: `applyDotSettings` is in its own `dot-settings.ts` to break patterns ↔ halftone cycle
- `sourceAspect` in OutputControls is raw source aspect — doesn't account for transforms (crop/rotation)
- Stipple in the preview hook bypasses the normal `renderHalftone` path — uses its own cached canvas + `drawImage`
