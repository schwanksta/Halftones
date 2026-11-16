import type { MouseEvent } from 'react'
import { HalftoneSettings, SpotSettings, ChannelView, CMYKChannel } from '../types'
import { Segmented } from './ui/Segmented'

interface Props {
  halftoneSettings: HalftoneSettings
  spotSettings: SpotSettings
  channelView: ChannelView
  onHalftoneChange: (settings: HalftoneSettings) => void
  onSpotChange: (settings: SpotSettings) => void
  onChannelViewChange: (view: ChannelView) => void
  /** Pointer entered the bar — the canvas hides its brush ring / hover state. */
  onHover?: () => void
}

const CMYK_VIEWS: { value: 'composite' | CMYKChannel; label: string; title: string }[] = [
  { value: 'composite', label: 'All', title: 'Composite of all channels' },
  { value: 'c', label: 'C', title: 'Cyan plate only' },
  { value: 'm', label: 'M', title: 'Magenta plate only' },
  { value: 'y', label: 'Y', title: 'Yellow plate only' },
  { value: 'k', label: 'K', title: 'Black plate only' },
]

const stop = (e: MouseEvent) => e.stopPropagation()

/**
 * Floating bar for settings that only change what you SEE (and the color
 * proof) — never the separated plates: which CMYK channel is shown, the
 * ink/paper preview colors, the spot substrate color and vibrancy.
 */
export function CanvasViewBar({
  halftoneSettings, spotSettings, channelView,
  onHalftoneChange, onSpotChange, onChannelViewChange, onHover,
}: Props) {
  const mode = halftoneSettings.colorMode
  const vibrancy = spotSettings.vibrancy ?? 0

  return (
    <div
      className="canvas-bar canvas-bar--view"
      data-canvas-ui
      onMouseDown={stop}
      onMouseUp={stop}
      onMouseMove={stop}
      onMouseEnter={onHover}
    >
      {mode === 'cmyk' && (
        <label>
          <span className="canvas-bar__muted">View</span>
          <Segmented
            size="sm" fill={false}
            options={CMYK_VIEWS}
            value={channelView.startsWith('spot-') ? null : (channelView as 'composite' | CMYKChannel)}
            onChange={onChannelViewChange}
          />
        </label>
      )}

      {mode === 'grayscale' && (
        <>
          <label title="Ink color — preview only; exports are always black on white">
            <span className="canvas-bar__muted">Ink</span>
            <input
              type="color" className="swatch-input"
              value={halftoneSettings.fgColor || '#000000'}
              onChange={(e) => onHalftoneChange({ ...halftoneSettings, fgColor: e.target.value })}
            />
          </label>
          <label title="Paper color — preview only; exports are always black on white">
            <span className="canvas-bar__muted">Paper</span>
            <input
              type="color" className="swatch-input"
              value={halftoneSettings.bgColor || '#ffffff'}
              onChange={(e) => onHalftoneChange({ ...halftoneSettings, bgColor: e.target.value })}
            />
          </label>
        </>
      )}

      {mode === 'spot' && (
        <>
          <label title="Paper / garment color the preview and color proof composite onto">
            <span className="canvas-bar__muted">Paper</span>
            <input
              type="color" className="swatch-input"
              value={spotSettings.substrate ?? '#ffffff'}
              onChange={(e) => onSpotChange({ ...spotSettings, substrate: e.target.value })}
            />
          </label>
          <label title="Boost each ink's saturation in the on-screen preview and the exported color proof. The separated plates are black-and-white, so this never changes the actual printed output.">
            <span className="canvas-bar__muted">Vibrancy</span>
            <input
              type="range" min={0} max={1} step={0.01}
              value={vibrancy}
              onChange={(e) => onSpotChange({ ...spotSettings, vibrancy: Number(e.target.value) })}
            />
            <span style={{ minWidth: 30, textAlign: 'right' }}>{Math.round(vibrancy * 100)}%</span>
          </label>
        </>
      )}
    </div>
  )
}
