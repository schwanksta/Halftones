// src/engine/webgl/patterns/dot.ts
import { FRAG_PRELUDE } from '../shared.glsl'

export const DOT_FRAG = FRAG_PRELUDE + `
void main() {
  vec2 dstP = vUv * uSize;
  // Rotate destination coord into grid space
  vec2 gridP = rotate2(dstP - uSize * 0.5, -uAngle);

  // Nearest cell center (in grid space)
  vec2 cellCenter = (floor(gridP / uCellSize) + 0.5) * uCellSize;

  // Sample brightness at the cell center (rotate back into image space)
  vec2 srcP = rotate2(cellCenter, uAngle) + uSize * 0.5;
  float brightness = sampleLum(srcP);

  float rawDarkness = 1.0 - brightness;
  float darkness = applyDotSettings(rawDarkness);
  if (darkness < 0.0 || darkness < 0.01) {
    fragColor = vec4(uBgColor, 1.0);
    return;
  }

  // Matches CPU path: radius = maxRadius * sqrt(darkness)
  float maxRadius = uCellSize * 0.5;
  float radius = maxRadius * sqrt(darkness);

  float d = length(gridP - cellCenter);
  // 1px anti-alias band — keeps edges crisp without visible aliasing in preview
  float coverage = 1.0 - smoothstep(radius - 0.5, radius + 0.5, d);
  fragColor = vec4(mix(uBgColor, uFgColor, coverage), 1.0);
}
`
