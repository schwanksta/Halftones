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
