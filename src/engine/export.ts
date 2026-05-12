import { HalftoneSettings, CMYKSettings, OutputSettings, ImageTransformSettings, SpotSettings, SpotColor } from '../types'
import { renderHalftone } from './halftone'
import { separateChannels } from './cmyk'
import { separateSpotChannels, renderFlat, boostSaturation } from './spot-separation'
import { setPngDpi } from './png-metadata'
import { applyTransforms } from './transform'
import { dilateMask } from './dilate'
import { platform } from '../platform'
import { precomputeGrayscale, sampleGray } from './sampling'
import { applyDotSettings } from './dot-settings'

/** Effective trap (px at export DPI) for a color — per-color override wins. */
function trapFor(color: SpotColor, spotSettings: SpotSettings): number {
  return color.trap ?? spotSettings.trap ?? 0
}

interface ExportOptions {
  source: ImageData
  transformSettings: ImageTransformSettings
  halftoneSettings: HalftoneSettings
  cmykSettings: CMYKSettings
  spotSettings: SpotSettings
  outputSettings: OutputSettings
  projectName: string
}

/** Convert a project name to a safe filename stem. */
function toStem(projectName: string, suffix: string): string {
  const slug = (projectName || 'untitled')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'untitled'
  return `${slug}-${suffix}`
}

function scaleImageData(source: ImageData, targetWidth: number, targetHeight: number): ImageData {
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = source.width
  srcCanvas.height = source.height
  const srcCtx = srcCanvas.getContext('2d')!
  srcCtx.putImageData(source, 0, 0)

  const dstCanvas = document.createElement('canvas')
  dstCanvas.width = targetWidth
  dstCanvas.height = targetHeight
  const dstCtx = dstCanvas.getContext('2d')!
  // Fill white before compositing so transparent source pixels (PNG cut-outs)
  // become opaque white instead of being read as black by precomputeGrayscale.
  dstCtx.fillStyle = '#ffffff'
  dstCtx.fillRect(0, 0, targetWidth, targetHeight)
  dstCtx.drawImage(srcCanvas, 0, 0, targetWidth, targetHeight)

  return dstCtx.getImageData(0, 0, targetWidth, targetHeight)
}

/** Strip preview-only color overrides so exports are always black-on-white. */
function bwSettings(s: HalftoneSettings): HalftoneSettings {
  return { ...s, fgColor: '#000000', bgColor: '#ffffff' }
}

/**
 * Colorize a black-on-white halftone channel for multiply-blend compositing.
 * 0 (full ink) → process ink color   255 (no ink) → white
 */
function colorizeForMultiply(imgData: ImageData, hex: string): ImageData {
  const inkR = parseInt(hex.slice(1, 3), 16)
  const inkG = parseInt(hex.slice(3, 5), 16)
  const inkB = parseInt(hex.slice(5, 7), 16)
  const { data, width, height } = imgData
  const out = new Uint8ClampedArray(data.length)
  for (let i = 0; i < width * height; i++) {
    const coverage = (255 - data[i * 4]) / 255   // 0=no ink, 1=full ink
    out[i * 4]     = Math.round(255 + (inkR - 255) * coverage)
    out[i * 4 + 1] = Math.round(255 + (inkG - 255) * coverage)
    out[i * 4 + 2] = Math.round(255 + (inkB - 255) * coverage)
    out[i * 4 + 3] = 255
  }
  return new ImageData(out, width, height)
}

/**
 * Colorize a black-on-white channel for source-over compositing (spot colors).
 * 0 (full ink) → spot color at full opacity   255 (no ink) → transparent
 */
function colorizeForOverlay(imgData: ImageData, hex: string): ImageData {
  const inkR = parseInt(hex.slice(1, 3), 16)
  const inkG = parseInt(hex.slice(3, 5), 16)
  const inkB = parseInt(hex.slice(5, 7), 16)
  const { data, width, height } = imgData
  const out = new Uint8ClampedArray(data.length)
  for (let i = 0; i < width * height; i++) {
    out[i * 4]     = inkR
    out[i * 4 + 1] = inkG
    out[i * 4 + 2] = inkB
    out[i * 4 + 3] = 255 - data[i * 4]   // 0=ink→opaque, 255=paper→transparent
  }
  return new ImageData(out, width, height)
}

// ─── Spot channel rendering ───────────────────────────────────────────────────

