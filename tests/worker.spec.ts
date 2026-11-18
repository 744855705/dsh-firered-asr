/** Local provider queueing, cancellation, idle reclamation, and process cleanup with real child workers. */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { Config } from '../src/config.ts'
import { hostRoot } from '../src/host.ts'
import { SpeechInputError } from '../src/input.ts'
import { FireRedWorker } from '../src/recognizer.ts'
import { inspectRuntime, prepareRuntime } from '../src/runtime.ts'
import { createFakeSubprocess } from './support/fake-subprocess.ts'

vi.mock('../src/runtime.ts', () => ({ inspectRuntime: vi.fn(), prepareRuntime: vi.fn() }))

const FIXTURE = fileURLToPath(new URL('./support/worker.fixture.mjs', import.meta.url))
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.clearAllMocks()
  for (const close of cleanup.splice(0).reverse()) await close()
})

const audio = new Uint8Array([1, 2])
const signal = (): AbortSignal => new AbortController().signal

async function fixture(overrides: Partial<Config> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-firered-worker-'))
  const fake = createFakeSubprocess()
  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
  const ctx = { subprocess: fake, logger } as unknown as Context
  const config = Config({ dataRoot: root, idleTimeoutMs: 0, ...overrides })
  vi.mocked(inspectRuntime).mockReset()
  vi.mocked(prepareRuntime).mockReset()
  vi.mocked(prepareRuntime).mockResolvedValue({ encoder: root, decoder: root, tokens: root, vad: root, worker: FIXTURE })
  const worker = new FireRedWorker(ctx, config)
  cleanup.push(async () => { await worker.dispose(); await rm(root, { recursive: true, force: true }) })
  return { root, worker, fake, logger }
}

async function prepare(worker: FireRedWorker): Promise<void> {
  const ready = Promise.withResolvers<undefined>()
  const unsubscribe = worker.subscribe(() => {
    const state = worker.snapshot()
    if (state.phase === 'ready') ready.resolve(undefined)
    if (state.phase === 'failed') ready.reject(new Error(state.message))
  })
  try { worker.prepare(); await ready.promise } finally { unsubscribe() }
}

