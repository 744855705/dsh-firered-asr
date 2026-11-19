import z from '@deepseek-ai/schemastery';
/**
 * Default cache root shared by every profile on the machine: `$DSH_HOME` when
 * non-blank, otherwise `~/.dsh`, then `speech-to-text/firered`. This mirrors the
 * official `resolveDshHome` precedence without adding an official runtime
 * dependency, and keeps the path independent of the profile directory.
 * @param env - environment mapping to read `DSH_HOME` from.
 * @param home - operating-system home used when `DSH_HOME` is absent or blank.
 * @returns the normalized absolute cache root.
 */
export declare function defaultDataRoot(env?: Record<string, string | undefined>, home?: string): string;
/** Release-pinned archive URL; an override must also provide `modelSha256`. */
export declare const DEFAULT_MODEL_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2";
/** Release-pinned CT-Transformer punctuation archive URL; an override must also provide `punctuationModelSha256`. */
export declare const DEFAULT_PUNCTUATION_MODEL_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2";
/** Local runtime, inference, segmentation, and retention settings. */
export interface Config {
    /** Unique registration id; consumers select this exact id. */
    providerId: string;
    /** Absolute directory for verified ONNX models and the download cache. */
    dataRoot: string;
    /** Existing absolute directory containing encoder.int8.onnx, decoder.int8.onnx, tokens.txt and optionally silero_vad.onnx; skips the model archive. */
    modelDirectory?: string | undefined;
    /** Existing absolute tar.bz2 containing the model files; skips the download. */
    archivePath?: string | undefined;
    /** HTTPS archive URL; overriding it requires `modelSha256`. */
    modelUrl: string;
    /** Expected SHA-256 of the archive; required when `modelUrl` is overridden. */
    modelSha256?: string | undefined;
    /** Enable the optional CT-Transformer punctuation model; a missing or failed model returns unpunctuated text. */
    punctuation: boolean;
    /** Existing absolute directory containing model.int8.onnx; skips the punctuation archive. */
    punctuationModelDirectory?: string | undefined;
    /** HTTPS punctuation archive URL; overriding it requires `punctuationModelSha256`. */
    punctuationModelUrl: string;
    /** Expected SHA-256 of the punctuation archive; required when `punctuationModelUrl` is overridden. */
    punctuationModelSha256?: string | undefined;
    /** CPU intra-operation thread count. */
    threads: number;
    /** Recordings at or below this duration use one stream instead of VAD segmentation. */
    directDecodeSeconds: number;
    /** Maximum VAD speech segment before padding; also bounds one decoded window. */
    segmentSeconds: number;
    /** Silero speech probability threshold. */
    vadThreshold: number;
    /** Minimum speech duration retained by VAD. */
    minSpeechSeconds: number;
    /** Silence separating two speech segments. */
    minSilenceSeconds: number;
    /** Samples restored before every VAD segment onset, never crossing the previous segment. */
    vadOnsetPaddingSeconds: number;
    /** Samples appended after every VAD segment end, never beyond the recording. */
    vadTailPaddingSeconds: number;
    /** Maximum decoded WAV bytes accepted by the private worker. */
    maxAudioBytes: number;
    /** Deadline for preparation, archive extraction, and cold model loading. */
    prepareTimeoutMs: number;
    /** Deadline for one inference after the worker is ready. */
    inferenceTimeoutMs: number;
    /** Idle period before stopping the worker (default two hours); zero keeps it warm. */
    idleTimeoutMs: number;
    /** Maximum accepted running and waiting transcriptions. */
    maxPending: number;
    /** Managed process termination grace period. */
    graceMs: number;
    /** Maximum retained worker diagnostic bytes. */
    maxLogBytes: number;
    /** Maximum transcript response bytes. */
    maxResponseBytes: number;
    /** Minimum interval between intermediate download progress notifications. */
    progressIntervalMs: number;
}
/** Validate deployment-varying runtime choices at plugin activation. */
export declare const Config: z<Partial<Config>, Config>;
/**
 * Validate deployment-varying choices before registration.
 * @param config - schema-validated configuration.
 * @throws when a path is relative, two offline sources are mixed, a URL is unsafe,
 *   an override lacks its hash, or VAD padding leaves no room for speech.
 */
export declare function validateConfig(config: Config): void;