/**
 * Render each enabled spot color to a black-on-white canvas at full export resolution.
 * Flat channels use renderFlat (no halftoning); halftone channels use renderHalftone.
 * Returns a map of color id → { canvas, label }.
 */
function renderSpotChannelCanvases(
  options: ExportOptions
): Map<string, { canvas: HTMLCanvasElement; label: string }> {
  const { source, transformSettings, halftoneSettings: rawSettings, spotSettings, outputSettings } = options
  const halftoneSettings = bwSettings(rawSettings)
  const targetWidth  = Math.round(outputSettings.widthInches  * outputSettings.dpi)
  const targetHeight = Math.round(outputSettings.heightInches * outputSettings.dpi)

  const transformed = applyTransforms(source, transformSettings)
  const scaled      = scaleImageData(transformed, targetWidth, targetHeight)

  // Separate ALL colors so disabled ones claim their own pixels — preventing
  // redistribution to enabled neighbors.  Only enabled colors get rendered/exported.
  const channels = separateSpotChannels(scaled, spotSettings.colors)
  const enabledColors = spotSettings.colors.filter((c) => c.enabled)

  const radialCenter = {
    x: scaled.width  * (halftoneSettings.radialOriginX ?? 0.5),
    y: scaled.height * (halftoneSettings.radialOriginY ?? 0.5),
  }

  const result = new Map<string, { canvas: HTMLCanvasElement; label: string }>()

  for (const color of enabledColors) {
    const channelData = channels.get(color.id)
    if (!channelData) continue

    const canvas = document.createElement('canvas')
    canvas.width  = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')!

    if (color.renderMode === 'flat') {
      renderFlat(ctx, channelData, color.threshold)
    } else {
      renderHalftone(ctx, {
        source: channelData,
        settings: { ...halftoneSettings, angle: color.angle, lpi: color.lpi },
        renderDpi: outputSettings.dpi,
        radialCenter,
        isExport: true,
      })
    }

    // Trap: dilate the plate so this layer's ink spreads outward, overlapping
    // neighbouring colors on press and hiding visible paper seams.
    const trap = trapFor(color, spotSettings)
    const finalCanvas = trap > 0 ? dilateMask(canvas, trap) : canvas

    result.set(color.id, { canvas: finalCanvas, label: color.name })
  }

  return result
}

// ─── CMYK channel rendering ───────────────────────────────────────────────────

function renderChannelCanvases(options: ExportOptions): Map<string, HTMLCanvasElement> {
  const { source, transformSettings, halftoneSettings: rawSettings, cmykSettings, outputSettings } = options
  const halftoneSettings = bwSettings(rawSettings)
  const targetWidth  = Math.round(outputSettings.widthInches  * outputSettings.dpi)
  const targetHeight = Math.round(outputSettings.heightInches * outputSettings.dpi)
  const transformed = applyTransforms(source, transformSettings)
  const scaled      = scaleImageData(transformed, targetWidth, targetHeight)
  const channels    = separateChannels(scaled)
  const result      = new Map<string, HTMLCanvasElement>()

  const radialCenter = {
    x: scaled.width  * (halftoneSettings.radialOriginX ?? 0.5),
    y: scaled.height * (halftoneSettings.radialOriginY ?? 0.5),
  }

  for (const ch of ['c', 'm', 'y', 'k'] as const) {
    if (!cmykSettings[ch].enabled) continue
    const canvas = document.createElement('canvas')
    canvas.width  = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')!

    renderHalftone(ctx, {
      source: channels[ch],
      settings: { ...halftoneSettings, angle: cmykSettings[ch].angle, lpi: cmykSettings[ch].lpi },
      renderDpi: outputSettings.dpi,
      radialCenter,
      isExport: true,
    })

    result.set(ch, canvas)
  }

  return result
}

// ─── Composite (single-image) render ─────────────────────────────────────────

