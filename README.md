# Halftones

A browser-based halftone image processor for screen printing, risograph, and graphic arts workflows. Drop in a photo, choose a pattern, adjust settings, and export print-ready files.

## Features

- **13 halftone patterns**: dot, euclidean dot, ellipse, diamond, hexagonal, line, crosshatch, concentric, brick, radial (dots & lines), stochastic (FM dither), and Poisson-disk stipple
- **CMYK separation**: per-channel angle/LPI control with composite preview
- **Dot controls**: min/max dot, dot gain compensation, dot size multiplier
- **Image transforms**: crop, rotation, levels (black/white point + gamma)
- **Ink & paper color preview**: preview any ink/paper color combination; exports always produce clean black-on-white
- **Print-ready export**: PNG (with DPI metadata), per-channel PNGs, and multi-page PDF with crop marks
- **Adjustable margin**: user-set margin preserved inside crop marks; marks live in a separate waste strip
- **Project persistence**: settings auto-save to localStorage; named projects with instant switching
- **Viewport**: pan/zoom with mouse wheel; "Fit" and "100%" (output-accurate) zoom presets

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:5173, drop an image, and start tweaking.

## Export

- **Export PNG** — full-resolution halftone with embedded DPI
- **Export Channels** (CMYK mode) — one PNG per separation
- **Export PDF** — image + margin + crop marks, one page per channel in CMYK mode

Output dimensions are derived from the source image's native resolution at your selected DPI. Filenames follow the pattern `[project]-[pattern].png`.

## Tech

React 18 + TypeScript + Vite. No backend, no dependencies beyond jsPDF for PDF export. All rendering is canvas-based with Path2D batching and grayscale pre-computation for performance.

## License

MIT
