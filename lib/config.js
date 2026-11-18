/** Deployment configuration for the managed local FireRedASR2-AED recognizer. */
import { isAbsolute } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout';
/** Release-pinned archive URL; an override must also provide `modelSha256`. */
export const DEFAULT_MODEL_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2';
/** Release-pinned CT-Transformer punctuation archive URL; an override must also provide `punctuationModelSha256`. */
export const DEFAULT_PUNCTUATION_MODEL_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2';
/** Validate deployment-varying runtime choices at plugin activation. */
export const Config = z.object({
    providerId: z.string().min(1).default('firered-local'),
    dataRoot: z.string().min(1).required(),
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
    idleTimeoutMs: z.natural().max(MAX_TIMER_DELAY_MS).default(300_000),
    maxPending: z.natural().min(1).default(4),
    graceMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(1000),
    maxLogBytes: z.natural().min(1).default(64 * 1024),
    maxResponseBytes: z.natural().min(1).default(128 * 1024),
    progressIntervalMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(100),
});
/** Reject a model URL that is not HTTPS or embeds credentials. */
function validateHttpsModelUrl(value, name) {
    let url;
    try {
        url = new URL(value);
    }
    catch (error) {
        throw new Error(`FireRedASR2 ${name} is not a valid URL`, { cause: error });
    }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
        throw new Error(`FireRedASR2 ${name} must be an HTTPS URL without credentials`);
    }
}
/**
 * Validate deployment-varying choices before registration.
 * @param config - schema-validated configuration.
 * @throws when a path is relative, two offline sources are mixed, a URL is unsafe,
 *   an override lacks its hash, or VAD padding leaves no room for speech.
 */
export function validateConfig(config) {
    for (const path of [config.dataRoot, config.modelDirectory, config.archivePath, config.punctuationModelDirectory]) {
        if (path !== undefined && !isAbsolute(path))
            throw new Error(`FireRedASR2 paths must be absolute: ${path}`);
    }
    if (config.modelDirectory !== undefined && config.archivePath !== undefined) {
        throw new Error('FireRedASR2 accepts either modelDirectory or archivePath, not both');
    }
    validateHttpsModelUrl(config.modelUrl, 'modelUrl');
    validateHttpsModelUrl(config.punctuationModelUrl, 'punctuationModelUrl');
    if (config.modelUrl !== DEFAULT_MODEL_URL && config.modelSha256 === undefined) {
        throw new Error('FireRedASR2 modelSha256 is required when modelUrl is overridden');
    }
    if (config.punctuationModelUrl !== DEFAULT_PUNCTUATION_MODEL_URL && config.punctuationModelSha256 === undefined) {
        throw new Error('FireRedASR2 punctuationModelSha256 is required when punctuationModelUrl is overridden');
    }
    if (config.segmentSeconds - config.vadOnsetPaddingSeconds - config.vadTailPaddingSeconds < 0.5) {
        throw new Error('FireRedASR2 segmentSeconds must leave at least 0.5s after VAD padding');
    }
}
//# sourceMappingURL=config.js.map