function renderFullRes(options: ExportOptions): HTMLCanvasElement {
  const { source, transformSettings, halftoneSettings: rawSettings, cmykSettings, outputSettings } = options
  const halftoneSettings = bwSettings(rawSettings)
  const targetWidth  = Math.round(outputSettings.widthInches  * outputSettings.dpi)
  const targetHeight = Math.round(outputSettings.heightInches * outputSettings.dpi)

  const transformed = applyTransforms(source, transformSettings)
  const scaled      = scaleImageData(transformed, targetWidth, targetHeight)

  const canvas = document.createElement('canvas')
  canvas.width  = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')!

  const radialCenter = {
    x: scaled.width  * (halftoneSettings.radialOriginX ?? 0.5),
    y: scaled.height * (halftoneSettings.radialOriginY ?? 0.5),
  }

  if (halftoneSettings.colorMode === 'cmyk') {
    const channels = separateChannels(scaled)
    const keys = ['c', 'm', 'y', 'k'] as const

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, targetWidth, targetHeight)

    for (const ch of keys) {
      if (!cmykSettings[ch].enabled) continue
      const offCanvas = document.createElement('canvas')
      offCanvas.width  = targetWidth
      offCanvas.height = targetHeight
      const offCtx = offCanvas.getContext('2d')!

      renderHalftone(offCtx, {
        source: channels[ch],
        settings: { ...halftoneSettings, angle: cmykSettings[ch].angle, lpi: cmykSettings[ch].lpi },
        renderDpi: outputSettings.dpi,
        radialCenter,
        isExport: true,
      })

      ctx.globalCompositeOperation = 'multiply'
      ctx.drawImage(offCanvas, 0, 0)
    }
    ctx.globalCompositeOperation = 'source-over'
  } else {
    renderHalftone(ctx, {
      source: scaled,
      settings: halftoneSettings,
      renderDpi: outputSettings.dpi,
      radialCenter,
      isExport: true,
    })
  }

  return canvas
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Export a colour-accurate proof of exactly what will be printed:
 * the halftone (or flat) render composited in ink colours, surrounded
 * by a white margin. Grayscale uses the fg/bg colour pickers; CMYK uses
 * process colours (C/M/Y/K multiply-blended on white); spot uses each
 * colour's hex composited source-over on a white background.
 */
