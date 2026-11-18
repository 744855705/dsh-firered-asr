/** Verified runtime assets, archive extraction, and managed download publication for local transcription. */
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, readFileSync } from 'node:fs'
import { access, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import type { SpeechPreparationState } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { Config } from './config.ts'
import { classifyDownloadFailure, SpeechDownloadError } from './download-error.ts'

/** One pinned file with its exact byte count and SHA-256. */
export interface FileAsset {
  readonly name: string
  readonly bytes: number
  readonly sha256: string
}

/** One downloadable file; `bytes` is omitted when a manual URL has no pinned size. */
export interface DownloadAsset extends Omit<FileAsset, 'bytes'> {
  readonly bytes?: number
  readonly url: string
  readonly fallbackUrl?: string
}

/** Optional CT-Transformer punctuation archive and extracted model identity. */
export interface PunctuationLock {
  readonly directory: string
  readonly archive: DownloadAsset
  readonly model: FileAsset
}

/** Release-pinned archive, VAD, and extracted model identity. */
export interface RuntimeLock {
  readonly archive: DownloadAsset
  readonly vad: DownloadAsset
  readonly model: {
    readonly directory: string
    readonly encoder: FileAsset
    readonly decoder: FileAsset
    readonly tokens: FileAsset
  }
  /** Missing on older/injected locks, which simply disables punctuation. */
  readonly punctuation?: PunctuationLock | undefined
}

/** Prepared model, VAD, punctuation, and worker paths, private to the local provider. */
export interface RuntimePaths {
  readonly encoder: string
  readonly decoder: string
  readonly tokens: string
  readonly vad: string
  readonly worker: string
  /** Verified punctuation model; absent means fail-open without punctuation. */
  readonly punctuationModel?: string | undefined
}

/** Resolved locations before any file is touched. */
export interface RuntimeTargets {
  readonly modelRoot: string
  readonly archivePath: string
  readonly vadPath: string
  readonly vadCandidates: readonly string[]
  readonly punctuationRoot: string | undefined
  readonly punctuationArchivePath: string | undefined
  readonly worker: string
}

/**
 * Read the pinned runtime manifest shipped beside `lib/`.
 * @returns the parsed lock file.
 */
export function loadLock(): RuntimeLock {
  return JSON.parse(readFileSync(new URL('../runtime/assets.json', import.meta.url), 'utf8')) as RuntimeLock
}

/**
 * Resolve private paths for one configuration without reading or creating anything.
 * @param config - validated plugin configuration.
 * @param lock - pinned asset identity.
 * @returns the model root, archive cache, VAD candidates, and worker entry.
 */
export function resolveTargets(config: Config, lock: RuntimeLock): RuntimeTargets {
  const modelRoot = config.modelDirectory ?? join(config.dataRoot, 'models', lock.model.directory)
  const vadCandidates = [
    ...(config.modelDirectory === undefined ? [] : [join(config.modelDirectory, lock.vad.name)]),
    join(config.dataRoot, 'models', 'silero', lock.vad.name),
  ]
  const punctuation = lock.punctuation
  const punctuationRoot = !config.punctuation || punctuation === undefined ? undefined
    : config.punctuationModelDirectory ?? join(config.dataRoot, 'models', punctuation.directory)
  const punctuationArchivePath = !config.punctuation || punctuation === undefined || config.punctuationModelDirectory !== undefined
    ? undefined : join(config.dataRoot, 'cache', punctuation.archive.name)
  return {
    modelRoot,
    archivePath: config.archivePath ?? join(config.dataRoot, 'cache', lock.archive.name),
    vadPath: vadCandidates[vadCandidates.length - 1]!,
    vadCandidates,
    punctuationRoot,
    punctuationArchivePath,
    worker: fileURLToPath(new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url)),
  }
}

async function hashFile(path: string, signal: AbortSignal): Promise<string> {
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path, { signal })) digest.update(chunk as Buffer)
  return digest.digest('hex')
}

