/** Deployment configuration for the managed local FireRedASR2-AED recognizer. */
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { timeout } from './host.ts'

const { MAX_TIMER_DELAY_MS } = timeout

/** Expand a leading `~`, `~/`, or `~\` against the operating-system home. */
function expandHomePath(value: string, home: string): string {
  if (value === '~') return home
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(home, value.slice(2))
  return value
}

/**
 * Resolve the DeepSeek Harness home shared by every profile on the machine:
 * `$DSH_HOME` when non-blank, otherwise `~/.dsh`. The result is normalized to
 * an absolute path with platform path rules.
 * @param env - environment mapping to read `DSH_HOME` from.
 * @param home - operating-system home used when `DSH_HOME` is absent or blank.
 * @returns the normalized absolute harness home.
 */
export function defaultHarnessHome(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  const configured = env.DSH_HOME?.trim()
  return resolve(configured === undefined || configured.length === 0 ? join(home, '.dsh') : expandHomePath(configured, home))
}

/**
 * Default cache root shared by every profile on the machine:
 * `$DSH_HOME`/`~/.dsh` followed by `speech-to-text/firered`. This mirrors the
 * official `resolveDshHome` precedence without adding an official runtime
 * dependency, and keeps the path independent of the profile directory.
 * @param env - environment mapping to read `DSH_HOME` from.
 * @param home - operating-system home used when `DSH_HOME` is absent or blank.
 * @returns the normalized absolute cache root.
 */
export function defaultDataRoot(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(defaultHarnessHome(env, home), 'speech-to-text', 'firered')
}

/**
 * Provider-lock file under the shared harness home. It is deliberately outside
 * the profile so a profile refresh cannot remove it.
 * @param env - environment mapping to read `DSH_HOME` from.
 * @param home - operating-system home used when `DSH_HOME` is absent or blank.
 * @returns the normalized absolute lock-file path.
 */
export function defaultLockFile(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(defaultHarnessHome(env, home), 'firered-asr-lock.json')
}

/** Release-pinned archive URL; an override must also provide `modelSha256`. */
export const DEFAULT_MODEL_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2'

/** Release-pinned CT-Transformer punctuation archive URL; an override must also provide `punctuationModelSha256`. */
export const DEFAULT_PUNCTUATION_MODEL_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2'

/** Local runtime, inference, segmentation, and retention settings. */
export interface Config {
  /** Unique registration id; consumers select this exact id. */
  providerId: string
  /** Absolute directory for verified ONNX models and the download cache. */
  dataRoot: string
  /** Existing absolute directory containing encoder.int8.onnx, decoder.int8.onnx, tokens.txt and optionally silero_vad.onnx; skips the model archive. */
  modelDirectory?: string | undefined
  /** Existing absolute tar.bz2 containing the model files; skips the download. */
  archivePath?: string | undefined
  /** HTTPS archive URL; overriding it requires `modelSha256`. */
  modelUrl: string
  /** Expected SHA-256 of the archive; required when `modelUrl` is overridden. */
  modelSha256?: string | undefined
  /** Enable the optional CT-Transformer punctuation model; a missing or failed model returns unpunctuated text. */
  punctuation: boolean
  /** Existing absolute directory containing model.int8.onnx; skips the punctuation archive. */
  punctuationModelDirectory?: string | undefined
  /** HTTPS punctuation archive URL; overriding it requires `punctuationModelSha256`. */
  punctuationModelUrl: string
  /** Expected SHA-256 of the punctuation archive; required when `punctuationModelUrl` is overridden. */
  punctuationModelSha256?: string | undefined
  /** CPU intra-operation thread count. */
  threads: number
  /** Recordings at or below this duration use one stream instead of VAD segmentation. */
  directDecodeSeconds: number
  /** Maximum VAD speech segment before padding; also bounds one decoded window. */
  segmentSeconds: number
  /** Silero speech probability threshold. */
  vadThreshold: number
  /** Minimum speech duration retained by VAD. */
  minSpeechSeconds: number
  /** Silence separating two speech segments. */
  minSilenceSeconds: number
  /** Samples restored before every VAD segment onset, never crossing the previous segment. */
  vadOnsetPaddingSeconds: number
  /** Samples appended after every VAD segment end, never beyond the recording. */
  vadTailPaddingSeconds: number
  /** Maximum decoded WAV bytes accepted by the private worker. */
  maxAudioBytes: number
  /** Deadline for preparation, archive extraction, and cold model loading. */
  prepareTimeoutMs: number
  /** Deadline for one inference after the worker is ready. */
  inferenceTimeoutMs: number
  /** Idle period before stopping the worker (default two hours); zero keeps it warm. */
  idleTimeoutMs: number
  /** Maximum accepted running and waiting transcriptions. */
  maxPending: number
  /** Managed process termination grace period. */
  graceMs: number
  /** Maximum retained worker diagnostic bytes. */
  maxLogBytes: number
  /** Maximum transcript response bytes. */
  maxResponseBytes: number
  /** Minimum interval between intermediate download progress notifications. */
  progressIntervalMs: number
}