export async function exportColorProof(options: ExportOptions): Promise<void> {
  const { source, transformSettings, halftoneSettings, cmykSettings, spotSettings, outputSettings, projectName } = options
  const { widthInches, dpi } = outputSettings
  const margin = outputSettings.marginInches ?? 1

  const targetW  = Math.round(widthInches  * dpi)
  const marginPx = Math.round(margin * dpi)

  const transformed = applyTransforms(source, transformSettings)

  // Derive targetH from the transformed image's actual aspect ratio so the
  // proof is never distorted (crop/rotation can change the aspect ratio without
  // the output settings being updated to match).
  const targetH = Math.round(targetW * transformed.height / transformed.width)

  const scaled = scaleImageData(transformed, targetW, targetH)

  const radialCenter = {
    x: scaled.width  * (halftoneSettings.radialOriginX ?? 0.5),
    y: scaled.height * (halftoneSettings.radialOriginY ?? 0.5),
  }

  // ── Render the halftone/flat image in colour ─────────────────────────────
  const imgCanvas = document.createElement('canvas')
  imgCanvas.width  = targetW
  imgCanvas.height = targetH
  const imgCtx = imgCanvas.getContext('2d')!

  if (halftoneSettings.colorMode === 'cmyk') {
    // Process-colour multiply composite
    const CMYK_INK = { c: '#00ffff', m: '#ff00ff', y: '#ffff00', k: '#000000' }
    const channels = separateChannels(scaled)

    imgCtx.fillStyle = '#ffffff'
    imgCtx.fillRect(0, 0, targetW, targetH)

    for (const ch of ['c', 'm', 'y', 'k'] as const) {
      if (!cmykSettings[ch].enabled) continue
      const offCanvas = document.createElement('canvas')
      offCanvas.width  = targetW
      offCanvas.height = targetH
      const offCtx = offCanvas.getContext('2d')!

      renderHalftone(offCtx, {
        source: channels[ch],
        settings: { ...bwSettings(halftoneSettings), angle: cmykSettings[ch].angle, lpi: cmykSettings[ch].lpi },
        renderDpi: dpi,
        radialCenter,
        outputDpi: dpi,
        isExport: true,
      })

      const colored = colorizeForMultiply(offCtx.getImageData(0, 0, targetW, targetH), CMYK_INK[ch])
      offCtx.putImageData(colored, 0, 0)
      imgCtx.globalCompositeOperation = 'multiply'
      imgCtx.drawImage(offCanvas, 0, 0)
    }
    imgCtx.globalCompositeOperation = 'source-over'

  } else if (halftoneSettings.colorMode === 'spot') {
    // Separate ALL colors so disabled ones retain their pixels (paper/white).
    const channels = separateSpotChannels(scaled, spotSettings.colors)
    const enabledColors = spotSettings.colors.filter((c) => c.enabled)

    imgCtx.fillStyle = '#ffffff'
    imgCtx.fillRect(0, 0, targetW, targetH)

    for (const color of enabledColors) {
      const channelData = channels.get(color.id)
      if (!channelData) continue

      const offCanvas = document.createElement('canvas')
      offCanvas.width  = targetW
      offCanvas.height = targetH
      const offCtx = offCanvas.getContext('2d')!

      if (color.renderMode === 'flat') {
        renderFlat(offCtx, channelData, color.threshold)
      } else {
        renderHalftone(offCtx, {
          source: channelData,
          settings: { ...bwSettings(halftoneSettings), angle: color.angle, lpi: color.lpi },
          renderDpi: dpi,
          radialCenter,
          outputDpi: dpi,
          isExport: true,
        })
      }

      // Trap: dilate the BW mask before colorize so this layer bleeds into
      // its neighbours in the proof — matches the preview and what channel
      // plates will produce on press.
      const trap = trapFor(color, spotSettings)
      const maskCanvas = trap > 0 ? dilateMask(offCanvas, trap) : offCanvas
      const maskCtx = maskCanvas.getContext('2d')!

      // Match preview: vibrancy slider boosts saturation of the display hex.
      // Proof is WYSIWYG of the preview, so apply it here (channel/PDF exports
      // which go to the press keep the raw hex).
      const displayHex = boostSaturation(color.hex, spotSettings.vibrancy ?? 0)
      const colored = colorizeForOverlay(maskCtx.getImageData(0, 0, targetW, targetH), displayHex)
      const overlayCanvas = document.createElement('canvas')
      overlayCanvas.width = targetW
      overlayCanvas.height = targetH
      overlayCanvas.getContext('2d')!.putImageData(colored, 0, 0)
      imgCtx.globalCompositeOperation = 'source-over'
      imgCtx.drawImage(overlayCanvas, 0, 0)
    }

  } else {
    // Grayscale — render with the actual ink/paper colours from the UI
    renderHalftone(imgCtx, {
      source: scaled,
      settings: halftoneSettings,   // NOT stripped to b/w
      renderDpi: dpi,
      radialCenter,
      outputDpi: dpi,
      isExport: true,
    })
  }

  // ── Wrap in margin ───────────────────────────────────────────────────────
  const totalW = targetW + 2 * marginPx
  const totalH = targetH + 2 * marginPx
  const proofCanvas = document.createElement('canvas')
  proofCanvas.width  = totalW
  proofCanvas.height = totalH
  const proofCtx = proofCanvas.getContext('2d')!
  proofCtx.fillStyle = '#ffffff'
  proofCtx.fillRect(0, 0, totalW, totalH)
  proofCtx.drawImage(imgCanvas, marginPx, marginPx)

  const blob = await new Promise<Blob>((resolve) => {
    proofCanvas.toBlob((b) => resolve(b!), 'image/png')
  })
  const withDpi = await setPngDpi(blob, dpi)
  await platform.exportWithDialog(withDpi, `${toStem(projectName, 'proof')}.png`, [{ name: 'PNG', extensions: ['png'] }])
}

export async function exportPNG(options: ExportOptions): Promise<void> {
  const canvas = renderFullRes(options)
  const stem = toStem(options.projectName, options.halftoneSettings.pattern)

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), 'image/png')
  })

  const withDpi = await setPngDpi(blob, options.outputSettings.dpi)
  await platform.exportWithDialog(withDpi, `${stem}.png`, [{ name: 'PNG', extensions: ['png'] }])
}

