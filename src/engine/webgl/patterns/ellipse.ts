// src/engine/webgl/patterns/ellipse.ts
import { FRAG_PRELUDE } from '../shared.glsl'

export const ELLIPSE_FRAG = FRAG_PRELUDE + `
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

  float maxRadius = uCellSize * 0.5;
  float rx = maxRadius * sqrt(darkness);
  float ry = rx * 0.6;

  // Elliptical distance, normalized so d <= 1 means inside
  vec2 p = gridP - cellCenter;
  float d = length(vec2(p.x / rx, p.y / ry));
  // Approximate AA — pixel-width smoothstep on the normalized distance
  float aa = max(1.0 / rx, 1.0 / ry) * 0.5;
  float coverage = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
  fragColor = vec4(mix(uBgColor, uFgColor, coverage), 1.0);
}
`
