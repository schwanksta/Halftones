# WebGL2 Halftone Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the seven most-used grid-based halftone patterns (dot, ellipse, diamond, hex, euclidean, line, crosshatch) from CPU Canvas 2D to a WebGL2 fragment-shader renderer, delivering a 10–50× speedup on preview and export while preserving pixel-accurate visual parity with the current CPU output.

**Architecture:**
- A new `src/engine/webgl/` module houses context management, program compilation, a fullscreen-quad VAO, a texture helper, and one fragment shader per pattern. A single `renderHalftoneGL(ctx, options)` entry point renders to an internal offscreen canvas then `drawImage`s into the caller's 2D context — interface-compatible with the existing `renderHalftone`. The existing `renderHalftone` in `halftone.ts` becomes a dispatcher that routes GL-supported patterns to the GL path and keeps stipple/stochastic/radial/radial-lines/concentric/brick on CPU.
- Capability detection: if WebGL2 is unavailable (or context creation fails), the dispatcher falls back to the current CPU path. A `localStorage.halftones_useGL = 'false'` override forces CPU during development.
- CMYK/spot use N render passes into framebuffer-backed textures, then a composite shader (or CPU composite for v1 to minimize risk — decided per-task below).

**Tech Stack:** TypeScript, React 18, Vite, WebGL2 (no libraries). No test framework added — verification is build + visual comparison against the CPU reference.

---

## File Structure

**New files:**
- `src/engine/webgl/context.ts` — lazy WebGL2 context + capability detection
- `src/engine/webgl/program.ts` — compile shader / link program helpers
- `src/engine/webgl/quad.ts` — shared fullscreen-quad VAO/VBO
- `src/engine/webgl/texture.ts` — upload `ImageData` to `GL_R8` (grayscale) or `GL_RGBA8` texture; luminance-pack helper
- `src/engine/webgl/shared.glsl.ts` — shared GLSL chunks (vertex shader, rotate2, dot-settings)
- `src/engine/webgl/patterns/dot.ts` — dot fragment shader + render fn
- `src/engine/webgl/patterns/ellipse.ts`
- `src/engine/webgl/patterns/diamond.ts`
- `src/engine/webgl/patterns/hex.ts`
- `src/engine/webgl/patterns/euclidean.ts`
- `src/engine/webgl/patterns/line.ts`
- `src/engine/webgl/patterns/crosshatch.ts`
- `src/engine/webgl/render.ts` — `renderHalftoneGL(ctx, options)` — dispatches by pattern, manages shared canvas/context
- `src/engine/webgl/composite.ts` — `compositeCMYK_GL(...)` / `compositeSpot_GL(...)` (Task 9–10)

**Modified files:**
- `src/engine/halftone.ts` — dispatcher: if `isGLSupported(pattern)` and `glAvailable()` and override not set, delegate to `renderHalftoneGL`; else existing CPU path
- `src/engine/export.ts` — full-resolution exports use the same dispatcher (no changes needed if the dispatcher lives in `renderHalftone`)

---

## Task 1: WebGL2 infrastructure scaffold

**Files:**
- Create: `src/engine/webgl/context.ts`
- Create: `src/engine/webgl/program.ts`
- Create: `src/engine/webgl/quad.ts`
- Create: `src/engine/webgl/texture.ts`
- Create: `src/engine/webgl/shared.glsl.ts`
- Create: `src/engine/webgl/render.ts`

- [ ] **Step 1: Add `context.ts`**

```ts
// src/engine/webgl/context.ts
let cached: { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext } | null = null
let probed: boolean | null = null

export function isWebGL2Available(): boolean {
  if (probed !== null) return probed
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2')
    probed = !!gl
  } catch { probed = false }
  return probed
}

export function useGLOverride(): 'force-off' | 'auto' {
  try {
    return localStorage.getItem('halftones_useGL') === 'false' ? 'force-off' : 'auto'
  } catch { return 'auto' }
}

/** Shared offscreen canvas / context reused for preview frames. */
export function getSharedGL(width: number, height: number): { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext } | null {
  if (!isWebGL2Available()) return null
  if (!cached) {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: false, antialias: false })
    if (!gl) return null
    cached = { canvas, gl }
  }
  if (cached.canvas.width !== width || cached.canvas.height !== height) {
    cached.canvas.width = width
    cached.canvas.height = height
  }
  return cached
}
```

- [ ] **Step 2: Add `program.ts`**

```ts
// src/engine/webgl/program.ts
export function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src); gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) ?? '(no log)'
    gl.deleteShader(s)
    throw new Error(`Shader compile failed: ${log}\n\nSource:\n${src}`)
  }
  return s
}

export function linkProgram(gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram {
  const p = gl.createProgram()!
  gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p) ?? '(no log)'
    gl.deleteProgram(p)
    throw new Error(`Program link failed: ${log}`)
  }
  return p
}

/** Cache compiled programs keyed by fragment-shader source string. */
const programCache = new WeakMap<WebGL2RenderingContext, Map<string, WebGLProgram>>()

export function getOrCompileProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram {
  let byCtx = programCache.get(gl)
  if (!byCtx) { byCtx = new Map(); programCache.set(gl, byCtx) }
  const key = fragSrc  // vert is constant across all patterns
  const cached = byCtx.get(key)
  if (cached) return cached
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc)
  const p = linkProgram(gl, vs, fs)
  byCtx.set(key, p)
  gl.deleteShader(vs); gl.deleteShader(fs)
  return p
}
```

