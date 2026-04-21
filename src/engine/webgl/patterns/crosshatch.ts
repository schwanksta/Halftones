// src/engine/webgl/patterns/crosshatch.ts
import { FRAG_PRELUDE } from '../shared.glsl'

// Two capsule stripe families per cell at perpendicular angles. Thickness
// formulas match CPU drawCrosshatch exactly (see src/engine/patterns.ts):
//   line1: thickness = cellSize * min(1, darkness * 2)          (always drawn)
//   line2: thickness = cellSize * (darkness - 0.5) * 2          (only if darkness > 0.5)
// Each capsule has length 1.5*cellSize with rounded caps — same SDF as the
// line pattern. For each stripe family we sample the nearest cell AND the
// horizontal-neighbour cell in that family's grid space so the 0.25*cellSize
// capsule overlap is preserved.
//
// Known fidelity gap vs CPU (approved at review as acceptable for v1):
// line.ts samples darkness per-cell (primary + neighbour) independently.
// Here, a single primary-grid darkness value is shared across both stripe
// families AND both cells within each family. Matches the CPU's own
// scalar-per-cell behavior and is imperceptible in smooth regions, but at
// sharp luminance borders the π/2-rotated family's vertical-neighbour cell
// will paint with the primary cell's darkness instead of its own. A future
// pass could sample darkness per-cell in each family to close this gap.
export const CROSSHATCH_FRAG = FRAG_PRELUDE + `
float capsuleCov(vec2 p, float halfLen, float halfT) {
  float clampedX = clamp(p.x, -halfLen, halfLen);
  float d = distance(p, vec2(clampedX, 0.0));
  return 1.0 - smoothstep(halfT - 0.5, halfT + 0.5, d);
}

// Evaluate one capsule stripe family (one axis of the crosshatch).
// stripeAngle rotates dst into the stripe's grid space so stripes run along x.
// stripeThickness is the pixel thickness of the stripe (already scaled).
float stripeFamily(vec2 dstP, float stripeAngle, float stripeThickness) {
  if (stripeThickness <= 0.0) return 0.0;
  vec2 gridP = rotate2(dstP - uSize * 0.5, -stripeAngle);
  float halfLen = uCellSize * 0.75;
  float halfT = stripeThickness * 0.5;

  vec2 c0 = (floor(gridP / uCellSize) + 0.5) * uCellSize;
  // Horizontal neighbour only — capsules extend ±0.75*cellSize along x and
  // cell pitch along y is exactly cellSize, so no vertical neighbour contributes.
  float xSign = sign(gridP.x - c0.x);
  if (xSign == 0.0) xSign = 1.0;
  vec2 c1 = c0 + vec2(xSign * uCellSize, 0.0);

  float a = capsuleCov(gridP - c0, halfLen, halfT);
  float b = capsuleCov(gridP - c1, halfLen, halfT);
  return max(a, b);
}

void main() {
  vec2 dstP = vUv * uSize;
  // Sample brightness at the cell center of the primary grid orientation.
  // Both stripes use the same darkness value — matches CPU, which computes
  // darkness once per cell and passes it to both drawLine calls.
  vec2 gridP = rotate2(dstP - uSize * 0.5, -uAngle);
  vec2 cellCenter = (floor(gridP / uCellSize) + 0.5) * uCellSize;
  vec2 srcP = rotate2(cellCenter, uAngle) + uSize * 0.5;
  float brightness = sampleLum(srcP);

  float darkness = applyDotSettings(1.0 - brightness);
  if (darkness < 0.01) {
    fragColor = vec4(uBgColor, 1.0);
    return;
  }

  // Non-symmetric thickness formulas — line2 stays dormant below 50% darkness.
  float t1 = uCellSize * min(1.0, darkness * 2.0);
  float t2 = darkness > 0.5 ? uCellSize * (darkness - 0.5) * 2.0 : 0.0;

  float c1 = stripeFamily(dstP, uAngle,                          t1);
  float c2 = stripeFamily(dstP, uAngle + 1.5707963267948966,     t2);  // + π/2
  float coverage = max(c1, c2);
  fragColor = vec4(mix(uBgColor, uFgColor, coverage), 1.0);
}
`
