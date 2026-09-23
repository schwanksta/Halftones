import { describe, expect, it } from 'vitest'
import { applyDotSettings } from './dot-settings'
import { FRAG_PRELUDE } from './webgl/shared.glsl'
import { DEFAULT_HALFTONE_SETTINGS, HalftoneSettings } from '../types'

type ToneParams = Pick<HalftoneSettings,
  'minDot' | 'maxDot' | 'dotGain' | 'dotSize' | 'halftoneGamma' | 'shadowBoost' | 'highlightBoost'>

/**
 * Transliterate the GLSL applyDotSettings() from shared.glsl.ts into a JS
 * function so the shader's actual source is checked against the CPU version.
 * Uniforms become function parameters; -1.0 is the shader's "suppressed" sentinel.
 */
function glslApplyDotSettings(): (raw: number, p: ToneParams) => number | null {
  const match = FRAG_PRELUDE.match(/float applyDotSettings\(float rawDarkness\) \{([\s\S]*?)\n\}/)
  if (!match) throw new Error('applyDotSettings() not found in FRAG_PRELUDE')
  const body = match[1]
    .replace(/\/\/.*$/gm, '')
    .replace(/\bfloat (\w+)\s*=/g, 'let $1 =')
    .replace(/\b(pow|min|max)\(/g, 'Math.$1(')
  const uniforms = ['uMinDot', 'uMaxDot', 'uDotGain', 'uDotSize', 'uHalftoneGamma', 'uShadowBoost', 'uHighlightBoost']
  const fn = new Function('rawDarkness', ...uniforms, body) as (...args: number[]) => number
  return (raw, p) => {
    const out = fn(raw, p.minDot, p.maxDot, p.dotGain, p.dotSize, p.halftoneGamma ?? 1, p.shadowBoost ?? 0, p.highlightBoost ?? 0)
    return out === -1 ? null : out
  }
}

const settings = (p: Partial<ToneParams>): HalftoneSettings => ({ ...DEFAULT_HALFTONE_SETTINGS, ...p })

describe('applyDotSettings', () => {
  it('is the identity with default settings', () => {
    const s = settings({ minDot: 0, maxDot: 1, dotGain: 0, dotSize: 1, halftoneGamma: 1, shadowBoost: 0, highlightBoost: 0 })
    for (const d of [0, 0.1, 0.5, 0.9, 1]) expect(applyDotSettings(d, s)).toBeCloseTo(d, 10)
  })

  it('suppresses marks below minDot', () => {
    expect(applyDotSettings(0.05, settings({ minDot: 0.1 }))).toBeNull()
    expect(applyDotSettings(0.15, settings({ minDot: 0.1 }))).not.toBeNull()
  })

  it('clamps to maxDot and never exceeds 1', () => {
    expect(applyDotSettings(0.9, settings({ maxDot: 0.7, dotGain: 0, dotSize: 1 }))).toBeCloseTo(0.7)
    expect(applyDotSettings(0.9, settings({ maxDot: 1, dotGain: 0, dotSize: 3 }))).toBe(1)
  })

  it('shadow/highlight boost is continuous at the 0.5 split', () => {
    const s = settings({ shadowBoost: 1, highlightBoost: 1, minDot: 0, maxDot: 1, dotGain: 0, dotSize: 1, halftoneGamma: 1 })
    const below = applyDotSettings(0.5 - 1e-9, s)!
    const at = applyDotSettings(0.5, s)!
    expect(Math.abs(below - at)).toBeLessThan(1e-6)
  })

  it('matches the GLSL implementation in shared.glsl.ts', () => {
    const gl = glslApplyDotSettings()
    const cases: ToneParams[] = []
    for (const halftoneGamma of [0.5, 1, 2.2, 3])
      for (const shadowBoost of [0, 0.4, 1])
        for (const highlightBoost of [0, 0.6, 1])
          for (const [minDot, maxDot, dotGain, dotSize] of [[0, 1, 0, 1], [0.08, 0.85, 0.15, 1.2], [0.3, 0.5, 0.5, 0.8]])
            cases.push({ halftoneGamma, shadowBoost, highlightBoost, minDot, maxDot, dotGain, dotSize })

    for (const p of cases) {
      const s = settings(p)
      for (let i = 0; i <= 40; i++) {
        const d = i / 40
        const cpu = applyDotSettings(d, s)
        const gpu = gl(d, p)
        if (cpu === null) expect(gpu, `d=${d} ${JSON.stringify(p)}`).toBeNull()
        else expect(gpu, `d=${d} ${JSON.stringify(p)}`).toBeCloseTo(cpu, 10)
      }
    }
  })
})
