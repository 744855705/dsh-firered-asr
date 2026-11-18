/** Opt-in real FireRedASR2-AED run: sample WAVs, punctuation, the padded VAD path, and cancellation. */
import { performance } from 'node:perf_hooks'
import { access, copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { Config } from '../../src/config.ts'
import { createTranscriber } from '../../src/inference.ts'
import { FireRedWorker } from '../../src/recognizer.ts'
import { inspectRuntime, prepareRuntime } from '../../src/runtime.ts'
import { createFakeSubprocess } from '../support/fake-subprocess.ts'
import { concatWaves } from '../support/wav.ts'

const modelDir = process.env.FIRERED_E2E_MODEL_DIR
const vadSource = process.env.FIRERED_E2E_VAD
const punctuationDir = process.env.FIRERED_E2E_PUNCT_DIR
const enabled = modelDir !== undefined && existsSync(join(modelDir, 'encoder.int8.onnx')) && existsSync(join(modelDir, 'decoder.int8.onnx'))
const hasPunctuation = punctuationDir !== undefined && existsSync(join(punctuationDir, 'model.int8.onnx'))

async function ensureVad(): Promise<void> {
  if (modelDir === undefined || vadSource === undefined) return
  try { await access(join(modelDir, 'silero_vad.onnx')) } catch { await copyFile(vadSource, join(modelDir, 'silero_vad.onnx')) }
}

it.skipIf(!enabled)('transcribes real FireRedASR2 sample WAVs, punctuation, the 60s VAD path, and cancellation', { timeout: 30 * 60_000 }, async () => {
  await ensureVad()
  const dataRoot = await mkdtemp(join(tmpdir(), 'dsh-firered-e2e-'))
  const config = Config({ dataRoot, modelDirectory: modelDir!, punctuationModelDirectory: punctuationDir,
    punctuation: hasPunctuation, threads: 8 })
  const signal = (): AbortSignal => new AbortController().signal
  try {
    const paths = await inspectRuntime(config, signal())
    expect(paths).toBeDefined()
    if (hasPunctuation) expect(paths?.punctuationModel).toBe(join(punctuationDir!, 'model.int8.onnx'))
    else expect(paths?.punctuationModel).toBeUndefined()
    const transcriber = createTranscriber(Object.assign({}, config, paths))

    const first = await readFile(join(modelDir!, 'test_wavs', '0.wav'))
    const second = await readFile(join(modelDir!, 'test_wavs', '1.wav'))
    const third = await readFile(join(modelDir!, 'test_wavs', '3.wav'))
    const r0 = transcriber(first, 'auto')
    const r1 = transcriber(second, 'auto')
    const r3 = transcriber(third, 'auto')
    for (const result of [r0, r1, r3]) {
      expect(result.text.length).toBeGreaterThan(0)
      expect(result.text).toMatch(/\p{Script=Han}/u)
    }
    expect(r0.audioSeconds).toBeGreaterThan(9)
    expect(r1.audioSeconds).toBeGreaterThan(4)
    expect(r3.audioSeconds).toBeGreaterThan(8)
    if (hasPunctuation) {
      for (const result of [r0, r1, r3]) {
        expect(result.punctuated).toBe(true)
        expect(result.text).toMatch(/[，。？]/u)
      }
    }

    const longWave = concatWaves([first, first, first, first, first, first], 1)
    const long = transcriber(longWave, 'auto')
    expect(long.audioSeconds).toBeGreaterThan(60)
    expect(long.segments).toBeGreaterThanOrEqual(2)
    expect(long.text.length).toBeGreaterThan(0)
    expect(long.text).toMatch(/\p{Script=Han}/u)
    if (hasPunctuation) expect(long.text).toMatch(/[，。？]/u)

    // Explicitly missing punctuation directory: ASR must still be ready and return raw text.
    const missingConfig = Config({ dataRoot, modelDirectory: modelDir!,
      punctuationModelDirectory: join(dataRoot, 'missing-punct'), threads: 8 })
    // Inspection now requires preparation, but an explicit prepare still fails open to ASR-only.
    expect(await inspectRuntime(missingConfig, signal())).toBeUndefined()
    const missingPaths = await prepareRuntime(missingConfig, signal())
    expect(missingPaths.punctuationModel).toBeUndefined()
    const missingTranscriber = createTranscriber(Object.assign({}, missingConfig, missingPaths))
    const raw = missingTranscriber(first, 'auto')
    expect(raw.text.length).toBeGreaterThan(0)
    expect(raw.text).toMatch(/\p{Script=Han}/u)
    expect(raw.punctuated).toBe(false)

    const fake = createFakeSubprocess()
    const ctx = { subprocess: fake, logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() } } as unknown as Context
    const worker = new FireRedWorker(ctx, Config({ dataRoot, modelDirectory: modelDir!,
      punctuationModelDirectory: punctuationDir, punctuation: hasPunctuation, idleTimeoutMs: 0 }))
    try {
      const ready = Promise.withResolvers<undefined>()
      const unsubscribe = worker.subscribe(() => {
        const state = worker.snapshot()
        if (state.phase === 'ready') ready.resolve(undefined)
        if (state.phase === 'failed') ready.reject(new Error(state.message))
      })
      const start = performance.now()
      // Reproduce the Host: it has no DSH_INSTALL_DIR, so the worker must receive the root
      // resolved by the provider instead of rediscovering it from its own argv or cwd.
      const savedInstallDir = process.env.DSH_INSTALL_DIR
      delete process.env.DSH_INSTALL_DIR
      worker.prepare()
      try {
        await ready.promise
      } finally {
        if (savedInstallDir !== undefined) process.env.DSH_INSTALL_DIR = savedInstallDir
      }
      unsubscribe()
      const coldStartMs = performance.now() - start

      const w0 = await worker.transcribe({ audio: first, language: 'auto' }, signal())
      const w1 = await worker.transcribe({ audio: second, language: 'auto' }, signal())
      const w3 = await worker.transcribe({ audio: third, language: 'auto' }, signal())
      for (const result of [w0, w1, w3]) {
        expect(result.text.length).toBeGreaterThan(0)
        expect(result.text).toMatch(/\p{Script=Han}/u)
        if (hasPunctuation) expect(result.text).toMatch(/[，。？]/u)
      }

      const longWorker = await worker.transcribe({ audio: longWave, language: 'auto' }, signal())
      expect(longWorker.text.length).toBeGreaterThan(0)

      const handle = fake.spawned[0]!
      const cancel = new AbortController()
      const pending = worker.transcribe({ audio: longWave, language: 'auto' }, cancel.signal)
      const rejected = expect(pending).rejects.toThrow()
      await new Promise(resolve => setTimeout(resolve, 300))
      cancel.abort(new Error('cancel'))
      await rejected
      await vi.waitFor(() => { expect(worker.snapshot().phase).toBe('standby') }, { timeout: 30_000 })
      expect(await handle.waitForExit()).toBe(true)

      const again = await worker.transcribe({ audio: second, language: 'zh' }, signal())
      expect(again.text.length).toBeGreaterThan(0)
      expect(fake.spawned.length).toBe(2)

      console.info('FireRedASR2 e2e', JSON.stringify({
        hasPunctuation,
        sample0: r0, sample1: r1, sample3: r3,
        long: { text: long.text, audioSeconds: long.audioSeconds, segments: long.segments, inferenceSeconds: long.inferenceSeconds },
        failOpen: { text: raw.text, punctuated: raw.punctuated },
        worker: { coldStartMs, sample0: w0, sample1: w1, sample3: w3, longSeconds: longWorker.audioSeconds, again: again.text },
      }))
    } finally { await worker.dispose() }
  } finally { await rm(dataRoot, { recursive: true, force: true }) }
})
