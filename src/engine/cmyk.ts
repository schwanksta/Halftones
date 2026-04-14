import { CMYKSettings } from '../types'

/**
 * Convert RGB to CMYK.
 * Returns values in 0-255 range where 255 = full ink.
 */
export function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const r1 = r / 255
  const g1 = g / 255
  const b1 = b / 255

  const k = 1 - Math.max(r1, g1, b1)
  if (k >= 1) return [0, 0, 0, 255]

  const invK = 1 / (1 - k)
  const c = (1 - r1 - k) * invK
  const m = (1 - g1 - k) * invK
  const y = (1 - b1 - k) * invK

  return [
    Math.round(c * 255),
    Math.round(m * 255),
    Math.round(y * 255),
    Math.round(k * 255),
  ]
}

/**
 * Separate an RGB ImageData into 4 grayscale ImageData arrays (C, M, Y, K).
 * In each output, white (255) = no ink, black (0) = full ink.
 */
export function separateChannels(source: ImageData): {
  c: ImageData
  m: ImageData
  y: ImageData
  k: ImageData
} {
  const { width, height, data } = source
  const len = width * height

  const cData = new Uint8ClampedArray(len * 4)
  const mData = new Uint8ClampedArray(len * 4)
  const yData = new Uint8ClampedArray(len * 4)
  const kData = new Uint8ClampedArray(len * 4)

  for (let i = 0; i < len; i++) {
    const idx = i * 4
    const [c, m, y, k] = rgbToCmyk(data[idx], data[idx + 1], data[idx + 2])

    // Store as grayscale: 255 - ink = brightness (so halftone engine sees dark where there's ink)
    const cBright = 255 - c
    const mBright = 255 - m
    const yBright = 255 - y
    const kBright = 255 - k

    cData[idx] = cBright; cData[idx + 1] = cBright; cData[idx + 2] = cBright; cData[idx + 3] = 255
    mData[idx] = mBright; mData[idx + 1] = mBright; mData[idx + 2] = mBright; mData[idx + 3] = 255
    yData[idx] = yBright; yData[idx + 1] = yBright; yData[idx + 2] = yBright; yData[idx + 3] = 255
    kData[idx] = kBright; kData[idx + 1] = kBright; kData[idx + 2] = kBright; kData[idx + 3] = 255
  }

  return {
    c: new ImageData(cData, width, height),
    m: new ImageData(mData, width, height),
    y: new ImageData(yData, width, height),
    k: new ImageData(kData, width, height),
  }
}

/**
 * Composite halftoned channel ImageDatas back into a color image.
 * Each channel ImageData has black dots on white background.
 * We interpret black pixels as that channel's ink color.
 */
export function compositeChannels(
  rendered: Record<string, ImageData>,
  width: number,
  height: number,
  cmykSettings: CMYKSettings
): ImageData {
  const result = new ImageData(width, height)
  const out = result.data
  const len = width * height

  // Start with white
  for (let i = 0; i < len; i++) {
    const idx = i * 4
    // Accumulate ink amounts from each channel
    let c = 0, m = 0, y = 0, k = 0

    if (rendered.c && cmykSettings.c.enabled) {
      // Black pixel (0) in rendered = full ink
      c = (255 - rendered.c.data[idx]) / 255
    }
    if (rendered.m && cmykSettings.m.enabled) {
      m = (255 - rendered.m.data[idx]) / 255
    }
    if (rendered.y && cmykSettings.y.enabled) {
      y = (255 - rendered.y.data[idx]) / 255
    }
    if (rendered.k && cmykSettings.k.enabled) {
      k = (255 - rendered.k.data[idx]) / 255
    }

    // CMYK to RGB
    const r = 255 * (1 - c) * (1 - k)
    const g = 255 * (1 - m) * (1 - k)
    const b = 255 * (1 - y) * (1 - k)

    out[idx] = Math.round(r)
    out[idx + 1] = Math.round(g)
    out[idx + 2] = Math.round(b)
    out[idx + 3] = 255
  }

  return result
}
