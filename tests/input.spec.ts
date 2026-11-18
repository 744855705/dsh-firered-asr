/** Canonical WAV validation, language limits, and sample conversion before native inference. */
import { describe, expect, it } from 'vitest'
import { SpeechInputError, validateInput, waveToSamples } from '../src/input.ts'
import { makeWave, samplesWave } from './support/wav.ts'

const max = 4 * 1024 * 1024

describe('validateInput', () => {
  it('accepts canonical 16 kHz mono PCM16 WAV and reports its duration', () => {
    expect(validateInput(samplesWave(1600), 'auto', max)).toBeCloseTo(0.1, 6)
    expect(validateInput(samplesWave(1600), 'zh', max)).toBeCloseTo(0.1, 6)
    expect(validateInput(samplesWave(1600), 'en', max)).toBeCloseTo(0.1, 6)
  })

  it('rejects unsupported languages before touching the WAV', () => {
    expect(() => validateInput(samplesWave(1600), 'ja', max)).toThrow(SpeechInputError)
    expect(() => validateInput(samplesWave(1600), 'ja', max)).toThrow('language')
  })

  it('rejects audio above the byte limit', () => {
    expect(() => validateInput(samplesWave(1000), 'zh', 100)).toThrow(SpeechInputError)
    expect(() => validateInput(samplesWave(1000), 'zh', 100)).toThrow('byte limit')
  })

  it.each([
    ['wrong sample rate', makeWave(Buffer.alloc(4), { sampleRate: 8000 })],
    ['stereo', makeWave(Buffer.alloc(4), { channels: 2 })],
    ['8-bit', makeWave(Buffer.alloc(4), { bits: 8 })],
    ['float format', makeWave(Buffer.alloc(4), { format: 3 })],
    ['inconsistent RIFF size', makeWave(Buffer.alloc(4), { riffSize: 1 })],
    ['inconsistent data size', makeWave(Buffer.alloc(4), { dataSize: 2 })],
    ['odd payload', makeWave(Buffer.alloc(3))],
    ['truncated', new Uint8Array(44)],
  ])('rejects a malformed WAV (%s)', (_name, wave) => {
    expect(() => validateInput(wave, 'zh', max)).toThrow(SpeechInputError)
    expect(() => validateInput(wave, 'zh', max)).toThrow('Invalid speech WAV')
  })
})

describe('waveToSamples', () => {
  it('copies PCM16 into normalized float samples', () => {
    const pcm = Buffer.alloc(8)
    pcm.writeInt16LE(0, 0); pcm.writeInt16LE(16384, 2); pcm.writeInt16LE(-16384, 4); pcm.writeInt16LE(32767, 6)
    const samples = waveToSamples(makeWave(pcm))
    expect([...samples]).toEqual([0, 0.5, -0.5, 32767 / 32768])
  })
})
