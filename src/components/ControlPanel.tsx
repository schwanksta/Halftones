import { HalftoneSettings, CMYKSettings, OutputSettings, ImageTransformSettings, ChannelView, SpotSettings } from '../types'
import { HalftoneControls } from './HalftoneControls'
import { CMYKControls } from './CMYKControls'
import { OutputControls } from './OutputControls'
import { TransformControls } from './TransformControls'
import { SpotColorEditor } from './SpotColorEditor'

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
  onHalftoneChange: (settings: HalftoneSettings) => void
  onCMYKChange: (settings: CMYKSettings) => void
  onSpotChange: (settings: SpotSettings) => void
  onOutputChange: (settings: OutputSettings) => void
  onTransformChange: (settings: ImageTransformSettings) => void
  onChannelViewChange: (view: ChannelView) => void
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
  onHalftoneChange,
  onCMYKChange,
  onSpotChange,
  onOutputChange,
  onTransformChange,
  onChannelViewChange,
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
    </div>
  )
}
