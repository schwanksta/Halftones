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

/** Cache uniform locations per (program, name) — avoids repeated string lookups every frame. */
const uniformCache = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation | null>>()

export function getUniform(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation | null {
  let cache = uniformCache.get(program)
  if (!cache) {
    cache = new Map()
    uniformCache.set(program, cache)
  }
  if (!cache.has(name)) {
    cache.set(name, gl.getUniformLocation(program, name))
  }
  return cache.get(name)!
}

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
