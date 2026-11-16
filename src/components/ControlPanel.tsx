import {
  HalftoneSettings, CMYKSettings, OutputSettings, ImageTransformSettings, SpotSettings,
  MaskSettings, MaskImage, ColorMode,
} from '../types'
import { Section } from './ui/Section'
import { Segmented } from './ui/Segmented'
import { ImageSection } from './ImageSection'
import { ScreenSection } from './ScreenSection'
import { PrintSection } from './PrintSection'
import { CmykPlates } from './CmykPlates'
import { SpotPlates } from './spot/SpotPlates'

interface Props {
  halftoneSettings: HalftoneSettings
  cmykSettings: CMYKSettings
  spotSettings: SpotSettings
  outputSettings: OutputSettings
  transformSettings: ImageTransformSettings
  hasImage: boolean
  sourceImageData: ImageData | null
  maskSettings: MaskSettings
  mask: MaskImage | null
  onHalftoneChange: (settings: HalftoneSettings) => void
  onCMYKChange: (settings: CMYKSettings) => void
  onSpotChange: (settings: SpotSettings) => void
  onOutputChange: (settings: OutputSettings) => void
  onTransformChange: (settings: ImageTransformSettings) => void
  onMaskSettingsChange: (s: MaskSettings) => void
  onMaskLoad: (m: MaskImage) => void
  onMaskClear: () => void
  seedColors: Array<[number, number, number]>
  onClearSeeds: () => void
  seedPickingActive: boolean
  onToggleSeedPicking: () => void
  editingColorId: string | null
  onToggleEdit: (colorId: string) => void
  hasEdits: (colorId: string) => boolean
  onClearEdits: (colorId: string) => void
  editsStale: boolean
}

const MODES: { value: ColorMode; label: string; title: string }[] = [
  { value: 'grayscale', label: 'Grayscale', title: 'One plate' },
  { value: 'cmyk', label: 'CMYK', title: 'Four process plates' },
  { value: 'spot', label: 'Spot', title: 'One plate per ink' },
]

/**
 * The sidebar, in workflow order: pick a mode, prepare the image, choose the
 * screen, set up the plates, then size it for print.
 */
export function ControlPanel({
  halftoneSettings, cmykSettings, spotSettings, outputSettings, transformSettings,
  hasImage, sourceImageData, maskSettings, mask,
  onHalftoneChange, onCMYKChange, onSpotChange, onOutputChange, onTransformChange,
  onMaskSettingsChange, onMaskLoad, onMaskClear,
  seedColors, onClearSeeds, seedPickingActive, onToggleSeedPicking,
  editingColorId, onToggleEdit, hasEdits, onClearEdits, editsStale,
}: Props) {
  const disabled = !hasImage
  const mode = halftoneSettings.colorMode

  const setMode = (next: ColorMode) => {
    if (next === mode) return
    // Layer editing and seed picking only exist in spot mode — leave them
    // rather than stranding the canvas in a hidden-cursor / pick state.
    if (mode === 'spot') {
      if (editingColorId) onToggleEdit(editingColorId)
      if (seedPickingActive) onToggleSeedPicking()
    }
    onHalftoneChange({ ...halftoneSettings, colorMode: next })
  }

  return (
    <div className="sidebar">
      <div className="mode-switch">
        <Segmented options={MODES} value={mode} onChange={setMode} disabled={disabled} />
      </div>

      <ImageSection
        settings={transformSettings}
        onChange={onTransformChange}
        maskSettings={maskSettings}
        mask={mask}
        outputSettings={outputSettings}
        onMaskSettingsChange={onMaskSettingsChange}
        onMaskLoad={onMaskLoad}
        onMaskClear={onMaskClear}
        disabled={disabled}
      />

      <ScreenSection
        settings={halftoneSettings}
        onChange={onHalftoneChange}
        disabled={disabled}
      />

      {/* Grayscale is a single plate with nothing to configure. */}
      {mode !== 'grayscale' && (
        <Section id="plates" title="Plates">
          {mode === 'cmyk' && (
            <CmykPlates settings={cmykSettings} onChange={onCMYKChange} disabled={disabled} />
          )}
          {mode === 'spot' && (
            <SpotPlates
              settings={spotSettings}
              onChange={onSpotChange}
              sourceImageData={sourceImageData}
              defaultLpi={halftoneSettings.lpi}
              disabled={disabled}
              seedColors={seedColors}
              onClearSeeds={onClearSeeds}
              seedPickingActive={seedPickingActive}
              onToggleSeedPicking={onToggleSeedPicking}
              editingColorId={editingColorId}
              onToggleEdit={onToggleEdit}
              hasEdits={hasEdits}
              onClearEdits={onClearEdits}
              editsStale={editsStale}
            />
          )}
        </Section>
      )}

      <PrintSection
        settings={outputSettings}
        onChange={onOutputChange}
        halftoneSettings={halftoneSettings}
        spotSettings={spotSettings}
        cmykSettings={cmykSettings}
        maskSettings={maskSettings}
        disabled={disabled}
      />
    </div>
  )
}
