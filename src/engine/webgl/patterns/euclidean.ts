// src/engine/webgl/patterns/euclidean.ts
import { FRAG_PRELUDE } from '../shared.glsl'

// Two-regime "euclidean" (round-dot/square) halftone:
//   darkness ≤ 0.5: ink dot grows from 0 to full cell
//                   radius = maxR * sqrt(2*darkness)
//   darkness > 0.5: cell is inked, white counter-dot shrinks to 0
//                   radius = maxR * sqrt(2*(1-darkness))
// Matches CPU drawEuclidean in src/engine/patterns.ts.
export const EUCLIDEAN_FRAG = FRAG_PRELUDE + `
void main() {
  vec2 dstP = vUv * uSize;
  vec2 gridP = rotate2(dstP - uSize * 0.5, -uAngle);
  vec2 cellCenter = (floor(gridP / uCellSize) + 0.5) * uCellSize;
  vec2 srcP = rotate2(cellCenter, uAngle) + uSize * 0.5;
  float brightness = sampleLum(srcP);

  float darkness = applyDotSettings(1.0 - brightness);
  // Short-circuit covers the -1.0 sentinel AND tiny-dot suppression
  // (below 0.01 a regime-1 dot has radius ≈ 0, where smoothstep would
  // otherwise paint half-coverage noise).
  if (darkness < 0.01) {
    fragColor = vec4(uBgColor, 1.0);
    return;
  }

  float d = distance(gridP, cellCenter);
  float maxR = uCellSize * 0.5;

  if (darkness <= 0.5) {
    // Regime 1: growing ink dot
    float r = maxR * sqrt(2.0 * darkness);
    float cov = 1.0 - smoothstep(r - 0.5, r + 0.5, d);
    fragColor = vec4(mix(uBgColor, uFgColor, cov), 1.0);
  } else {
    // Regime 2: no explicit cell-fill needed. Every fragment here is
    // already inside a cell (cellCenter was derived from floor(gridP/cell)),
    // so the mix below paints uFgColor everywhere the hole doesn't reach —
    // that's equivalent to the CPU's fillRect(cell) + bgColor punch-out.
    float r = maxR * sqrt(2.0 * (1.0 - darkness));
    float hole = 1.0 - smoothstep(r - 0.5, r + 0.5, d);  // 1 inside hole
    fragColor = vec4(mix(uFgColor, uBgColor, hole), 1.0);
  }
}
`
