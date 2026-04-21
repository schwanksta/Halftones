import { HalftoneSettings, PatternType } from '../../types'
import { getSharedGL, isWebGL2Available, useGLOverride } from './context'
import { getOrCompileProgram, getUniform } from './program'
import { getFullscreenQuadVAO } from './quad'
import { uploadRGBATexture } from './texture'
import { VERT_SRC } from './shared.glsl'
import { DOT_FRAG } from './patterns/dot'
import { ELLIPSE_FRAG } from './patterns/ellipse'
import { DIAMOND_FRAG } from './patterns/diamond'

export const GL_SUPPORTED_PATTERNS: ReadonlySet<PatternType> = new Set<PatternType>([
  'dot', 'ellipse', 'diamond',
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
  pattern: PatternType
}

function fragSrcFor(pattern: PatternType): string | null {
  switch (pattern) {
    case 'dot': return DOT_FRAG
    case 'ellipse': return ELLIPSE_FRAG
    case 'diamond': return DIAMOND_FRAG
    default: return null
  }
}

export function renderHalftoneGL(
  targetCtx: CanvasRenderingContext2D,
  opts: GLRenderOptions,
): boolean {
  const { width, height, settings, source, renderDpi, pattern } = opts
  const shared = getSharedGL(width, height)
  if (!shared) return false
  const { gl, canvas } = shared

  const frag = fragSrcFor(pattern)
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
    gl.uniform1i(getUniform(gl, prog, 'uSrc'), 0)

    const cellSize = renderDpi / settings.lpi
    const invert = !!settings.invert
    const rawFg = settings.fgColor || '#000000'
    const rawBg = settings.bgColor || '#ffffff'
    const fg = invert ? rawBg : rawFg
    const bg = invert ? rawFg : rawBg

    gl.uniform2f(getUniform(gl, prog, 'uSize'), width, height)
    gl.uniform1f(getUniform(gl, prog, 'uCellSize'), cellSize)
    gl.uniform1f(getUniform(gl, prog, 'uAngle'), (settings.angle * Math.PI) / 180)
    gl.uniform1f(getUniform(gl, prog, 'uMinDot'), settings.minDot ?? 0)
    gl.uniform1f(getUniform(gl, prog, 'uMaxDot'), settings.maxDot ?? 1)
    gl.uniform1f(getUniform(gl, prog, 'uDotGain'), settings.dotGain ?? 0)
    gl.uniform1f(getUniform(gl, prog, 'uDotSize'), settings.dotSize ?? 1)
    gl.uniform3fv(getUniform(gl, prog, 'uFgColor'), hexToRgb01(fg))
    gl.uniform3fv(getUniform(gl, prog, 'uBgColor'), hexToRgb01(bg))

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
