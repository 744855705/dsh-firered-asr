import type { SpeechPreparationState } from '@deepseek-ai/dsh-experimental-speech-to-text/types';
import type { Config } from './config.ts';
/** One pinned file with its exact byte count and SHA-256. */
export interface FileAsset {
    readonly name: string;
    readonly bytes: number;
    readonly sha256: string;
}
/** One downloadable file; `bytes` is omitted when a manual URL has no pinned size. */
export interface DownloadAsset extends Omit<FileAsset, 'bytes'> {
    readonly bytes?: number;
    readonly url: string;
    readonly fallbackUrl?: string;
}
/** Optional CT-Transformer punctuation archive and extracted model identity. */
export interface PunctuationLock {
    readonly directory: string;
    readonly archive: DownloadAsset;
    readonly model: FileAsset;
}
/** Release-pinned archive, VAD, and extracted model identity. */
export interface RuntimeLock {
    readonly archive: DownloadAsset;
    readonly vad: DownloadAsset;
    readonly model: {
        readonly directory: string;
        readonly encoder: FileAsset;
        readonly decoder: FileAsset;
        readonly tokens: FileAsset;
    };
    /** Missing on older/injected locks, which simply disables punctuation. */
    readonly punctuation?: PunctuationLock | undefined;
}
/** Prepared model, VAD, punctuation, and worker paths, private to the local provider. */
export interface RuntimePaths {
    readonly encoder: string;
    readonly decoder: string;
    readonly tokens: string;
    readonly vad: string;
    readonly worker: string;
    /** Verified punctuation model; absent means fail-open without punctuation. */
    readonly punctuationModel?: string | undefined;
}
/** Resolved locations before any file is touched. */
export interface RuntimeTargets {
    readonly modelRoot: string;
    readonly archivePath: string;
    readonly vadPath: string;
    readonly vadCandidates: readonly string[];
    readonly punctuationRoot: string | undefined;
    readonly punctuationArchivePath: string | undefined;
    readonly worker: string;
}
/**
 * Read the pinned runtime manifest shipped beside `lib/`.
 * @returns the parsed lock file.
 */
export declare function loadLock(): RuntimeLock;
/**
 * Resolve private paths for one configuration without reading or creating anything.
 * @param config - validated plugin configuration.
 * @param lock - pinned asset identity.
 * @returns the model root, archive cache, VAD candidates, and worker entry.
 */
export declare function resolveTargets(config: Config, lock: RuntimeLock): RuntimeTargets;
/**
 * Verify the three extracted ASR model files against their pinned size and hash.
 * @param root - directory containing the pinned file names.
 * @param lock - pinned asset identity.
 * @param signal - preparation cancellation.
 * @returns true only when all three files exist and match.
 */
export declare function verifyModelFiles(root: string, lock: RuntimeLock, signal: AbortSignal): Promise<boolean>;
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
export declare function downloadAsset(asset: DownloadAsset, destination: string, signal: AbortSignal, report?: (state: SpeechPreparationState) => void): Promise<string>;
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
export declare function extractArchive(archive: string, destination: string, lock: RuntimeLock, graceMs: number, signal: AbortSignal): Promise<void>;
/**
 * Inspect existing models without downloading, writing files, or starting the worker.
 *
 * When punctuation is enabled and the pinned lock includes a punctuation model, that model is
 * required for readiness too: a missing model marks the provider `unprepared`, which is the only
 * state where the official preparation card shows its Prepare button. An already loaded worker
 * keeps its runtime and remains fail-open if the file later disappears.
 * @param config - model paths and inference settings.
 * @param signal - provider cancellation or inspection deadline.
 * @param lock - pinned asset identity, injectable for tests.
 * @returns cached paths when all required files exist and match their pinned size and hash; otherwise undefined.
 */
export declare function inspectRuntime(config: Config, signal: AbortSignal, lock?: RuntimeLock): Promise<RuntimePaths | undefined>;
/**
 * Resolve and verify all model resources, downloading only what the user asked preparation to fetch.
 * @param config - model paths, download policy, and extraction settings.
 * @param signal - preparation cancellation or deadline.
 * @param report - Host-owned progress publisher.
 * @param lock - pinned asset identity, injectable for tests.
 * @returns verified model, VAD, and worker paths.
 */
export declare function prepareRuntime(config: Config, signal: AbortSignal, report?: (state: SpeechPreparationState) => void, lock?: RuntimeLock): Promise<RuntimePaths>;