/** Validate deployment-varying runtime choices at plugin activation. */
export const Config: z<Partial<Config>, Config> = z.object({
  providerId: z.string().min(1).default('firered-local'),
  dataRoot: z.string().min(1).default(defaultDataRoot()),
  modelDirectory: z.union([z.string().min(1), z.const(undefined)]),
  archivePath: z.union([z.string().min(1), z.const(undefined)]),
  modelUrl: z.string().pattern(/^https:\/\/[^\s]+$/).default(DEFAULT_MODEL_URL),
  modelSha256: z.union([z.string().pattern(/^[a-f0-9]{64}$/), z.const(undefined)]),
  punctuation: z.boolean().default(true),
  punctuationModelDirectory: z.union([z.string().min(1), z.const(undefined)]),
  punctuationModelUrl: z.string().pattern(/^https:\/\/[^\s]+$/).default(DEFAULT_PUNCTUATION_MODEL_URL),
  punctuationModelSha256: z.union([z.string().pattern(/^[a-f0-9]{64}$/), z.const(undefined)]),
  threads: z.natural().min(1).default(8),
  directDecodeSeconds: z.number().min(1).max(120).default(30),
  segmentSeconds: z.number().min(1).max(120).default(30),
  vadThreshold: z.number().min(0).max(1).default(0.5),
  minSpeechSeconds: z.number().min(0).default(0.1),
  minSilenceSeconds: z.number().min(0.01).default(0.8),
  vadOnsetPaddingSeconds: z.number().min(0).max(2).default(0.3),
  vadTailPaddingSeconds: z.number().min(0).max(2).default(0.25),
  maxAudioBytes: z.natural().min(46).default(4 * 1024 * 1024),
  prepareTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(3_600_000),
  inferenceTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(600_000),
  idleTimeoutMs: z.natural().max(MAX_TIMER_DELAY_MS).default(7_200_000),
  maxPending: z.natural().min(1).default(4),
  graceMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(1000),
  maxLogBytes: z.natural().min(1).default(64 * 1024),
  maxResponseBytes: z.natural().min(1).default(128 * 1024),
  progressIntervalMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(100),
})

/** Reject a model URL that is not HTTPS or embeds credentials. */
function validateHttpsModelUrl(value: string, name: string): void {
  let url: URL
  try { url = new URL(value) }
  catch (error) { throw new Error(`FireRedASR2 ${name} is not a valid URL`, { cause: error }) }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error(`FireRedASR2 ${name} must be an HTTPS URL without credentials`)
  }
}

/**
 * Validate deployment-varying choices before registration.
 * @param config - schema-validated configuration.
 * @throws when a path is relative, two offline sources are mixed, a URL is unsafe,
 *   an override lacks its hash, or VAD padding leaves no room for speech.
 */
export function validateConfig(config: Config): void {
  for (const path of [config.dataRoot, config.modelDirectory, config.archivePath, config.punctuationModelDirectory]) {
    if (path !== undefined && !isAbsolute(path)) throw new Error(`FireRedASR2 paths must be absolute: ${path}`)
  }
  if (config.modelDirectory !== undefined && config.archivePath !== undefined) {
    throw new Error('FireRedASR2 accepts either modelDirectory or archivePath, not both')
  }
  validateHttpsModelUrl(config.modelUrl, 'modelUrl')
  validateHttpsModelUrl(config.punctuationModelUrl, 'punctuationModelUrl')
  if (config.modelUrl !== DEFAULT_MODEL_URL && config.modelSha256 === undefined) {
    throw new Error('FireRedASR2 modelSha256 is required when modelUrl is overridden')
  }
  if (config.punctuationModelUrl !== DEFAULT_PUNCTUATION_MODEL_URL && config.punctuationModelSha256 === undefined) {
    throw new Error('FireRedASR2 punctuationModelSha256 is required when punctuationModelUrl is overridden')
  }
  if (config.segmentSeconds - config.vadOnsetPaddingSeconds - config.vadTailPaddingSeconds < 0.5) {
    throw new Error('FireRedASR2 segmentSeconds must leave at least 0.5s after VAD padding')
  }
}
