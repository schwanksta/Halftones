import { HalftoneSettings, CMYKSettings, OutputSettings, ImageTransformSettings, SpotSettings, SpotColor, MaskSettings, MaskImage } from '../types'
import { computeAlphaBoundaryMask, applyEdgeMaskToCanvas } from './edge'
import { renderHalftone } from './halftone'
import { separateChannels } from './cmyk'
import { computeSpotLabels, buildSpotChannels, buildUnderbaseChannel, renderFlat, boostSaturation, darkestSpotColor } from './spot-separation'
import { setPngDpi } from './png-metadata'
import { applyTransforms } from './transform'
import { dilateMask } from './dilate'
import { buildMaskOverlay, buildMaskStroke, applyCutOverlayToCanvas } from './mask'
import { platform } from '../platform'
import { precomputeGrayscale, sampleGray } from './sampling'
import { applyDotSettings } from './dot-settings'
import { buildKeyPlateCanvas, buildExportEdgeMask } from './key-plate'
import { traceBinaryMask, polygonsToPath2D } from './vectorize'

/** Whether a color's flat plate should be vectorized: per-color override wins
 *  over the global toggle. */
function smoothFor(color: SpotColor, spotSettings: SpotSettings): boolean {
  return color.smooth ?? spotSettings.smoothFlat ?? false
}

/**
 * Fill a flat plate by vectorizing its mask into smooth polygons instead of
 * rendering the raw per-pixel staircase. `mask` and the target ctx are at the
 * same (output) resolution, so polygons map 1:1. Black-on-white, even-odd fill.
 * No built-in trap — adjacent-plate seam closure (if wanted) is the user's trap.
 */
function fillFlatVector(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  mask: ImageData, threshold: number, strength: number,
): void {
  const path = polygonsToPath2D(traceBinaryMask(mask, { threshold, strength }))
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = '#000000'
  ctx.fill(path, 'evenodd')
}

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
  /** Optional global layer mask. When enabled, cut areas become paper (white) on all plates. */
  mask?: MaskImage | null
  maskSettings?: MaskSettings
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

/** Suffix for export filenames — reflects the color mode rather than the
 *  pattern when that's more meaningful (spot, cmyk). */
function exportSuffix(halftoneSettings: HalftoneSettings): string {
  if (halftoneSettings.colorMode === 'spot') return 'spot'
  if (halftoneSettings.colorMode === 'cmyk') return 'cmyk'
  return halftoneSettings.pattern
}

/** Spelled-out layer numbers for PDF plate labels (1-based). Falls back to
 *  the numeral past the table. */
