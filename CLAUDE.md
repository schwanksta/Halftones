# Halftones — Project Guide

Browser-based halftone image processor. React + TypeScript + Vite, no backend.
Packaged as a native macOS app via Tauri 2. The `tauri` branch was merged to `main` — there is only one branch now.

## Working Rules

- **Always commit when done.** After completing any task, run `npm run build` to verify, then `git add -A && git commit`.
- **Also run `npm run tauri:build` when done.** This produces the `.app` and `.dmg` at `src-tauri/target/release/bundle/macos/`. Takes ~50s on second+ Rust builds (just JS changed), ~2–3 min after Rust changes.

## Quick Reference

```bash
npm run dev          # start dev server (Vite, port 5173)
npm run build        # typecheck (tsc -b) then bundle
npm run tauri:dev    # boot Vite + native window (for testing Tauri features)
npm run tauri:build  # full release build → Halftones.app + .dmg
```

## Architecture

```
src/
  App.tsx                     # root: state, refs, image load, auto-save
  platform/
    index.ts                  # detects Tauri vs web, exports `platform` singleton + `isTauri`
    types.ts                  # PlatformAPI interface, AllSettings, ProjectFile, MenuEvent
    platform-tauri.ts         # Tauri implementation (file I/O, dialogs, prefs, menus, window)
    platform-web.ts           # Web stubs (blob download, localStorage, no-ops)
    halftones-file.ts         # .halftones zip pack/unpack (JSZip, schemaVersion 1)
  types.ts                    # all interfaces, defaults, type unions
  components/
    TopBar.tsx                # project name (editable), projects dropdown, image loader
    ControlPanel.tsx          # sidebar shell, passes settings to sub-panels
    HalftoneControls.tsx      # pattern selector, LPI, angle, dot controls, color pickers
    OutputControls.tsx        # width/height (inches), DPI, margin
    TransformControls.tsx     # crop, rotation, levels (black/white point, gamma)
    SpotColorEditor.tsx       # spot color list, per-color controls, global trap/vibrancy, key plate
    PreviewCanvas.tsx         # viewport canvas, zoom controls, drag-drop
    ExportBar.tsx             # PNG / channel PNG / PDF / color proof export buttons
    ImageLoader.tsx           # file picker
  hooks/
    useHalftonePreview.ts     # main render loop: transforms, viewport extract, halftone, compositing
    useCanvasTransform.ts     # pan/zoom viewport state (wheel, drag)
    useProjectPersistence.ts  # localStorage read/write for project snapshots
    useAppShell.ts            # Tauri menu/drop/save/open/quit handlers
  engine/
    halftone.ts               # renderHalftone() — routes to pattern renderers
    patterns.ts               # grid-based patterns: dot, line, ellipse, diamond, hex, euclidean,
                              #   crosshatch, concentric, brick, radial, radial-lines, stochastic
    stipple.ts                # Poisson-disk stipple (Bridson's algorithm, variable spacing)
    dot-settings.ts           # applyDotSettings() — minDot/maxDot/dotGain/dotSize/gamma/shadow/highlight pipeline
    sampling.ts               # precomputeGrayscale(), sampleGray() — fast luminance sampling
    cmyk.ts                   # separateChannels(), compositeChannels()
    transform.ts              # applyTransforms() — rotation, crop, levels
    spot-separation.ts        # separateSpotChannels(), renderFlat(), boostSaturation(), extractPalette()
    dilate.ts                 # dilateMask() — morphological dilation for spot trap
    export.ts                 # exportPNG(), exportChannelPNGs(), exportPDF(), exportColorProof()
    png-metadata.ts           # setPngDpi() — inject pHYs chunk for DPI metadata
```

## Tauri — Key Facts

### Platform Abstraction
- `src/platform/index.ts` detects `'__TAURI_INTERNALS__' in window` and exports the right impl
- `platform-web.ts` stubs keep `npm run dev` (browser) working unchanged
- All file I/O, dialogs, exports, and recent-project state go through `platform.*`
- Prefs stored at Tauri app data dir (`~/Library/Application Support/com.schwank.halftones/prefs.json`)

### Icon Generation
- Master SVG: `src-tauri/icons/halftones-icon.svg` (Inkscape-edited)
- **Always regenerate via Tauri CLI** — manual ImageMagick produces 16-bit PNGs that crash on startup:
  ```bash
  npx @tauri-apps/cli@latest icon src-tauri/icons/halftones-icon.svg -o src-tauri/icons
  ```
- Commit the regenerated files, then `npm run tauri:build`

