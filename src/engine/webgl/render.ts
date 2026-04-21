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