const NUMBER_WORDS = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen', 'Twenty',
]
function layerWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n)
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
async function renderSpotChannelCanvases(
  options: ExportOptions
): Promise<Map<string, { canvas: HTMLCanvasElement; label: string; bleedPx?: number }>> {
  const { source, transformSettings, halftoneSettings: rawSettings, spotSettings, outputSettings } = options
  const halftoneSettings = bwSettings(rawSettings)
  const targetWidth  = Math.round(outputSettings.widthInches  * outputSettings.dpi)
  const targetHeight = Math.round(outputSettings.heightInches * outputSettings.dpi)

  const transformed = applyTransforms(source, transformSettings)
  const scaled      = scaleImageData(transformed, targetWidth, targetHeight)

  // Separate ALL colors so disabled ones claim their own pixels — preventing
  // redistribution to enabled neighbors.  Only enabled colors get rendered/exported.
  const buildup = spotSettings.separationMode === 'buildup'
  const labelData = computeSpotLabels(scaled, spotSettings.colors,
      spotSettings.paperWhite ? { enabled: true, threshold: spotSettings.paperWhiteThreshold ?? 92 } : undefined)
  const channels = buildSpotChannels(labelData, (spotSettings.smoothing ?? 0) / 100, spotSettings.separationMode ?? 'knockout')
  const enabledColors = spotSettings.colors.filter((c) => c.enabled)

  const radialCenter = {
    x: scaled.width  * (halftoneSettings.radialOriginX ?? 0.5),
    y: scaled.height * (halftoneSettings.radialOriginY ?? 0.5),
  }

  // Build the mask overlay once at target resolution — applied to every plate.
  // The overlay covers the image rect only (no bleed extension); bleed areas
  // are outside the mask region and are left as-is (full ink for background plates).
  const ms = options.maskSettings ?? { enabled: false, invert: false, source: 'auto' as const }
  const maskOverlay = await buildMaskOverlay(options.mask ?? null, ms, targetWidth, targetHeight)

  const result = new Map<string, { canvas: HTMLCanvasElement; label: string; bleedPx?: number }>()

  // Underbase plate (printed first): union of all inked area, choked inward.
  if (spotSettings.underbase?.enabled) {
    const chokePx = Math.round((spotSettings.underbase.chokeInches ?? 0) * outputSettings.dpi)
    const ubCanvas = document.createElement('canvas')
    ubCanvas.width = targetWidth; ubCanvas.height = targetHeight
    ubCanvas.getContext('2d')!.putImageData(buildUnderbaseChannel(labelData, chokePx), 0, 0)
    if (maskOverlay) applyCutOverlayToCanvas(ubCanvas, maskOverlay)
    result.set('__underbase__', { canvas: ubCanvas, label: 'Underbase' })
  }

  // Key plate content (dots + edge stroke + outline), rendered black-on-white.
  // Built before the per-color loop so it can be merged directly into the
  // darkest color's plate instead of exported as its own layer.
  let keyCanvas: HTMLCanvasElement | null = null
  if (spotSettings.key?.enabled) {
    const key = spotSettings.key
    const edgeMask = key.strokeEnabled
      ? buildExportEdgeMask(transformed, targetWidth, targetHeight, key.strokeThreshold ?? 0.3, key.strokeWidth ?? 2)
      : null
    const outlineMask = key.outlineEnabled
      ? computeAlphaBoundaryMask(scaled, key.outlineWidth ?? 3)
      : null
    keyCanvas = buildKeyPlateCanvas({
      width: targetWidth,
      height: targetHeight,
      dotsSource: scaled,
      key,
      baseSettings: halftoneSettings,
      renderDpi: outputSettings.dpi,
      isExport: true,
      radialCenter,
      edgeMask,
      outlineMask,
    })
  }

  // When merging, fold the key plate's ink directly into the darkest enabled
  // color's plate (one screen, that color's ink) instead of exporting it as a
  // separate overprinted layer. Falls back to a standalone key plate if there's
  // no enabled spot color to merge into.
  const keyMergeTarget = spotSettings.key?.enabled && spotSettings.key.mergeWithDarkest
    ? darkestSpotColor(spotSettings.colors)
    : null

  for (const color of enabledColors) {
    const channelData = channels.get(color.id)
    if (!channelData) continue

    // Bleed: expand the channel source data BEFORE rendering so the halftone
    // (or flat fill) naturally extends into the bleed area.  Same approach as
    // the preview — avoids the solid-black border that a post-render expansion
    // would produce for halftone backgrounds.
    const bleedPx = color.type === 'background' && (color.bleedInches ?? 0) > 0
      ? Math.round(color.bleedInches! * outputSettings.dpi)
      : 0

    let effectiveChannelData = channelData
    let renderW = targetWidth
    let renderH = targetHeight
    if (bleedPx > 0) {
      const expW = targetWidth  + 2 * bleedPx
      const expH = targetHeight + 2 * bleedPx
      // Build expanded channel: border = 0 (full ink), image = original channel
      const expandSrc = document.createElement('canvas')
      expandSrc.width = targetWidth; expandSrc.height = targetHeight
      expandSrc.getContext('2d')!.putImageData(channelData, 0, 0)
      const expandDst = document.createElement('canvas')
      expandDst.width = expW; expandDst.height = expH
      const expandCtx = expandDst.getContext('2d')!
      expandCtx.fillStyle = '#000000'
      expandCtx.fillRect(0, 0, expW, expH)
      expandCtx.drawImage(expandSrc, bleedPx, bleedPx)
      effectiveChannelData = expandCtx.getImageData(0, 0, expW, expH)
      renderW = expW; renderH = expH
    }

    const canvas = document.createElement('canvas')
    canvas.width  = renderW
    canvas.height = renderH
    const ctx = canvas.getContext('2d')!

    const isFlat = buildup || color.renderMode === 'flat'
    if (isFlat && smoothFor(color, spotSettings) && bleedPx === 0) {
      // Vectorize the flat mask for smooth (non-staircased) edges. Bleed plates
      // fall back to raster fill (their edge runs off into the trimmed margin).
      fillFlatVector(ctx, renderW, renderH, channelData, color.threshold, spotSettings.smoothFlatStrength ?? 50)
    } else if (isFlat) {
      renderFlat(ctx, effectiveChannelData, color.threshold)
    } else {
      renderHalftone(ctx, {
        source: effectiveChannelData,
        settings: { ...halftoneSettings, angle: color.angle, lpi: color.lpi },
        renderDpi: outputSettings.dpi,
        radialCenter,
        isExport: true,
      })
    }

    // Merge the key plate's ink into this color's plate (one screen) when
    // mergeWithDarkest targets this color — masked/trapped together below.
    if (keyMergeTarget && color.id === keyMergeTarget.id && keyCanvas) {
      applyEdgeMaskToCanvas(canvas, keyCanvas.getContext('2d')!.getImageData(0, 0, targetWidth, targetHeight))
    }

    // Apply mask overlay to the image-rect portion of the plate.
    // Bleed extends OUTSIDE the mask region — leave those pixels as-is
    // (they're in the margin and won't appear in the final trimmed piece).
    if (maskOverlay) {
      ctx.drawImage(maskOverlay, bleedPx, bleedPx)
    }

    // Trap: dilate the plate so this layer's ink spreads outward, overlapping
    // neighbouring colors on press and hiding visible paper seams.
    const trap = trapFor(color, spotSettings)
    const finalCanvas = trap > 0 ? dilateMask(canvas, trap) : canvas

    result.set(color.id, { canvas: finalCanvas, label: color.name, bleedPx: bleedPx || undefined })
  }

  // Key plate: exported as its own layer only when NOT merged into a color
  // plate above (merge is off, or there's no enabled spot color to merge into).
  if (keyCanvas && !keyMergeTarget) {
    if (maskOverlay) applyCutOverlayToCanvas(keyCanvas, maskOverlay)
    result.set('__key__', { canvas: keyCanvas, label: 'Key' })
  }

  // Mask boundary stroke: its own dedicated keyline plate (black on white).
  const stroke = await buildMaskStroke(
    options.mask ?? null, ms, targetWidth, targetHeight,
    Math.round((ms.strokeWidthInches ?? 0) * outputSettings.dpi),
  )
  if (stroke) result.set('__maskstroke__', { canvas: stroke.plate, label: 'Mask Stroke' })

  return result
}