- [ ] **Step 3: Add `quad.ts`**

```ts
// src/engine/webgl/quad.ts
/** Creates (once per context) a VAO holding a fullscreen triangle that covers
 *  clip space [-1,1]² with UV [0,1]² flowing via gl_Position. */
const vaoCache = new WeakMap<WebGL2RenderingContext, WebGLVertexArrayObject>()

export function getFullscreenQuadVAO(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const cached = vaoCache.get(gl)
  if (cached) return cached

  const vao = gl.createVertexArray()!
  gl.bindVertexArray(vao)

  // Single triangle covering the screen — simpler than a quad, no overdraw
  const positions = new Float32Array([-1, -1,  3, -1,  -1,  3])
  const buf = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

  gl.bindVertexArray(null)
  vaoCache.set(gl, vao)
  return vao
}
```

- [ ] **Step 4: Add `texture.ts`**

```ts
// src/engine/webgl/texture.ts
/** Upload RGBA ImageData to a 2D texture. Returns a fresh texture each call —
 *  caller is responsible for deleting. For small preview frames (< 2MP) this
 *  is fast enough to redo per frame. */
export function uploadRGBATexture(gl: WebGL2RenderingContext, img: ImageData): WebGLTexture {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, img.width, img.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, img.data)
  return tex
}
```

- [ ] **Step 5: Add `shared.glsl.ts`**

```ts
// src/engine/webgl/shared.glsl.ts

/** Vertex shader — fullscreen triangle. vUv spans [0,1] across the viewport. */
export const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

/** Shared fragment prelude: common uniforms + helpers. Concatenate before each
 *  pattern's shape function + its own main(). */
export const FRAG_PRELUDE = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSrc;       // RGBA source image; we read .r (luminance-packed)
uniform vec2  uSize;           // destination size in pixels
uniform float uCellSize;       // cell size in destination pixels
uniform float uAngle;          // radians
uniform float uMinDot;         // 0..1, same semantics as HalftoneSettings.minDot
uniform float uMaxDot;         // 0..1
uniform float uDotGain;        // 0..1
uniform float uDotSize;        // multiplier
uniform vec3  uFgColor;        // [0,1]^3 ink
uniform vec3  uBgColor;        // [0,1]^3 paper

// Keep in sync with engine/dot-settings.ts applyDotSettings()
// Returns -1.0 if suppressed (raw < minDot), else clamped darkness in [0,1].
float applyDotSettings(float rawDarkness) {
  if (rawDarkness < uMinDot) return -1.0;
  float clamped = min(rawDarkness, uMaxDot);
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
```

- [ ] **Step 6: Add `render.ts` skeleton (dispatcher placeholder)**

```ts
// src/engine/webgl/render.ts
import { HalftoneSettings, PatternType } from '../../types'
import { getSharedGL, isWebGL2Available, useGLOverride } from './context'

export const GL_SUPPORTED_PATTERNS: ReadonlySet<PatternType> = new Set([
  // Filled in as patterns are added. Start empty.
])

export function shouldUseGL(pattern: PatternType): boolean {
  if (!GL_SUPPORTED_PATTERNS.has(pattern)) return false
  if (useGLOverride() === 'force-off') return false
  return isWebGL2Available()
}

export interface GLRenderOptions {
  source: ImageData
  settings: HalftoneSettings
  width: number
  height: number
}

/** Returns true on success (caller should drawImage the shared canvas onto
 *  their ctx). Returns false if GL failed — caller should fall back to CPU. */
export function renderHalftoneGL(
  targetCtx: CanvasRenderingContext2D,
  opts: GLRenderOptions,
): boolean {
  const { width, height } = opts
  const shared = getSharedGL(width, height)
  if (!shared) return false

  // Per-pattern dispatch added in subsequent tasks.
  // For now, just clear to paper color so integration test proves wiring.
  const { gl, canvas } = shared
  gl.viewport(0, 0, width, height)
  const rawBg = opts.settings.bgColor || '#ffffff'
  const [br, bg, bb] = hexToRgb01(rawBg)
  gl.clearColor(br, bg, bb, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)

  targetCtx.drawImage(canvas, 0, 0)
  return true
}

export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ]
}
```

- [ ] **Step 7: Build and verify**

Run: `npm run build`
Expected: clean build, zero TypeScript errors. No functional change yet — nothing calls `renderHalftoneGL`.

- [ ] **Step 8: Commit**

```bash
git add src/engine/webgl/
git commit -m "Add WebGL2 scaffolding for halftone renderer

Sets up context caching, program compilation, fullscreen-quad VAO,
texture upload, and shared GLSL helpers. No patterns yet — renderer
returns a cleared canvas. Subsequent tasks add one pattern at a time.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Dot pattern end-to-end

Wire up the dispatcher so a single pattern flows through GL. Prove the plumbing works visually before adding more patterns.

**Files:**
- Create: `src/engine/webgl/patterns/dot.ts`
- Modify: `src/engine/webgl/render.ts`
- Modify: `src/engine/halftone.ts`

- [ ] **Step 1: Add `patterns/dot.ts`**

```ts
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
```

- [ ] **Step 2: Add pattern dispatcher and uniform-setter helper in `render.ts`**

Update `src/engine/webgl/render.ts` — replace the placeholder body with:

```ts
import { HalftoneSettings, PatternType } from '../../types'
import { getSharedGL, isWebGL2Available, useGLOverride } from './context'
import { getOrCompileProgram } from './program'
import { getFullscreenQuadVAO } from './quad'
import { uploadRGBATexture } from './texture'
import { VERT_SRC } from './shared.glsl'
import { DOT_FRAG } from './patterns/dot'

