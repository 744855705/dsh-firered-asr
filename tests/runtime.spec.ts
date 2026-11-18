/** Downloads, extraction, verification, and offline paths for the FireRedASR2 runtime. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Config, DEFAULT_MODEL_URL, DEFAULT_PUNCTUATION_MODEL_URL } from '../src/config.ts'
import {
  downloadAsset, inspectRuntime, loadLock, prepareRuntime,
  type DownloadAsset, type FileAsset, type RuntimeLock,
} from '../src/runtime.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const close of cleanup.splice(0).reverse()) await close()
})

const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')
const signal = (): AbortSignal => new AbortController().signal

interface Fixture {
  root: string
  dataRoot: string
  modelDir: string
  bytes: { encoder: Buffer; decoder: Buffer; tokens: Buffer }
  vadBytes: Buffer
  lock: RuntimeLock
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-firered-runtime-'))
  cleanup.push(async () => { await rm(root, { recursive: true, force: true }) })
  const bytes = { encoder: Buffer.from('encoder-bytes'), decoder: Buffer.from('decoder-bytes'), tokens: Buffer.from('tokens-bytes') }
  const vadBytes = Buffer.from('vad-bytes')
  const file = (name: string, content: Buffer): FileAsset => ({ name, bytes: content.length, sha256: sha(content) })
  const lock: RuntimeLock = {
    archive: { name: 'fake.tar.bz2', url: DEFAULT_MODEL_URL, bytes: 10, sha256: sha(Buffer.from('archive')) },
    vad: { name: 'silero_vad.onnx', url: 'https://example.invalid/vad', fallbackUrl: 'https://mirror.invalid/vad', bytes: vadBytes.length, sha256: sha(vadBytes) },
    model: {
      directory: 'fake-model',
      encoder: file('encoder.int8.onnx', bytes.encoder),
      decoder: file('decoder.int8.onnx', bytes.decoder),
      tokens: file('tokens.txt', bytes.tokens),
    },
  }
  return { root, dataRoot: join(root, 'data'), modelDir: join(root, 'models', 'fake-model'), bytes, vadBytes, lock }
}

async function writeModel(dir: string, bytes: Fixture['bytes']): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'encoder.int8.onnx'), bytes.encoder)
  await writeFile(join(dir, 'decoder.int8.onnx'), bytes.decoder)
  await writeFile(join(dir, 'tokens.txt'), bytes.tokens)
}

async function writeVad(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
}

const PUNCT_MODEL = Buffer.from('punct-model-bytes')

async function writePunctuation(dir: string, bytes: Buffer = PUNCT_MODEL): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'model.int8.onnx'), bytes)
}

async function writeAsr(f: Fixture): Promise<void> {
  await writeModel(f.modelDir, f.bytes)
  await writeVad(join(f.modelDir, 'silero_vad.onnx'), f.vadBytes)
}

function punctuationLock(f: Fixture, archive: Buffer): RuntimeLock {
  return {
    ...f.lock,
    punctuation: {
      directory: 'fake-punct',
      archive: {
        name: 'punct.tar.bz2', url: DEFAULT_PUNCTUATION_MODEL_URL,
        bytes: archive.length, sha256: sha(archive),
      },
      model: { name: 'model.int8.onnx', bytes: PUNCT_MODEL.length, sha256: sha(PUNCT_MODEL) },
    },
  }
}

describe('runtime lock', () => {
  it('pins the published archive and extracted file identities', () => {
    const lock = loadLock()
    expect(lock.archive.url).toBe(DEFAULT_MODEL_URL)
    expect(lock.archive.bytes).toBe(838589068)
    expect(lock.archive.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(lock.model.encoder).toMatchObject({ name: 'encoder.int8.onnx', bytes: 817286833 })
    expect(lock.model.decoder).toMatchObject({ name: 'decoder.int8.onnx', bytes: 417291928 })
    expect(lock.model.tokens).toMatchObject({ name: 'tokens.txt', bytes: 79172 })
    expect(lock.punctuation).toMatchObject({
      directory: 'sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8',
      archive: { bytes: 64717756, url: DEFAULT_PUNCTUATION_MODEL_URL },
      model: { name: 'model.int8.onnx', bytes: 75519198 },
    })
  })
})

describe('inspectRuntime', () => {
  it('accepts a verified explicit model directory and rejects corruption without network access', async () => {
    const f = await fixture()
    await writeModel(f.modelDir, f.bytes)
    const vad = join(f.modelDir, 'silero_vad.onnx')
    await writeVad(vad, f.vadBytes)
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const config = Config({ dataRoot: f.dataRoot, modelDirectory: f.modelDir })
    expect(await inspectRuntime(config, signal(), f.lock)).toMatchObject({
      encoder: join(f.modelDir, 'encoder.int8.onnx'), decoder: join(f.modelDir, 'decoder.int8.onnx'),
      tokens: join(f.modelDir, 'tokens.txt'), vad,
    })
    await writeFile(join(f.modelDir, 'encoder.int8.onnx'), 'tampered')
    expect(await inspectRuntime(config, signal(), f.lock)).toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reports a missing model directory or VAD as unprepared', async () => {
    const f = await fixture()
    const config = Config({ dataRoot: f.dataRoot, modelDirectory: f.modelDir })
    expect(await inspectRuntime(config, signal(), f.lock)).toBeUndefined()
    await writeModel(f.modelDir, f.bytes)
    expect(await inspectRuntime(config, signal(), f.lock)).toBeUndefined()
    await writeVad(join(f.dataRoot, 'models', 'silero', 'silero_vad.onnx'), f.vadBytes)
    expect(await inspectRuntime(config, signal(), f.lock)).toBeDefined()
  })
})

describe('prepareRuntime', () => {
  it('uses an explicit model directory and downloads only a missing VAD', async () => {
    const f = await fixture()
    await writeModel(f.modelDir, f.bytes)
    const fetcher = vi.fn(async () => new Response(f.vadBytes)); vi.stubGlobal('fetch', fetcher)
    const report = vi.fn()
    const paths = await prepareRuntime(Config({ dataRoot: f.dataRoot, modelDirectory: f.modelDir }), signal(), report, f.lock)
    expect(paths.vad).toBe(join(f.dataRoot, 'models', 'silero', 'silero_vad.onnx'))
    expect(await readFile(paths.vad)).toEqual(f.vadBytes)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(report.mock.calls.map(([state]) => state.step)).toEqual(expect.arrayContaining(['model', 'vad', 'verify']))
  })

  it('fails verification for a tampered explicit model directory without downloading', async () => {
    const f = await fixture()
    await writeModel(f.modelDir, f.bytes)
    await writeFile(join(f.modelDir, 'decoder.int8.onnx'), 'tampered')
    await writeVad(join(f.modelDir, 'silero_vad.onnx'), f.vadBytes)
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(prepareRuntime(Config({ dataRoot: f.dataRoot, modelDirectory: f.modelDir }), signal(), () => {}, f.lock))
      .rejects.toThrow('verification failed')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('extracts a user archive, publishes it atomically, and downloads the VAD', async () => {
    const f = await fixture()
    const source = join(f.root, 'source'), model = join(source, 'fake-model')
    await writeModel(model, f.bytes)
    await mkdir(join(model, 'test_wavs'), { recursive: true })
    await writeFile(join(model, 'test_wavs', '0.wav'), 'fixture')
    const archive = join(f.root, 'fake.tar.bz2')
    execFileSync('tar', ['-cjf', archive, '-C', source, 'fake-model'])
    const fetcher = vi.fn(async () => new Response(f.vadBytes)); vi.stubGlobal('fetch', fetcher)
    const dataRoot = join(f.root, 'data2')
    const paths = await prepareRuntime(Config({ dataRoot, archivePath: archive }), signal(), () => {}, f.lock)
    expect(await readFile(paths.encoder)).toEqual(f.bytes.encoder)
    expect(await readdir(join(dataRoot, 'models'))).toContain('fake-model')
    expect(await readdir(join(dataRoot, 'models'))).not.toEqual(expect.arrayContaining([expect.stringContaining('.staging-')]))
    expect(await readFile(join(dataRoot, 'models', 'fake-model', 'test_wavs', '0.wav'), 'utf8')).toBe('fixture')
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('rejects a tampered archive and leaves no published model directory', async () => {
    const f = await fixture()
    const source = join(f.root, 'source'), model = join(source, 'fake-model')
    await writeModel(model, f.bytes)
    await writeFile(join(model, 'encoder.int8.onnx'), 'tampered')
    const archive = join(f.root, 'fake.tar.bz2')
    execFileSync('tar', ['-cjf', archive, '-C', source, 'fake-model'])
    const dataRoot = join(f.root, 'data3')
    await expect(prepareRuntime(Config({ dataRoot, archivePath: archive }), signal(), () => {}, f.lock))
      .rejects.toThrow('verification failed')
    const models = await readdir(join(dataRoot, 'models')).catch(() => [] as string[])
    expect(models).not.toContain('fake-model')
    expect(models).not.toEqual(expect.arrayContaining([expect.stringContaining('.staging-')]))
  })

  it('rejects a missing archive and a pre-aborted preparation', async () => {
    const f = await fixture()
    await expect(prepareRuntime(Config({ dataRoot: f.dataRoot, archivePath: join(f.root, 'missing.tar.bz2') }), signal(), () => {}, f.lock))
      .rejects.toThrow('not found')
    const abort = new AbortController(); abort.abort(new Error('cancelled'))
    await expect(prepareRuntime(Config({ dataRoot: f.dataRoot, archivePath: join(f.root, 'missing.tar.bz2') }), abort.signal, () => {}, f.lock))
      .rejects.toThrow('cancelled')
  })
})

describe('downloadAsset', () => {
  const assetFor = (bytes: Buffer, extra: Partial<DownloadAsset> = {}): DownloadAsset => ({
    name: 'model.tar.bz2', url: 'https://example.invalid/one', bytes: bytes.length, sha256: sha(bytes), ...extra,
  })

  it('publishes verified bytes, reuses them offline, and replaces corruption', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-firered-download-')); cleanup.push(async () => { await rm(root, { recursive: true, force: true }) })
    const bytes = Buffer.from('verified archive'), destination = join(root, 'cache', 'model.tar.bz2')
    const fetcher = vi.fn(async () => new Response(bytes)); vi.stubGlobal('fetch', fetcher)
    expect(await downloadAsset(assetFor(bytes), destination, signal())).toBe(destination)
    expect(await readFile(destination)).toEqual(bytes)
    await downloadAsset(assetFor(bytes), destination, signal())
    expect(fetcher).toHaveBeenCalledOnce()
    await writeFile(destination, 'corrupt')
    await downloadAsset(assetFor(bytes), destination, signal())
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect((await readdir(join(root, 'cache'))).filter(name => name.endsWith('.part'))).toEqual([])
  })

  it('rejects hash, byte, and HTTP failures without leaving partial files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-firered-download-')); cleanup.push(async () => { await rm(root, { recursive: true, force: true }) })
    const bytes = Buffer.from('verified archive'), destination = join(root, 'cache', 'model.tar.bz2')
    vi.stubGlobal('fetch', async () => new Response(bytes))
    await expect(downloadAsset({ ...assetFor(bytes), sha256: 'b'.repeat(64) }, destination, signal()))
      .rejects.toMatchObject({ download: { reason: 'integrity' } })
    await expect(downloadAsset({ ...assetFor(bytes), bytes: bytes.length - 1 }, destination, signal()))
      .rejects.toMatchObject({ download: { reason: 'integrity' } })
    vi.stubGlobal('fetch', async () => new Response(null, { status: 503 }))
    await expect(downloadAsset(assetFor(bytes), destination, signal()))
      .rejects.toMatchObject({ download: { reason: 'http', status: 503, source: 'https://example.invalid' } })
    expect(await readdir(join(root, 'cache'))).toEqual([])
  })

  it('uses the fallback origin only for retryable failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-firered-download-')); cleanup.push(async () => { await rm(root, { recursive: true, force: true }) })
    const bytes = Buffer.from('verified archive')
    const fetcher = vi.fn(async (url: string) => url.includes('mirror') ? new Response(bytes) : new Response(null, { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    const asset = assetFor(bytes, { fallbackUrl: 'https://mirror.invalid/two' })
    expect(await downloadAsset(asset, join(root, 'cache', 'model.tar.bz2'), signal())).toContain('model.tar.bz2')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('sanitizes network diagnostics and never exposes the signed URL or credentials', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-firered-download-')); cleanup.push(async () => { await rm(root, { recursive: true, force: true }) })
    const cause = Object.assign(new Error('private proxy details'), { code: 'ENOTFOUND' })
    vi.stubGlobal('fetch', async () => { throw new TypeError('fetch failed', { cause }) })
    const asset = assetFor(Buffer.from('x'), { url: 'https://user:secret@example.invalid/model?token=private' })
    await expect(downloadAsset(asset, join(root, 'cache', 'model.tar.bz2'), signal())).rejects.toMatchObject({
      message: 'Unable to prepare model.tar.bz2 from https://example.invalid: dns (ENOTFOUND)',
      download: { reason: 'dns', source: 'https://example.invalid', code: 'ENOTFOUND' },
    })
  })

  it('cancels an in-flight stream and removes its partial file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-firered-download-')); cleanup.push(async () => { await rm(root, { recursive: true, force: true }) })
    const bytes = Buffer.from('verified archive')
    const abort = new AbortController()
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.subarray(0, 2))
        abort.signal.addEventListener('abort', () => { controller.error(abort.signal.reason) }, { once: true })
      },
    })))
    const pending = downloadAsset(assetFor(bytes), join(root, 'cache', 'model.tar.bz2'), abort.signal)
    const rejected = expect(pending).rejects.toThrow()
    setTimeout(() => { abort.abort(new Error('cancelled')) }, 20)
    await rejected
    const entries = await readdir(join(root, 'cache')).catch(() => [] as string[])
    expect(entries).toEqual([])
  })
})

describe('punctuation runtime', () => {
  it('marks an enabled but missing punctuation model as needing preparation', async () => {
    const f = await fixture()
    await writeAsr(f)
    const puncDir = join(f.root, 'punct')
    await writePunctuation(puncDir)
    const lock = punctuationLock(f, Buffer.from('archive'))
    const config = Config({ dataRoot: f.dataRoot, modelDirectory: f.modelDir, punctuationModelDirectory: puncDir })
    const ready = await inspectRuntime(config, signal(), lock)
    expect(ready?.punctuationModel).toBe(join(puncDir, 'model.int8.onnx'))
    await rm(join(puncDir, 'model.int8.onnx'))
    expect(await inspectRuntime(config, signal(), lock)).toBeUndefined()
    await writePunctuation(puncDir)
    const disabled = await inspectRuntime(Config({ dataRoot: f.dataRoot, modelDirectory: f.modelDir,
      punctuationModelDirectory: puncDir, punctuation: false }), signal(), lock)
    expect(disabled?.punctuationModel).toBeUndefined()
    expect(disabled).toBeDefined()
  })

  it('fails open when an explicit punctuation directory is missing', async () => {
    const f = await fixture()
    await writeAsr(f)
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const config = Config({ dataRoot: f.dataRoot, modelDirectory: f.modelDir,
      punctuationModelDirectory: join(f.root, 'missing-punct') })
    const paths = await prepareRuntime(config, signal(), () => {}, punctuationLock(f, Buffer.from('archive')))
    expect(paths.encoder).toBe(join(f.modelDir, 'encoder.int8.onnx'))
    expect(paths.punctuationModel).toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('downloads and extracts punctuation within the model step', async () => {
    const f = await fixture()
    await writeAsr(f)
    const source = join(f.root, 'punct-source'), dir = join(source, 'fake-punct')
    await writePunctuation(dir)
    const archive = join(f.root, 'punct.tar.bz2')
    execFileSync('tar', ['-cjf', archive, '-C', source, 'fake-punct'])
    const archiveBytes = await readFile(archive)
    const lock = punctuationLock(f, archiveBytes)
    const fetcher = vi.fn(async () => new Response(archiveBytes)); vi.stubGlobal('fetch', fetcher)
    const report = vi.fn()
    const dataRoot = join(f.root, 'data-punct')
    const paths = await prepareRuntime(Config({ dataRoot, modelDirectory: f.modelDir }), signal(), report, lock)
    expect(paths.punctuationModel).toBe(join(dataRoot, 'models', 'fake-punct', 'model.int8.onnx'))
    expect(await readFile(paths.punctuationModel!)).toEqual(PUNCT_MODEL)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(report.mock.calls.map(([state]) => state.step)).toContain('model')
  })

  it('fails open on a punctuation download or integrity failure and keeps ASR prepared', async () => {
    const f = await fixture()
    await writeAsr(f)
    const lock = punctuationLock(f, Buffer.from('not-a-tar'))
    vi.stubGlobal('fetch', async () => new Response(null, { status: 503 }))
    const failed = await prepareRuntime(Config({ dataRoot: join(f.root, 'data-punct-fail'), modelDirectory: f.modelDir }),
      signal(), () => {}, lock)
    expect(failed.encoder).toBe(join(f.modelDir, 'encoder.int8.onnx'))
    expect(failed.punctuationModel).toBeUndefined()
    vi.stubGlobal('fetch', async () => new Response(Buffer.from('not-a-tar')))
    const wrong = punctuationLock(f, Buffer.from('different-archive'))
    const mismatch = await prepareRuntime(Config({ dataRoot: join(f.root, 'data-punct-bad'), modelDirectory: f.modelDir }),
      signal(), () => {}, wrong)
    expect(mismatch.punctuationModel).toBeUndefined()
  })
})