// ─── CMYK channel rendering ───────────────────────────────────────────────────

async function renderChannelCanvases(options: ExportOptions): Promise<Map<string, HTMLCanvasElement>> {
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

  // Build mask overlay once for the target size, shared across all channels.
  const ms = options.maskSettings ?? { enabled: false, invert: false, source: 'auto' as const }
  const maskOverlay = await buildMaskOverlay(options.mask ?? null, ms, targetWidth, targetHeight)

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

    if (maskOverlay) applyCutOverlayToCanvas(canvas, maskOverlay)

    result.set(ch, canvas)
  }

  return result
}

// ─── Composite (single-image) render ─────────────────────────────────────────

async function renderFullRes(options: ExportOptions): Promise<HTMLCanvasElement> {
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

  // Apply global mask overlay — converts cut pixels to white (no ink) on the
  // composite output.  Applied last so it overrides all CMYK/grayscale layers.
  const ms = options.maskSettings ?? { enabled: false, invert: false, source: 'auto' as const }
  const maskOverlay = await buildMaskOverlay(options.mask ?? null, ms, targetWidth, targetHeight)
  if (maskOverlay) applyCutOverlayToCanvas(canvas, maskOverlay)

  // Boundary stroke composited on top (keyline) for the single-image export.
  const stroke = await buildMaskStroke(
    options.mask ?? null, ms, targetWidth, targetHeight,
    Math.round((ms.strokeWidthInches ?? 0) * outputSettings.dpi),
  )
  if (stroke) ctx.drawImage(stroke.colored, 0, 0)

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

  // Create proof canvas up front so the spot branch can paint background-bleed
  // layers directly into the margin area (before imgCanvas is composited).
  const totalW = targetW + 2 * marginPx
  const totalH = targetH + 2 * marginPx
  const proofCanvas = document.createElement('canvas')
  proofCanvas.width  = totalW
  proofCanvas.height = totalH
  const proofCtx = proofCanvas.getContext('2d')!
  // Substrate (paper/garment) colour backs the proof so dark/colored stock previews honestly.
  proofCtx.fillStyle = spotSettings.substrate || '#ffffff'
  proofCtx.fillRect(0, 0, totalW, totalH)

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
    const buildup = spotSettings.separationMode === 'buildup'
    const proofLabelData = computeSpotLabels(scaled, spotSettings.colors,
      spotSettings.paperWhite ? { enabled: true, threshold: spotSettings.paperWhiteThreshold ?? 92 } : undefined)
    const channels = buildSpotChannels(proofLabelData, (spotSettings.smoothing ?? 0) / 100, spotSettings.separationMode ?? 'knockout')
    // Build-up overprints, so paint light→dark (darkest opaque ink ends up on top).
    const enabledColors = spotSettings.colors.filter((c) => c.enabled)
      .sort((a, b) => (buildup ? b.lab[0] - a.lab[0] : 0))

    // NOTE: imgCtx is intentionally left transparent (no substrate fill).
    // proofCanvas provides the substrate background; background-bleed layers
    // draw directly onto proofCanvas so their ink extends into the margin area.
    // Non-bleed layers draw onto imgCanvas which is then composited on top.

    // Underbase (bottom layer): union of inked area, choked, in its ink colour.
    if (spotSettings.underbase?.enabled) {
      const chokePx = Math.round((spotSettings.underbase.chokeInches ?? 0) * dpi)
      const ubColored = colorizeForOverlay(buildUnderbaseChannel(proofLabelData, chokePx), spotSettings.underbase.color || '#c0c0c0')
      const ubCanvas = document.createElement('canvas')
      ubCanvas.width = targetW; ubCanvas.height = targetH
      ubCanvas.getContext('2d')!.putImageData(ubColored, 0, 0)
      imgCtx.drawImage(ubCanvas, 0, 0)
    }

    // Key plate content (dots + edge stroke + outline), rendered black-on-white.
    // Built before the per-color loop so it can be merged directly into the
    // darkest color's plate instead of overprinted as its own layer.
    let keyCanvas: HTMLCanvasElement | null = null
    if (spotSettings.key?.enabled) {
      const key = spotSettings.key
      const edgeMask = key.strokeEnabled
        ? buildExportEdgeMask(transformed, targetW, targetH, key.strokeThreshold ?? 0.3, key.strokeWidth ?? 2)
        : null
      const outlineMask = key.outlineEnabled
        ? computeAlphaBoundaryMask(scaled, key.outlineWidth ?? 3)
        : null
      keyCanvas = buildKeyPlateCanvas({
        width: targetW,
        height: targetH,
        dotsSource: scaled,
        key,
        baseSettings: halftoneSettings,
        renderDpi: dpi,
        outputDpi: dpi,
        isExport: true,
        radialCenter,
        edgeMask,
        outlineMask,
      })
    }

    // When merging, fold the key plate's ink directly into the darkest enabled
    // color's plate (one screen, that color's hue) instead of compositing it as
    // a separate overprinted layer. Falls back to a standalone key layer if
    // there's no enabled spot color to merge into.
    const keyMergeTarget = spotSettings.key?.enabled && spotSettings.key.mergeWithDarkest
      ? darkestSpotColor(spotSettings.colors)
      : null

    for (const color of enabledColors) {
      const channelData = channels.get(color.id)
      if (!channelData) continue

      // Bleed: expand the channel source data BEFORE rendering so the halftone
      // or flat fill naturally extends through the bleed area.
      const bleedPx = color.type === 'background' && (color.bleedInches ?? 0) > 0
        ? Math.round(color.bleedInches! * dpi) : 0

      let effectiveChannelData = channelData
      let offW = targetW, offH = targetH
      if (bleedPx > 0) {
        const expW = targetW + 2 * bleedPx
        const expH = targetH + 2 * bleedPx
        const expandSrc = document.createElement('canvas')
        expandSrc.width = targetW; expandSrc.height = targetH
        expandSrc.getContext('2d')!.putImageData(channelData, 0, 0)
        const expandDst = document.createElement('canvas')
        expandDst.width = expW; expandDst.height = expH
        const expandCtx = expandDst.getContext('2d')!
        expandCtx.fillStyle = '#000000'
        expandCtx.fillRect(0, 0, expW, expH)
        expandCtx.drawImage(expandSrc, bleedPx, bleedPx)
        effectiveChannelData = expandCtx.getImageData(0, 0, expW, expH)
        offW = expW; offH = expH
      }

      const offCanvas = document.createElement('canvas')
      offCanvas.width  = offW
      offCanvas.height = offH
      const offCtx = offCanvas.getContext('2d')!

      const isFlat = buildup || color.renderMode === 'flat'
      if (isFlat && smoothFor(color, spotSettings) && bleedPx === 0) {
        fillFlatVector(offCtx, offW, offH, channelData, color.threshold, spotSettings.smoothFlatStrength ?? 50)
      } else if (isFlat) {
        renderFlat(offCtx, effectiveChannelData, color.threshold)
      } else {
        renderHalftone(offCtx, {
          source: effectiveChannelData,
          settings: { ...bwSettings(halftoneSettings), angle: color.angle, lpi: color.lpi },
          renderDpi: dpi,
          radialCenter,
          outputDpi: dpi,
          isExport: true,
        })
      }

      // Merge the key plate's ink into this color's plate (one screen) when
      // mergeWithDarkest targets this color — trapped/colorized together below.
      if (keyMergeTarget && color.id === keyMergeTarget.id && keyCanvas) {
        applyEdgeMaskToCanvas(offCanvas, keyCanvas.getContext('2d')!.getImageData(0, 0, targetW, targetH))
      }

      // Trap: dilate the BW mask before colorize.
      const trap = trapFor(color, spotSettings)
      const maskCanvas = trap > 0 ? dilateMask(offCanvas, trap) : offCanvas
      const maskCtx = maskCanvas.getContext('2d')!
      const displayHex = boostSaturation(color.hex, spotSettings.vibrancy ?? 0)
      const colored = colorizeForOverlay(
        maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height), displayHex)
      const overlayCanvas = document.createElement('canvas')
      overlayCanvas.width = maskCanvas.width
      overlayCanvas.height = maskCanvas.height
      overlayCanvas.getContext('2d')!.putImageData(colored, 0, 0)

      if (color.type === 'background' && bleedPx > 0) {
        // Draw directly onto proofCanvas so bleed ink extends into the margin.
        // The expanded overlay is (targetW + 2*bleedPx) × (targetH + 2*bleedPx);
        // positioning at (marginPx - bleedPx, marginPx - bleedPx) lands the
        // image-area portion at (marginPx, marginPx) and lets the bleed surround it.
        proofCtx.globalCompositeOperation = 'source-over'
        proofCtx.drawImage(overlayCanvas, marginPx - bleedPx, marginPx - bleedPx)
      } else {
        imgCtx.globalCompositeOperation = 'source-over'
        imgCtx.drawImage(overlayCanvas, 0, 0)
      }
    }

    // Key plate: overprinted on top of all colors only when NOT merged into a
    // color plate above (merge is off, or there's no enabled spot color).
    if (keyCanvas && !keyMergeTarget) {
      const keyImgData = keyCanvas.getContext('2d')!.getImageData(0, 0, targetW, targetH)
      const keyColored = colorizeForOverlay(keyImgData, spotSettings.key!.color)
      const keyOverlay = document.createElement('canvas')
      keyOverlay.width = targetW; keyOverlay.height = targetH
      keyOverlay.getContext('2d')!.putImageData(keyColored, 0, 0)
      imgCtx.globalCompositeOperation = 'source-over'
      imgCtx.drawImage(keyOverlay, 0, 0)
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

  // ── Apply global layer mask ──────────────────────────────────────────────
  // The mask cuts through all rendered layers — applied to imgCanvas before
  // it is composited onto the proof.  Background-bleed layers on proofCanvas
  // are outside the image rect and are intentionally NOT masked (they sit in
  // the margin and bleed area, not the image area proper).
  const ms = options.maskSettings ?? { enabled: false, invert: false, source: 'auto' as const }
  const maskOverlay = await buildMaskOverlay(options.mask ?? null, ms, targetW, targetH)
  if (maskOverlay) applyCutOverlayToCanvas(imgCanvas, maskOverlay)

  // Boundary stroke (keyline) composited on top of the masked artwork.
  const stroke = await buildMaskStroke(
    options.mask ?? null, ms, targetW, targetH,
    Math.round((ms.strokeWidthInches ?? 0) * dpi),
  )
  if (stroke) imgCanvas.getContext('2d')!.drawImage(stroke.colored, 0, 0)

  // ── Wrap in margin ───────────────────────────────────────────────────────
  // proofCanvas was created above (before the mode branches) and already filled
  // white. Background-bleed spot layers were painted directly onto it; all other
  // layers are on imgCanvas and composited here.
  proofCtx.globalCompositeOperation = 'source-over'
  proofCtx.drawImage(imgCanvas, marginPx, marginPx)

  const blob = await new Promise<Blob>((resolve) => {
    proofCanvas.toBlob((b) => resolve(b!), 'image/png')
  })
  const withDpi = await setPngDpi(blob, dpi)
  await platform.exportWithDialog(withDpi, `${toStem(projectName, 'proof')}.png`, [{ name: 'PNG', extensions: ['png'] }])
}

