/** Provider registration through the real speechToText service, without loading a model. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import SpeechToText from '@deepseek-ai/dsh-experimental-speech-to-text'
import { afterEach, expect, it, vi } from 'vitest'
import * as Provider from '../src/index.ts'
import { Config } from '../src/config.ts'
import { createFakeSubprocess } from './support/fake-subprocess.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

class FakeSubprocess extends Service {
  private readonly fake = createFakeSubprocess()
  constructor(ctx: Context) { super(ctx, 'subprocess') }
  spawn(spec: Parameters<typeof this.fake.spawn>[0]) { return this.fake.spawn(spec) }
}

it('registers the local provider, advertises Chinese and English, and rejects ja', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-firered-provider-'))
  vi.stubEnv('DSH_HOME', root)
  const ctx = new Context()
  cleanup.push(async () => { await ctx.fiber.dispose() })
  cleanup.push(async () => { await rm(root, { recursive: true, force: true }) })
  cleanup.push(async () => { vi.unstubAllEnvs() })
  await ctx.plugin(FakeSubprocess)
  await ctx.plugin(SpeechToText, { defaultProvider: 'firered-local', language: 'auto' })
  const fiber = ctx.plugin(Provider, Config({ dataRoot: root, idleTimeoutMs: 0 }))
  await fiber
  const speech = ctx.get('speechToText')!
  expect(speech.listProviders()).toMatchObject([{
    id: 'firered-local', name: 'FireRedASR2-AED (int8)', location: 'host-local', languages: ['auto', 'zh', 'en'],
    setupEstimate: { recommendedDiskBytes: 2_600_000_000, expectedMemoryBytes: 4_000_000_000, minimumMinutes: 2, maximumMinutes: 20 },
  }])
  await vi.waitFor(() => { expect(speech.snapshot().providers[0]?.preparation.phase).toBe('unprepared') })
  expect(() => speech.resolve({ providerId: 'firered-local', language: 'ja', audio: new Uint8Array() })).toThrow('does not support language')
  expect(speech.resolve({ providerId: 'firered-local', language: 'zh', audio: new Uint8Array() })).toMatchObject({ language: 'zh' })
  await fiber.dispose()
  expect(speech.listProviders()).toEqual([])
})

it('installs the hard lock on the real speech service', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-firered-provider-hard-'))
  vi.stubEnv('DSH_HOME', root)
  await writeFile(join(root, 'firered-asr-lock.json'), JSON.stringify({ providerId: 'firered-local', mode: 'hard' }))
  const ctx = new Context()
  cleanup.push(async () => { await ctx.fiber.dispose() })
  cleanup.push(async () => { await rm(root, { recursive: true, force: true }) })
  cleanup.push(async () => { vi.unstubAllEnvs() })
  await ctx.plugin(FakeSubprocess)
  await ctx.plugin(SpeechToText, { defaultProvider: 'firered-local', language: 'auto' })
  const fiber = ctx.plugin(Provider, Config({ dataRoot: root, idleTimeoutMs: 0 }))
  await fiber
  const speech = ctx.get('speechToText')!
  await expect(speech.configure({ providerId: 'sensevoice' as SpeechProviderId })).rejects.toThrow('locked')
  const spec = speech.resolve({ providerId: 'sensevoice' as SpeechProviderId, language: 'zh', audio: new Uint8Array() })
  expect(spec.provider.info.id).toBe('firered-local')
  await fiber.dispose()
})
