import { HalftoneSettings, CMYKSettings, OutputSettings, ImageTransformSettings, SpotSettings } from '../types'
import { renderHalftone } from './halftone'
import { separateChannels } from './cmyk'
import { separateSpotChannels, renderFlat } from './spot-separation'
import { setPngDpi } from './png-metadata'
import { applyTransforms } from './transform'

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

  const enabledColors = spotSettings.colors.filter((c) => c.enabled)
  const channels = separateSpotChannels(scaled, enabledColors)

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
      })
    }

    result.set(color.id, { canvas, label: color.name })
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
      })

      const colored = colorizeForMultiply(offCtx.getImageData(0, 0, targetW, targetH), CMYK_INK[ch])
      offCtx.putImageData(colored, 0, 0)
      imgCtx.globalCompositeOperation = 'multiply'
      imgCtx.drawImage(offCanvas, 0, 0)
    }
    imgCtx.globalCompositeOperation = 'source-over'

  } else if (halftoneSettings.colorMode === 'spot') {
    const enabledColors = spotSettings.colors.filter((c) => c.enabled)
    const channels = separateSpotChannels(scaled, enabledColors)

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
        })
      }

      const colored = colorizeForOverlay(offCtx.getImageData(0, 0, targetW, targetH), color.hex)
      offCtx.putImageData(colored, 0, 0)
      imgCtx.globalCompositeOperation = 'source-over'
      imgCtx.drawImage(offCanvas, 0, 0)
    }

  } else {
    // Grayscale — render with the actual ink/paper colours from the UI
    renderHalftone(imgCtx, {
      source: scaled,
      settings: halftoneSettings,   // NOT stripped to b/w
      renderDpi: dpi,
      radialCenter,
      outputDpi: dpi,
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
  downloadBlob(withDpi, `${toStem(projectName, 'proof')}.png`)
}

export async function exportPNG(options: ExportOptions): Promise<void> {
  const canvas = renderFullRes(options)
  const stem = toStem(options.projectName, options.halftoneSettings.pattern)

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), 'image/png')
  })

  const withDpi = await setPngDpi(blob, options.outputSettings.dpi)
  downloadBlob(withDpi, `${stem}.png`)
}

export async function exportChannelPNGs(options: ExportOptions): Promise<void> {
  const stem = toStem(options.projectName, options.halftoneSettings.pattern)

  if (options.halftoneSettings.colorMode === 'spot') {
    const spotCanvases = renderSpotChannelCanvases(options)
    for (const [, { canvas, label }] of spotCanvases) {
      const safeName = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), 'image/png')
      })
      const withDpi = await setPngDpi(blob, options.outputSettings.dpi)
      downloadBlob(withDpi, `${stem}-${safeName}.png`)
    }
  } else {
    const channelCanvases = renderChannelCanvases(options)
    const channelNames: Record<string, string> = { c: 'cyan', m: 'magenta', y: 'yellow', k: 'black' }
    for (const [ch, canvas] of channelCanvases) {
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), 'image/png')
      })
      const withDpi = await setPngDpi(blob, options.outputSettings.dpi)
      downloadBlob(withDpi, `${stem}-${channelNames[ch]}.png`)
    }
  }
}

export async function exportPDF(options: ExportOptions): Promise<void> {
  const { default: jsPDF } = await import('jspdf')
  const { halftoneSettings, cmykSettings, spotSettings, outputSettings } = options
  const { widthInches, heightInches } = outputSettings

  const margin = (outputSettings.marginInches != null && isFinite(outputSettings.marginInches))
    ? outputSettings.marginInches
    : 1
  const cropMarkPts = 0.5 * 72
  const marginPts   = margin * 72
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
      drawCropMarks(pdf, pieceX0, pieceY0, pieceX1, pieceY1, cropMarkPts)
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

      drawCropMarks(pdf, pieceX0, pieceY0, pieceX1, pieceY1, cropMarkPts)
    }
  } else {
    const canvas = renderFullRes(options)
    const imgData = canvas.toDataURL('image/png')
    pdf.addImage(imgData, 'PNG', imgOffX, imgOffY, imageWPts, imageHPts)
    drawCropMarks(pdf, pieceX0, pieceY0, pieceX1, pieceY1, cropMarkPts)
  }

  const stem = toStem(options.projectName, options.halftoneSettings.pattern)
  pdf.save(`${stem}.pdf`)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