export async function exportChannelPNGs(options: ExportOptions): Promise<void> {
  const stem = toStem(options.projectName, options.halftoneSettings.pattern)
  const entries: { name: string; blob: Blob }[] = []

  if (options.halftoneSettings.colorMode === 'spot') {
    const spotCanvases = renderSpotChannelCanvases(options)
    for (const [, { canvas, label }] of spotCanvases) {
      const safeName = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), 'image/png')
      })
      const withDpi = await setPngDpi(blob, options.outputSettings.dpi)
      entries.push({ name: `${stem}-${safeName}.png`, blob: withDpi })
    }
  } else {
    const channelCanvases = renderChannelCanvases(options)
    const channelNames: Record<string, string> = { c: 'cyan', m: 'magenta', y: 'yellow', k: 'black' }
    for (const [ch, canvas] of channelCanvases) {
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), 'image/png')
      })
      const withDpi = await setPngDpi(blob, options.outputSettings.dpi)
      entries.push({ name: `${stem}-${channelNames[ch]}.png`, blob: withDpi })
    }
  }

  await platform.exportChannelsWithDialog(entries, stem)
}

// ─── Vector PDF rendering ─────────────────────────────────────────────────────

/**
 * Patterns that can be rendered as PDF vector paths.
 * Others fall back to the raster (PNG-embed) path.
 */
const VECTOR_PATTERNS = new Set(['dot', 'hex', 'ellipse', 'diamond', 'line', 'euclidean', 'radial-lines'])

type JsPDF = InstanceType<typeof import('jspdf').jsPDF>

/**
 * Render a grayscale halftone layer directly as vector PDF paths.
 * Uses the same grid iteration as the canvas renderer; emits jsPDF
 * draw calls instead of Path2D.  Only called for VECTOR_PATTERNS.
 */
