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
