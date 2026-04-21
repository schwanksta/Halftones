// src/engine/webgl/patterns/hex.ts
import { FRAG_PRELUDE } from '../shared.glsl'

// Hex grid: compute the nearest of two candidate lattice neighbours and pick
// whichever is closer. Row spacing = cellSize * sqrt(3)/2; odd rows are offset
// horizontally by cellSize/2. Shape is the same circle as dot — only the
// lattice differs.
export const HEX_FRAG = FRAG_PRELUDE + `
const float ROW_FACTOR = 0.8660254037844386;  // sqrt(3)/2

void main() {
  vec2 dstP = vUv * uSize;
  vec2 gridP = rotate2(dstP - uSize * 0.5, -uAngle);

  float rowSpacing = uCellSize * ROW_FACTOR;
  float fRow = gridP.y / rowSpacing;
  int rowBase = int(floor(fRow + 0.5));  // nearest row index

  // Two candidate cell centers: the nearest row, and one above/below
  // depending on which half of the row's vertical band we're in.
  int altRow = (fRow - float(rowBase) >= 0.0) ? rowBase + 1 : rowBase - 1;

  vec2 best;
  float bestD = 1e20;

  for (int i = 0; i < 2; i++) {
    int row = (i == 0) ? rowBase : altRow;
    float hexOffset = (row - (row / 2) * 2 != 0) ? uCellSize * 0.5 : 0.0;
    float cx = floor((gridP.x - hexOffset) / uCellSize + 0.5) * uCellSize + hexOffset;
    float cy = float(row) * rowSpacing;
    vec2 c = vec2(cx, cy);
    float d = distance(gridP, c);
    if (d < bestD) { bestD = d; best = c; }
  }

  vec2 srcP = rotate2(best, uAngle) + uSize * 0.5;
  float brightness = sampleLum(srcP);
  float darkness = applyDotSettings(1.0 - brightness);
  if (darkness < 0.01) {
    fragColor = vec4(uBgColor, 1.0);
    return;
  }

  float radius = (uCellSize * 0.5) * sqrt(darkness);
  // 1px anti-alias band
  float coverage = 1.0 - smoothstep(radius - 0.5, radius + 0.5, bestD);
  fragColor = vec4(mix(uBgColor, uFgColor, coverage), 1.0);
}
`