function renderVectorLayer(
  source: ImageData,
  pdf: JsPDF,
  halftoneSettings: HalftoneSettings,
  outputSettings: OutputSettings,
  imgOffX: number,
  imgOffY: number,
  imageWPts: number,
  imageHPts: number,
) {
  const { lpi, angle, pattern } = halftoneSettings
  const { width, height } = source

  // Cell size in source-image pixels (not output pixels)
  const sourcePixelsPerInch = width / outputSettings.widthInches
  const cellSizePx = sourcePixelsPerInch / lpi
  if (cellSizePx < 0.5) return  // too fine to be useful

  // Scale from source pixels → PDF points
  const pxToPtX = imageWPts / width
  const pxToPtY = imageHPts / height

  const gray = precomputeGrayscale(source)
  const angleRad = (angle * Math.PI) / 180
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)

  const isHex = pattern === 'hex'
  const rowSpacing = isHex ? cellSizePx * (Math.sqrt(3) / 2) : cellSizePx
  const diagonal   = Math.sqrt(width * width + height * height)
  const gridCols   = Math.ceil(diagonal / cellSizePx) + 2
  const gridRows   = Math.ceil(diagonal / rowSpacing) + 2
  const offsetX    = width  / 2
  const offsetY    = height / 2

  pdf.setFillColor(0, 0, 0)
  pdf.setDrawColor(0, 0, 0)

  for (let row = -gridRows; row <= gridRows; row++) {
    for (let col = -gridCols; col <= gridCols; col++) {
      const hexOffset = isHex && row % 2 !== 0 ? cellSizePx / 2 : 0
      const gx = col * cellSizePx + hexOffset
      const gy = row * rowSpacing
      const ix = gx * cos - gy * sin + offsetX
      const iy = gx * sin + gy * cos + offsetY

      if (ix < -cellSizePx || ix > width  + cellSizePx) continue
      if (iy < -cellSizePx || iy > height + cellSizePx) continue

      const brightness  = sampleGray(gray, width, height, ix, iy, cellSizePx)
      const rawDarkness = 1 - brightness
      const darkness    = applyDotSettings(rawDarkness, halftoneSettings)
      if (darkness === null || darkness < 0.01) continue

      const pdfX = imgOffX + ix * pxToPtX
      const pdfY = imgOffY + iy * pxToPtY

      if (pattern === 'dot' || pattern === 'hex') {
        const r = (cellSizePx * 0.5) * Math.sqrt(darkness)
        const rPt = r * pxToPtX
        if (rPt < 0.05) continue
        pdf.circle(pdfX, pdfY, rPt, 'F')

      } else if (pattern === 'euclidean') {
        if (darkness <= 0.5) {
          const r = (cellSizePx * 0.5) * Math.sqrt(darkness * 2)
          const rPt = r * pxToPtX
          if (rPt < 0.05) continue
          pdf.circle(pdfX, pdfY, rPt, 'F')
        } else {
          // Dark cell with white punch-out circle
          const half = (cellSizePx * 0.5) * pxToPtX
          pdf.rect(pdfX - half, pdfY - half, half * 2, half * 2, 'F')
          const r = (cellSizePx * 0.5) * Math.sqrt((1 - darkness) * 2)
          const rPt = r * pxToPtX
          if (rPt >= 0.05) {
            pdf.setFillColor(255, 255, 255)
            pdf.circle(pdfX, pdfY, rPt, 'F')
            pdf.setFillColor(0, 0, 0)
          }
        }

      } else if (pattern === 'ellipse') {
        const maxR = cellSizePx * 0.48
        const ry   = maxR * Math.sqrt(darkness)
        const rx   = ry * 1.5
        if (rx * pxToPtX < 0.05) continue
        pdf.ellipse(pdfX, pdfY, rx * pxToPtX, ry * pxToPtY, 'F')

      } else if (pattern === 'diamond') {
        const h   = (cellSizePx * 0.5) * Math.sqrt(darkness)
        const hPt = h * pxToPtX
        if (hPt < 0.05) continue
        // Diamond: four vertices relative to (pdfX - hPt, pdfY)
        pdf.lines([[hPt, -hPt], [hPt, hPt], [-hPt, hPt]], pdfX - hPt, pdfY, [1, 1], 'F', true)

      } else if (pattern === 'line') {
        const thickness = cellSizePx * darkness
        if (thickness < 0.1) continue
        const halfLen = (cellSizePx * 0.75) / 2
        const lx = Math.cos(angleRad) * halfLen
        const ly = Math.sin(angleRad) * halfLen
        pdf.setLineWidth(thickness * pxToPtX)
        pdf.line(pdfX - lx * pxToPtX, pdfY - ly * pxToPtY,
                 pdfX + lx * pxToPtX, pdfY + ly * pxToPtY)
      }
    }
  }

  if (pattern === 'radial-lines') {
    // Radial arc segments — each arc drawn as a cubic bezier approximation.
    // Uses the same geometry as renderRadialLines() in patterns.ts.
    const cx = width  * (halftoneSettings.radialOriginX ?? 0.5)
    const cy = height * (halftoneSettings.radialOriginY ?? 0.5)
    const cxPdf = imgOffX + cx * pxToPtX
    const cyPdf = imgOffY + cy * pxToPtY

    const maxRadius = Math.max(
      Math.sqrt(cx * cx + cy * cy),
      Math.sqrt((width - cx) ** 2 + cy * cy),
      Math.sqrt(cx * cx + (height - cy) ** 2),
      Math.sqrt((width - cx) ** 2 + (height - cy) ** 2),
    ) + cellSizePx

    pdf.setDrawColor(0, 0, 0)
    pdf.setLineCap('round')

    for (let ring = 1; ring * cellSizePx <= maxRadius; ring++) {
      const radius = ring * cellSizePx
      const circumference = 2 * Math.PI * radius
      const numSegments = Math.max(6, Math.round(circumference / cellSizePx))
      const angleStep = (2 * Math.PI) / numSegments
      // Bezier control point coefficient for this arc span
      const k = (4 / 3) * Math.tan(angleStep / 4)

      // Ellipse radii in PDF points (handles non-square px→pt scaling)
      const rPtX = radius * pxToPtX
      const rPtY = radius * pxToPtY

      for (let seg = 0; seg < numSegments; seg++) {
        const α = seg * angleStep
        const β = α + angleStep
        const midAngle = α + angleStep / 2

        // Sample brightness at arc midpoint
        const px = cx + radius * Math.cos(midAngle)
        const py = cy + radius * Math.sin(midAngle)
        if (px < -cellSizePx || px > width + cellSizePx) continue
        if (py < -cellSizePx || py > height + cellSizePx) continue

        const brightness  = sampleGray(gray, width, height, px, py, cellSizePx)
        const rawDarkness = 1 - brightness
        const darkness    = applyDotSettings(rawDarkness, halftoneSettings)
        if (darkness === null || darkness < 0.01) continue

        const strokeWidthPt = cellSizePx * darkness * pxToPtX
        if (strokeWidthPt < 0.05) continue

        // Bezier control points for an elliptical arc α→β
        // P0/P3 are arc endpoints; P1/P2 are control points using
        // the tangent vectors scaled by k.
        const p0x = cxPdf + rPtX * Math.cos(α)
        const p0y = cyPdf + rPtY * Math.sin(α)
        const p3x = cxPdf + rPtX * Math.cos(β)
        const p3y = cyPdf + rPtY * Math.sin(β)
        const p1x = p0x - k * rPtX * Math.sin(α)
        const p1y = p0y + k * rPtY * Math.cos(α)
        const p2x = p3x + k * rPtX * Math.sin(β)
        const p2y = p3y - k * rPtY * Math.cos(β)

        pdf.setLineWidth(strokeWidthPt)
        pdf.moveTo(p0x, p0y)
        pdf.curveTo(p1x, p1y, p2x, p2y, p3x, p3y)
        pdf.stroke()
      }
    }

    // Restore default line cap for any subsequent drawing
    pdf.setLineCap('butt')
  }
}