async function matchesFile(path: string, asset: FileAsset | DownloadAsset, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted()
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new Error(`Speech asset is not a regular file: ${path}`)
    if (asset.bytes !== undefined && info.size !== asset.bytes) return false
    return await hashFile(path, signal) === asset.sha256
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
}

async function matchesDownload(path: string, asset: DownloadAsset, signal: AbortSignal): Promise<boolean> {
  signal.throwIfAborted()
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new Error(`Speech asset is not a regular file: ${path}`)
    if (asset.bytes !== undefined && info.size !== asset.bytes) return false
    return await hashFile(path, signal) === asset.sha256
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return false
  }
}

async function verifyFiles(root: string, files: readonly FileAsset[], signal: AbortSignal): Promise<boolean> {
  for (const asset of files) {
    if (!await matchesFile(join(root, asset.name), asset, signal)) return false
  }
  return true
}

/**
 * Verify the three extracted ASR model files against their pinned size and hash.
 * @param root - directory containing the pinned file names.
 * @param lock - pinned asset identity.
 * @param signal - preparation cancellation.
 * @returns true only when all three files exist and match.
 */
export async function verifyModelFiles(root: string, lock: RuntimeLock, signal: AbortSignal): Promise<boolean> {
  return await verifyFiles(root, [lock.model.encoder, lock.model.decoder, lock.model.tokens], signal)
}

async function pickVad(targets: RuntimeTargets, lock: RuntimeLock, signal: AbortSignal): Promise<string> {
  for (const candidate of targets.vadCandidates) {
    if (await matchesFile(candidate, lock.vad, signal)) return candidate
  }
  return targets.vadPath
}

function archiveAssetFor(config: Config, lock: RuntimeLock): DownloadAsset {
  if (config.modelUrl === lock.archive.url && config.modelSha256 === undefined) return lock.archive
  const sha256 = config.modelSha256
  if (sha256 === undefined) throw new Error('modelSha256 is required when modelUrl is overridden')
  const bytes = config.modelUrl === lock.archive.url && sha256 === lock.archive.sha256 ? lock.archive.bytes : undefined
  return { name: lock.archive.name, url: config.modelUrl, sha256, ...bytes === undefined ? {} : { bytes } }
}

function punctuationArchiveAssetFor(config: Config, punctuation: PunctuationLock): DownloadAsset {
  if (config.punctuationModelUrl === punctuation.archive.url && config.punctuationModelSha256 === undefined) {
    return punctuation.archive
  }
  const sha256 = config.punctuationModelSha256
  if (sha256 === undefined) throw new Error('punctuationModelSha256 is required when punctuationModelUrl is overridden')
  const bytes = config.punctuationModelUrl === punctuation.archive.url && sha256 === punctuation.archive.sha256
    ? punctuation.archive.bytes : undefined
  return { name: punctuation.archive.name, url: config.punctuationModelUrl, sha256, ...bytes === undefined ? {} : { bytes } }
}

/**
 * Download one asset into a unique partial file, verify it, then publish it atomically.
 * The first URL is the configured source; `fallbackUrl` is tried only for network, HTTP,
 * certificate, and integrity failures. Cancellation, storage failures, and unclassified
 * failures stop preparation instead of silently switching sources.
 * @param asset - pinned release identity.
 * @param destination - final local file.
 * @param signal - preparation cancellation or deadline.
 * @param report - Host-owned progress publisher.
 * @returns verified local file path; failures carry localized-UI diagnostics through SpeechDownloadError.
 */
export async function downloadAsset(asset: DownloadAsset, destination: string, signal: AbortSignal,
  report: (state: SpeechPreparationState) => void = () => {}): Promise<string> {
  signal.throwIfAborted()
  await mkdir(dirname(destination), { recursive: true })
  if (await matchesDownload(destination, asset, signal)) return destination
  const urls = [asset.url, ...(asset.fallbackUrl === undefined ? [] : [asset.fallbackUrl])]
  let last: unknown
  for (const [index, url] of urls.entries()) {
    try {
      return await downloadFrom(url, asset, destination, signal, report)
    } catch (error) {
      last = error
      if (signal.aborted || !(error instanceof SpeechDownloadError)
        || error.download.reason === 'storage' || error.download.reason === 'unknown'
        || index === urls.length - 1) throw error
    }
  }
  throw last
}