export const GL_SUPPORTED_PATTERNS: ReadonlySet<PatternType> = new Set<PatternType>([
  'dot',
])

export function shouldUseGL(pattern: PatternType): boolean {
  if (!GL_SUPPORTED_PATTERNS.has(pattern)) return false
  if (useGLOverride() === 'force-off') return false
  return isWebGL2Available()
}

export interface GLRenderOptions {
  source: ImageData
  settings: HalftoneSettings
  renderDpi: number
  width: number
  height: number
}

function fragSrcFor(pattern: PatternType): string | null {
  switch (pattern) {
    case 'dot': return DOT_FRAG
    default: return null
  }
}

export function renderHalftoneGL(
  targetCtx: CanvasRenderingContext2D,
  opts: GLRenderOptions,
): boolean {
  const { width, height, settings, source, renderDpi } = opts
  const shared = getSharedGL(width, height)
  if (!shared) return false
  const { gl, canvas } = shared

  const frag = fragSrcFor(settings.pattern)
  if (!frag) return false

  let tex: WebGLTexture | null = null
  try {
    const prog = getOrCompileProgram(gl, VERT_SRC, frag)
    const vao = getFullscreenQuadVAO(gl)
    tex = uploadRGBATexture(gl, source)

    gl.viewport(0, 0, width, height)
    gl.useProgram(prog)
    gl.bindVertexArray(vao)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(gl.getUniformLocation(prog, 'uSrc'), 0)

    const cellSize = renderDpi / settings.lpi
    const invert = !!settings.invert
    const rawFg = settings.fgColor || '#000000'
    const rawBg = settings.bgColor || '#ffffff'
    const fg = invert ? rawBg : rawFg
    const bg = invert ? rawFg : rawBg

    gl.uniform2f(gl.getUniformLocation(prog, 'uSize'), width, height)
    gl.uniform1f(gl.getUniformLocation(prog, 'uCellSize'), cellSize)
    gl.uniform1f(gl.getUniformLocation(prog, 'uAngle'), (settings.angle * Math.PI) / 180)
    gl.uniform1f(gl.getUniformLocation(prog, 'uMinDot'), settings.minDot ?? 0)
    gl.uniform1f(gl.getUniformLocation(prog, 'uMaxDot'), settings.maxDot ?? 1)
    gl.uniform1f(gl.getUniformLocation(prog, 'uDotGain'), settings.dotGain ?? 0)
    gl.uniform1f(gl.getUniformLocation(prog, 'uDotSize'), settings.dotSize ?? 1)
    gl.uniform3fv(gl.getUniformLocation(prog, 'uFgColor'), hexToRgb01(fg))
    gl.uniform3fv(gl.getUniformLocation(prog, 'uBgColor'), hexToRgb01(bg))

    gl.drawArrays(gl.TRIANGLES, 0, 3)

    targetCtx.drawImage(canvas, 0, 0)
    return true
  } catch (err) {
    console.error('[webgl] render failed', err)
    return false
  } finally {
    if (tex) gl.deleteTexture(tex)
  }
}

export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ]
}
```

- [ ] **Step 3: Wire dispatcher into `halftone.ts`**

In `src/engine/halftone.ts`, add the import and early-dispatch block. Insert the GL dispatch *after* the early-exit special cases (stochastic, radial, stipple) and *before* the grayscale pre-computation — i.e., right after the `if (cellSize < 1) return` check on line 86.

Add import at top of file:

```ts
import { shouldUseGL, renderHalftoneGL } from './webgl/render'
```

Replace:

```ts
  if (cellSize < 1) return

  // Pre-compute grayscale buffer once — avoids per-pixel luminance math in the hot loop
  const gray = precomputeGrayscale(source)
```

With:

```ts
  if (cellSize < 1) return

  // Try GL fast path first for supported patterns. Falls through to CPU on failure.
  if (shouldUseGL(pattern)) {
    const ok = renderHalftoneGL(ctx, {
      source, settings, renderDpi,
      width, height,
    })
    if (ok) return
  }

  // Pre-compute grayscale buffer once — avoids per-pixel luminance math in the hot loop
  const gray = precomputeGrayscale(source)
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 5: Visual verification**

Run: `npm run dev`, load any test image, set pattern = dot.

Expected: preview renders dots. Side-by-side check vs CPU by setting `localStorage.halftones_useGL = 'false'` in the console and reloading — output should look visually identical (tiny anti-alias differences at dot edges are acceptable; overall density, angle, dot size should match).

Also test: change LPI, angle, fgColor, bgColor, invert, minDot, maxDot, dotGain, dotSize sliders — each should update the GL output correctly. Any that look wrong indicate a uniform mismatch with the CPU reference in `engine/halftone.ts` lines 159–167.

