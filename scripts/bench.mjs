// CPU benchmark for the real FireRedASR2-AED int8 model: cold load, 5/10/30s RTF, peak RSS.
// Run after `pnpm build`:
//   FIRERED_MODEL_DIR=<extracted model dir> node scripts/bench.mjs
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Config } from '../lib/config.js'
import { createTranscriber } from '../lib/inference.js'
import { inspectRuntime } from '../lib/runtime.js'

function readPcm(wave) {
  return Buffer.from(wave.subarray(44))
}

function makeWave(pcm) {
  const wave = Buffer.alloc(44 + pcm.length)
  wave.write('RIFF', 0, 'ascii')
  wave.writeUInt32LE(wave.length - 8, 4)
  wave.write('WAVE', 8, 'ascii')
  wave.write('fmt ', 12, 'ascii')
  wave.writeUInt32LE(16, 16)
  wave.writeUInt16LE(1, 20)
  wave.writeUInt16LE(1, 22)
  wave.writeUInt32LE(16000, 24)
  wave.writeUInt32LE(32000, 28)
  wave.writeUInt16LE(2, 32)
  wave.writeUInt16LE(16, 34)
  wave.write('data', 36, 'ascii')
  wave.writeUInt32LE(pcm.length, 40)
  pcm.copy(wave, 44)
  return wave
}

const modelDir = process.env.FIRERED_MODEL_DIR
if (!modelDir) throw new Error('FIRERED_MODEL_DIR is required')
const threads = Number(process.env.FIRERED_THREADS ?? '8')
const punctuationModel = process.env.FIRERED_PUNCT_MODEL
const punctuation = punctuationModel !== undefined && process.env.FIRERED_PUNCT !== '0'
const config = Config({ dataRoot: join(tmpdir(), 'dsh-firered-bench'), modelDirectory: modelDir, threads, punctuation })
const paths = await inspectRuntime(config, new AbortController().signal)
if (!paths) throw new Error('model directory failed verification')

const loadStart = performance.now()
const transcriber = createTranscriber(Object.assign({}, config, paths, punctuation ? { punctuationModel } : {}))
const loadMs = performance.now() - loadStart

const sourceWave = readFileSync(join(modelDir, 'test_wavs', '0.wav'))
const sourcePcm = readPcm(sourceWave)
function exactWave(seconds) {
  const target = Math.round(seconds * 32000)
  const pcm = Buffer.alloc(target)
  for (let offset = 0; offset < target; offset += sourcePcm.length) {
    sourcePcm.copy(pcm, offset, 0, Math.min(sourcePcm.length, target - offset))
  }
  return makeWave(pcm)
}

const clips = []
for (const seconds of [5, 10, 30]) {
  const wave = exactWave(seconds)
  const runs = []
  let text = ''
  let punctuatedLast = false
  let punctuationSeconds = 0
  for (let index = 0; index < 3; index++) {
    const result = transcriber(wave, 'auto')
    text = result.text
    punctuatedLast = result.punctuated
    punctuationSeconds = result.punctuationSeconds
    runs.push(result.inferenceSeconds)
  }
  const sorted = [...runs].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  clips.push({
    seconds, runs, medianSeconds: median, rtf: median / seconds,
    textLength: [...text].length, punctuated: punctuatedLast, punctuationSeconds,
  })
}

console.log(JSON.stringify({
  model: 'sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26',
  punctuationModel: punctuation ? punctuationModel : undefined,
  threads,
  loadMs: Math.round(loadMs),
  peakRssBytes: process.resourceUsage().maxRSS * 1024,
  rssBytes: process.memoryUsage().rss,
  clips,
}))
