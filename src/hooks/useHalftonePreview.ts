import { useEffect, useRef, useCallback, useMemo, useState } from 'react'
import {
  HalftoneSettings, CMYKSettings, SourceImage,
  ImageTransformSettings, OutputSettings, SpotSettings,
  MaskSettings, MaskImage,
} from '../types'
import { renderHalftone } from '../engine/halftone'
import { renderStipple } from '../engine/stipple'
import { renderFlat, computeSpotLabels, buildSpotChannels, boostSaturation } from '../engine/spot-separation'
import { computeEdgeMask, computeAlphaBoundaryMask, applyEdgeMaskToCanvas } from '../engine/edge'
import { separateChannels, compositeChannels } from '../engine/cmyk'
import { applyTransforms } from '../engine/transform'
import { dilateMask } from '../engine/dilate'
import { buildMaskOverlay, extractOverlayRegion } from '../engine/mask'
import type { ChannelView } from '../types'
import type { Viewport } from './useCanvasTransform'

const STIPPLE_MAX_PX = 1200

interface PreviewOptions {
  source: SourceImage | null
  transformSettings: ImageTransformSettings
  halftoneSettings: HalftoneSettings
  cmykSettings: CMYKSettings
  spotSettings: SpotSettings
  channelView: ChannelView
  outputSettings: OutputSettings
  viewport: Viewport
  mask: MaskImage | null
  maskSettings?: MaskSettings
}

function invertImageData(img: ImageData) {
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]
  }
}

const GUTTER_COLOR = '#8a8a8a'

/**
 * Convert a black-on-white rendered channel into a colored RGBA layer.
 * 0 (ink) → fully opaque spot color.  255 (paper) → transparent.
 */
function colorizeSpot(rendered: ImageData, hex: string): ImageData {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const { data, width, height } = rendered
  const out = new Uint8ClampedArray(data.length)
  for (let i = 0; i < width * height; i++) {
    const v = data[i * 4]
    out[i * 4]     = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    out[i * 4 + 3] = 255 - v   // 0=ink→255 alpha, 255=paper→0 alpha
  }
  return new ImageData(out, width, height)
}

function extractRegionFromCanvas(
  srcCanvas: HTMLCanvasElement,
  srcX: number, srcY: number, srcW: number, srcH: number,
  targetW: number, targetH: number,
  bgColor = '#ffffff',
): ImageData {
  const dst = document.createElement('canvas')
  dst.width = targetW; dst.height = targetH
  const dstCtx = dst.getContext('2d')!

  dstCtx.fillStyle = bgColor
  dstCtx.fillRect(0, 0, targetW, targetH)

  const clampedSrcX  = Math.max(0, srcX)
  const clampedSrcY  = Math.max(0, srcY)
  const clampedSrcX2 = Math.min(srcCanvas.width,  srcX + srcW)
  const clampedSrcY2 = Math.min(srcCanvas.height, srcY + srcH)
  if (clampedSrcX2 <= clampedSrcX || clampedSrcY2 <= clampedSrcY) {
    return dstCtx.getImageData(0, 0, targetW, targetH)
  }

  const scaleX = targetW / srcW, scaleY = targetH / srcH
  dstCtx.drawImage(
    srcCanvas,
    clampedSrcX, clampedSrcY, clampedSrcX2 - clampedSrcX, clampedSrcY2 - clampedSrcY,
    (clampedSrcX - srcX) * scaleX, (clampedSrcY - srcY) * scaleY,
    (clampedSrcX2 - clampedSrcX) * scaleX, (clampedSrcY2 - clampedSrcY) * scaleY,
  )
  return dstCtx.getImageData(0, 0, targetW, targetH)
}

