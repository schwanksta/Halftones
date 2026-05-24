import { HalftoneSettings } from '../types'

/**
 * Apply min/max dot clamp and dot gain compensation to a raw darkness value.
 * Returns null if the mark should be suppressed entirely.
 */
export function applyDotSettings(rawDarkness: number, settings: HalftoneSettings): number | null {
  let d = rawDarkness

  // A. Halftone gamma — power curve over the full tonal range.
  //    γ > 1 boosts midtone dot size; γ < 1 flattens it.
  const gamma = settings.halftoneGamma ?? 1
  if (gamma !== 1 && d > 0) d = Math.pow(d, 1 / gamma)

  // C. Shadow / highlight boost — piecewise power on each half of the range,
  //    expanding dot-size variation in dark or light areas independently.
  //    Both controls are 0 (neutral) to 1 (maximum boost).
  const shadowBoost    = settings.shadowBoost    ?? 0
  const highlightBoost = settings.highlightBoost ?? 0

  if (d < 0.5 && highlightBoost > 0) {
    // Highlight half: d ∈ [0, 0.5) — expand toward more ink
    d = Math.pow(d * 2, 1 / (1 + highlightBoost)) * 0.5
  } else if (d >= 0.5 && shadowBoost > 0) {
    // Shadow half: d ∈ [0.5, 1] — expand toward more ink
    d = Math.pow((d - 0.5) * 2, 1 / (1 + shadowBoost)) * 0.5 + 0.5
  }

  // Existing: min/max clamp, dot gain, dot size.
  const minDot  = settings.minDot  ?? 0
  const maxDot  = settings.maxDot  ?? 1
  const dotGain = settings.dotGain ?? 0
  const dotSize = settings.dotSize ?? 1

  if (d < minDot) return null
  const clamped = Math.min(d, maxDot)
  return Math.min(1, clamped * (1 - dotGain) * dotSize)
}
