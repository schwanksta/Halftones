import { HalftoneSettings } from '../types'

/**
 * Apply min/max dot clamp and dot gain compensation to a raw darkness value.
 * Returns null if the mark should be suppressed entirely.
 */
export function applyDotSettings(rawDarkness: number, settings: HalftoneSettings): number | null {
  const minDot = settings.minDot ?? 0
  const maxDot = settings.maxDot ?? 1
  const dotGain = settings.dotGain ?? 0

  if (rawDarkness < minDot) return null
  const clamped = Math.min(rawDarkness, maxDot)
  const dotSize = settings.dotSize ?? 1
  return Math.min(1, clamped * (1 - dotGain) * dotSize)
}