async function downloadFrom(url: string, asset: DownloadAsset, destination: string, signal: AbortSignal,
  report: (state: SpeechPreparationState) => void): Promise<string> {
  const partial = `${destination}.${randomUUID()}.part`
  let source = new URL(url).origin
  try {
    const response = await fetch(url, { signal })
    source = new URL(response.url || url).origin
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      throw new SpeechDownloadError({ resource: asset.name, source, reason: 'http', status: response.status })
    }
    const contentLength = Number(response.headers.get('content-length'))
    const totalBytes = asset.bytes ?? (Number.isSafeInteger(contentLength) && contentLength > 0 ? contentLength : undefined)
    const digest = createHash('sha256')
    let completedBytes = 0
    const publish = (): void => {
      report({ phase: 'downloading', resource: asset.name, completedBytes, ...totalBytes === undefined ? {} : { totalBytes } })
    }
    publish()
    const hashing = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      completedBytes += chunk.length
      if (asset.bytes !== undefined && completedBytes > asset.bytes) {
        callback(new SpeechDownloadError({ resource: asset.name, source, reason: 'integrity' })); return
      }
      digest.update(chunk); publish(); callback(null, chunk)
    } })
    await pipeline(response.body, hashing, createWriteStream(partial, { flags: 'wx', mode: 0o600 }), { signal })
    if ((asset.bytes !== undefined && completedBytes !== asset.bytes) || digest.digest('hex') !== asset.sha256) {
      throw new SpeechDownloadError({ resource: asset.name, source, reason: 'integrity' })
    }
    signal.throwIfAborted()
    await rename(partial, destination)
    return destination
  } catch (error) {
    const timedOut = timeoutOf(signal)
    if (signal.aborted && !timedOut || error instanceof SpeechDownloadError) throw error
    throw new SpeechDownloadError({ resource: asset.name, source,
      ...timedOut ? { reason: 'timeout' } : classifyDownloadFailure(error),
    }, { cause: error })
  } finally {
    await rm(partial, { force: true })
  }
}

async function findModelDirectory(staging: string, files: readonly FileAsset[]): Promise<string> {
  const nested = (await readdir(staging, { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => join(staging, entry.name))
  for (const candidate of [staging, ...nested]) {
    try {
      for (const asset of files) await access(join(candidate, asset.name))
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  throw new Error(`FireRedASR2 model archive does not contain ${files.map(file => file.name).join(', ')}`)
}

function runTar(archive: string, staging: string, graceMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('tar', ['-xjf', archive, '-C', staging], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let settled = false
    let killer: ReturnType<typeof setTimeout> | undefined
    const onAbort = (): void => {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      killer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, graceMs)
      killer.unref()
    }
    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort)
      if (killer !== undefined) clearTimeout(killer)
    }
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      if (error === undefined) resolve()
      else reject(error)
    }
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4096) })
    child.once('error', (error: Error) => { finish(new Error(`Unable to run tar for model extraction: ${error.message}`, { cause: error })) })
    child.once('close', (code: number | null) => {
      if (signal.aborted) {
        finish(signal.reason instanceof Error ? signal.reason : new Error('FireRedASR2 model extraction cancelled'))
        return
      }
      if (code !== 0) {
        finish(new Error(`FireRedASR2 model extraction failed (tar exit ${String(code)}): ${stderr.trim().slice(0, 512)}`))
        return
      }
      finish()
    })
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
}