- [ ] **Step 6: Commit**

```bash
git add src/engine/halftone.ts src/engine/webgl/
git commit -m "Render dot pattern via WebGL2 fragment shader

First pattern wired through the GL fast path. Dispatcher in
renderHalftone() routes 'dot' to the GPU when WebGL2 is available;
falls back to the existing CPU path on failure or when forced off via
localStorage.halftones_useGL = 'false'.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Ellipse pattern

**Files:**
- Create: `src/engine/webgl/patterns/ellipse.ts`
- Modify: `src/engine/webgl/render.ts`

- [ ] **Step 1: Add `patterns/ellipse.ts`**

CPU reference (for semantics): `engine/halftone.ts` lines 168–173:
```
rx = maxRadius * sqrt(darkness); ry = rx * 0.6;
path.ellipse(ix, iy, rx, ry, angleRad, 0, TWO_PI);
```
The ellipse is axis-aligned in grid space and rotated to image space by `angleRad`. In the shader, we're already in grid space when we compute the shape, so this is straightforward.

```ts
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
  if (darkness < 0.0 || darkness < 0.01) {
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
```

- [ ] **Step 2: Register pattern in `render.ts`**

In `src/engine/webgl/render.ts`, update the supported set and dispatcher:

```ts
import { ELLIPSE_FRAG } from './patterns/ellipse'

export const GL_SUPPORTED_PATTERNS: ReadonlySet<PatternType> = new Set<PatternType>([
  'dot', 'ellipse',
])

function fragSrcFor(pattern: PatternType): string | null {
  switch (pattern) {
    case 'dot': return DOT_FRAG
    case 'ellipse': return ELLIPSE_FRAG
    default: return null
  }
}
```

- [ ] **Step 3: Build + visual verify**

Run: `npm run build`
Expected: clean build.

Run: `npm run dev`, pattern = ellipse. Toggle `halftones_useGL='false'` reload to compare vs CPU. Should match within AA tolerance; ellipse aspect ratio should look identical, angle rotation should match.

- [ ] **Step 4: Commit**

```bash
git add src/engine/webgl/
git commit -m "Add WebGL ellipse pattern"
```

---

## Task 4: Diamond pattern

**Files:**
- Create: `src/engine/webgl/patterns/diamond.ts`
- Modify: `src/engine/webgl/render.ts`

CPU reference: `engine/halftone.ts` lines 174–183. Diamond = square rotated 45° with half-diagonal = `maxRadius * sqrt(darkness)`. This is the L1 (Manhattan) distance ball.

- [ ] **Step 1: Add `patterns/diamond.ts`**

```ts
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
  if (darkness < 0.0 || darkness < 0.01) {
    fragColor = vec4(uBgColor, 1.0);
    return;
  }

  float halfSize = (uCellSize * 0.5) * sqrt(darkness);
  vec2 p = abs(gridP - cellCenter);
  float d = p.x + p.y;  // L1 distance
  float coverage = 1.0 - smoothstep(halfSize - 0.5, halfSize + 0.5, d);
  fragColor = vec4(mix(uBgColor, uFgColor, coverage), 1.0);
}
`
```

- [ ] **Step 2: Register in `render.ts`**

```ts
import { DIAMOND_FRAG } from './patterns/diamond'

export const GL_SUPPORTED_PATTERNS = new Set<PatternType>(['dot', 'ellipse', 'diamond'])

function fragSrcFor(pattern: PatternType): string | null {
  switch (pattern) {
    case 'dot': return DOT_FRAG
    case 'ellipse': return ELLIPSE_FRAG
    case 'diamond': return DIAMOND_FRAG
    default: return null
  }
}
```

- [ ] **Step 3: Build + visual verify + commit**

```bash
npm run build
# verify dev server, pattern=diamond
git add src/engine/webgl/ && git commit -m "Add WebGL diamond pattern"
```

---

## Task 5: Hex pattern

**Files:**
- Create: `src/engine/webgl/patterns/hex.ts`
- Modify: `src/engine/webgl/render.ts`

CPU reference: `engine/halftone.ts` lines 95–96, 144, 160–167. Hex uses `rowSpacing = cellSize * sqrt(3)/2` and odd rows are shifted by `cellSize/2`. The *shape* is the same as dot (circle with radius = `maxRadius * sqrt(darkness)`) — only the *lattice* differs.

- [ ] **Step 1: Add `patterns/hex.ts`**

```ts
// src/engine/webgl/patterns/hex.ts
import { FRAG_PRELUDE } from '../shared.glsl'

// Hex grid: compute nearest of the two possible lattice neighbours and pick
// whichever is closer. Row spacing = cellSize * sqrt(3)/2; odd rows offset by
// cellSize/2.
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
  if (darkness < 0.0 || darkness < 0.01) {
    fragColor = vec4(uBgColor, 1.0);
    return;
  }

  float radius = (uCellSize * 0.5) * sqrt(darkness);
  float coverage = 1.0 - smoothstep(radius - 0.5, radius + 0.5, bestD);
  fragColor = vec4(mix(uBgColor, uFgColor, coverage), 1.0);
}
`
```

- [ ] **Step 2: Register in `render.ts`**

```ts
import { HEX_FRAG } from './patterns/hex'

