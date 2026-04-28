import { HalftoneSettings, PatternType } from '../types'
import { precomputeGrayscale, sampleGray } from './sampling'
import { applyDotSettings } from './dot-settings'
import { drawLine, drawEuclidean, renderStochastic, drawCrosshatch, drawConcentric, drawBrick, renderRadial, renderRadialLines } from './patterns'
import { renderStipple } from './stipple'
import { shouldUseGL, renderHalftoneGL } from './webgl/render'

export interface RenderOptions {
  source: ImageData
  settings: HalftoneSettings
  renderDpi: number
  radialCenter?: { x: number; y: number }
  /** Output DPI — when provided, stochastic dithers at this density and scales up for display. */
  outputDpi?: number
  /** Set true for full-resolution exports — routes GL to a dedicated one-shot
   *  context so preview state isn't disrupted. */
  isExport?: boolean
}

export function renderHalftone(
  ctx: CanvasRenderingContext2D,
  options: RenderOptions
) {
  const { source, settings, renderDpi, radialCenter } = options
  const { width, height } = source
  const { lpi, angle, pattern, invert } = settings

  // Resolve ink/paper colors from settings, then swap if invert is on
  const rawFg = settings.fgColor || '#000000'
  const rawBg = settings.bgColor || '#ffffff'
  const fgColor = invert ? rawBg : rawFg
  const bgColor = invert ? rawFg : rawBg

  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, width, height)

  if (pattern === 'stochastic') {
    const { outputDpi } = options
    if (outputDpi && Math.abs(outputDpi - renderDpi) > 1) {
      // Scale source to output pixel density, dither there, scale back up.
      // This makes the grain size reflect the actual DPI setting.
      const scale = outputDpi / renderDpi
      const scaledW = Math.max(1, Math.round(width * scale))
      const scaledH = Math.max(1, Math.round(height * scale))

      const srcCanvas = document.createElement('canvas')
      srcCanvas.width = width
      srcCanvas.height = height
      srcCanvas.getContext('2d')!.putImageData(source, 0, 0)

      const downCanvas = document.createElement('canvas')
      downCanvas.width = scaledW
      downCanvas.height = scaledH
      const downCtx = downCanvas.getContext('2d')!
      downCtx.drawImage(srcCanvas, 0, 0, scaledW, scaledH)

      const ditherCanvas = document.createElement('canvas')
      ditherCanvas.width = scaledW
      ditherCanvas.height = scaledH
      const ditherCtx = ditherCanvas.getContext('2d')!
      renderStochastic(downCtx.getImageData(0, 0, scaledW, scaledH), ditherCtx, 1, invert)

      // Scale back up with nearest-neighbor so dither pixels appear as crisp blocks
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, width, height)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(ditherCanvas, 0, 0, width, height)
      ctx.imageSmoothingEnabled = true
    } else {
      renderStochastic(source, ctx, 1, invert)
    }
    return
  }

  const cellSize = renderDpi / lpi

  if (pattern === 'radial' || pattern === 'radial-lines') {
    if (cellSize < 1) return   // sub-pixel cell → millions of arcs → hang
    const cx = radialCenter?.x ?? width / 2
    const cy = radialCenter?.y ?? height / 2
    if (pattern === 'radial') renderRadial(source, ctx, cellSize, cx, cy, settings, fgColor, bgColor)
    else renderRadialLines(source, ctx, cellSize, cx, cy, settings, fgColor, bgColor)
    return
  }

  if (pattern === 'stipple') {
    renderStipple(ctx, source, cellSize, settings, fgColor, bgColor)
    return
  }

  if (cellSize < 1) return

  // Try GL fast path first for supported patterns. Falls through to CPU on failure.
  if (shouldUseGL(pattern)) {
    const ok = renderHalftoneGL(ctx, {
      source, settings, renderDpi,
      width, height,
      pattern,
      isExport: !!options.isExport,
    })
    if (ok) return
  }

  // Pre-compute grayscale buffer once — avoids per-pixel luminance math in the hot loop
  const gray = precomputeGrayscale(source)

  const angleRad = (angle * Math.PI) / 180
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)

  const isHex = pattern === 'hex'
  const rowSpacing = isHex ? cellSize * Math.sqrt(3) / 2 : cellSize

  const diagonal = Math.sqrt(width * width + height * height)
  const gridCols = Math.ceil(diagonal / cellSize) + 2
  const gridRows = Math.ceil(diagonal / rowSpacing) + 2

  const offsetX = width / 2
  const offsetY = height / 2

  // Check if this pattern can be batched into a single Path2D
  const batchable = pattern === 'dot' || pattern === 'hex' || pattern === 'diamond' || pattern === 'ellipse'

  if (batchable) {
    renderBatched(ctx, gray, width, height, pattern, settings, cellSize, angleRad, cos, sin, rowSpacing, isHex, gridRows, gridCols, offsetX, offsetY, fgColor, bgColor)
  } else {
    renderUnbatched(ctx, gray, width, height, pattern, settings, cellSize, angleRad, cos, sin, rowSpacing, isHex, gridRows, gridCols, offsetX, offsetY, fgColor, bgColor)
  }
}