export async function exportPNG(options: ExportOptions): Promise<void> {
  const canvas = await renderFullRes(options)
  const stem = toStem(options.projectName, exportSuffix(options.halftoneSettings))

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), 'image/png')
  })

  const withDpi = await setPngDpi(blob, options.outputSettings.dpi)
  await platform.exportWithDialog(withDpi, `${stem}.png`, [{ name: 'PNG', extensions: ['png'] }])
}

/**
 * Shift a left-aligned label's x so its horizontal span clears a centred
 * alignment-mark zone [centerX ± clearance]. Returns the original x when there
 * is no overlap; otherwise pushes the label fully to the nearer clear side.
 */
function clearCenterMark(x: number, textW: number, centerX: number, clearance: number): number {
  if (x + textW < centerX - clearance || x > centerX + clearance) return x
  return x + textW / 2 <= centerX
    ? centerX - clearance - textW
    : centerX + clearance
}

/**
 * Wrap a rendered channel image (black-on-white, at output resolution) into a
 * full print page: white margin on all sides plus the 0.5" crop-mark waste
 * strip, with crop marks, optional alignment marks, and a staggered plate
 * label — the raster equivalent of an exportPDF page.  Geometry mirrors
 * exportPDF exactly, scaled to pixels via dpi instead of points.
 */