export function useHalftonePreview(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  options: PreviewOptions
) {
  const {
    source, transformSettings, halftoneSettings,
    cmykSettings, spotSettings, channelView, outputSettings, viewport,
    mask, maskSettings,
  } = options
  const rafRef = useRef(0)

  const transformed = useMemo(() => {
    if (!source) return null
    return applyTransforms(source.imageData, transformSettings)
  }, [source, transformSettings])

  const transformedCanvas = useMemo(() => {
    if (!transformed) return null
    const c = document.createElement('canvas')
    c.width = transformed.width; c.height = transformed.height
    c.getContext('2d')!.putImageData(transformed, 0, 0)
    return c
  }, [transformed])

  // ── Stipple ────────────────────────────────────────────────────────────────

  const stippleCanvas = useMemo(() => {
    if (!transformed || !transformedCanvas || halftoneSettings.pattern !== 'stipple') return null
    const maxDim = Math.max(transformed.width, transformed.height)
    const scale  = Math.min(1, STIPPLE_MAX_PX / maxDim)
    const sw = Math.max(1, Math.round(transformed.width  * scale))
    const sh = Math.max(1, Math.round(transformed.height * scale))

    const srcCanvas = document.createElement('canvas')
    srcCanvas.width = sw; srcCanvas.height = sh
    srcCanvas.getContext('2d')!.drawImage(transformedCanvas, 0, 0, sw, sh)
    const scaledSource = srcCanvas.getContext('2d')!.getImageData(0, 0, sw, sh)
    const cellSize = (sw / outputSettings.widthInches) / halftoneSettings.lpi

    const rawFg = halftoneSettings.fgColor || '#000000'
    const rawBg = halftoneSettings.bgColor || '#ffffff'
    const fg = halftoneSettings.invert ? rawBg : rawFg
    const bg = halftoneSettings.invert ? rawFg : rawBg

    const c = document.createElement('canvas')
    c.width = sw; c.height = sh
    renderStipple(c.getContext('2d')!, scaledSource, cellSize, halftoneSettings, fg, bg)
    return c
  }, [transformed, transformedCanvas, halftoneSettings, outputSettings])

  // ── Spot separation ────────────────────────────────────────────────────────
  //
  // PERF: separateSpotChannels is O(pixels × numColors) and must NOT re-run
  // when only rendering properties change (threshold, angle, lpi, hex, etc.).
  // We derive a stable string key from just the parts that affect separation:
  // color IDs and LAB values.  Rendering properties are excluded from this key.

  const spotSeparationKey = useMemo(
    // Background colors use alpha separation — their LAB is irrelevant, so we
    // use ':bg' to avoid spurious re-separations when only the display hex changes.
    () => spotSettings.colors.map(c =>
      c.type === 'background' ? `${c.id}:bg` : `${c.id}:${c.lab.join(',')}`
    ).join('|'),
    [spotSettings.colors],
  )

  // Expensive LAB classification — gated only by color IDs + LAB values.
  const spotLabels = useMemo(() => {
    if (!transformed || halftoneSettings.colorMode !== 'spot' || !spotSettings.colors.length) {
      return null
    }
    // Classify ALL colors (including disabled) so each pixel is claimed by its
    // true nearest color.  Disabled colors are simply not rendered later.
    return computeSpotLabels(transformed, spotSettings.colors)
    // spotSeparationKey intentionally stands in for spotSettings.colors —
    // only LAB values + IDs gate re-classification.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transformed, halftoneSettings.colorMode, spotSeparationKey])

  // Build per-color channels from the partition, applying joint smoothing.
  // Cheap relative to classification, so retuning smoothing doesn't re-run LAB.
  const spotChannels = useMemo(() => {
    if (!spotLabels) return null
    return buildSpotChannels(spotLabels, (spotSettings.smoothing ?? 0) / 100)
  }, [spotLabels, spotSettings.smoothing])

  // ── Spot channel canvases ──────────────────────────────────────────────────
  //
  // Convert per-color ImageData separations into HTMLCanvasElements so the
  // render loop can call extractRegionFromCanvas on them.  Rendering (halftone
  // or flat) happens inside the hot render loop at viewport DPI, which makes
  // dots correctly rescale with zoom instead of being drawImage-scaled from a
  // fixed source-resolution pre-render.

  const spotChannelCanvases = useMemo(() => {
    if (!spotChannels) return null
    const result = new Map<string, HTMLCanvasElement>()
    for (const [id, data] of spotChannels) {
      const c = document.createElement('canvas')
      c.width = data.width; c.height = data.height
      c.getContext('2d')!.putImageData(data, 0, 0)
      result.set(id, c)
    }
    return result
  }, [spotChannels])

  // ── Alpha boundary outline canvas ─────────────────────────────────────────
  //
  // Computed at full source resolution (so alpha channel is intact), then
  // extracted to viewport coordinates at render time — same pattern as
  // spotChannelCanvases.  Memoized so the dilation only re-runs when the
  // source image or outline settings change, not on every frame.

  const alphaOutlineCanvas = useMemo(() => {
    if (!transformed || halftoneSettings.colorMode !== 'spot') return null
    if (!spotSettings.key?.outlineEnabled) return null
    // Use outlineWidth directly as source-image pixels — no output-settings
    // conversion needed, and crucially no dependency on widthInches (which can
    // briefly be 0 while the user is typing, causing Infinity dilation).
    const outlineWidthSourcePx = spotSettings.key.outlineWidth ?? 3
    const alphaMask = computeAlphaBoundaryMask(transformed, outlineWidthSourcePx)
    const c = document.createElement('canvas')
    c.width = transformed.width; c.height = transformed.height
    c.getContext('2d')!.putImageData(alphaMask, 0, 0)
    return c
  }, [transformed, halftoneSettings.colorMode, spotSettings.key])

  // ── Mask overlay canvas ────────────────────────────────────────────────────
  //
  // Built asynchronously at source resolution (same dimensions as transformed),
  // then a viewport region is extracted per frame in the render callback.
  // The overlay has opaque-white in cut areas and transparent in keep areas.
  // Drawn with drawImage over each rendered plate to white out cut regions.

  const [maskOverlayCanvas, setMaskOverlayCanvas] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => {
    // Key: stable string over everything that affects the overlay pixels
    const enabled = maskSettings?.enabled && !!mask
    if (!enabled || !transformed) {
      setMaskOverlayCanvas(null)
      return
    }
    let cancelled = false
    buildMaskOverlay(mask!, maskSettings!, transformed.width, transformed.height)
      .then((overlay) => { if (!cancelled) setMaskOverlayCanvas(overlay) })
      .catch((err) => { console.error('Mask overlay build failed:', err); if (!cancelled) setMaskOverlayCanvas(null) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mask, maskSettings?.enabled, maskSettings?.invert, maskSettings?.source, transformed])

  // ── Render ─────────────────────────────────────────────────────────────────

  const render = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !transformed || !transformedCanvas) {
      if (canvas) canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
      return
    }

    const canvasW = canvas.width
    const canvasH = canvas.height
    if (canvasW === 0 || canvasH === 0) return

    const srcX = viewport.panX
    const srcY = viewport.panY
    const srcW = canvasW / viewport.zoom
    const srcH = canvasH / viewport.zoom

    const sourcePixelsPerInch = transformed.width / outputSettings.widthInches
    const renderDpi = viewport.zoom * sourcePixelsPerInch

    const rawFg = halftoneSettings.fgColor || '#000000'
    const rawBg = halftoneSettings.bgColor || '#ffffff'
    const bgColor = halftoneSettings.invert ? rawFg : rawBg

    const radialCenter = {
      x: (transformed.width  * (halftoneSettings.radialOriginX ?? 0.5) - srcX) * viewport.zoom,
      y: (transformed.height * (halftoneSettings.radialOriginY ?? 0.5) - srcY) * viewport.zoom,
    }

    const regionData = extractRegionFromCanvas(
      transformedCanvas, srcX, srcY, srcW, srcH, canvasW, canvasH, bgColor,
    )

    const ctx = canvas.getContext('2d')!
    const offscreen = document.createElement('canvas')
    offscreen.width = canvasW; offscreen.height = canvasH
    const offCtx = offscreen.getContext('2d')!

    if (halftoneSettings.colorMode === 'cmyk') {
      const channels = separateChannels(regionData)
      const channelKeys = ['c', 'm', 'y', 'k'] as const
      const rendered: Record<string, ImageData> = {}

      for (const ch of channelKeys) {
        if (!cmykSettings[ch].enabled) continue
        const chCanvas = document.createElement('canvas')
        chCanvas.width = canvasW; chCanvas.height = canvasH
        const chCtx = chCanvas.getContext('2d')!
        renderHalftone(chCtx, {
          source: channels[ch],
          settings: { ...halftoneSettings, angle: cmykSettings[ch].angle, lpi: cmykSettings[ch].lpi },
          renderDpi, radialCenter, outputDpi: outputSettings.dpi,
        })
        rendered[ch] = chCtx.getImageData(0, 0, canvasW, canvasH)
      }

      if (channelView === 'composite') {
        const composite = compositeChannels(rendered, canvasW, canvasH, cmykSettings)
        if (halftoneSettings.invert) invertImageData(composite)
        offCtx.putImageData(composite, 0, 0)
      } else {
        const chData = rendered[channelView as string]
        if (chData) offCtx.putImageData(chData, 0, 0)
      }

    } else if (halftoneSettings.colorMode === 'spot') {
      // Spot mode: fill background, render color channels, then key plate.
      offCtx.fillStyle = bgColor
      offCtx.fillRect(0, 0, canvasW, canvasH)

      // Spot color channels — only when separation is available.
      if (spotSettings.colors.length > 0 && spotChannelCanvases) {
        const globalTrap = spotSettings.trap ?? 0

        for (const color of spotSettings.colors) {
          if (!color.enabled) continue
          const chCanvas = spotChannelCanvases.get(color.id)
          if (!chCanvas) continue

          // Bleed: for background-type colors, expand the channel canvas outward
          // by bleedSourcePx on each side (filled with black = full ink) before
          // extracting the viewport region.  This way flat fill and halftone dots
          // naturally extend into the bleed area — no seam, and halftone patterns
          // continue through the bleed just like the rest of the background.
          const bleedSourcePx = color.type === 'background' && (color.bleedInches ?? 0) > 0
            ? Math.round(color.bleedInches! * sourcePixelsPerInch)
            : 0

          let effectiveChCanvas = chCanvas
          let chSrcX = srcX, chSrcY = srcY
          if (bleedSourcePx > 0) {
            const expW = chCanvas.width  + 2 * bleedSourcePx
            const expH = chCanvas.height + 2 * bleedSourcePx
            const expCanvas = document.createElement('canvas')
            expCanvas.width = expW; expCanvas.height = expH
            const expCtx = expCanvas.getContext('2d')!
            expCtx.fillStyle = '#000000'             // bleed border = full ink
            expCtx.fillRect(0, 0, expW, expH)
            expCtx.drawImage(chCanvas, bleedSourcePx, bleedSourcePx)
            effectiveChCanvas = expCanvas
            // Shift extraction coords: source (x,y) is now at expanded (x+bleedSourcePx, y+bleedSourcePx)
            chSrcX = srcX + bleedSourcePx
            chSrcY = srcY + bleedSourcePx
          }

          // Extract the viewport region. Always use white as bgColor — the
          // expanded canvas already has the black bleed border built in, so
          // anything beyond that (further into the margin) should be no-ink.
          const chRegionData = extractRegionFromCanvas(
            effectiveChCanvas, chSrcX, chSrcY, srcW, srcH, canvasW, canvasH, '#ffffff',
          )

          // Render black-on-white at viewport DPI
          const bwCanvas = document.createElement('canvas')
          bwCanvas.width = canvasW; bwCanvas.height = canvasH
          const bwCtx = bwCanvas.getContext('2d')!
          if (color.renderMode === 'flat') {
            renderFlat(bwCtx, chRegionData, color.threshold)
          } else {
            renderHalftone(bwCtx, {
              source: chRegionData,
              settings: { ...halftoneSettings, angle: color.angle, lpi: color.lpi, fgColor: '#000000', bgColor: '#ffffff' },
              renderDpi,
              radialCenter,
              outputDpi: outputSettings.dpi,
            })
          }

          // Trap: dilate the BW mask so this layer's ink spreads outward and
          // bleeds under adjacent layers, hiding seams between halftone/flat.
          // Per-color override (including 0) wins over the global value.
          const effTrap = color.trap ?? globalTrap
          // The trap value is in output-DPI pixels for physical WYSIWYG; scale
          // down to viewport pixels for preview.  Enforce a 1-px minimum when
          // trap > 0 so the effect is always visible at any zoom level.
          const previewTrap = effTrap > 0
            ? Math.max(1, Math.round(effTrap * renderDpi / outputSettings.dpi))
            : 0
          const maskCanvas = previewTrap > 0 ? dilateMask(bwCanvas, previewTrap) : bwCanvas

          // Colorize and composite (ink → spot color opaque, paper → transparent)
          const displayHex = boostSaturation(color.hex, spotSettings.vibrancy ?? 0)
          const maskData = maskCanvas.getContext('2d')!.getImageData(0, 0, canvasW, canvasH)
          const colored = colorizeSpot(maskData, displayHex)
          const colorCanvas = document.createElement('canvas')
          colorCanvas.width = canvasW; colorCanvas.height = canvasH
          colorCanvas.getContext('2d')!.putImageData(colored, 0, 0)
          offCtx.drawImage(colorCanvas, 0, 0)
        }
      }

      // Key plate: halftone of the full image overprinted on top of all colors.
      // Rendered independently — does not require spot colors to be present.
      if (spotSettings.key?.enabled) {
        const key = spotSettings.key
        const keyRegion = extractRegionFromCanvas(
          transformedCanvas, srcX, srcY, srcW, srcH, canvasW, canvasH, '#ffffff',
        )
        const keyBwCanvas = document.createElement('canvas')
        keyBwCanvas.width = canvasW; keyBwCanvas.height = canvasH
        const keyBwCtx = keyBwCanvas.getContext('2d')!
        if (key.dotsEnabled !== false) {
          renderHalftone(keyBwCtx, {
            source: keyRegion,
            settings: {
              ...halftoneSettings,
              lpi: key.lpi,
              angle: key.angle,
              minDot: key.minDot,
              maxDot: key.maxDot,
              fgColor: '#000000',
              bgColor: '#ffffff',
              invert: false,
            },
            renderDpi,
            radialCenter,
            outputDpi: outputSettings.dpi,
          })
        } else {
          // No dots — fill white so strokes composite correctly
          keyBwCtx.fillStyle = '#ffffff'
          keyBwCtx.fillRect(0, 0, canvasW, canvasH)
        }

        // Edge stroke: overlay Sobel contour lines on the key plate halftone.
        if (key.strokeEnabled) {
          const edgeMask = computeEdgeMask(keyRegion, key.strokeThreshold ?? 0.3)
          // strokeWidth is in output-DPI pixels; scale to viewport pixels, min 1
          const outStrokePx = key.strokeWidth ?? 2
          const previewStrokePx = outStrokePx > 0
            ? Math.max(1, Math.round(outStrokePx * renderDpi / outputSettings.dpi))
            : 0

          let edgeToDraw: ImageData = edgeMask
          if (previewStrokePx > 1) {
            const edgeTmp = document.createElement('canvas')
            edgeTmp.width = canvasW; edgeTmp.height = canvasH
            edgeTmp.getContext('2d')!.putImageData(edgeMask, 0, 0)
            const dilated = dilateMask(edgeTmp, previewStrokePx)
            edgeToDraw = dilated.getContext('2d')!.getImageData(0, 0, canvasW, canvasH)
          }
          applyEdgeMaskToCanvas(keyBwCanvas, edgeToDraw)
        }

        // Alpha boundary outline: solid ring around the subject silhouette.
        // Computed at source resolution (memoized), extracted to viewport here.
        if (key.outlineEnabled && alphaOutlineCanvas) {
          const outlineViewport = extractRegionFromCanvas(
            alphaOutlineCanvas, srcX, srcY, srcW, srcH, canvasW, canvasH, '#ffffff',
          )
          applyEdgeMaskToCanvas(keyBwCanvas, outlineViewport)
        }

        const keyImgData = keyBwCtx.getImageData(0, 0, canvasW, canvasH)
        const keyColored = colorizeSpot(keyImgData, key.color)
        const keyOverlay = document.createElement('canvas')
        keyOverlay.width = canvasW; keyOverlay.height = canvasH
        keyOverlay.getContext('2d')!.putImageData(keyColored, 0, 0)
        offCtx.drawImage(keyOverlay, 0, 0)
      }

    } else {
      renderHalftone(offCtx, {
        source: regionData,
        settings: halftoneSettings,
        renderDpi, radialCenter, outputDpi: outputSettings.dpi,
      })
    }

    // ── Apply global layer mask ────────────────────────────────────────────
    // The mask overlay is built at source resolution (same as transformed).
    // Here we extract the viewport region — matching the srcX/srcY/srcW/srcH
    // region used for all other per-frame channel extractions — and draw it
    // over the offscreen canvas.  Cut areas (opaque white in the overlay)
    // overwrite whatever ink was there with paper color.  Keep areas are
    // transparent, leaving the rendered content untouched.
    if (maskOverlayCanvas) {
      const overlayRegion = extractOverlayRegion(
        maskOverlayCanvas, srcX, srcY, srcW, srcH, canvasW, canvasH,
      )
      offCtx.drawImage(overlayRegion, 0, 0)
    }

    // ── Composite onto main canvas ─────────────────────────────────────────
    ctx.fillStyle = GUTTER_COLOR
    ctx.fillRect(0, 0, canvasW, canvasH)

    const marginSrcPx = (outputSettings.marginInches ?? 0) * sourcePixelsPerInch
    const pieceLeft   = (-srcX - marginSrcPx) * viewport.zoom
    const pieceTop    = (-srcY - marginSrcPx) * viewport.zoom
    const pieceRight  = (transformed.width  - srcX + marginSrcPx) * viewport.zoom
    const pieceBottom = (transformed.height - srcY + marginSrcPx) * viewport.zoom

    ctx.save()
    ctx.beginPath()
    ctx.rect(pieceLeft, pieceTop, pieceRight - pieceLeft, pieceBottom - pieceTop)
    ctx.clip()

    if (halftoneSettings.pattern === 'stipple' && stippleCanvas && halftoneSettings.colorMode !== 'spot') {
      const dx = -srcX * viewport.zoom
      const dy = -srcY * viewport.zoom
      const dw =  transformed.width  * viewport.zoom
      const dh =  transformed.height * viewport.zoom
      ctx.drawImage(stippleCanvas, dx, dy, dw, dh)
      // Apply mask overlay on top of the stipple render
      if (maskOverlayCanvas) {
        const overlayRegion = extractOverlayRegion(
          maskOverlayCanvas, srcX, srcY, srcW, srcH, canvasW, canvasH,
        )
        ctx.drawImage(overlayRegion, 0, 0)
      }
    } else {
      ctx.drawImage(offscreen, 0, 0)
    }

    ctx.restore()
  }, [
    canvasRef, transformed, transformedCanvas, stippleCanvas,
    spotSettings.colors, spotSettings.vibrancy, spotSettings.trap, spotSettings.key,
    spotChannelCanvases, alphaOutlineCanvas,
    maskOverlayCanvas,
    halftoneSettings, cmykSettings, channelView, outputSettings, viewport,
  ])

  useEffect(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(render)
    return () => cancelAnimationFrame(rafRef.current)
  }, [render])
}