export const GL_SUPPORTED_PATTERNS = new Set<PatternType>(['dot', 'ellipse', 'diamond', 'hex'])
// plus case 'hex': return HEX_FRAG in fragSrcFor
```

- [ ] **Step 3: Build + visual verify + commit**

Hex needs careful visual check — row spacing and odd-row offset must produce the characteristic honeycomb lattice. Compare directly against CPU (toggle override).

```bash
npm run build
git add src/engine/webgl/ && git commit -m "Add WebGL hex pattern"
```

---

## Task 6: Euclidean pattern

**Files:**
- Create: `src/engine/webgl/patterns/euclidean.ts`
- Modify: `src/engine/webgl/render.ts`

CPU reference: `engine/patterns.ts → drawEuclidean` (not shown inline — the engineer should read it before implementing). Semantics: for darkness ≤ 0.5 the cell grows a solid dot just like the dot pattern but scaled to fill up to the full cell at darkness=0.5; for darkness > 0.5 the cell is filled with ink and a *white* counter-dot punches out, shrinking to zero at darkness=1.0.

- [ ] **Step 1: Read the CPU reference**

Run: `grep -n "drawEuclidean" src/engine/patterns.ts` and read that function end-to-end before writing the shader. Note the exact radius formulas for both regimes so the shader matches.

- [ ] **Step 2: Add `patterns/euclidean.ts`**

```ts
// src/engine/webgl/patterns/euclidean.ts
import { FRAG_PRELUDE } from '../shared.glsl'

// Two-regime dot:
//   darkness ≤ 0.5:  ink dot grows from 0 to full cell (radius = cellSize * sqrt(darkness / 0.5) * 0.5)
//   darkness >  0.5: cell is inked, white counter-dot shrinks to 0
//                    (radius = cellSize * sqrt(1 - (darkness - 0.5) / 0.5) * 0.5)
// Match CPU formulas in src/engine/patterns.ts drawEuclidean exactly.
export const EUCLIDEAN_FRAG = FRAG_PRELUDE + `
void main() {
  vec2 dstP = vUv * uSize;
  vec2 gridP = rotate2(dstP - uSize * 0.5, -uAngle);
  vec2 cellCenter = (floor(gridP / uCellSize) + 0.5) * uCellSize;
  vec2 srcP = rotate2(cellCenter, uAngle) + uSize * 0.5;
  float brightness = sampleLum(srcP);

  float darkness = applyDotSettings(1.0 - brightness);
  if (darkness < 0.0) {
    fragColor = vec4(uBgColor, 1.0);
    return;
  }

  float d = distance(gridP, cellCenter);
  float maxR = uCellSize * 0.5;

  if (darkness <= 0.5) {
    float r = maxR * sqrt(darkness / 0.5);
    float cov = 1.0 - smoothstep(r - 0.5, r + 0.5, d);
    fragColor = vec4(mix(uBgColor, uFgColor, cov), 1.0);
  } else {
    float r = maxR * sqrt(1.0 - (darkness - 0.5) / 0.5);
    // Ink fills the cell, white counter-dot (bgColor) punches out.
    float cov = 1.0 - smoothstep(r - 0.5, r + 0.5, d);  // 1 inside white hole
    fragColor = vec4(mix(uFgColor, uBgColor, cov), 1.0);
  }
}
`
```

- [ ] **Step 3: Verify formulas match `drawEuclidean` in `src/engine/patterns.ts`**

If the CPU uses a different radius curve (e.g., without the sqrt), update the shader to match. The shader's output must equal the CPU's at darkness = 0.25 and darkness = 0.75 (pixel-level spot check).

- [ ] **Step 4: Register, build, visual verify, commit**

```ts
// render.ts
import { EUCLIDEAN_FRAG } from './patterns/euclidean'
// add 'euclidean' to GL_SUPPORTED_PATTERNS
// case 'euclidean': return EUCLIDEAN_FRAG
```

```bash
npm run build
# visual: pattern=euclidean, sweep darkness via black point to verify both regimes
git add src/engine/webgl/ && git commit -m "Add WebGL euclidean pattern"
```

---

## Task 7: Line pattern

**Files:**
- Create: `src/engine/webgl/patterns/line.ts`
- Modify: `src/engine/webgl/render.ts`

CPU reference: `engine/patterns.ts → drawLine` (lines 17–36). Important: the CPU draws an **oriented capsule per cell** (line segment of length `cellSize * 1.5` with rounded caps), *not* an infinite stripe. `halfLen = cellSize * 0.75`, `thickness = cellSize * darkness`, `lineCap = 'round'`. Because halfLen > cellSize/2, adjacent cells' capsules overlap by 0.25×cellSize — that's what produces visually continuous stripes when neighbouring darknesses are similar.

The shader has to match the capsule SDF so parity holds when neighbouring darknesses *differ*. Simple approach: sample both the nearest cell and the horizontal-neighbour cell (in grid space), compute capsule coverage for each, take the max.

- [ ] **Step 1: Read the CPU reference**

Run: `grep -n "drawLine" src/engine/patterns.ts` and read the function. Note the exact halfLen, lineCap, and thickness formula.

- [ ] **Step 2: Add `patterns/line.ts`**

```ts
// src/engine/webgl/patterns/line.ts
import { FRAG_PRELUDE } from '../shared.glsl'

