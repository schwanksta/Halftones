// src/engine/webgl/patterns/diamond.ts
import { FRAG_PRELUDE } from '../shared.glsl'

export const DIAMOND_FRAG = FRAG_PRELUDE + `
void main() {
  vec2 dstP = vUv * uSize;
  vec2 gridP = rotate2(dstP - uSize * 0.5, -uAngle);
  vec2 cellCenter = (floor(gridP / uCellSize) + 0.5) * uCellSize;
  vec2 srcP = rotate2(cellCenter, uAngle) + uSize * 0.5;
  float brightness = sampleLum(srcP);

  float darkness = applyDotSettings(1.0 - brightness);
  if (darkness < 0.01) {
    fragColor = vec4(uBgColor, 1.0);
    return;
  }

  float halfSize = (uCellSize * 0.5) * sqrt(darkness);
  vec2 p = abs(gridP - cellCenter);
  float d = p.x + p.y;  // L1 (Manhattan) distance — diamond shape
  // 1px anti-alias band
  float coverage = 1.0 - smoothstep(halfSize - 0.5, halfSize + 0.5, d);
  fragColor = vec4(mix(uBgColor, uFgColor, coverage), 1.0);
}
`
