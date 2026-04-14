# Feature Roadmap — Screen Printing & Halftone

Features we don't have yet, ranked by practical value to screen printers.

---

## TIER 1 — High Impact

### 1. White Underbase Generation
Auto-generate a white underbase channel with adjustable choke (shrink 0.5-2pt so it doesn't peek out from under top colors). Every dark-garment halftone job needs this and most printers do it manually in Photoshop right now.

### 2. Trapping / Choke / Spread
Per-channel ability to grow or shrink separations by a configurable amount. Misregistration on press is inevitable -- trapping compensates by overlapping adjacent colors so white gaps don't appear.

### 3. Simulated Process Color Separation
Separate into N arbitrary *spot* colors (white, black, red, gold, royal blue, etc.) instead of just CMYK. This is the dominant workflow in garment printing -- UltraSeps has three different simulated-process modules because it's that critical.

### 4. Dot Gain Compensation Curves (full curve, not just a slider)
A per-channel tone curve editor with presets ("20% plastisol on cotton", "15% water-based on poly") and the ability to save calibration profiles per press/mesh/ink combo. Screen printing has 20-35% dot gain; a single linear slider doesn't cut it.

### 5. Mesh-to-LPI Calculator / Advisor
Input mesh count -> tool recommends LPI range (mesh / 4 to mesh / 5), warns about moire risk, flags incompatible settings. Beginners constantly waste screens by getting this ratio wrong.

### 6. Registration Marks (crosshair/bullseye style)
We have crop marks, but screen printers need the classic crosshair registration marks for multi-color alignment when taping films to screens. Distinct purpose from crop marks.

### 7. N-Up / Film Nesting
Auto-tile multiple separation channels onto one sheet of film. Inkjet film is $1-3/sheet; a 6-color job normally burns 6 sheets but N-up packing can cut that to 2-3.

---

## TIER 2 — Medium-High Impact

### 8. Highlight White Channel
Separate from underbase, adds halftoned white on top for bright highlights on dark shirts.

### 9. Index Color Separation
Convert to a limited palette with non-overlapping square pixels; no halftone dots, no ink mixing. Popular for photorealistic work on dark garments.

### 10. SVG / Vector Halftone Output
Export as geometric shapes for infinite scalability, vinyl cutting, laser engraving.

### 11. Step Wedge / Tonal Test Strip
Generate a 10-step wedge in the current halftone settings alongside the job, for exposure calibration.

### 12. Per-Channel Halftone Shape
Different dot shapes per channel (e.g., elliptical on CMY, round on K).

### 13. GCR / UCR Controls
Gray Component Replacement reduces total ink coverage (critical for hand feel on garments) and makes registration less fussy.

---

## TIER 3 — Nice-to-Have Professional

### 14. Total Ink Limit
Max combined ink % across all channels (too much ink = cracking, bleed-through).

### 15. Bulk Angle Rotation
Rotate all CMYK angles together by 7.5 degrees to break mesh-vs-halftone moire.

### 16. Ink Sequence / Layer Buildup Preview
Show how colors stack in print order with transparent ink simulation.

### 17. Hybrid AM/FM Screening
AM dots in midtones, FM in highlights/shadows (what Harlequin HXM does). Solves the problem that tiny AM dots wash out during exposure.

### 18. Garment Mockup Preview
Render the halftone on a photo of a T-shirt/hoodie in the selected color.

### 19. Press Profiles
Reusable presets (LPI + angles + dot gain curve + mesh count + ink type) per press configuration, separate from project settings.

---

## TIER 4 — Specialized / Advanced

### 20. Spot Color / Pantone Library
Pick from named ink colors, map channels to PMS numbers.

### 21. Per-Channel Curves / Levels
Post-separation editing of individual channels.

### 22. Alternative Dithering Algorithms
Atkinson, Jarvis, Stucki, blue-noise threshold masks (each has different visual character).

### 23. Batch Processing / Queue
Process multiple images with the same settings.

### 24. Job Ticket Metadata
Embed customer name, ink colors, mesh counts, print order into the PDF output.

### 25. Photo-to-Line-Art / Posterization
Convert photos to simplified high-contrast spot-color graphics (non-halftone).

### 26. Green Noise Stochastic
Clustered minority dots that survive screen exposure better than dispersed blue-noise dots.
