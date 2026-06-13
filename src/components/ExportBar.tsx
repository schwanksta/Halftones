import { useState } from 'react'
import {
  SourceImage, HalftoneSettings, CMYKSettings,
  OutputSettings, ImageTransformSettings, SpotSettings,
  MaskSettings, MaskImage,
} from '../types'
import { exportPNG, exportChannelPNGs, exportPDF, exportColorProof } from '../engine/export'

interface Props {
  source: SourceImage | null
  transformSettings: ImageTransformSettings
  halftoneSettings: HalftoneSettings
  cmykSettings: CMYKSettings
  spotSettings: SpotSettings
  outputSettings: OutputSettings
  projectName: string
  mask?: MaskImage | null
  maskSettings?: MaskSettings
}

export function ExportBar({
  source, transformSettings, halftoneSettings,
  cmykSettings, spotSettings, outputSettings, projectName,
  mask, maskSettings,
}: Props) {
  const [exporting, setExporting] = useState<string | null>(null)

  if (!source) return null

  const options = {
    source: source.imageData,
    transformSettings,
    halftoneSettings,
    cmykSettings,
    spotSettings,
    outputSettings,
    projectName,
    mask: mask ?? null,
    maskSettings,
  }

  const handleExport = async (format: string, fn: () => Promise<void>) => {
    setExporting(format)
    try {
      await fn()
    } catch (err) {
      console.error(`Export failed:`, err)
    } finally {
      setExporting(null)
    }
  }

  const isSpot = halftoneSettings.colorMode === 'spot'
  const isCmyk = halftoneSettings.colorMode === 'cmyk'
  const hasSpotColors = spotSettings.colors.some((c) => c.enabled)

  return (
    <>
      {/* In spot mode, single PNG is less useful — hide it to keep the bar clean */}
      {!isSpot && (
        <button
          onClick={() => handleExport('png', () => exportPNG(options))}
          disabled={!!exporting}
        >
          {exporting === 'png' ? 'Exporting…' : 'Export PNG'}
        </button>
      )}

      {(isCmyk || (isSpot && hasSpotColors)) && (
        <button
          onClick={() => handleExport('channels', () => exportChannelPNGs(options))}
          disabled={!!exporting}
          title={isSpot ? 'One PNG per spot color (flat or halftone per channel)' : 'One PNG per CMYK channel'}
        >
          {exporting === 'channels' ? 'Exporting…' : 'Export Channels'}
        </button>
      )}

      <button
        onClick={() => handleExport('pdf', () => exportPDF(options))}
        disabled={!!exporting || (isSpot && !hasSpotColors)}
        title={isSpot ? 'One PDF page per spot color' : undefined}
      >
        {exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}
      </button>

      <button
        onClick={() => handleExport('proof', () => exportColorProof(options))}
        disabled={!!exporting}
        title="Full-colour image at output resolution with margin — use as a print reference"
      >
        {exporting === 'proof' ? 'Exporting…' : 'Color Proof'}
      </button>
    </>
  )
}
