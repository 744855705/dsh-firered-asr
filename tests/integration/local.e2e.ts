/** Opt-in real FireRedASR2-AED run: sample WAVs, the padded VAD path, and cancellation process exit. */
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
import { inspectRuntime } from '../../src/runtime.ts'
import { createFakeSubprocess } from '../support/fake-subprocess.ts'
import { concatWaves } from '../support/wav.ts'

const modelDir = process.env.FIRERED_E2E_MODEL_DIR
const vadSource = process.env.FIRERED_E2E_VAD
const enabled = modelDir !== undefined && existsSync(join(modelDir, 'encoder.int8.onnx')) && existsSync(join(modelDir, 'decoder.int8.onnx'))

async function ensureVad(): Promise<void> {
  if (modelDir === undefined || vadSource === undefined) return
  try { await access(join(modelDir, 'silero_vad.onnx')) } catch { await copyFile(vadSource, join(modelDir, 'silero_vad.onnx')) }
}

it.skipIf(!enabled)('transcribes real FireRedASR2 sample WAVs, the 60s VAD path, and cancellation', { timeout: 30 * 60_000 }, async () => {
  await ensureVad()
  const dataRoot = await mkdtemp(join(tmpdir(), 'dsh-firered-e2e-'))
  const config = Config({ dataRoot, modelDirectory: modelDir!, threads: 8 })
  const signal = (): AbortSignal => new AbortController().signal
  try {
    const paths = await inspectRuntime(config, signal())
    expect(paths).toBeDefined()
    const transcriber = createTranscriber(Object.assign({}, config, paths))

    const first = await readFile(join(modelDir!, 'test_wavs', '0.wav'))
    const second = await readFile(join(modelDir!, 'test_wavs', '1.wav'))
    const r0 = transcriber(first, 'auto')
    const r1 = transcriber(second, 'auto')
    expect(r0.text.length).toBeGreaterThan(0)
    expect(r1.text.length).toBeGreaterThan(0)
    expect(r0.text).toMatch(/\p{Script=Han}/u)
    expect(r1.text).toMatch(/\p{Script=Han}/u)
    expect(r0.audioSeconds).toBeGreaterThan(9)
    expect(r1.audioSeconds).toBeGreaterThan(4)

    const longWave = concatWaves([first, first, first, first, first, first], 1)
    const long = transcriber(longWave, 'auto')
    expect(long.audioSeconds).toBeGreaterThan(60)
    expect(long.segments).toBeGreaterThanOrEqual(2)
    expect(long.text.length).toBeGreaterThan(0)
    expect(long.text).toMatch(/\p{Script=Han}/u)

    const fake = createFakeSubprocess()
    const ctx = { subprocess: fake, logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() } } as unknown as Context
    const worker = new FireRedWorker(ctx, Config({ dataRoot, modelDirectory: modelDir!, idleTimeoutMs: 0 }))
    try {
      const ready = Promise.withResolvers<undefined>()
      const unsubscribe = worker.subscribe(() => {
        const state = worker.snapshot()
        if (state.phase === 'ready') ready.resolve(undefined)
        if (state.phase === 'failed') ready.reject(new Error(state.message))
      })
      const start = performance.now()
      worker.prepare()
      await ready.promise
      unsubscribe()
      const coldStartMs = performance.now() - start

      const w0 = await worker.transcribe({ audio: first, language: 'auto' }, signal())
      const w1 = await worker.transcribe({ audio: second, language: 'auto' }, signal())
      expect(w0.text).toMatch(/\p{Script=Han}/u)
      expect(w1.text).toMatch(/\p{Script=Han}/u)

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
        sample0: r0, sample1: r1, long: { text: long.text, audioSeconds: long.audioSeconds, segments: long.segments, inferenceSeconds: long.inferenceSeconds },
        worker: { coldStartMs, sample0: w0, sample1: w1, longSeconds: longWorker.audioSeconds, again: again.text },
      }))
    } finally { await worker.dispose() }
  } finally { await rm(dataRoot, { recursive: true, force: true }) }
})
