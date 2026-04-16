import { HalftoneSettings } from '../types'
import { sampleCellBrightness } from './sampling'
import { applyDotSettings } from './dot-settings'

export function drawDot(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number
) {
  if (radius < 0.3) return
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fill()
}

export function drawLine(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cellSize: number,
  thickness: number,
  angle: number
) {
  if (thickness < 0.2) return
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const halfLen = cellSize * 0.75

  ctx.beginPath()
  ctx.lineWidth = thickness
  ctx.lineCap = 'round'
  ctx.moveTo(cx - cos * halfLen, cy - sin * halfLen)
  ctx.lineTo(cx + cos * halfLen, cy + sin * halfLen)
  ctx.stroke()
}

export function drawEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radiusX: number,
  radiusY: number,
  angle: number
) {
  if (radiusX < 0.3 && radiusY < 0.3) return
  ctx.beginPath()
  ctx.ellipse(cx, cy, radiusX, radiusY, angle, 0, Math.PI * 2)
  ctx.fill()
}

export function drawDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  halfSize: number
) {
  if (halfSize < 0.3) return
  ctx.beginPath()
  ctx.moveTo(cx, cy - halfSize)
  ctx.lineTo(cx + halfSize, cy)
  ctx.lineTo(cx, cy + halfSize)
  ctx.lineTo(cx - halfSize, cy)
  ctx.closePath()
  ctx.fill()
}

/**
 * Euclidean dot: transitions circle → square → circle (inverted) as darkness increases.
 * At 50% the dot just touches its neighbors; above 50% it inverts to a white dot on black square.
 * bgColor is used to punch out the inner highlight above 50%.
 */
export function drawEuclidean(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cellSize: number,
  darkness: number,
  bgColor: string
) {
  const half = cellSize * 0.5
  if (darkness <= 0.5) {
    // Growing circle: at darkness=0.5, radius reaches half cellSize (touching neighbors)
    const radius = half * Math.sqrt(darkness * 2)
    if (radius < 0.3) return
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fill()
  } else {
    // Filled square with shrinking white circle punched out
    ctx.fillRect(cx - half, cy - half, cellSize, cellSize)
    const innerRadius = half * Math.sqrt((1 - darkness) * 2)
    if (innerRadius >= 0.3) {
      const prevFill = ctx.fillStyle
      ctx.fillStyle = bgColor
      ctx.beginPath()
      ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = prevFill
    }
  }
}

/**
 * Crosshatch: two overlapping line screens at perpendicular angles.
 * First screen at `angle`, second at `angle + 90°`.
 */
export function drawCrosshatch(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cellSize: number,
  darkness: number,
  angle: number
) {
  if (darkness < 0.01) return
  // First line
  const thickness1 = cellSize * Math.min(1, darkness * 2)
  drawLine(ctx, cx, cy, cellSize, thickness1, angle)
  // Second line perpendicular — only appears when dark enough
  if (darkness > 0.5) {
    const thickness2 = cellSize * (darkness - 0.5) * 2
    drawLine(ctx, cx, cy, cellSize, thickness2, angle + Math.PI / 2)
  }
}

/**
 * Concentric rings: ring radius and count grow with darkness.
 */
export function drawConcentric(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cellSize: number,
  darkness: number
) {
  if (darkness < 0.02) return
  const maxRadius = cellSize * 0.48
  const numRings = Math.max(1, Math.round(darkness * 3))
  const lineW = Math.max(0.3, maxRadius * darkness / numRings)

  ctx.lineWidth = lineW
  for (let r = 0; r < numRings; r++) {
    const radius = (maxRadius * (r + 1)) / numRings
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.stroke()
  }
}

/**
 * Brick: filled rectangle, offset every other row like a brick pattern.
 */
export function drawBrick(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cellSize: number,
  darkness: number,
  row: number
) {
  if (darkness < 0.02) return
  const w = cellSize * Math.sqrt(darkness)
  const h = w * 0.5
  const offsetX = row % 2 === 0 ? 0 : cellSize * 0.5
  ctx.fillRect(cx - w / 2 + offsetX, cy - h / 2, w, h)
}

/**
 * Radial halftone: polar grid of dots emanating from the image center.
 * Ring spacing = cellSize. Each ring is divided into segments sized to keep
 * cells roughly square (circumference / cellSize segments per ring).
 */