async function extractFiles(archive: string, destination: string, files: readonly FileAsset[],
  graceMs: number, signal: AbortSignal): Promise<void> {
  const staging = join(dirname(destination), `.staging-${randomUUID()}`)
  let published = false
  await mkdir(staging, { recursive: true })
  try {
    await runTar(archive, staging, graceMs, signal)
    signal.throwIfAborted()
    const source = await findModelDirectory(staging, files)
    if (!await verifyFiles(source, files, signal)) {
      throw new Error('FireRedASR2 model verification failed: extracted files do not match the pinned sizes and hashes')
    }
    signal.throwIfAborted()
    await mkdir(dirname(destination), { recursive: true })
    await rm(destination, { recursive: true, force: true })
    if (source === staging) {
      await rename(staging, destination)
      published = true
    } else {
      await rename(source, destination)
    }
  } finally {
    if (!published) await rm(staging, { recursive: true, force: true })
  }
}

/**
 * Extract the pinned ASR archive into a staging directory, verify the extracted files, then publish
 * the model directory atomically. Cancellation or failure removes staging; a previously valid
 * model directory is replaced only after the staged copy has been verified.
 * @param archive - existing tar.bz2.
 * @param destination - final model directory.
 * @param lock - pinned model identity.
 * @param graceMs - tar termination grace.
 * @param signal - preparation cancellation or deadline.
 */
export async function extractArchive(archive: string, destination: string, lock: RuntimeLock,
  graceMs: number, signal: AbortSignal): Promise<void> {
  await extractFiles(archive, destination, [lock.model.encoder, lock.model.decoder, lock.model.tokens], graceMs, signal)
}

async function ensureArchive(config: Config, targets: RuntimeTargets, lock: RuntimeLock,
  signal: AbortSignal, report: (state: SpeechPreparationState) => void): Promise<string> {
  if (config.archivePath !== undefined) {
    signal.throwIfAborted()
    const info = await stat(config.archivePath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`FireRedASR2 model archive not found: ${config.archivePath}`)
      }
      throw error
    })
    if (!info.isFile()) throw new Error(`FireRedASR2 model archive is not a regular file: ${config.archivePath}`)
    return config.archivePath
  }
  return await downloadAsset(archiveAssetFor(config, lock), targets.archivePath, signal,
    state => report({ ...state, step: 'model' }))
}

async function ensureVad(targets: RuntimeTargets, lock: RuntimeLock,
  signal: AbortSignal, report: (state: SpeechPreparationState) => void): Promise<string> {
  const existing = await pickVad(targets, lock, signal)
  if (await matchesFile(existing, lock.vad, signal)) return existing
  return await downloadAsset(lock.vad, targets.vadPath, signal, state => report({ ...state, step: 'vad' }))
}

async function inspectPunctuation(config: Config, targets: RuntimeTargets, lock: RuntimeLock,
  signal: AbortSignal): Promise<string | undefined> {
  const punctuation = lock.punctuation
  if (!config.punctuation || punctuation === undefined || targets.punctuationRoot === undefined) return undefined
  try {
    const path = join(targets.punctuationRoot, punctuation.model.name)
    return await matchesFile(path, punctuation.model, signal) ? path : undefined
  } catch (error) {
    if (signal.aborted) throw error
    return undefined
  }
}

/**
 * Ensure the optional punctuation model, failing open. An explicit offline directory is verified
 * but never downloaded; the managed path downloads and extracts the archive under the same `model`
 * preparation step. Any non-cancellation failure disables punctuation and keeps ASR available.
 */
async function ensurePunctuation(config: Config, targets: RuntimeTargets, lock: RuntimeLock,
  signal: AbortSignal, report: (state: SpeechPreparationState) => void): Promise<string | undefined> {
  const punctuation = lock.punctuation
  if (!config.punctuation || punctuation === undefined || targets.punctuationRoot === undefined) return undefined
  const path = join(targets.punctuationRoot, punctuation.model.name)
  try {
    if (await matchesFile(path, punctuation.model, signal)) return path
  } catch (error) {
    if (signal.aborted) throw error
    return undefined
  }
  if (config.punctuationModelDirectory !== undefined) return undefined
  const archivePath = targets.punctuationArchivePath
  if (archivePath === undefined) return undefined
  try {
    report({ phase: 'checking', step: 'model', startedAt: Date.now() })
    await downloadAsset(punctuationArchiveAssetFor(config, punctuation), archivePath, signal,
      state => report({ ...state, step: 'model' }))
    report({ phase: 'checking', step: 'model', startedAt: Date.now() })
    await extractFiles(archivePath, targets.punctuationRoot, [punctuation.model], config.graceMs, signal)
    return await matchesFile(path, punctuation.model, signal) ? path : undefined
  } catch (error) {
    if (signal.aborted) throw error
    return undefined
  }
}

