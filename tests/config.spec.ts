/** Configuration defaults and deployment-time rejection without touching native code. */
import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_MODEL_URL, DEFAULT_PUNCTUATION_MODEL_URL, defaultDataRoot, validateConfig } from '../src/config.ts'

const base = { dataRoot: '/cache/firered' }

describe('Config', () => {
  it('applies the documented defaults', () => {
    expect(Config(base)).toMatchObject({
      providerId: 'firered-local', modelUrl: DEFAULT_MODEL_URL,
      punctuation: true, punctuationModelUrl: DEFAULT_PUNCTUATION_MODEL_URL, threads: 8,
      directDecodeSeconds: 30, segmentSeconds: 30, vadThreshold: 0.5, minSpeechSeconds: 0.1,
      minSilenceSeconds: 0.8, vadOnsetPaddingSeconds: 0.3, vadTailPaddingSeconds: 0.25,
      maxAudioBytes: 4 * 1024 * 1024, prepareTimeoutMs: 3_600_000, inferenceTimeoutMs: 600_000,
      idleTimeoutMs: 7_200_000, maxPending: 4, graceMs: 1000, maxLogBytes: 64 * 1024,
      maxResponseBytes: 128 * 1024, progressIntervalMs: 100,
    })
    expect(Config({ ...base, idleTimeoutMs: 0 }).idleTimeoutMs).toBe(0)
    expect(Config({ ...base, idleTimeoutMs: 60_000 }).idleTimeoutMs).toBe(60_000)
    expect(Config(base).modelDirectory).toBeUndefined()
    expect(Config(base).archivePath).toBeUndefined()
    expect(Config(base).modelSha256).toBeUndefined()
    expect(Config(base).punctuationModelDirectory).toBeUndefined()
    expect(Config(base).punctuationModelSha256).toBeUndefined()
  })

  it('defaults dataRoot to the shared harness-home cache', () => {
    expect(Config({}).dataRoot).toBe(defaultDataRoot())
    expect(isAbsolute(Config({}).dataRoot)).toBe(true)
    expect(Config({ dataRoot: '/custom/firered' }).dataRoot).toBe('/custom/firered')
  })

  it('resolves the shared cache from DSH_HOME, blank fallback, and tilde', () => {
    const home = resolve('firered-test-home')
    const dshHome = join(home, 'dsh-home')
    expect(defaultDataRoot({ DSH_HOME: dshHome }, home)).toBe(join(dshHome, 'speech-to-text', 'firered'))
    expect(defaultDataRoot({ DSH_HOME: '   ' }, home)).toBe(join(home, '.dsh', 'speech-to-text', 'firered'))
    expect(defaultDataRoot({ DSH_HOME: '~/custom' }, home)).toBe(join(home, 'custom', 'speech-to-text', 'firered'))
    expect(defaultDataRoot({}, home)).toBe(join(home, '.dsh', 'speech-to-text', 'firered'))
  })

  it('bundle patch no longer evaluates a profile-layer JS expression', () => {
    const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    expect(patch).not.toContain('!!js')
    expect(patch).toContain('firered-asr')
  })

  it.each([
    { threads: 0 }, { vadThreshold: 1.5 }, { directDecodeSeconds: 0 }, { segmentSeconds: 0 },
    { maxAudioBytes: 0 }, { progressIntervalMs: 0 }, { modelSha256: 'not-a-hash' },
    { modelUrl: 'http://example.com/model.tar.bz2' }, { dataRoot: '' },
    { punctuationModelSha256: 'not-a-hash' }, { punctuationModelUrl: 'http://example.com/punct.tar.bz2' },
    { punctuation: 'yes' },
  ])('rejects invalid values %j', (overrides) => {
    expect(() => Config({ ...base, ...overrides })).toThrow()
  })

  it('requires a hash for an overridden URL and rejects unsafe or mixed offline sources', () => {
    const hash = 'a'.repeat(64)
    expect(() => validateConfig(Config({ ...base, modelUrl: 'https://example.com/model.tar.bz2' }))).toThrow('modelSha256')
    expect(() => validateConfig(Config({ ...base, modelUrl: 'https://example.com/model.tar.bz2', modelSha256: hash }))).not.toThrow()
    expect(() => validateConfig(Config({ ...base, modelUrl: 'https://user:pass@example.com/model.tar.bz2', modelSha256: hash }))).toThrow('credentials')
    expect(() => validateConfig(Config({ ...base, punctuationModelUrl: 'https://example.com/punct.tar.bz2' }))).toThrow('punctuationModelSha256')
    expect(() => validateConfig(Config({ ...base, punctuationModelUrl: 'https://example.com/punct.tar.bz2', punctuationModelSha256: hash }))).not.toThrow()
    expect(() => validateConfig(Config({ ...base, punctuationModelUrl: 'https://user:pass@example.com/punct.tar.bz2', punctuationModelSha256: hash }))).toThrow('credentials')
    expect(() => validateConfig(Config({ ...base, punctuation: false }))).not.toThrow()
    expect(() => validateConfig(Config({ ...base, modelDirectory: '/models' }))).not.toThrow()
    expect(() => validateConfig(Config({ ...base, archivePath: '/cache/model.tar.bz2' }))).not.toThrow()
    expect(() => validateConfig(Config({ ...base, punctuationModelDirectory: '/punct' }))).not.toThrow()
    expect(() => validateConfig(Config({ ...base, modelDirectory: '/models', archivePath: '/cache/model.tar.bz2' }))).toThrow('either')
  })

  it.each(['dataRoot', 'modelDirectory', 'archivePath', 'punctuationModelDirectory'] as const)('requires %s to be absolute', (field) => {
    expect(() => validateConfig(Config({ ...base, [field]: 'relative/path' }))).toThrow('absolute')
  })

  it('leaves at least 0.5s of speech after both VAD paddings', () => {
    expect(() => validateConfig(Config({ ...base, segmentSeconds: 1, vadOnsetPaddingSeconds: 0.6, vadTailPaddingSeconds: 0.6 }))).toThrow('0.5s')
    expect(() => validateConfig(Config({ ...base, segmentSeconds: 1, vadOnsetPaddingSeconds: 0, vadTailPaddingSeconds: 0 }))).not.toThrow()
  })
})
