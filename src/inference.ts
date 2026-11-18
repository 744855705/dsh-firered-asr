/** CPU FireRedASR2-AED inference and padded Silero segmentation, confined to the recognition process. */
import { createRequire } from 'node:module'
import type { Transcript } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import type { Config } from './config.ts'
import { validateInput, waveToSamples } from './input.ts'
import { joinTranscripts, planSegments } from './segments.ts'

/** Verified files and validated inference settings sent by the Host. */
export interface InferenceConfig extends Config {
  readonly encoder: string
  readonly decoder: string
  readonly tokens: string
  readonly vad: string
}

/** Native inference result with the number of decoded windows, used by integration tests and diagnostics. */
export interface Transcription extends Transcript {
  readonly segments: number
}

interface Stream {
  acceptWaveform(audio: { samples: Float32Array; sampleRate: number }): void
}

interface Recognizer {
  createStream(): Stream
  decode(stream: Stream): void
  getResult(stream: Stream): { text: string }
}

interface Detector {
  acceptWaveform(samples: Float32Array): void
  isEmpty(): boolean
  front(externalBuffer: false): { start: number; samples: Float32Array }
  pop(): void
  reset(): void
  flush(): void
}

interface Sherpa {
  OfflineRecognizer: new (config: object) => Recognizer
  Vad: new (config: object, bufferSeconds: number) => Detector
}

interface RawSegment {
  readonly start: number
  readonly length: number
}

/** Native configuration is fixed per process; language hints are metadata only for the AED model. */
function nativeRecognizerConfig(config: InferenceConfig): object {
  return {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      // FireRedASR2-AED is an encoder/decoder pair; there is no single-file variant.
      fireRedAsr: { encoder: config.encoder, decoder: config.decoder },
      tokens: config.tokens,
      numThreads: config.threads,
      provider: 'cpu',
      debug: 0,
    },
  }
}

/** Silero window must be large enough for one maximum-duration segment plus its silence margin. */
function vadConfig(config: InferenceConfig): object {
  const maxSpeechDuration = Math.max(0.1, config.segmentSeconds - config.vadOnsetPaddingSeconds - config.vadTailPaddingSeconds)
  return {
    sileroVad: {
      model: config.vad,
      threshold: config.vadThreshold,
      minSilenceDuration: config.minSilenceSeconds,
      minSpeechDuration: config.minSpeechSeconds,
      maxSpeechDuration,
      windowSize: 512,
    },
    sampleRate: 16000,
    numThreads: config.threads,
    provider: 'cpu',
    debug: 0,
  }
}

function decode(recognizer: Recognizer, samples: Float32Array): string {
  const stream = recognizer.createStream()
  // Electron's V8 memory cage requires owned native buffers; every caller passes a copy.
  stream.acceptWaveform({ sampleRate: 16000, samples })
  recognizer.decode(stream)
  return recognizer.getResult(stream).text
}

/**
 * Load one native model pair and expose synchronous transcription for its dedicated process.
 * @param config - verified ONNX paths and explicit CPU/VAD limits.
 * @returns synchronous inference confined to its dedicated process.
 */
export function createTranscriber(config: InferenceConfig): (audio: Uint8Array, language: string) => Transcription {
  // sherpa-onnx-node publishes a CommonJS Node-API binding with JSDoc but no declarations.
  const sherpa = createRequire(import.meta.url)('sherpa-onnx-node') as Sherpa
  const recognizer = new sherpa.OfflineRecognizer(nativeRecognizerConfig(config))
  const detector = new sherpa.Vad(vadConfig(config), config.segmentSeconds + config.minSilenceSeconds + 1)

  return (audio, language) => {
    const audioSeconds = validateInput(audio, language, config.maxAudioBytes)
    const samples = waveToSamples(audio)
    detector.reset()
    const started = performance.now()

    if (audioSeconds <= config.directDecodeSeconds) {
      // Short recordings are decoded whole: no VAD boundary, no padding, no join.
      const text = decode(recognizer, samples).trim()
      return { text, audioSeconds, inferenceSeconds: (performance.now() - started) / 1000, segments: 1 }
    }

    const raw: RawSegment[] = []
    const drain = (): void => {
      while (!detector.isEmpty()) {
        const segment = detector.front(false)
        raw.push({ start: segment.start, length: segment.samples.length })
        detector.pop()
      }
    }
    for (let offset = 0; offset < samples.length; offset += 512) {
      detector.acceptWaveform(samples.subarray(offset, offset + 512))
      drain()
    }
    detector.flush()
    drain()

    const plans = planSegments(raw, {
      totalSamples: samples.length,
      sampleRate: 16000,
      onsetPaddingSeconds: config.vadOnsetPaddingSeconds,
      tailPaddingSeconds: config.vadTailPaddingSeconds,
    })
    const texts: string[] = []
    for (const plan of plans) {
      // Slice from the original recording so padding is real audio, not a VAD-internal copy.
      const window = Float32Array.from(samples.subarray(plan.start, plan.end))
      texts.push(decode(recognizer, window).trim())
    }
    return {
      text: joinTranscripts(texts), audioSeconds,
      inferenceSeconds: (performance.now() - started) / 1000, segments: plans.length,
    }
  }
}