async function requests(root: string): Promise<string> {
  try { return await readFile(join(root, 'requests'), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return ''
  }
}

it('wakes verified caches on the first recording without preparing them again', async () => {
  const { worker, fake, root } = await fixture()
  vi.mocked(inspectRuntime).mockResolvedValueOnce({ encoder: root, decoder: root, tokens: root, vad: root, worker: FIXTURE })
  const phases: string[] = []
  worker.subscribe(() => { phases.push(worker.snapshot().phase) })
  worker.inspect(); worker.inspect()
  await vi.waitFor(() => { expect(worker.snapshot().phase).toBe('standby') })
  expect(inspectRuntime).toHaveBeenCalledOnce()
  expect(fake.spawned).toHaveLength(0)
  expect((await worker.transcribe({ audio, language: 'zh' }, signal())).text).toBe('zh')
  expect(phases).toContain('waking')
  expect(phases).not.toContain('loading')
  expect(prepareRuntime).not.toHaveBeenCalled()
  expect(fake.spawned).toHaveLength(1)
})

it('hands the resolved DSH installation to the worker even when the Host environment has none', async () => {
  const saved = process.env.DSH_INSTALL_DIR
  delete process.env.DSH_INSTALL_DIR
  try {
    const { worker, fake } = await fixture()
    await prepare(worker)
    expect(fake.specs.at(-1)?.env?.DSH_INSTALL_DIR).toBe(hostRoot)
  } finally {
    if (saved !== undefined) process.env.DSH_INSTALL_DIR = saved
  }
})

it('keeps one worker warm across recordings and joins its exit on disposal', async () => {
  const { worker, fake } = await fixture()
  await prepare(worker)
  expect(worker.snapshot().phase).toBe('ready')
  expect((await worker.transcribe({ audio, language: 'zh' }, signal())).text).toBe('zh')
  expect((await worker.transcribe({ audio, language: 'en' }, signal())).text).toBe('en')
  const handle = fake.spawned[0]!
  await worker.dispose()
  expect(await handle.waitForExit()).toBe(true)
  await expect(worker.transcribe({ audio, language: 'en' }, signal())).rejects.toThrow('disposed')
})

it('cancels active inference before the next recording can acquire a fresh worker', async () => {
  const { worker, fake, root } = await fixture()
  await prepare(worker)
  const cancel = new AbortController()
  const first = worker.transcribe({ audio, language: 'hold' }, cancel.signal)
  const rejected = expect(first).rejects.toThrow()
  await vi.waitFor(async () => { expect(await requests(root)).toContain('hold') }, { timeout: 10_000 })
  const next = worker.transcribe({ audio, language: 'en' }, signal())
  cancel.abort(new Error('cancel'))
  await rejected
  expect((await next).text).toBe('en')
  expect(fake.spawned).toHaveLength(2)
  expect(await fake.spawned[0]!.waitForExit()).toBe(true)
})

it('bounds the queue and never executes a cancelled waiting recording', async () => {
  const { worker, fake, root } = await fixture({ maxPending: 2 })
  await prepare(worker)
  const active = new AbortController(), waiting = new AbortController()
  const first = worker.transcribe({ audio, language: 'hold' }, active.signal)
  const firstFailure = expect(first).rejects.toThrow()
  await vi.waitFor(async () => { expect(await requests(root)).toContain('hold') }, { timeout: 10_000 })
  const second = worker.transcribe({ audio, language: 'discard' }, waiting.signal)
  const secondFailure = expect(second).rejects.toThrow('waiting cancelled')
  await expect(worker.transcribe({ audio, language: 'full' }, signal())).rejects.toThrow('queue is full')
  waiting.abort(new Error('waiting cancelled')); active.abort()
  await firstFailure; await secondFailure
  expect(await requests(root)).toBe('hold\n')
  expect(fake.spawned).toHaveLength(1)
})

it('stops an idle worker and reloads it on demand', async () => {
  const { worker, fake } = await fixture({ idleTimeoutMs: 50 })
  await prepare(worker)
  await worker.transcribe({ audio, language: 'en' }, signal())
  await vi.waitFor(() => { expect(worker.snapshot().phase).toBe('standby') }, { timeout: 10_000 })
  expect((await worker.transcribe({ audio, language: 'zh' }, signal())).text).toBe('zh')
  expect(fake.spawned).toHaveLength(2)
})

it('reuses a loaded worker after a classified input rejection', async () => {
  const { worker, fake } = await fixture()
  await prepare(worker)
  await expect(worker.transcribe({ audio, language: 'ja' }, signal())).rejects.toThrow(SpeechInputError)
  expect(worker.snapshot().phase).toBe('ready')
  expect((await worker.transcribe({ audio, language: 'en' }, signal())).text).toBe('en')
  expect(fake.spawned).toHaveLength(1)
})

it('reclaims the worker after a provider error and recovers on the next recording', async () => {
  const { worker, fake } = await fixture()
  await prepare(worker)
  await expect(worker.transcribe({ audio, language: 'error' }, signal())).rejects.toThrow('provider failed')
  expect(worker.snapshot().phase).toBe('standby')
  expect((await worker.transcribe({ audio, language: 'zh' }, signal())).text).toBe('zh')
  expect(fake.spawned).toHaveLength(2)
})

it('reports preparation failure, keeps retry admission, and publishes safe diagnostics', async () => {
  const { worker, fake } = await fixture()
  vi.mocked(prepareRuntime).mockRejectedValueOnce(new Error('download unavailable'))
  worker.prepare()
  await vi.waitFor(() => { expect(worker.snapshot()).toMatchObject({ phase: 'failed', message: 'download unavailable' }) })
  expect(fake.spawned).toHaveLength(0)
  await prepare(worker)
  expect(worker.snapshot().phase).toBe('ready')
})

it('reports unreadable caches as retryable failures and requires explicit preparation', async () => {
  const { worker, fake } = await fixture()
  vi.mocked(inspectRuntime).mockRejectedValueOnce(new Error('cache unreadable'))
  worker.inspect()
  await vi.waitFor(() => { expect(worker.snapshot()).toMatchObject({ phase: 'failed', message: 'cache unreadable' }) })
  await expect(worker.transcribe({ audio, language: 'zh' }, signal())).rejects.toThrow('Prepare')
  expect(prepareRuntime).not.toHaveBeenCalled()
  expect(fake.spawned).toHaveLength(0)
  await prepare(worker)
  expect(worker.snapshot().phase).toBe('ready')
})

it('rejects an unadvertised manual source without starting work', async () => {
  const { worker, fake } = await fixture()
  expect(() => worker.prepare({ downloadSource: 'https://example.com' })).toThrow('unavailable')
  expect(fake.spawned).toHaveLength(0)
  expect(prepareRuntime).not.toHaveBeenCalled()
})