export async function exportPDF(options: ExportOptions): Promise<void> {
  const { default: jsPDF } = await import('jspdf')
  const { halftoneSettings, cmykSettings, spotSettings, outputSettings } = options
  const { widthInches, heightInches } = outputSettings

  const margin = (outputSettings.marginInches != null && isFinite(outputSettings.marginInches))
    ? outputSettings.marginInches
    : 1
  const showCropMarks    = outputSettings.cropMarks !== false
  const showMargin       = outputSettings.showMargin !== false
  const showAlignMarks   = !!outputSettings.alignmentMarks
  const cropMarkPts = showCropMarks ? 0.5 * 72 : 0
  const marginPts   = showMargin ? margin * 72 : 0
  const imageWPts   = widthInches  * 72
  const imageHPts   = heightInches * 72

  const pageW = imageWPts + 2 * marginPts + 2 * cropMarkPts
  const pageH = imageHPts + 2 * marginPts + 2 * cropMarkPts

  const imgOffX = marginPts + cropMarkPts
  const imgOffY = marginPts + cropMarkPts

  const pieceX0 = cropMarkPts
  const pieceY0 = cropMarkPts
  const pieceX1 = cropMarkPts + 2 * marginPts + imageWPts
  const pieceY1 = cropMarkPts + 2 * marginPts + imageHPts

  const pdf = new jsPDF({
    orientation: widthInches > heightInches ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [pageW, pageH],
  })

  if (halftoneSettings.colorMode === 'spot') {
    const spotCanvases = renderSpotChannelCanvases(options)
    let first = true

    for (const [id, { canvas, label }] of spotCanvases) {
      if (!first) pdf.addPage([pageW, pageH])
      first = false

      const imgData = canvas.toDataURL('image/png')
      pdf.addImage(imgData, 'PNG', imgOffX, imgOffY, imageWPts, imageHPts)

      pdf.setFontSize(8)
      pdf.setTextColor(0)

      const color = spotSettings.colors.find((c) => c.id === id)
      const modeLabel = color?.renderMode === 'flat'
        ? `Flat — threshold ${Math.round((color.threshold) * 100)}%`
        : `Halftone — ${color?.angle ?? 45}° @ ${color?.lpi ?? 55} LPI`

      pdf.text(`${label} — ${modeLabel}`, imgOffX, pieceY0 - 6)
      if (showCropMarks) drawCropMarks(pdf, pieceX0, pieceY0, pieceX1, pieceY1, cropMarkPts)
      if (showAlignMarks) drawAlignmentMarks(pdf, imgOffX, imgOffY, imageWPts, imageHPts, marginPts, cropMarkPts)
    }
  } else if (halftoneSettings.colorMode === 'cmyk') {
    const channelCanvases = renderChannelCanvases(options)
    const channelNames: Record<string, string> = { c: 'Cyan', m: 'Magenta', y: 'Yellow', k: 'Black' }
    let first = true

    for (const [ch, canvas] of channelCanvases) {
      if (!first) pdf.addPage([pageW, pageH])
      first = false

      const imgData = canvas.toDataURL('image/png')
      pdf.addImage(imgData, 'PNG', imgOffX, imgOffY, imageWPts, imageHPts)

      pdf.setFontSize(8)
      pdf.setTextColor(0)
      const chSettings = cmykSettings[ch as keyof typeof cmykSettings]
      pdf.text(
        `${channelNames[ch]} — ${chSettings.angle}° @ ${chSettings.lpi} LPI`,
        imgOffX,
        pieceY0 - 6,
      )

      if (showCropMarks) drawCropMarks(pdf, pieceX0, pieceY0, pieceX1, pieceY1, cropMarkPts)
      if (showAlignMarks) drawAlignmentMarks(pdf, imgOffX, imgOffY, imageWPts, imageHPts, marginPts, cropMarkPts)
    }
  } else {
    const useVector = outputSettings.vectorPDF !== false
      && VECTOR_PATTERNS.has(halftoneSettings.pattern)

    if (useVector) {
      const targetWidth  = Math.round(widthInches  * outputSettings.dpi)
      const targetHeight = Math.round(heightInches * outputSettings.dpi)
      const transformed  = applyTransforms(options.source, options.transformSettings)
      const scaled       = scaleImageData(transformed, targetWidth, targetHeight)

      // White background for the image area
      pdf.setFillColor(255, 255, 255)
      pdf.rect(imgOffX, imgOffY, imageWPts, imageHPts, 'F')

      renderVectorLayer(scaled, pdf, bwSettings(halftoneSettings), outputSettings, imgOffX, imgOffY, imageWPts, imageHPts)
    } else {
      const canvas = renderFullRes(options)
      const imgData = canvas.toDataURL('image/png')
      pdf.addImage(imgData, 'PNG', imgOffX, imgOffY, imageWPts, imageHPts)
    }
    if (showCropMarks) drawCropMarks(pdf, pieceX0, pieceY0, pieceX1, pieceY1, cropMarkPts)
  }

  const stem = toStem(options.projectName, options.halftoneSettings.pattern)
  const filename = `${stem}.pdf`
  const pdfBlob = pdf.output('blob')
  await platform.exportWithDialog(pdfBlob, filename, [{ name: 'PDF', extensions: ['pdf'] }])
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Draw screenprint registration marks (circle + crosshair) at the midpoint
 * of each side of the image, centred in the available border space.
 * Used on every plate so layers can be aligned on press.
 */
function drawAlignmentMarks(
  pdf: InstanceType<typeof import('jspdf').jsPDF>,
  imgOffX: number,
  imgOffY: number,
  imageWPts: number,
  imageHPts: number,
  marginPts: number,
  cropMarkPts: number,
) {
  const border = marginPts + cropMarkPts
  if (border < 6) return  // no room

  // Centre the mark in the border strip on each side
  const offset = border / 2
  const radius = Math.min(10, border * 0.36)   // ≤ 10 pt (~0.14")
  const armLen = radius * 1.7                  // crosshair extends beyond circle

  const cx = imgOffX + imageWPts / 2
  const cy = imgOffY + imageHPts / 2

  const positions = [
    { x: cx,                              y: imgOffY - offset },              // top
    { x: cx,                              y: imgOffY + imageHPts + offset },  // bottom
    { x: imgOffX - offset,                y: cy },                            // left
    { x: imgOffX + imageWPts + offset,    y: cy },                            // right
  ]

  pdf.setDrawColor(0, 0, 0)
  pdf.setLineWidth(0.5)

  for (const { x, y } of positions) {
    pdf.circle(x, y, radius, 'S')                 // ring
    pdf.line(x - armLen, y, x + armLen, y)        // horizontal arm
    pdf.line(x, y - armLen, x, y + armLen)        // vertical arm
  }
}

function drawCropMarks(
  pdf: InstanceType<typeof import('jspdf').jsPDF>,
  pieceX0: number,
  pieceY0: number,
  pieceX1: number,
  pieceY1: number,
  wasteSize: number,
) {
  pdf.setDrawColor(0)
  pdf.setLineWidth(0.5)

  const gap     = Math.max(3, wasteSize * 0.12)
  const markLen = Math.min(wasteSize - gap - 2, wasteSize * 0.75)

  const corners: [number, number, number, number][] = [
    [pieceX0, pieceY0, -1, -1],
    [pieceX1, pieceY0, +1, -1],
    [pieceX0, pieceY1, -1, +1],
    [pieceX1, pieceY1, +1, +1],
  ]

  for (const [x, y, dx, dy] of corners) {
    pdf.line(x + dx * gap, y, x + dx * (gap + markLen), y)
    pdf.line(x, y + dy * gap, x, y + dy * (gap + markLen))
  }
}

