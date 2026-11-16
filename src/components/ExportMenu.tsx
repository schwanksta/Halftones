import { useState } from 'react'
import {
  SourceImage, HalftoneSettings, CMYKSettings,
  OutputSettings, ImageTransformSettings, SpotSettings,
  MaskSettings, MaskImage,
} from '../types'
import { exportPNG, exportChannelPNGs, exportPDF, exportColorProof } from '../engine/export'
import { EditMasks } from '../engine/layer-edits'
import { Popover } from './ui/Popover'
import { ToggleRow } from './ui/rows'

interface Props {
  source: SourceImage | null
  transformSettings: ImageTransformSettings
  halftoneSettings: HalftoneSettings
  cmykSettings: CMYKSettings
  spotSettings: SpotSettings
  outputSettings: OutputSettings
  /** The PDF options (marks, margin, vector) live in this menu. */
  onOutputChange: (settings: OutputSettings) => void
  projectName: string
  mask?: MaskImage | null
  maskSettings?: MaskSettings
  /** Layer edit masks (layer edit mode) — read at click time so exports match the preview. */
  editMasks?: EditMasks
  /** transformKeyOf() geometry the masks were painted at. */
  editMasksKey?: string | null
}

/** One Export button: every format, with the PDF options next to the PDF export. */
export function ExportMenu({
  source, transformSettings, halftoneSettings,
  cmykSettings, spotSettings, outputSettings, onOutputChange, projectName,
  mask, maskSettings, editMasks, editMasksKey,
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
    editMasks,
    editMasksKey,
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
  const setOutput = (partial: Partial<OutputSettings>) => onOutputChange({ ...outputSettings, ...partial })

  return (
    <Popover
      label={exporting ? 'Exporting…' : 'Export ▾'}
      align="right"
      buttonClassName="btn--primary"
      disabled={!!exporting}
    >
      {(close) => (
        <>
          <button
            className="menu-item"
            onClick={() => { close(); handleExport('pdf', () => exportPDF(options)) }}
            disabled={isSpot && !hasSpotColors}
          >
            PDF
            <small>{isSpot ? 'One page per plate, ready to print' : isCmyk ? 'One page per channel, ready to print' : 'Print-ready page'}</small>
          </button>
          <div className="menu-options">
            <ToggleRow
              label="Crop marks"
              checked={outputSettings.cropMarks !== false}
              onChange={(cropMarks) => setOutput({ cropMarks })}
            />
            <ToggleRow
              label="Margin"
              checked={outputSettings.showMargin !== false}
              onChange={(showMargin) => setOutput({ showMargin })}
            />
            <ToggleRow
              label="Alignment marks"
              checked={!!outputSettings.alignmentMarks}
              onChange={(alignmentMarks) => setOutput({ alignmentMarks })}
            />
            <ToggleRow
              label="Vector dots/lines"
              checked={outputSettings.vectorPDF !== false}
              onChange={(vectorPDF) => setOutput({ vectorPDF })}
            />
          </div>

          {(isCmyk || (isSpot && hasSpotColors)) && (
            <button
              className="menu-item"
              onClick={() => { close(); handleExport('channels', () => exportChannelPNGs(options)) }}
            >
              Channel PNGs
              <small>{isSpot ? 'One PNG per spot color (flat or halftone per channel)' : 'One PNG per CMYK channel'}</small>
            </button>
          )}

          {/* In spot mode, a single PNG is less useful — leave it out to keep the menu clean */}
          {!isSpot && (
            <button
              className="menu-item"
              onClick={() => { close(); handleExport('png', () => exportPNG(options)) }}
            >
              PNG
              <small>Single image at output resolution</small>
            </button>
          )}

          <button
            className="menu-item"
            onClick={() => { close(); handleExport('proof', () => exportColorProof(options)) }}
          >
            Color proof
            <small>Full-colour image at output resolution with margin — use as a print reference</small>
          </button>
        </>
      )}
    </Popover>
  )
}
