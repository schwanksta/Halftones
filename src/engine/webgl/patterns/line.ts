// src/engine/webgl/patterns/line.ts
import { FRAG_PRELUDE } from '../shared.glsl'

// Per-cell capsule (rounded line segment) of length 1.5*cellSize along the
// grid's x-axis — in grid space, lines run along x because the angle is
// factored out by rotate2(..., -uAngle). Thickness = cellSize * darkness.
// We sample the primary cell AND its horizontal neighbour and take max
// coverage so the 0.25*cellSize capsule overlap is preserved, matching the
// CPU drawLine in src/engine/patterns.ts.
export const LINE_FRAG = FRAG_PRELUDE + `
float capsuleCoverage(vec2 gridP, vec2 cellCenter, float darknessAtCell, float halfLen) {
  if (darknessAtCell < 0.01) return 0.0;
  float halfT = (uCellSize * darknessAtCell) * 0.5;
  vec2 p = gridP - cellCenter;
  float clampedX = clamp(p.x, -halfLen, halfLen);
  float d = distance(p, vec2(clampedX, 0.0));
  return 1.0 - smoothstep(halfT - 0.5, halfT + 0.5, d);
}

float sampleDarknessAt(vec2 cellCenter) {
  vec2 srcP = rotate2(cellCenter, uAngle) + uSize * 0.5;
  float brightness = sampleLum(srcP);
  // Clamp the -1.0 "suppressed" sentinel to 0.0 — a suppressed cell
  // contributes zero darkness, which is the right behaviour here.
  // Avoids the sentinel crossing a function boundary undocumented.
  return max(0.0, applyDotSettings(1.0 - brightness));
}

void main() {
  vec2 dstP = vUv * uSize;
  vec2 gridP = rotate2(dstP - uSize * 0.5, -uAngle);

  // Primary cell containing gridP
  vec2 c0 = (floor(gridP / uCellSize) + 0.5) * uCellSize;
  // Horizontal neighbour only: capsules extend ±0.75*cellSize along x
  // and the cell pitch along y is exactly cellSize, so caps never protrude
  // vertically into another row — no y-neighbour can contribute.
  float xSign = sign(gridP.x - c0.x);
  if (xSign == 0.0) xSign = 1.0;  // exact cell-boundary hit is vanishingly rare; fallback direction is arbitrary
  vec2 c1 = c0 + vec2(xSign * uCellSize, 0.0);

  float halfLen = uCellSize * 0.75;
  float d0 = sampleDarknessAt(c0);
  float d1 = sampleDarknessAt(c1);

  float cov = max(
    capsuleCoverage(gridP, c0, d0, halfLen),
    capsuleCoverage(gridP, c1, d1, halfLen)
  );
  fragColor = vec4(mix(uBgColor, uFgColor, cov), 1.0);
}
`