function composeChannelPage(
  channelCanvas: HTMLCanvasElement,
  bleedPx: number,
  outputSettings: OutputSettings,
  label: string,
  labelXFrac: number,
): HTMLCanvasElement {
  const dpi = outputSettings.dpi
  const pxPerPt = dpi / 72
  const margin = (outputSettings.marginInches != null && isFinite(outputSettings.marginInches))
    ? outputSettings.marginInches : 1
  const showCropMarks = outputSettings.cropMarks !== false
  const showMargin = outputSettings.showMargin !== false
  const showAlign = !!outputSettings.alignmentMarks

  const cropPx = showCropMarks ? Math.round(0.5 * dpi) : 0
  const marginPx = showMargin ? Math.round(margin * dpi) : 0
  const imageW = Math.round(outputSettings.widthInches * dpi)
  const imageH = Math.round(outputSettings.heightInches * dpi)

  const pageW = imageW + 2 * marginPx + 2 * cropPx
  const pageH = imageH + 2 * marginPx + 2 * cropPx
  const offX = cropPx + marginPx
  const offY = cropPx + marginPx

  const page = document.createElement('canvas')
  page.width = pageW
  page.height = pageH
  const ctx = page.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, pageW, pageH)

  // Channel image. Bleed plates are larger than the image and shifted outward
  // so their ink runs into the margin on all sides.
  ctx.drawImage(channelCanvas, offX - bleedPx, offY - bleedPx)

  ctx.strokeStyle = '#000000'
  ctx.fillStyle = '#000000'
  // 1.5pt — thick enough to expose/develop reliably on screen emulsion and
  // hold ink through the mesh; thinner hairlines (e.g. 0.5pt) print fine on
  // paper proofs but burn inconsistently depending on mesh count/exposure.
  ctx.lineWidth = Math.max(1, 1.5 * pxPerPt)

  if (showCropMarks) {
    const pieceX0 = cropPx, pieceY0 = cropPx
    const pieceX1 = cropPx + 2 * marginPx + imageW
    const pieceY1 = cropPx + 2 * marginPx + imageH
    const gap = Math.max(3 * pxPerPt, cropPx * 0.12)
    const markLen = Math.min(cropPx - gap - 2 * pxPerPt, cropPx * 0.75)
    const corners: [number, number, number, number][] = [
      [pieceX0, pieceY0, -1, -1],
      [pieceX1, pieceY0, +1, -1],
      [pieceX0, pieceY1, -1, +1],
      [pieceX1, pieceY1, +1, +1],
    ]
    for (const [x, y, dx, dy] of corners) {
      ctx.beginPath(); ctx.moveTo(x + dx * gap, y); ctx.lineTo(x + dx * (gap + markLen), y); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(x, y + dy * gap); ctx.lineTo(x, y + dy * (gap + markLen)); ctx.stroke()
    }
  }

  if (showAlign && cropPx >= 6 * pxPerPt) {
    const half = cropPx / 2
    const radius = Math.min(8 * pxPerPt, cropPx * 0.36)
    const armLen = radius * 1.4
    const cx = offX + imageW / 2
    const cy = offY + imageH / 2
    const positions = [
      { x: cx, y: half },
      { x: cx, y: offY + imageH + marginPx + half },
      { x: half, y: cy },
      { x: offX + imageW + marginPx + half, y: cy },
    ]
    for (const { x, y } of positions) {
      ctx.beginPath(); ctx.arc(x, y, radius, 0, 2 * Math.PI); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(x - armLen, y); ctx.lineTo(x + armLen, y); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(x, y - armLen); ctx.lineTo(x, y + armLen); ctx.stroke()
    }
  }

  // Plate label, staggered across the width so stacked plates don't overlap.
  if (label) {
    const lx = offX + imageW * labelXFrac
    ctx.fillStyle = '#000000'
    ctx.textBaseline = 'middle'
    if (cropPx > 0) {
      // Fill ~55% of the waste strip's height and centre it vertically.
      const fontPx = Math.round(cropPx * 0.55)
      ctx.font = `${fontPx}px sans-serif`
      let tx = lx
      // Keep clear of the top-centre alignment mark (same waste strip).
      if (showAlign && cropPx >= 6 * pxPerPt) {
        const radius = Math.min(8 * pxPerPt, cropPx * 0.36)
        const armLen = radius * 1.4
        const w = ctx.measureText(label).width
        tx = clearCenterMark(lx, w, offX + imageW / 2, armLen + 4 * pxPerPt)
      }
      ctx.fillText(label, tx, cropPx / 2)
    } else {
      // No waste strip — small label centred in the top margin instead.
      const fontPx = Math.max(8, Math.round(8 * pxPerPt))
      ctx.font = `${fontPx}px sans-serif`
      ctx.fillText(label, lx, Math.max(fontPx, marginPx / 2))
    }
  }

  return page
}

