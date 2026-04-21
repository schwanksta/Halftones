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

/** One-shot context for a full-resolution export. Caller must dispose the
 *  canvas/context after use; there is no cache. Returns null if WebGL2
 *  unavailable or if the requested size exceeds MAX_TEXTURE_SIZE. */
export function createExportGL(width: number, height: number): { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext } | null {
  if (!isWebGL2Available()) return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false })
  if (!gl) return null
  const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  if (width > maxSize || height > maxSize) {
    console.warn(`[webgl] export ${width}×${height} exceeds MAX_TEXTURE_SIZE ${maxSize}; falling back to CPU`)
    // Free the GPU context immediately. Mobile browsers enforce a hard limit
    // (~8–16) on live WebGL contexts; a stream of oversized export attempts
    // would otherwise starve subsequent GL work until GC reclaims them.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return null
  }
  return { canvas, gl }
}
