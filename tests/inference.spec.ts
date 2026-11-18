/** Punctuation is loaded with ASR, called once on the final transcript, and fails open. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Config } from '../src/config.ts'
import { createTranscriber, type InferenceConfig } from '../src/inference.ts'
import { samplesWave } from './support/wav.ts'

const native = vi.hoisted(() => ({
  texts: [] as string[],
  punctConfigs: [] as object[],
  punctCalls: [] as string[],
  punctResult: (text: string) => text,
  punctLoadThrow: false,
  punctThrow: false,
  segments: [] as Array<{ start: number; samples: Float32Array }>,
}))

vi.mock('node:module', () => ({
  createRequire: () => () => ({
    OfflineRecognizer: class {
      createStream() { return { acceptWaveform: () => {} } }
      decode() {}
      getResult() { return { text: native.texts.shift() ?? '' } }
    },
    Vad: class {
      private index = 0
      acceptWaveform() {}
      isEmpty() { return this.index >= native.segments.length }
      front() { return native.segments[this.index]! }
      pop() { this.index++ }
      reset() { this.index = 0 }
      flush() {}
    },
    OfflinePunctuation: class {
      constructor(config: object) {
        if (native.punctLoadThrow) throw new Error('punct load failed')
        native.punctConfigs.push(config)
      }
      addPunct(text: string) {
        if (native.punctThrow) throw new Error('punct failed')
        native.punctCalls.push(text)
        return native.punctResult(text)
      }
    },
  }),
}))

const modelPath = '/punct/model.int8.onnx'

function inference(overrides: Partial<Config> = {}, punctuationModel: string | null = modelPath): InferenceConfig {
  const config = Config({ dataRoot: '/cache', ...overrides })
  return Object.assign({}, config, {
    encoder: '/asr/encoder.onnx', decoder: '/asr/decoder.onnx', tokens: '/asr/tokens.txt', vad: '/asr/silero_vad.onnx',
    ...punctuationModel === null ? {} : { punctuationModel },
  })
}

beforeEach(() => {
  native.texts = []
  native.punctConfigs = []
  native.punctCalls = []
  native.punctResult = text => `${text}。`
  native.punctLoadThrow = false
  native.punctThrow = false
  native.segments = []
})
afterEach(() => { vi.restoreAllMocks() })

describe('punctuation inference', () => {
  it('loads the model with ASR and punctuates a direct transcript once', () => {
    native.texts = ['第一句']
    const result = createTranscriber(inference())(samplesWave(16000), 'zh')
    expect(native.punctConfigs).toHaveLength(1)
    expect(native.punctConfigs[0]).toMatchObject({
      model: { ctTransformer: modelPath, numThreads: 8, provider: 'cpu', debug: 0 },
    })
    expect(native.punctCalls).toEqual(['第一句'])
    expect(result).toMatchObject({ text: '第一句。', segments: 1, punctuated: true })
  })

  it('punctuates the joined VAD transcript once, not each segment', () => {
    native.texts = ['第一段', '第二段']
    native.segments = [{ start: 0, samples: new Float32Array(512) }, { start: 1000, samples: new Float32Array(512) }]
    const result = createTranscriber(inference({ directDecodeSeconds: 1 }))(samplesWave(32000), 'zh')
    expect(result.segments).toBe(2)
    expect(native.punctCalls).toEqual(['第一段第二段'])
    expect(result).toMatchObject({ text: '第一段第二段。', punctuated: true })
  })

  it('does not construct or call the punctuator when disabled', () => {
    native.texts = ['原文']
    const result = createTranscriber(inference({ punctuation: false }))(samplesWave(16000), 'zh')
    expect(native.punctConfigs).toEqual([])
    expect(native.punctCalls).toEqual([])
    expect(result).toMatchObject({ text: '原文', punctuated: false })
  })

  it('fails open when the punctuation model path is missing', () => {
    const warning = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    native.texts = ['原文']
    const result = createTranscriber(inference({}, null))(samplesWave(16000), 'zh')
    expect(native.punctConfigs).toEqual([])
    expect(result).toMatchObject({ text: '原文', punctuated: false })
    expect(warning.mock.calls.some(([chunk]) => String(chunk).includes('unavailable'))).toBe(true)
  })

  it('fails open when the punctuation model cannot load', () => {
    const warning = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    native.punctLoadThrow = true
    native.texts = ['原文']
    const result = createTranscriber(inference())(samplesWave(16000), 'zh')
    expect(result).toMatchObject({ text: '原文', punctuated: false })
    expect(warning.mock.calls.some(([chunk]) => String(chunk).includes('failed to load'))).toBe(true)
  })

  it('fails open when addPunct throws and disables punctuation for later calls', () => {
    const warning = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    native.punctThrow = true
    native.texts = ['原文']
    const transcriber = createTranscriber(inference())
    expect(transcriber(samplesWave(16000), 'zh')).toMatchObject({ text: '原文', punctuated: false })
    native.punctThrow = false
    native.texts = ['第二段']
    expect(transcriber(samplesWave(16000), 'zh')).toMatchObject({ text: '第二段', punctuated: false })
    expect(native.punctCalls).toEqual([])
    expect(warning.mock.calls.some(([chunk]) => String(chunk).includes('punctuation failed'))).toBe(true)
  })

  it('fails open when punctuation returns an empty string', () => {
    const warning = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    native.punctResult = () => ''
    native.texts = ['原文']
    const result = createTranscriber(inference())(samplesWave(16000), 'zh')
    expect(result).toMatchObject({ text: '原文', punctuated: false })
    expect(warning.mock.calls.some(([chunk]) => String(chunk).includes('empty'))).toBe(true)
  })
})