/**
 * Inspect existing models without downloading, writing files, or starting the worker.
 * @param config - model paths and inference settings.
 * @param signal - provider cancellation or inspection deadline.
 * @param lock - pinned asset identity, injectable for tests.
 * @returns cached paths when all files exist and match their pinned size and hash; otherwise undefined.
 */
export async function inspectRuntime(config: Config, signal: AbortSignal, lock: RuntimeLock = loadLock()): Promise<RuntimePaths | undefined> {
  const targets = resolveTargets(config, lock)
  signal.throwIfAborted()
  if (!await verifyModelFiles(targets.modelRoot, lock, signal)) return undefined
  const vad = await pickVad(targets, lock, signal)
  if (!await matchesFile(vad, lock.vad, signal)) return undefined
  const punctuationModel = await inspectPunctuation(config, targets, lock, signal)
  return {
    encoder: join(targets.modelRoot, lock.model.encoder.name),
    decoder: join(targets.modelRoot, lock.model.decoder.name),
    tokens: join(targets.modelRoot, lock.model.tokens.name),
    vad,
    worker: targets.worker,
    ...punctuationModel === undefined ? {} : { punctuationModel },
  }
}

/**
 * Resolve and verify all model resources, downloading only what the user asked preparation to fetch.
 * @param config - model paths, download policy, and extraction settings.
 * @param signal - preparation cancellation or deadline.
 * @param report - Host-owned progress publisher.
 * @param lock - pinned asset identity, injectable for tests.
 * @returns verified model, VAD, and worker paths.
 */
export async function prepareRuntime(config: Config, signal: AbortSignal,
  report: (state: SpeechPreparationState) => void = () => {}, lock: RuntimeLock = loadLock()): Promise<RuntimePaths> {
  const targets = resolveTargets(config, lock)
  report({ phase: 'checking', step: 'model', startedAt: Date.now() })
  const modelRoot = targets.modelRoot
  if (config.modelDirectory === undefined && !await verifyModelFiles(modelRoot, lock, signal)) {
    const archive = await ensureArchive(config, targets, lock, signal, report)
    report({ phase: 'checking', step: 'model', startedAt: Date.now() })
    await extractArchive(archive, modelRoot, lock, config.graceMs, signal)
  }
  // The punctuation model shares the existing `model` step; its absence never fails ASR preparation.
  const punctuationModel = await ensurePunctuation(config, targets, lock, signal, report)
  report({ phase: 'checking', step: 'vad', startedAt: Date.now() })
  const vad = await ensureVad(targets, lock, signal, report)
  report({ phase: 'checking', step: 'verify', startedAt: Date.now() })
  if (!await verifyModelFiles(modelRoot, lock, signal) || !await matchesFile(vad, lock.vad, signal)) {
    throw new Error('FireRedASR2 model verification failed: missing or corrupted model files')
  }
  let verifiedPunctuation = punctuationModel
  if (verifiedPunctuation !== undefined) {
    try {
      const punctuation = lock.punctuation
      if (punctuation === undefined || !await matchesFile(verifiedPunctuation, punctuation.model, signal)) {
        verifiedPunctuation = undefined
      }
    } catch (error) {
      if (signal.aborted) throw error
      verifiedPunctuation = undefined
    }
  }
  return {
    encoder: join(modelRoot, lock.model.encoder.name),
    decoder: join(modelRoot, lock.model.decoder.name),
    tokens: join(modelRoot, lock.model.tokens.name),
    vad,
    worker: targets.worker,
    ...verifiedPunctuation === undefined ? {} : { punctuationModel: verifiedPunctuation },
  }
}