// Per-cell capsule (rounded line segment) of length 1.5*cellSize along the
// grid's x-axis, thickness = cellSize * darkness. Sample the nearest cell and
// its horizontal neighbour; take max coverage so the 0.25*cellSize overlap
// between adjacent capsules is preserved.
export const LINE_FRAG = FRAG_PRELUDE + `
float capsuleCoverage(vec2 gridP, vec2 cellCenter, float darknessAtCell, float halfLen) {
  if (darknessAtCell < 0.0 || darknessAtCell < 0.01) return 0.0;
  float halfT = (uCellSize * darknessAtCell) * 0.5;
  vec2 p = gridP - cellCenter;
  float clampedX = clamp(p.x, -halfLen, halfLen);
  float d = distance(p, vec2(clampedX, 0.0));
  return 1.0 - smoothstep(halfT - 0.5, halfT + 0.5, d);
}

float sampleDarknessAt(vec2 cellCenter) {
  vec2 srcP = rotate2(cellCenter, uAngle) + uSize * 0.5;
  float brightness = sampleLum(srcP);
  return applyDotSettings(1.0 - brightness);
}

void main() {
  vec2 dstP = vUv * uSize;
  vec2 gridP = rotate2(dstP - uSize * 0.5, -uAngle);

  // Primary cell containing gridP
  vec2 c0 = (floor(gridP / uCellSize) + 0.5) * uCellSize;
  // Horizontal neighbour in grid space (lines run along x, so neighbour along x)
  float xSign = sign(gridP.x - c0.x);
  if (xSign == 0.0) xSign = 1.0;
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
```

- [ ] **Step 3: Register in `render.ts`**

```ts
// render.ts: add 'line' to GL_SUPPORTED_PATTERNS, case 'line': return LINE_FRAG
```

- [ ] **Step 4: Build + visual verify + commit**

Visual check against CPU:
1. Solid-grey test image, angle=0, moderate LPI → should produce evenly-spaced horizontal stripes with no column-boundary artefacts.
2. Image with sharp light/dark transition → capsule ends should be visibly rounded at the transition boundary, matching CPU.
3. Sweep angle slider → stripe orientation tracks.

```bash
npm run build
git add src/engine/webgl/ && git commit -m "Add WebGL line pattern"
```

---

## Task 8: Crosshatch pattern

**Files:**
- Create: `src/engine/webgl/patterns/crosshatch.ts`
- Modify: `src/engine/webgl/render.ts`

CPU reference: `engine/patterns.ts → drawCrosshatch` (lines 108–125). Important formulas — they are **not symmetric**:
- First line at `angle`, thickness = `cellSize * min(1, darkness * 2)`
- Second line at `angle + π/2`, only drawn when `darkness > 0.5`, thickness = `cellSize * (darkness - 0.5) * 2`

