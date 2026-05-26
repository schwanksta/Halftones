# Feature Roadmap — Screen Printing & Halftone

Features ranked by practical value to screen printers. ✅ = shipped.

---

## Shipped

✅ **13 halftone patterns** — dot, euclidean, ellipse, diamond, hex, line, crosshatch, concentric, brick, radial dots, radial lines, stochastic (FM), Poisson-disk stipple

✅ **Simulated process / spot color separation** — LAB k-means++ palette extraction, per-color flat or halftone rendering, vibrancy slider, merge-by-ΔE

✅ **Key plate** — halftone of the full image overprinted on top of all spot color layers; independent color, LPI, angle, and min-dot controls. Classic screenprint technique for adding tonal depth to flat separations.

✅ **Trapping / choke / spread** — global trap + per-color override; morphological dilation of BW mask before colorize; scales correctly between preview DPI and output DPI

✅ **CMYK separation** — per-channel angle/LPI, composite preview, per-channel export

✅ **Tone curve controls** — gamma (power curve over full range), shadows boost, highlights boost (piecewise power on each tonal half); applied in both CPU and WebGL paths

✅ **Dot controls** — min dot, max dot, dot gain compensation, dot size multiplier

✅ **Image transforms** — crop, rotation, levels (black/white point + midtone gamma)

✅ **Alignment / registration marks** — crosshair + bullseye at midpoints of each side, placed in the crop-mark waste strip so they're removed on trim

✅ **Vector PDF output** — dot, hex, ellipse, diamond, line, euclidean, radial-lines rendered as PDF vector paths; other patterns fall back to embedded raster

✅ **Color proof export** — WYSIWYG composite of all layers in actual ink colors (with vibrancy and trap applied); transparent source areas preserved

✅ **Transparent source PNG** — transparent pixels produce no ink on any plate across all render paths (CPU, WebGL, spot separation)

✅ **Project persistence** — named projects, auto-save, `.halftones` file format (zip of JSON + source image), recent files in native menu (Tauri)

✅ **Ink/paper color preview** — any ink/paper color in preview; exports always produce clean black-on-white plates

---

## TIER 1 — High Impact

### 1. White Underbase Generation
Auto-generate a white underbase channel with adjustable choke (shrink 0.5–2pt). Every dark-garment halftone job needs this; most printers do it manually in Photoshop.

### 2. Dot Gain Compensation Curves (full curve)
A per-channel tone curve editor with presets ("20% plastisol on cotton", "15% water-based on poly") and the ability to save calibration profiles. Screen printing has 20–35% dot gain; a single linear slider doesn't cut it.

### 3. Mesh-to-LPI Calculator / Advisor
Input mesh count → recommended LPI range (mesh/4 to mesh/5), moire risk warning, incompatible settings flag. Beginners constantly waste screens getting this ratio wrong.

### 4. N-Up / Film Nesting
Auto-tile multiple separation channels onto one sheet of film. Inkjet film is $1–3/sheet; a 6-color job normally burns 6 sheets but N-up packing can cut that to 2–3.

---

## TIER 2 — Medium-High Impact

### 5. Highlight White Channel
Separate from underbase — adds halftoned white on top for bright highlights on dark shirts.

### 6. Index Color Separation
Convert to a limited palette with non-overlapping square pixels; no halftone dots, no ink mixing. Popular for photorealistic work on dark garments.

### 7. Step Wedge / Tonal Test Strip
Generate a 10-step wedge in the current halftone settings alongside the job, for exposure calibration.

### 8. Per-Channel Halftone Shape
Different dot shapes per channel (e.g., elliptical on CMY, round on K).

### 9. GCR / UCR Controls
Gray Component Replacement reduces total ink coverage (critical for hand feel on garments) and makes registration less fussy.

---

## TIER 3 — Nice-to-Have Professional

### 10. Total Ink Limit
Max combined ink % across all channels (too much ink = cracking, bleed-through).

### 11. Bulk Angle Rotation
Rotate all CMYK angles together by 7.5° to break mesh-vs-halftone moiré.

### 12. Ink Sequence / Layer Buildup Preview
Show how colors stack in print order with transparent ink simulation.

### 13. Hybrid AM/FM Screening
AM dots in midtones, FM in highlights/shadows. Solves the problem that tiny AM dots wash out during exposure.

### 14. Garment Mockup Preview
Render the halftone on a photo of a T-shirt/hoodie in the selected color.

### 15. Press Profiles
Reusable presets (LPI + angles + dot gain + mesh + ink type) per press config, separate from project settings.

---

## TIER 4 — Specialized / Advanced

### 16. Spot Color / Pantone Library
Pick from named ink colors, map channels to PMS numbers.

### 17. Per-Channel Curves / Levels
Post-separation editing of individual channels.

### 18. Alternative Dithering Algorithms
Atkinson, Jarvis, Stucki, blue-noise threshold masks (each has different visual character).

### 19. Batch Processing / Queue
Process multiple images with the same settings.

### 20. Job Ticket Metadata
Embed customer name, ink colors, mesh counts, print order into the PDF output.

### 21. Photo-to-Line-Art / Posterization
Convert photos to simplified high-contrast spot-color graphics (non-halftone).

### 22. Green Noise Stochastic
Clustered minority dots that survive screen exposure better than dispersed blue-noise dots.
