/** Provider-lock file decoding and soft/hard enforcement without a real model. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SpeechProviderId, SpeechRequest, SpeechSelectionPatch, SpeechSpec } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { afterEach, expect, it, vi } from 'vitest'
import { installProviderLock, readProviderLock, type ProviderLockRuntime } from '../src/provider-lock.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-firered-lock-'))
  roots.push(root)
  return root
}

function lockLogger(): { warn: ReturnType<typeof vi.fn> } {
  return { warn: vi.fn() }
}

async function writeLock(content: string | Buffer): Promise<string> {
  const root = await tempRoot()
  const path = join(root, 'firered-asr-lock.json')
  await writeFile(path, content)
  return path
}

interface FakeState {
  selection: string
}

interface FakeRuntime {
  readonly runtime: ProviderLockRuntime
  readonly speech: {
    snapshot(): { selection: { providerId: string } }
    configure(patch: SpeechSelectionPatch): Promise<void>
    resolve(request: SpeechRequest): SpeechSpec
    follow(caller: AbortSignal): AsyncIterable<{ selection: { providerId: string } }>
  }
  readonly state: FakeState
  readonly configure: ReturnType<typeof vi.fn>
  readonly resolve: ReturnType<typeof vi.fn>
  readonly wake: () => void
}

function fakeRuntime(initial = 'firered-local', failConfigure = false): FakeRuntime {
  const waiters: Array<() => void> = []
  const state: FakeState = { selection: initial }
  const configure = vi.fn(async (patch: SpeechSelectionPatch): Promise<void> => {
    if (failConfigure) throw new Error('configure failed')
    if (patch.providerId !== undefined) state.selection = patch.providerId
  })
  const resolve = vi.fn((request: SpeechRequest): SpeechSpec => ({ ...request, provider: {} } as unknown as SpeechSpec))
  const follow = async function* (signal: AbortSignal): AsyncIterable<{ selection: { providerId: string } }> {
    while (!signal.aborted) {
      yield { selection: { providerId: state.selection } }
      await new Promise<void>((done) => {
        const onAbort = (): void => { done() }
        waiters.push(done)
        signal.addEventListener('abort', onAbort, { once: true })
      })
    }
  }
  const speech = {
    snapshot: (): { selection: { providerId: string } } => ({ selection: { providerId: state.selection } }),
    configure,
    resolve,
    follow,
  }
  const runtime: ProviderLockRuntime = {
    speechToText: speech,
    logger: { warn: vi.fn() },
  }
  return {
    runtime, speech, state, configure, resolve,
    wake: () => { for (const done of waiters.splice(0)) done() },
  }
}

it('reads valid soft and hard locks, including BOM/UTF-16/CRLF files', async () => {
  const logger = lockLogger()
  const valid = await writeLock(JSON.stringify({ providerId: 'firered-local', mode: 'hard' }))
  expect(readProviderLock(valid, 'firered-local', logger)).toEqual({ providerId: 'firered-local', mode: 'hard' })
  expect(logger.warn).not.toHaveBeenCalled()

  const utf8Bom = await writeLock(Buffer.concat([
    Buffer.from([0xEF, 0xBB, 0xBF]),
    Buffer.from(JSON.stringify({ mode: 'soft' })),
  ]))
  expect(readProviderLock(utf8Bom, 'firered-local', logger)).toEqual({ providerId: 'firered-local', mode: 'soft' })

  const utf16le = await writeLock(Buffer.concat([
    Buffer.from([0xFF, 0xFE]),
    Buffer.from(JSON.stringify({ providerId: 'firered-local', mode: 'soft' }), 'utf16le'),
  ]))
  expect(readProviderLock(utf16le, 'firered-local', logger)).toEqual({ providerId: 'firered-local', mode: 'soft' })

  const utf16be = await writeLock(Buffer.concat([
    Buffer.from([0xFE, 0xFF]),
    (() => {
      const swapped = Buffer.from(JSON.stringify({ mode: 'hard' }), 'utf16le')
      swapped.swap16()
      return swapped
    })(),
  ]))
  expect(readProviderLock(utf16be, 'firered-local', logger)).toEqual({ providerId: 'firered-local', mode: 'hard' })

  const crlf = await writeLock('{\r\n  "mode": "soft"\r\n}\r\n')
  expect(readProviderLock(crlf, 'firered-local', logger)).toEqual({ providerId: 'firered-local', mode: 'soft' })
})

it('treats absent, malformed, mismatched, and unreadable lock files as unlocked', async () => {
  const logger = lockLogger()
  const root = await tempRoot()
  expect(readProviderLock(join(root, 'missing.json'), 'firered-local', logger)).toBeUndefined()
  expect(logger.warn).not.toHaveBeenCalled()

  expect(readProviderLock(await writeLock('{not json'), 'firered-local', logger)).toBeUndefined()
  expect(logger.warn).toHaveBeenCalled()

  logger.warn.mockClear()
  expect(readProviderLock(await writeLock(JSON.stringify({ providerId: 'sensevoice' })), 'firered-local', logger)).toBeUndefined()
  expect(logger.warn).toHaveBeenCalled()

  logger.warn.mockClear()
  expect(readProviderLock(await writeLock(JSON.stringify({ mode: 'sometimes' })), 'firered-local', logger)).toBeUndefined()
  expect(logger.warn).toHaveBeenCalled()

  logger.warn.mockClear()
  expect(readProviderLock(root, 'firered-local', logger)).toBeUndefined()
  expect(logger.warn).toHaveBeenCalled()
})

it('soft-locks initial and changed selections, then unsubscribes on dispose', async () => {
  const fake = fakeRuntime('sensevoice')
  const dispose = installProviderLock(fake.runtime, { providerId: 'firered-local', mode: 'soft' })
  await vi.waitFor(() => {
    expect(fake.configure).toHaveBeenCalledWith({ providerId: 'firered-local' })
    expect(fake.state.selection).toBe('firered-local')
  })

  fake.configure.mockClear()
  fake.state.selection = 'sensevoice'
  fake.wake()
  await vi.waitFor(() => { expect(fake.configure).toHaveBeenCalledTimes(1) })
  expect(fake.state.selection).toBe('firered-local')

  dispose()
  fake.configure.mockClear()
  fake.state.selection = 'sensevoice'
  fake.wake()
  expect(fake.configure).not.toHaveBeenCalled()
})

it('does not call configure when the locked provider is already selected', () => {
  const fake = fakeRuntime('firered-local')
  const dispose = installProviderLock(fake.runtime, { providerId: 'firered-local', mode: 'soft' })
  expect(fake.configure).not.toHaveBeenCalled()
  dispose()
})

it('warns instead of throwing when configure fails', async () => {
  const fake = fakeRuntime('sensevoice', true)
  const dispose = installProviderLock(fake.runtime, { providerId: 'firered-local', mode: 'soft' })
  await vi.waitFor(() => { expect(fake.runtime.logger.warn).toHaveBeenCalled() })
  expect(() => dispose()).not.toThrow()
})

it('hard-locks configure/resolve and restores both on dispose', async () => {
  const fake = fakeRuntime('firered-local')
  const dispose = installProviderLock(fake.runtime, { providerId: 'firered-local', mode: 'hard' })

  await expect(fake.speech.configure({ providerId: 'sensevoice' as SpeechProviderId })).rejects.toThrow('locked')
  await fake.speech.configure({ providerId: 'firered-local' as SpeechProviderId })
  await fake.speech.configure({ language: 'zh' })
  expect(fake.state.selection).toBe('firered-local')

  const request: SpeechRequest = { audio: new Uint8Array([1]), providerId: 'sensevoice' as SpeechProviderId, language: 'zh' }
  fake.speech.resolve(request)
  expect(fake.resolve).toHaveBeenCalledWith({ ...request, providerId: 'firered-local' })

  dispose()
  await fake.speech.configure({ providerId: 'sensevoice' as SpeechProviderId })
  expect(fake.state.selection).toBe('sensevoice')
})

it('falls back to soft lock when a hard wrapper cannot be installed', async () => {
  const fake = fakeRuntime('firered-local')
  Object.defineProperty(fake.speech, 'configure', { value: fake.speech.configure, writable: false, configurable: true })
  Object.defineProperty(fake.speech, 'resolve', { value: fake.speech.resolve, writable: false, configurable: true })
  const dispose = installProviderLock(fake.runtime, { providerId: 'firered-local', mode: 'hard' })
  expect(fake.runtime.logger.warn).toHaveBeenCalledWith(expect.stringContaining('hard provider lock'), expect.anything())
  expect(() => dispose()).not.toThrow()
})