Both lines are capsules of length 1.5×cellSize with rounded caps (they're just calls into `drawLine`). So the crosshatch shader is two capsule-coverage evaluations at perpendicular angles, with these specific thickness formulas, OR'd together.

- [ ] **Step 1: Read `drawCrosshatch` and `drawLine` in `src/engine/patterns.ts`**

Confirm the thickness formulas above before coding. Match them exactly.

- [ ] **Step 2: Add `patterns/crosshatch.ts`**

```ts
// src/engine/webgl/patterns/crosshatch.ts
import { FRAG_PRELUDE } from '../shared.glsl'

// Two capsules per cell at perpendicular angles. Thickness formulas match
// CPU drawCrosshatch exactly:
//   line1: thickness = cellSize * min(1, darkness * 2)          (always drawn)
//   line2: thickness = cellSize * (darkness - 0.5) * 2          (only if darkness > 0.5)
// Each capsule has length 1.5*cellSize with rounded caps — same SDF as the
// line pattern. Sample both the nearest cell AND the neighbour along each
// capsule's axis so the 0.25*cellSize overlap is preserved.
export const CROSSHATCH_FRAG = FRAG_PRELUDE + `
float capsuleCov(vec2 p, float halfLen, float halfT) {
  float clampedX = clamp(p.x, -halfLen, halfLen);
  float d = distance(p, vec2(clampedX, 0.0));
  return 1.0 - smoothstep(halfT - 0.5, halfT + 0.5, d);
}

// Evaluate one capsule stripe family (one axis of the crosshatch).
// angleOffset: 0.0 for first stripe, π/2 for second.
// thicknessFn: set by caller via thicknessA/B uniforms passed per-call.
float stripeFamily(vec2 dstP, float stripeAngle, float stripeThickness) {
  if (stripeThickness <= 0.0) return 0.0;
  vec2 gridP = rotate2(dstP - uSize * 0.5, -stripeAngle);
  float halfLen = uCellSize * 0.75;
  float halfT = stripeThickness * 0.5;

  vec2 c0 = (floor(gridP / uCellSize) + 0.5) * uCellSize;
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
  vec2 gridP = rotate2(dstP - uSize * 0.5, -uAngle);
  vec2 cellCenter = (floor(gridP / uCellSize) + 0.5) * uCellSize;
  vec2 srcP = rotate2(cellCenter, uAngle) + uSize * 0.5;
  float brightness = sampleLum(srcP);

  float darkness = applyDotSettings(1.0 - brightness);
  if (darkness < 0.0 || darkness < 0.01) {
    fragColor = vec4(uBgColor, 1.0);
    return;
  }

  float t1 = uCellSize * min(1.0, darkness * 2.0);
  float t2 = darkness > 0.5 ? uCellSize * (darkness - 0.5) * 2.0 : 0.0;

  float c1 = stripeFamily(dstP, uAngle,                         t1);
  float c2 = stripeFamily(dstP, uAngle + 1.5707963267948966,     t2);
  float coverage = max(c1, c2);
  fragColor = vec4(mix(uBgColor, uFgColor, coverage), 1.0);
}
`
```

Note: the brightness sample for the *secondary* stripe should ideally come from the cell centre of the rotated-by-π/2 grid, but since the CPU uses the same cell's darkness for both, we match by using the single darkness value computed from the primary grid. This matches CPU behaviour exactly.

- [ ] **Step 3: Register, build, visual verify, commit**

Add `'crosshatch'` to supported set and dispatcher. Visual check: crosshatching is visible at medium darkness; rotates correctly.

```bash
npm run build
git add src/engine/webgl/ && git commit -m "Add WebGL crosshatch pattern"
```

---

## Task 9: CMYK multi-pass rendering

**Goal:** For CMYK color mode, render each channel with its own angle/LPI to a framebuffer texture, then composite in CPU (simplest, lowest-risk). A future task can move compositing to a shader if perf demands.

**Files:**
- Modify: `src/engine/webgl/render.ts` — add `renderChannelGL(...)` that renders to a grayscale readback
- Modify: `src/hooks/useHalftonePreview.ts` — CMYK branch uses GL channel renderer when pattern is GL-supported
- Modify: `src/engine/halftone.ts` — no changes needed; existing per-channel `renderHalftone` call already routes through the dispatcher

- [ ] **Step 1: Verify existing CMYK path already benefits**

Read lines 279–295 of `src/hooks/useHalftonePreview.ts`. The CMYK branch calls `renderHalftone(chCtx, { source: channels[ch], ... })` per channel. Since our dispatcher is *inside* `renderHalftone`, each of those 4 calls already takes the GL fast path automatically when the pattern is supported.

Expected at this point: switch to CMYK mode with pattern=dot → 4 GL passes fire → composite happens in existing CPU `compositeChannels`. Visually identical to before, just faster.

- [ ] **Step 2: Build, visual verify in dev**

```bash
npm run build
# run dev, colorMode=cmyk, pattern=dot, verify correct 4-channel halftone
# cycle through ellipse/diamond/hex/euclidean/line/crosshatch — all should work
# compare against force-off to confirm parity
```

- [ ] **Step 3: Check channelView tab**

Switch to individual C/M/Y/K tabs. Each should show a single-channel halftone at that channel's angle.

- [ ] **Step 4: Commit only if changes were needed**

If the above worked without code changes (the dispatcher handled everything), skip to Task 10. If you had to make adjustments, commit:

```bash
git add -A && git commit -m "Route CMYK per-channel renders through WebGL dispatcher"
```

---

## Task 10: Spot color multi-pass rendering

**Goal:** Same as CMYK — spot mode's per-color renders automatically benefit from the dispatcher.

**Files:**
- None expected — verify the existing spot path works correctly

- [ ] **Step 1: Verify spot path**

Read lines 213–223 of `src/hooks/useHalftonePreview.ts`. The spot branch also calls `renderHalftone(bwCtx, ...)` per color when `renderMode === 'halftone'`. Same automatic benefit.

- [ ] **Step 2: Build, visual verify**

```bash
npm run build
# colorMode=spot, add 2-3 spot colors, pattern=dot, verify each channel halftones
# try renderMode=halftone and renderMode=flat (flat bypasses renderHalftone entirely)
```

- [ ] **Step 3: Commit if needed**

Skip if no changes.

---

## Task 11: Export integration

**Goal:** Confirm exports (PNG, PDF, channel PNGs, color proof) use the GL dispatcher and produce full-resolution output.

**Files:**
- Modify: `src/engine/webgl/context.ts` — add non-cached context for exports
- Modify: `src/engine/webgl/render.ts` — optional `useSharedContext` flag for exports
- Modify: `src/engine/export.ts` — no logic changes expected; verify

- [ ] **Step 1: Inspect export code paths**

Read `src/engine/export.ts`. All three export functions (exportPNG, exportChannelPNGs, exportPDF) and exportColorProof ultimately call `renderHalftone` on an OffscreenCanvas or document canvas. The dispatcher routes to GL automatically.

- [ ] **Step 2: Handle large-resolution exports**

An 8.5"×11" export at 600dpi is 5100×6600 px (~33MP). The shared preview GL canvas is sized to viewport dims (typically under 2MP). For exports, we need a *separate* non-shared context sized to the export target.

Update `src/engine/webgl/context.ts` — add:

```ts
/** One-shot context for a full-resolution export. Caller must dispose the
 *  canvas/context after use; there is no cache. Returns null if WebGL2
 *  unavailable or if the requested size exceeds MAX_TEXTURE_SIZE. */
export function createExportGL(width: number, height: number): { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext } | null {
  if (!isWebGL2Available()) return null
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false })
  if (!gl) return null
  const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  if (width > maxSize || height > maxSize) {
    console.warn(`[webgl] export ${width}×${height} exceeds MAX_TEXTURE_SIZE ${maxSize}; falling back to CPU`)
    return null
  }
  return { canvas, gl }
}
```

- [ ] **Step 3: Route renderHalftoneGL to export context for large outputs**

Update `renderHalftoneGL` in `render.ts` to pick context by size — if width × height > (2048 × 2048) use a dedicated (non-cached) context; else use the shared preview context. Simplest: always try shared first, catch failure, retry with export context.

Actually simpler: pass a flag.

```ts
export interface GLRenderOptions {
  source: ImageData
  settings: HalftoneSettings
  renderDpi: number
  width: number
  height: number
  /** Set true for full-resolution exports — uses a dedicated (non-cached) GL
   *  context so the shared preview one isn't resized. */
  isExport?: boolean
}
```

Inside `renderHalftoneGL`, replace `const shared = getSharedGL(width, height)` with:

```ts
import { createExportGL } from './context'
// ...
const shared = opts.isExport
  ? createExportGL(width, height)
  : getSharedGL(width, height)
if (!shared) return false
// ... at the end, if (opts.isExport) gl.getExtension('WEBGL_lose_context')?.loseContext() to free
```

Then in `src/engine/halftone.ts`, the dispatcher needs to know it's an export. Add an optional flag to `RenderOptions`:

```ts
export interface RenderOptions {
  source: ImageData
  settings: HalftoneSettings
  renderDpi: number
  radialCenter?: { x: number; y: number }
  outputDpi?: number
  isExport?: boolean
}
```

Pass `isExport` through:

```ts
if (shouldUseGL(pattern)) {
  const ok = renderHalftoneGL(ctx, {
    source, settings, renderDpi, width, height,
    isExport: !!options.isExport,
  })
  if (ok) return
}
```

In `src/engine/export.ts`, pass `isExport: true` on every `renderHalftone` call inside export functions. (Do a grep — there may be several.)

- [ ] **Step 4: Build + test each export path**

```bash
npm run build
```

Run dev, test:
1. Pattern=dot, grayscale, click Export PNG → verify file opens, resolution matches `widthInches * dpi`, DPI metadata correct
2. Pattern=hex, CMYK mode, click Export Channels → 4 PNGs per channel, correct angles
3. Pattern=dot, CMYK, click Export PDF → 4-page PDF, one per channel
4. Any mode, click Color Proof → colored proof at output resolution

Each should produce output visually identical to CPU path (set `halftones_useGL='false'`, re-export, diff). Exports should be noticeably faster than before.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Route full-resolution exports through WebGL dispatcher

Adds a dedicated non-cached GL context for exports so the shared preview
context isn't disrupted by large render targets. Falls back to CPU if
the requested size exceeds MAX_TEXTURE_SIZE.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 12: Perf verification and cleanup

**Goal:** Confirm the speedup is real, tidy up.

- [ ] **Step 1: Measure preview frame time**

Add a temporary `console.time`/`timeEnd` around the `renderHalftone` call in `useHalftonePreview.ts`:

```ts
console.time('halftone')
renderHalftone(offCtx, { ... })
console.timeEnd('halftone')
```

Load a ~2000×3000 image, pattern=dot, LPI=55, CMYK mode. Record ms with GL on, with GL forced off. Expect at least 5× improvement (likely more — published WebGL fragment shaders of this complexity run in single-digit ms for these sizes).

- [ ] **Step 2: Remove temporary console.time**

Revert the timing change.

- [ ] **Step 3: Verify CPU fallback still works**

Set `localStorage.halftones_useGL = 'false'`, reload, confirm all patterns still render correctly via CPU. Clear the override.

- [ ] **Step 4: Verify graceful degradation if GL fails**

In the console: `const gl = document.createElement('canvas').getContext('webgl2'); gl.getExtension('WEBGL_lose_context').loseContext()` — no, that's a different context. Instead, temporarily edit `isWebGL2Available()` in `context.ts` to always return `false`, reload, confirm all preview/export works via CPU. Revert the edit.

- [ ] **Step 5: Check bundle size**

```bash
npm run build
```

Note the `dist/assets/index-*.js` size before and after all tasks. Shader source strings add maybe 10–20 KB — acceptable.

- [ ] **Step 6: Final commit and push branch**

```bash
git log --oneline main..HEAD   # review all commits on this branch
git push -u origin webgl
```

- [ ] **Step 7: Open PR (optional — user-gated)**

The user may want to review visually in a deployed preview before merging. Do not merge without their sign-off.

---

## Out of scope (deliberately deferred)

- **Stipple, stochastic, radial, radial-lines, concentric, brick** remain on CPU. Radial (variable origin) and stipple (inherently serial) don't port naturally; the other three are lower-priority patterns that can be added in a follow-up plan using the infrastructure established here.
- **WebGPU**: considered but rejected for this iteration because WKWebView (Safari/Tauri-macOS) support is still patchy. WebGL2 runs identically in every target deploy.
- **GPU-side CMYK/spot composite**: the current CPU composite works fine since it's a simple pixel-pass over already-GPU-rendered channels. Move to a composite shader only if profiling shows it matters.
- **Zero-copy export**: we currently readback via `drawImage(canvas, 0, 0)` onto a 2D context, then PNG-encode via the existing pipeline. This is fine; only revisit if export latency becomes a bottleneck.