export function renderRadial(
  source: ImageData,
  targetCtx: CanvasRenderingContext2D,
  cellSize: number,
  cx: number = source.width / 2,
  cy: number = source.height / 2,
  settings?: HalftoneSettings,
  fgColor: string = '#000000',
  bgColor: string = '#ffffff',
) {
  const { width, height } = source
  const maxRadius = Math.max(
    Math.sqrt(cx * cx + cy * cy),
    Math.sqrt((width - cx) ** 2 + cy * cy),
    Math.sqrt(cx * cx + (height - cy) ** 2),
    Math.sqrt((width - cx) ** 2 + (height - cy) ** 2),
  ) + cellSize

  targetCtx.fillStyle = bgColor
  targetCtx.fillRect(0, 0, width, height)

  const TWO_PI = Math.PI * 2
  const path = new Path2D()

  // Ring r = 0: single center dot
  const centerBrightness = sampleCellBrightness(source, cx, cy, cellSize)
  const rawCenterDarkness = 1 - centerBrightness
  const centerDarkness = settings ? applyDotSettings(rawCenterDarkness, settings) : rawCenterDarkness
  if (centerDarkness !== null && centerDarkness >= 0.01) {
    const r0 = (cellSize * 0.5) * Math.sqrt(centerDarkness)
    if (r0 >= 0.3) {
      path.moveTo(cx + r0, cy)
      path.arc(cx, cy, r0, 0, TWO_PI)
    }
  }

  // Remaining rings
  for (let ring = 1; ring * cellSize <= maxRadius; ring++) {
    const radius = ring * cellSize
    const circumference = TWO_PI * radius
    const numSegments = Math.max(6, Math.round(circumference / cellSize))
    const angleStep = TWO_PI / numSegments

    for (let seg = 0; seg < numSegments; seg++) {
      const angle = seg * angleStep
      const px = cx + radius * Math.cos(angle)
      const py = cy + radius * Math.sin(angle)

      const brightness = sampleCellBrightness(source, px, py, cellSize)
      const rawDarkness = 1 - brightness
      const darkness = settings ? applyDotSettings(rawDarkness, settings) : rawDarkness
      if (darkness === null || darkness < 0.01) continue

      const dotRadius = (cellSize * 0.5) * Math.sqrt(darkness)
      if (dotRadius < 0.3) continue

      path.moveTo(px + dotRadius, py)
      path.arc(px, py, dotRadius, 0, TWO_PI)
    }
  }

  targetCtx.fillStyle = fgColor
  targetCtx.fill(path)
}

/**
 * Radial line halftone: concentric rings with variable stroke width per segment.
 * Round line caps let adjacent segments blend smoothly into continuous arcs.
 */
export function renderRadialLines(
  source: ImageData,
  targetCtx: CanvasRenderingContext2D,
  cellSize: number,
  cx: number = source.width / 2,
  cy: number = source.height / 2,
  settings?: HalftoneSettings,
  fgColor: string = '#000000',
  bgColor: string = '#ffffff',
) {
  const { width, height } = source
  const maxRadius = Math.max(
    Math.sqrt(cx * cx + cy * cy),
    Math.sqrt((width - cx) ** 2 + cy * cy),
    Math.sqrt(cx * cx + (height - cy) ** 2),
    Math.sqrt((width - cx) ** 2 + (height - cy) ** 2),
  ) + cellSize

  targetCtx.fillStyle = bgColor
  targetCtx.fillRect(0, 0, width, height)
  targetCtx.strokeStyle = fgColor
  targetCtx.lineCap = 'round'

  for (let ring = 1; ring * cellSize <= maxRadius; ring++) {
    const radius = ring * cellSize
    const circumference = 2 * Math.PI * radius
    const numSegments = Math.max(6, Math.round(circumference / cellSize))
    const angleStep = (2 * Math.PI) / numSegments

    for (let seg = 0; seg < numSegments; seg++) {
      const angleStart = seg * angleStep
      const angleEnd = angleStart + angleStep

      const midAngle = angleStart + angleStep / 2
      const px = cx + radius * Math.cos(midAngle)
      const py = cy + radius * Math.sin(midAngle)

      const brightness = sampleCellBrightness(source, px, py, cellSize)
      const rawDarkness = 1 - brightness
      const darkness = settings ? applyDotSettings(rawDarkness, settings) : rawDarkness
      if (darkness === null || darkness < 0.01) continue

      const strokeWidth = cellSize * darkness
      if (strokeWidth < 0.2) continue

      targetCtx.lineWidth = strokeWidth
      targetCtx.beginPath()
      targetCtx.arc(cx, cy, radius, angleStart, angleEnd)
      targetCtx.stroke()
    }
  }
}

/**
 * Stochastic (FM) halftone via Floyd-Steinberg error diffusion.
 * Operates on the entire image, not per-cell.
 */
export function renderStochastic(
  source: ImageData,
  targetCtx: CanvasRenderingContext2D,
  _dotSize: number,
  invert = false
) {
  const { width, height, data } = source

  // Build grayscale buffer
  const gray = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4
    gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
  }

  // Floyd-Steinberg error diffusion
  const output = targetCtx.createImageData(width, height)
  const out = output.data

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const oldVal = gray[idx]
      const newVal = oldVal < 128 ? 0 : 255
      const error = oldVal - newVal

      // In invert mode, dark source pixels become white dots on black
      const outVal = invert ? 255 - newVal : newVal
      out[idx * 4] = outVal
      out[idx * 4 + 1] = outVal
      out[idx * 4 + 2] = outVal
      out[idx * 4 + 3] = 255

      // Distribute error
      if (x + 1 < width) gray[idx + 1] += error * 7 / 16
      if (y + 1 < height) {
        if (x > 0) gray[idx + width - 1] += error * 3 / 16
        gray[idx + width] += error * 5 / 16
        if (x + 1 < width) gray[idx + width + 1] += error * 1 / 16
      }
    }
  }

  targetCtx.putImageData(output, 0, 0)
}
