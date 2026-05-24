// src/engine/webgl/shared.glsl.ts

/** Vertex shader — fullscreen triangle.
 *  vUv spans [0,1] across the viewport with (0,0) at the TOP-left, matching
 *  ImageData / 2D-canvas convention. WebGL's native framebuffer origin is
 *  bottom-left, so vUv.y is flipped here — otherwise texture sampling
 *  (which is top-origin) would render the output upside-down. */
export const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

/** Shared fragment prelude: common uniforms + helpers. Concatenate before each
 *  pattern's shape function + its own main(). */
export const FRAG_PRELUDE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSrc;          // RGBA source image; luminance computed in sampleLum()
uniform vec2  uSize;              // destination size in pixels
uniform float uCellSize;          // cell size in destination pixels
uniform float uAngle;             // radians
uniform float uMinDot;            // 0..1, same semantics as HalftoneSettings.minDot
uniform float uMaxDot;            // 0..1
uniform float uDotGain;           // 0..1
uniform float uDotSize;           // multiplier
uniform float uHalftoneGamma;     // 0.5..3, power curve over full tonal range
uniform float uShadowBoost;       // 0..1, piecewise boost in dark tones
uniform float uHighlightBoost;    // 0..1, piecewise boost in light tones
uniform vec3  uFgColor;           // [0,1]^3 ink
uniform vec3  uBgColor;           // [0,1]^3 paper

// Keep in sync with engine/dot-settings.ts applyDotSettings()
// Returns -1.0 if suppressed (raw < minDot), else clamped darkness in [0,1].
//
// Canonical guard for callers: \`if (darkness < 0.01) { ...skip... }\` — the
// same branch catches both the -1.0 suppression sentinel AND near-zero
// darkness (where shapes collapse to subpixel noise). New patterns should
// follow this idiom rather than testing the sentinel explicitly.
float applyDotSettings(float rawDarkness) {
  float d = rawDarkness;

  // Halftone gamma — power curve over the full tonal range.
  if (uHalftoneGamma != 1.0 && d > 0.0) d = pow(d, 1.0 / uHalftoneGamma);

  // Shadow / highlight boost — piecewise power on each half of the range.
  if (d < 0.5 && uHighlightBoost > 0.0) {
    d = pow(d * 2.0, 1.0 / (1.0 + uHighlightBoost)) * 0.5;
  } else if (d >= 0.5 && uShadowBoost > 0.0) {
    d = pow((d - 0.5) * 2.0, 1.0 / (1.0 + uShadowBoost)) * 0.5 + 0.5;
  }

  if (d < uMinDot) return -1.0;
  float clamped = min(d, uMaxDot);
  return min(1.0, clamped * (1.0 - uDotGain) * uDotSize);
}

vec2 rotate2(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

/** Sample the source image at an (x,y) pixel coordinate in destination space.
 *  Source is uploaded at exactly the destination size (we extract the viewport
 *  region on CPU before upload), so UVs map 1:1. */
float sampleLum(vec2 pxCoord) {
  vec2 uv = clamp(pxCoord / uSize, vec2(0.0), vec2(1.0));
  vec3 rgb = texture(uSrc, uv).rgb;
  return dot(rgb, vec3(0.299, 0.587, 0.114));
}
`
