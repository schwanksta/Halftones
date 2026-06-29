import { HalftoneSettings, CMYKSettings, OutputSettings, ImageTransformSettings, ChannelView, SpotSettings, MaskSettings, MaskImage } from '../types'
import { HalftoneControls } from './HalftoneControls'
import { CMYKControls } from './CMYKControls'
import { OutputControls } from './OutputControls'
import { TransformControls } from './TransformControls'
import { SpotColorEditor } from './SpotColorEditor'
import { MaskControls } from './MaskControls'
import { PrintPlan } from './PrintPlan'

interface Props {
  halftoneSettings: HalftoneSettings
  cmykSettings: CMYKSettings
  spotSettings: SpotSettings
  outputSettings: OutputSettings
  transformSettings: ImageTransformSettings
  channelView: ChannelView
  hasImage: boolean
  sourceAspect: number | null
  sourceImageData: ImageData | null
  maskSettings: MaskSettings
  mask: MaskImage | null
  onHalftoneChange: (settings: HalftoneSettings) => void
  onCMYKChange: (settings: CMYKSettings) => void
  onSpotChange: (settings: SpotSettings) => void
  onOutputChange: (settings: OutputSettings) => void
  onTransformChange: (settings: ImageTransformSettings) => void
  onChannelViewChange: (view: ChannelView) => void
  onMaskSettingsChange: (s: MaskSettings) => void
  onMaskLoad: (m: MaskImage) => void
  onMaskClear: () => void
  seedColors: Array<[number, number, number]>
  onClearSeeds: () => void
  seedPickingActive: boolean
  onToggleSeedPicking: () => void
}

export function ControlPanel({
  halftoneSettings,
  cmykSettings,
  spotSettings,
  outputSettings,
  transformSettings,
  channelView,
  hasImage,
  sourceAspect,
  sourceImageData,
  maskSettings,
  mask,
  onHalftoneChange,
  onCMYKChange,
  onSpotChange,
  onOutputChange,
  onTransformChange,
  onChannelViewChange,
  onMaskSettingsChange,
  onMaskLoad,
  onMaskClear,
  seedColors,
  onClearSeeds,
  seedPickingActive,
  onToggleSeedPicking,
}: Props) {
  return (
    <div className="sidebar">
      <HalftoneControls
        settings={halftoneSettings}
        onChange={onHalftoneChange}
        disabled={!hasImage}
      />
      {halftoneSettings.colorMode === 'cmyk' && (
        <CMYKControls
          settings={cmykSettings}
          channelView={channelView}
          onSettingsChange={onCMYKChange}
          onChannelViewChange={onChannelViewChange}
          disabled={!hasImage}
        />
      )}
      {halftoneSettings.colorMode === 'spot' && (
        <SpotColorEditor
          settings={spotSettings}
          onChange={onSpotChange}
          sourceImageData={sourceImageData}
          defaultLpi={halftoneSettings.lpi}
          disabled={!hasImage}
          seedColors={seedColors}
          onClearSeeds={onClearSeeds}
          seedPickingActive={seedPickingActive}
          onToggleSeedPicking={onToggleSeedPicking}
        />
      )}
      <TransformControls
        settings={transformSettings}
        onChange={onTransformChange}
        disabled={!hasImage}
      />
      <OutputControls
        settings={outputSettings}
        sourceAspect={sourceAspect}
        onChange={onOutputChange}
        disabled={!hasImage}
      />
      <PrintPlan
        halftoneSettings={halftoneSettings}
        spotSettings={spotSettings}
        cmykSettings={cmykSettings}
        outputSettings={outputSettings}
        maskSettings={maskSettings}
        disabled={!hasImage}
      />
      <MaskControls
        maskSettings={maskSettings}
        mask={mask}
        outputSettings={outputSettings}
        onMaskSettingsChange={onMaskSettingsChange}
        onMaskLoad={onMaskLoad}
        onMaskClear={onMaskClear}
        disabled={!hasImage}
      />
    </div>
  )
}