### Tauri 2 Gotchas
- Drag-drop: use `getCurrentWebview().onDragDropEvent()`, NOT `listen('tauri://file-drop')` (doesn't exist in v2)
- `setDocumentEdited` is macOS-only; cast window to `any` and use optional chaining
- `use tauri::Emitter` must be imported explicitly for `app.emit()` — not in prelude
- Bundle identifier must NOT end in `.app` (`com.schwank.halftones`, not `com.halftones.app`)
- `tauri-build` embeds icon PNGs at compile time — icon changes require a full `tauri:build`

## Key Design Decisions

### Rendering Pipeline (preview)
1. `applyTransforms(source, transformSettings)` — rotation, crop, levels → `ImageData` (memoized)
2. Cache as `transformedCanvas` (memoized, avoids `putImageData` per frame)
3. `extractRegionFromCanvas(...)` — viewport region at render DPI
4. `renderHalftone(ctx, { source, settings, renderDpi })` — pattern-specific renderer
5. Composite onto main canvas with gutter gray + clip to image+margin rect

### Spot Color Rendering (preview)
- **Separation** (`separateSpotChannels`): expensive O(pixels × colors) LAB-distance pass, memoized behind a key of `colorId:lab` values — only re-runs when LAB assignments change, not when angle/lpi/hex/threshold change
- **Channel canvases**: separation ImageData is converted to HTMLCanvasElement once per separation (also memoized)
- **Per-frame render**: each enabled color is extracted from its channel canvas via `extractRegionFromCanvas` at the current viewport region, then rendered (`renderFlat` or `renderHalftone`) at `renderDpi = viewport.zoom × sourcePixelsPerInch` — same approach as CMYK, so dots rescale correctly with zoom
- **Trap**: after rendering BW mask, `dilateMask(bwCanvas, trapPx)` expands the black ink region outward, causing layers to bleed into each other and hiding paper-coloured seams between halftone and flat layers. Trap value in UI = output-DPI pixels; preview scales by `renderDpi / outputDpi` with a 1-px floor for visible feedback at low zoom
- **Key plate**: `spotSettings.key` (optional `KeyPlateSettings`) renders a halftone of the full image on top of all color layers. Independent of whether spot colors are present — the `colorMode === 'spot'` branch always checks for key separately from the color channel loop.

### Spot Color Export
- `exportChannelPNGs` / `exportPDF` both call `renderSpotChannelCanvases()` which: transforms → scales to output resolution → separates → renders each plate (halftone or flat) → applies trap dilation → returns per-color BW canvases. Key plate (if enabled) is appended with id `'__key__'` and label `'Key'`.
- `exportColorProof` composites all colors with their actual hex colours source-over on white, using `colorizeForOverlay()`. Key plate composited last (source-over). Height is derived from the transformed image's actual AR (not outputSettings.heightInches) to avoid distortion
- Trap is applied in all three paths; per-color override (`color.trap`) wins over global (`spotSettings.trap`); `null` = use global (safe for older .halftones files that don't have the field)
- In `exportPDF` spot loop: `id === '__key__'` is detected to generate the correct plate label

### Performance
- **Path2D batching**: dot/hex/diamond/ellipse all add to one `Path2D`, single `ctx.fill()` call
- **Grayscale pre-computation**: `Uint8Array` via integer math `(77*R + 150*G + 29*B) >> 8`
- **Sub-sampling**: stride 2–3 for large cellSizes in `sampleGray()`
- **Memoization**: `useMemo` for `transformed`, `transformedCanvas`, `stippleCanvas`, `spotChannels`, `spotChannelCanvases`

### Stipple (Poisson disk)
- Full-image pre-render cached at max 1200px — dots are stable across pan/zoom
- Bridson's algorithm with darkness-weighted minimum distance
- MAX_DOTS = 40,000 auto-scaling cap to keep computation under ~500ms
- Best at Density (LPI) 5–30; higher values auto-scale up spacing

### WebGL Fast Path
- `src/engine/webgl/` — GL2 renderer for dot, hex, ellipse, diamond, line, crosshatch, euclidean
- `shouldUseGL(pattern)` gates on `GL_SUPPORTED_PATTERNS` + `isWebGL2Available()`; CPU fallback on failure
- Shared preview GL context (`getSharedGL`) reused across frames; export uses one-shot `createExportGL`
- `shared.glsl.ts` contains the vertex shader, shared uniforms, and `applyDotSettings()` / `sampleLum()` in GLSL — **must be kept in sync with `dot-settings.ts` and `sampling.ts`**
- `sampleLum()` checks `rgba.a < 0.5` → returns 1.0 (paper/no-ink) for transparent pixels, matching the CPU alpha guard in `precomputeGrayscale()`
- All tone-curve uniforms (`uHalftoneGamma`, `uShadowBoost`, `uHighlightBoost`) and dot uniforms (`uMinDot`, `uMaxDot`, `uDotGain`, `uDotSize`) must be uploaded in `render.ts` — adding new controls to `dot-settings.ts` requires parallel updates to the GLSL and uniform uploads

### Colors (preview only)
- `fgColor`/`bgColor` in `HalftoneSettings` — ink/paper color pickers
- `invert` swaps them at render time
- **Export always uses black-on-white** — `bwSettings()` wrapper in export.ts strips colors

### Output Dimensions & Export
- **On image load**: `fitToPaper(imgW, imgH, prev.widthInches, prev.heightInches)` fits the new image inside the current paper bounds while preserving aspect ratio. DPI no longer controls print size at load time (the old `pixelCount / DPI` formula produced tiny sizes whenever DPI was set high from a previous session).
- **On crop/rotation change**: proportional scaling via `prevTransformRef`. Computes the ratio of visible pixels before vs after the change (`visiblePx(prev)` / `visiblePx(newT)`) and scales current output dims by that ratio. This is DPI-independent and correct regardless of how dims were set (fit-to-paper, manual, or native-DPI from a scanner).
- **`prevTransformRef`** in App.tsx tracks the crop+rotation that the current output dims reflect. Updated in the useEffect's skip branch on image/project load, and after each proportional recalc.
- **`skipDimensionRecalcRef`**: set by `handleImageLoad`, `applySettings`, and `handleLoadProject` to suppress the crop/rotation useEffect once. The skip branch also syncs `prevTransformRef` to the newly applied transforms.
- PDF layout: image + margin + 0.5" crop mark waste strip on all sides
- Crop marks in waste strip only — cutting along them preserves full margin
- Alignment marks (circle + crosshair) live in the waste strip midpoints — removed on trim. Only rendered when `outputSettings.alignmentMarks` is true and `cropMarkPts >= 6`.
- PNG export includes DPI metadata via pHYs chunk
- Filenames: `[project-slug]-[pattern].ext`
- **Transparent source pixels**: treated as paper (no ink) throughout — `precomputeGrayscale()` maps alpha<128 → 255, `separateSpotChannels()` skips alpha<128 pixels, GLSL `sampleLum()` returns 1.0 for alpha<0.5

### Project Persistence
- localStorage key `halftones_projects` → `Record<string, ProjectSnapshot>`
- Auto-save with 1-second debounce on any settings change (web mode only; Tauri uses explicit save)
- Source image NOT saved (too large) — user must reload file, but all sliders restore
- `.halftones` file format: zip of `project.json` (schemaVersion 1) + `source.<ext>`
- Migration chain in `halftones-file.ts` — add new `case` before `default` to upgrade old files

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

### Tone Curve Controls
- `halftoneGamma` (0.5–3): power curve over the full tonal range. Applied first in `applyDotSettings()`.
- `shadowBoost` / `highlightBoost` (0–1): piecewise power on each half of the range (split at d=0.5). Continuous at boundary regardless of boost value.
- Both CPU (`dot-settings.ts`) and GPU (`shared.glsl.ts`) implementations must match exactly.

## Common Gotchas
- `radialOriginX/Y` can be undefined from stale state — always `?? 0.5`
- Radial `maxRadius` must use max of all 4 corner distances (not just one)
- Circular imports: `applyDotSettings` is in its own `dot-settings.ts` to break patterns ↔ halftone cycle
- `sourceAspect` in OutputControls is derived from `transformedImageData` so the aspect lock uses the post-crop/rotation ratio (NOT the raw source)
- Stipple in the preview hook bypasses the normal `renderHalftone` path — uses its own cached canvas + `drawImage`
- **Output dimension clobbering on project/image load**: `applySettings()`, `handleImageLoad`, and `handleLoadProject` all set `skipDimensionRecalcRef` to suppress the crop/rotation useEffect. They also sync `prevTransformRef` to the loaded transforms so the first user crop delta is computed from the correct baseline.
- **Spot trap `color.trap` nullable**: `null`/`undefined` means "use global `spotSettings.trap`". A number (including 0) overrides. Older .halftones files omit the field → `undefined` → falls through to global cleanly. Use `color.trap ?? spotSettings.trap ?? 0` everywhere.
- **`dilateMask` returns a NEW canvas** of the same dimensions. It does NOT modify the source. The iterative 8-neighbour darken-composite approach expands black regions by N pixels (Chebyshev metric) in N passes.
- **Drag-drop image in Tauri uses `handleDroppedPaths`** (in `useAppShell.ts`), NOT `handleImageLoad` (in App.tsx). Both must apply the same fit-to-paper logic; keep them in sync if you change either.
- **Key plate is independent of spot color channels**: in the preview hook, `colorMode === 'spot'` is the outer condition; spot channel rendering and key plate rendering are separate sub-blocks. Key plate must NOT be nested inside `spotSettings.colors.length > 0 && spotChannelCanvases` — it can render even with no colors extracted.
- **Adding new tone-curve controls**: update `dot-settings.ts` (CPU), `shared.glsl.ts` (GLSL uniform declaration + applyDotSettings body), and `render.ts` (uniform upload). All three must stay in sync.
- **DMG bundler occasionally flakes** on macOS — if `npm run tauri:build` fails at `bundle_dmg.sh`, just re-run; it succeeds on the next attempt.
