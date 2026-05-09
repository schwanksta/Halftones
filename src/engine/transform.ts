import { ImageTransformSettings } from '../types'

/**
 * Apply rotation, crop, and levels adjustments to source ImageData.
 * Returns a new ImageData with all transforms applied.
 * This runs before the halftone engine.
 */
export function applyTransforms(source: ImageData, settings: ImageTransformSettings): ImageData {
  let result = source

  // 1. Rotation (fills rotated areas with white)
  if (settings.rotation !== 0) {
    result = rotateImageData(result, settings.rotation)
  }

  // 2. Crop (after rotation so crop is on the rotated image)
  const { cropLeft, cropRight, cropTop, cropBottom } = settings
  if (cropLeft > 0 || cropRight > 0 || cropTop > 0 || cropBottom > 0) {
    result = cropImageData(result, cropLeft, cropRight, cropTop, cropBottom)
  }

  // 3. Levels
  if (settings.blackPoint !== 0 || settings.whitePoint !== 255 || settings.gamma !== 1.0) {
    result = applyLevels(result, settings.blackPoint, settings.whitePoint, settings.gamma)
  }

  return result
}

function rotateImageData(source: ImageData, degrees: number): ImageData {
  const rad = (degrees * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))

  // New canvas is large enough to contain the rotated image
  const newWidth = Math.round(source.width * cos + source.height * sin)
  const newHeight = Math.round(source.width * sin + source.height * cos)

  const canvas = document.createElement('canvas')
  canvas.width = newWidth
  canvas.height = newHeight
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, newWidth, newHeight)

  // Draw source centered, rotated
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = source.width
  srcCanvas.height = source.height
  const srcCtx = srcCanvas.getContext('2d')!
  srcCtx.putImageData(source, 0, 0)

  ctx.save()
  ctx.translate(newWidth / 2, newHeight / 2)
  ctx.rotate(rad)
  ctx.drawImage(srcCanvas, -source.width / 2, -source.height / 2)
  ctx.restore()

  return ctx.getImageData(0, 0, newWidth, newHeight)
}

function cropImageData(
  source: ImageData,
  left: number, right: number,
  top: number, bottom: number
): ImageData {
  const { width, height } = source
  const x0 = Math.round(left * width)
  const y0 = Math.round(top * height)
  const x1 = width - Math.round(right * width)
  const y1 = height - Math.round(bottom * height)

  const newWidth = Math.max(1, x1 - x0)
  const newHeight = Math.max(1, y1 - y0)

  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d')!
  ctx.putImageData(source, 0, 0)

  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = newWidth
  cropCanvas.height = newHeight
  const cropCtx = cropCanvas.getContext('2d')!
  // Fill white so transparent pixels in the source (PNG cut-outs) composite
  // onto white rather than remaining transparent (which halftone reads as black).
  cropCtx.fillStyle = '#ffffff'
  cropCtx.fillRect(0, 0, newWidth, newHeight)
  cropCtx.drawImage(canvas, x0, y0, newWidth, newHeight, 0, 0, newWidth, newHeight)

  return cropCtx.getImageData(0, 0, newWidth, newHeight)
}

/**
 * Apply levels adjustment to an ImageData.
 * Maps the [blackPoint, whitePoint] input range to [0, 255] output,
 * then applies gamma correction.
 * Operates on each channel independently (preserves color).
 */
export function applyLevels(
  source: ImageData,
  blackPoint: number,
  whitePoint: number,
  gamma: number
): ImageData {
  const { width, height, data } = source
  const out = new Uint8ClampedArray(data.length)

  const range = Math.max(1, whitePoint - blackPoint)
  const invGamma = gamma === 1.0 ? 1.0 : 1.0 / gamma

  // Precompute lookup table for speed
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    // Clamp to [blackPoint, whitePoint], remap to [0, 1]
    let v = Math.max(0, Math.min(255, i - blackPoint)) / range
    // Clamp to [0, 1]
    v = Math.max(0, Math.min(1, v))
    // Apply gamma
    if (invGamma !== 1.0) v = Math.pow(v, invGamma)
    lut[i] = Math.round(v * 255)
  }

  for (let i = 0; i < data.length; i += 4) {
    out[i] = lut[data[i]]
    out[i + 1] = lut[data[i + 1]]
    out[i + 2] = lut[data[i + 2]]
    out[i + 3] = data[i + 3]
  }

  return new ImageData(out, width, height)
}

/**
 * Compute a luminance histogram for an ImageData (256 bins).
 */
export function computeHistogram(source: ImageData): Uint32Array {
  const hist = new Uint32Array(256)
  const { data } = source
  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    hist[lum]++
  }
  return hist
}