export async function exportChannelPNGs(options: ExportOptions): Promise<void> {
  const stem = toStem(options.projectName, exportSuffix(options.halftoneSettings))
  const dpi = options.outputSettings.dpi
  const entries: { name: string; blob: Blob }[] = []

  const pushCanvas = async (canvas: HTMLCanvasElement, name: string) => {
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
    const withDpi = await setPngDpi(blob, dpi)
    entries.push({ name, blob: withDpi })
  }

  if (options.halftoneSettings.colorMode === 'spot') {
    const spotEntries = [...(await renderSpotChannelCanvases(options)).entries()]
    const layerCount = spotEntries.length
    let colorN = 0
    for (let i = 0; i < spotEntries.length; i++) {
      const [id, { canvas, bleedPx }] = spotEntries[i]
      // Special plates keep their own labels; color plates get layer numbers
      // (one/two/three…) counted independently so underbase/key/stroke don't shift them.
      let label: string, slug: string
      if (id === '__underbase__')      { label = 'Underbase';   slug = 'underbase' }
      else if (id === '__key__')       { label = 'Key';         slug = 'key' }
      else if (id === '__maskstroke__'){ label = 'Mask Stroke'; slug = 'mask-stroke' }
      else { colorN++; label = layerWord(colorN); slug = label.toLowerCase() }
      const page = composeChannelPage(canvas, bleedPx ?? 0, options.outputSettings, label, i / layerCount)
      await pushCanvas(page, `${stem}-${slug}.png`)
    }
  } else {
    const channelCanvases = [...(await renderChannelCanvases(options)).entries()]
    const channelNames: Record<string, string> = { c: 'cyan', m: 'magenta', y: 'yellow', k: 'black' }
    const channelLabels: Record<string, string> = { c: 'Cyan', m: 'Magenta', y: 'Yellow', k: 'Black' }
    for (let i = 0; i < channelCanvases.length; i++) {
      const [ch, canvas] = channelCanvases[i]
      const page = composeChannelPage(canvas, 0, options.outputSettings, channelLabels[ch], i / channelCanvases.length)
      await pushCanvas(page, `${stem}-${channelNames[ch]}.png`)
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
  const { halftoneSettings, cmykSettings, outputSettings } = options
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
    const spotCanvases = await renderSpotChannelCanvases(options)
    const spotEntries = [...spotCanvases.entries()]
    // Stagger each plate's label across the image width so that when the
    // printed plates are physically stacked for registration, the labels sit
    // side-by-side rather than overlapping into an unreadable blob.
    const layerCount = spotEntries.length
    const labelStep = imageWPts / Math.max(1, layerCount)
    let first = true
    let colorN = 0

    for (let layerIdx = 0; layerIdx < spotEntries.length; layerIdx++) {
      const [id, { canvas, bleedPx }] = spotEntries[layerIdx]
      if (!first) pdf.addPage([pageW, pageH])
      first = false

      const imgData = canvas.toDataURL('image/png')
      // Background bleed: plate is larger than the image; offset placement so
      // bleed ink extends into the margin area on all sides.
      const bleedPts = bleedPx ? (bleedPx / outputSettings.dpi * 72) : 0
      pdf.addImage(imgData, 'PNG',
        imgOffX - bleedPts, imgOffY - bleedPts,
        imageWPts + 2 * bleedPts, imageHPts + 2 * bleedPts)

      pdf.setTextColor(0)
      // Special plates keep their own labels; color plates get layer numbers
      // counted independently so underbase/key/stroke don't shift them.
      const plateLabel = id === '__underbase__' ? 'Underbase'
        : id === '__key__' ? 'Key'
        : id === '__maskstroke__' ? 'Mask Stroke'
        : layerWord(++colorN)
      const labelX = imgOffX + labelStep * layerIdx
      if (cropMarkPts > 0) {
        // Fill ~55% of the crop-mark waste strip and centre it vertically.
        pdf.setFontSize(Math.round(cropMarkPts * 0.55))
        let tx = labelX
        // Keep clear of the top-centre alignment mark (same waste strip).
        if (showAlignMarks && cropMarkPts >= 6) {
          const radius = Math.min(8, cropMarkPts * 0.36)
          const armLen = radius * 1.4
          const w = pdf.getTextWidth(plateLabel)
          tx = clearCenterMark(labelX, w, imgOffX + imageWPts / 2, armLen + 4)
        }
        pdf.text(plateLabel, tx, cropMarkPts / 2, { baseline: 'middle' })
      } else {
        pdf.setFontSize(8)
        pdf.text(plateLabel, labelX, Math.max(8, marginPts / 2), { baseline: 'middle' })
      }
      if (showCropMarks) drawCropMarks(pdf, pieceX0, pieceY0, pieceX1, pieceY1, cropMarkPts)
      if (showAlignMarks) drawAlignmentMarks(pdf, imgOffX, imgOffY, imageWPts, imageHPts, marginPts, cropMarkPts)
    }
  } else if (halftoneSettings.colorMode === 'cmyk') {
    const channelCanvases = await renderChannelCanvases(options)
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
    // Use vector paths only when no mask is active — the mask overlay is a
    // raster operation and cannot be applied to PDF vector primitives.
    const hasMask = !!(options.maskSettings?.enabled && options.mask)
    const useVector = !hasMask
      && outputSettings.vectorPDF !== false
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
      const canvas = await renderFullRes(options)
      const imgData = canvas.toDataURL('image/png')
      pdf.addImage(imgData, 'PNG', imgOffX, imgOffY, imageWPts, imageHPts)
    }
    if (showCropMarks) drawCropMarks(pdf, pieceX0, pieceY0, pieceX1, pieceY1, cropMarkPts)
  }

  const stem = toStem(options.projectName, exportSuffix(options.halftoneSettings))
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
  // Marks live in the crop-mark waste strip (outside the cut line) so they
  // are removed when the piece is trimmed — never inside the margin.
  if (cropMarkPts < 6) return  // no waste strip to place marks in

  // Centre of each waste strip, at the midpoint of the image edge.
  // imgOffX = cropMarkPts + marginPts, so:
  //   left waste centre  = cropMarkPts / 2
  //   right waste centre = imgOffX + imageWPts + marginPts + cropMarkPts / 2
  const half = cropMarkPts / 2
  const radius = Math.min(8, cropMarkPts * 0.36)
  const armLen = radius * 1.4

  const cx = imgOffX + imageWPts / 2
  const cy = imgOffY + imageHPts / 2

  const positions = [
    { x: cx,                                            y: half },                                          // top
    { x: cx,                                            y: imgOffY + imageHPts + marginPts + half },        // bottom
    { x: half,                                          y: cy },                                            // left
    { x: imgOffX + imageWPts + marginPts + half,        y: cy },                                            // right
  ]

  pdf.setDrawColor(0, 0, 0)
  // 1.5pt — see composeChannelPage for why (burns reliably on screen emulsion).
  pdf.setLineWidth(1.5)

  for (const { x, y } of positions) {
    pdf.circle(x, y, radius, 'S')
    pdf.line(x - armLen, y, x + armLen, y)
    pdf.line(x, y - armLen, x, y + armLen)
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
  // 1.5pt — see composeChannelPage for why (burns reliably on screen emulsion).
  pdf.setLineWidth(1.5)

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