/**
 * Batch all shapes into a single Path2D → one fill() call.
 * Massive speedup for dot/hex/diamond/ellipse patterns.
 */
function renderBatched(
  ctx: CanvasRenderingContext2D,
  gray: Uint8Array,
  width: number,
  height: number,
  pattern: PatternType,
  settings: HalftoneSettings,
  cellSize: number,
  angleRad: number,
  cos: number,
  sin: number,
  rowSpacing: number,
  isHex: boolean,
  gridRows: number,
  gridCols: number,
  offsetX: number,
  offsetY: number,
  fgColor: string,
  _bgColor: string,
) {
  const path = new Path2D()
  const maxRadius = cellSize * 0.5
  const TWO_PI = Math.PI * 2

  for (let row = -Math.floor(gridRows / 2); row < Math.ceil(gridRows / 2); row++) {
    const hexOffset = isHex && row % 2 !== 0 ? cellSize / 2 : 0
    const gy = row * rowSpacing

    for (let col = -Math.floor(gridCols / 2); col < Math.ceil(gridCols / 2); col++) {
      const gx = col * cellSize + hexOffset
      const ix = gx * cos - gy * sin + offsetX
      const iy = gx * sin + gy * cos + offsetY

      if (ix < -cellSize || ix > width + cellSize || iy < -cellSize || iy > height + cellSize) continue

      const brightness = sampleGray(gray, width, height, ix, iy, cellSize)
      const rawDarkness = 1 - brightness
      const darkness = applyDotSettings(rawDarkness, settings)
      if (darkness === null || darkness < 0.01) continue

      switch (pattern) {
        case 'dot':
        case 'hex': {
          const radius = maxRadius * Math.sqrt(darkness)
          if (radius < 0.3) continue
          path.moveTo(ix + radius, iy)
          path.arc(ix, iy, radius, 0, TWO_PI)
          break
        }
        case 'ellipse': {
          const rx = maxRadius * Math.sqrt(darkness)
          const ry = rx * 0.6
          if (rx < 0.3 && ry < 0.3) continue
          path.ellipse(ix, iy, rx, ry, angleRad, 0, TWO_PI)
          break
        }
        case 'diamond': {
          const halfSize = maxRadius * Math.sqrt(darkness)
          if (halfSize < 0.3) continue
          path.moveTo(ix, iy - halfSize)
          path.lineTo(ix + halfSize, iy)
          path.lineTo(ix, iy + halfSize)
          path.lineTo(ix - halfSize, iy)
          path.closePath()
          break
        }
      }
    }
  }

  ctx.fillStyle = fgColor
  ctx.fill(path)
}

/**
 * Per-cell rendering for patterns that need individual draw calls
 * (line, crosshatch, concentric, brick, euclidean).
 */
function renderUnbatched(
  ctx: CanvasRenderingContext2D,
  gray: Uint8Array,
  width: number,
  height: number,
  pattern: PatternType,
  settings: HalftoneSettings,
  cellSize: number,
  angleRad: number,
  cos: number,
  sin: number,
  rowSpacing: number,
  isHex: boolean,
  gridRows: number,
  gridCols: number,
  offsetX: number,
  offsetY: number,
  fgColor: string,
  bgColor: string,
) {
  ctx.fillStyle = fgColor
  ctx.strokeStyle = fgColor

  for (let row = -Math.floor(gridRows / 2); row < Math.ceil(gridRows / 2); row++) {
    const hexOffset = isHex && row % 2 !== 0 ? cellSize / 2 : 0
    const gy = row * rowSpacing

    for (let col = -Math.floor(gridCols / 2); col < Math.ceil(gridCols / 2); col++) {
      const gx = col * cellSize + hexOffset
      const ix = gx * cos - gy * sin + offsetX
      const iy = gx * sin + gy * cos + offsetY

      if (ix < -cellSize || ix > width + cellSize || iy < -cellSize || iy > height + cellSize) continue

      const brightness = sampleGray(gray, width, height, ix, iy, cellSize)
      const rawDarkness = 1 - brightness
      const darkness = applyDotSettings(rawDarkness, settings)
      if (darkness === null || darkness < 0.01) continue

      switch (pattern) {
        case 'line': {
          const thickness = cellSize * darkness
          drawLine(ctx, ix, iy, cellSize, thickness, angleRad)
          break
        }
        case 'euclidean': {
          drawEuclidean(ctx, ix, iy, cellSize, darkness, bgColor)
          // Restore fill to fgColor after euclidean may have used bgColor
          ctx.fillStyle = fgColor
          break
        }
        case 'crosshatch': {
          drawCrosshatch(ctx, ix, iy, cellSize, darkness, angleRad)
          break
        }
        case 'concentric': {
          drawConcentric(ctx, ix, iy, cellSize, darkness)
          break
        }
        case 'brick': {
          drawBrick(ctx, ix, iy, cellSize, darkness, row)
          break
        }
      }
    }
  }
}
