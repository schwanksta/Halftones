import { describe, it, expect } from 'vitest'
import { readOpenState, writeOpenState, type StorageLike } from './ui-state'

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v },
  }
}

const throwing: StorageLike = {
  getItem: () => { throw new Error('denied') },
  setItem: () => { throw new Error('quota') },
}

describe('ui-state', () => {
  it('returns {} when nothing is stored', () => {
    expect(readOpenState(memoryStorage())).toEqual({})
  })

  it('returns {} when storage is unavailable', () => {
    expect(readOpenState(null)).toEqual({})
    expect(readOpenState(undefined)).toEqual({})
  })

  it('returns {} for corrupt JSON', () => {
    expect(readOpenState(memoryStorage({ halftones_ui: '{not json' }))).toEqual({})
  })

  it('returns {} for JSON that is not an object', () => {
    expect(readOpenState(memoryStorage({ halftones_ui: '[true]' }))).toEqual({})
    expect(readOpenState(memoryStorage({ halftones_ui: '"open"' }))).toEqual({})
    expect(readOpenState(memoryStorage({ halftones_ui: 'null' }))).toEqual({})
  })

  it('drops entries that are not booleans', () => {
    const s = memoryStorage({ halftones_ui: JSON.stringify({ image: true, screen: 'yes', print: 0 }) })
    expect(readOpenState(s)).toEqual({ image: true })
  })

  it('does not throw when storage throws', () => {
    expect(readOpenState(throwing)).toEqual({})
    expect(() => writeOpenState(throwing, { image: true })).not.toThrow()
    expect(() => writeOpenState(null, { image: true })).not.toThrow()
  })

  it('round-trips', () => {
    const s = memoryStorage()
    writeOpenState(s, { image: true, screen: false })
    expect(readOpenState(s)).toEqual({ image: true, screen: false })
  })
})
