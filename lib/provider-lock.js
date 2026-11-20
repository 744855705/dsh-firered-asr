/**
 * Optional provider selection lock backed by a JSON file outside the profile.
 *
 * The file is user-managed and read-only for this plugin: it is never created,
 * written, watched, or opened with an exclusive lock. All read/decode/parse
 * failures degrade to "unlocked" so a malformed or temporarily unavailable file
 * can never make the plugin fail to start (including on Windows).
 */
import { readFileSync } from 'node:fs';
import { TextDecoder } from 'node:util';
/**
 * Decode a lock-file buffer without throwing on unusual Windows encodings:
 * UTF-8 (BOM allowed), UTF-16LE, and UTF-16BE (byte-swapped to LE).
 * @param bytes - complete file contents.
 * @returns decoded text; decoding errors propagate to the caller.
 */
function decodeLock(bytes) {
    const first = bytes[0];
    const second = bytes[1];
    if (first === 0xFF && second === 0xFE) {
        return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (first === 0xFE && second === 0xFF) {
        const swapped = Buffer.from(bytes.subarray(2));
        swapped.swap16();
        return new TextDecoder('utf-16le').decode(swapped);
    }
    return new TextDecoder('utf-8').decode(bytes);
}
/**
 * Read and validate the optional provider-lock file. The file is optional:
 * absence means unlocked, and every failure is reported once and treated as
 * unlocked so plugin startup is never blocked by the lock file.
 * @param path - absolute lock-file path.
 * @param expectedProviderId - provider id this plugin can enforce.
 * @param logger - host logger for one-line diagnostics.
 * @returns the validated lock, or undefined when absent/invalid.
 */
export function readProviderLock(path, expectedProviderId, logger) {
    let bytes;
    try {
        bytes = readFileSync(path);
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            logger.warn(`FireRedASR2 lock file could not be read: ${path}`, error);
        }
        return undefined;
    }
    let value;
    try {
        const text = decodeLock(bytes).replace(/^\uFEFF/u, '').trim();
        value = JSON.parse(text);
    }
    catch (error) {
        logger.warn(`FireRedASR2 lock file is not valid JSON: ${path}`, error);
        return undefined;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        logger.warn(`FireRedASR2 lock file must contain a JSON object: ${path}`);
        return undefined;
    }
    const record = value;
    const providerId = record.providerId;
    if (providerId !== undefined && (typeof providerId !== 'string' || providerId !== expectedProviderId)) {
        logger.warn(`FireRedASR2 lock file targets another provider: ${path}`);
        return undefined;
    }
    const mode = record.mode ?? 'soft';
    if (mode !== 'soft' && mode !== 'hard') {
        logger.warn(`FireRedASR2 lock file has an unsupported mode: ${path}`);
        return undefined;
    }
    return { providerId: expectedProviderId, mode };
}
/**
 * Install the hard-mode wrappers around the official speech service.
 * Failure to assign the wrappers logs once and falls back to soft lock.
 * @param runtime - speech service and logger.
 * @param target - provider id to force.
 * @returns disposer restoring only the wrappers still installed by this call.
 */
function installHardLock(runtime, target) {
    const speech = runtime.speechToText;
    const originalConfigure = speech.configure;
    const originalResolve = speech.resolve;
    const configure = async (patch) => {
        if (patch.providerId !== undefined && patch.providerId !== target) {
            throw new Error(`FireRedASR2 speech provider is locked to ${target}`);
        }
        await originalConfigure.call(speech, patch);
    };
    const resolve = (request) => originalResolve.call(speech, { ...request, providerId: target });
    let installed = false;
    try {
        speech.configure = configure;
        speech.resolve = resolve;
        installed = true;
    }
    catch (error) {
        runtime.logger.warn('FireRedASR2 hard provider lock is unavailable; falling back to soft lock', error);
        if (speech.configure === configure)
            speech.configure = originalConfigure;
        if (speech.resolve === resolve)
            speech.resolve = originalResolve;
        return () => { };
    }
    return () => {
        if (!installed)
            return;
        if (speech.configure === configure)
            speech.configure = originalConfigure;
        if (speech.resolve === resolve)
            speech.resolve = originalResolve;
        installed = false;
    };
}
/**
 * Install a soft or hard selection lock. Soft reasserts the target provider at
 * startup and whenever the official catalog changes; hard additionally blocks
 * other provider selections and forces resolve() to the target.
 * @param runtime - speech service and logger.
 * @param lock - validated lock file.
 * @returns disposer stopping the catalog observer and restoring hard wrappers.
 */
export function installProviderLock(runtime, lock) {
    const target = lock.providerId;
    const restore = lock.mode === 'hard' ? installHardLock(runtime, target) : () => { };
    let disposed = false;
    let inFlight = false;
    let rerun = false;
    const enforce = () => {
        if (disposed)
            return;
        if (inFlight) {
            rerun = true;
            return;
        }
        let current;
        try {
            current = runtime.speechToText.snapshot().selection.providerId;
        }
        catch (error) {
            runtime.logger.warn('FireRedASR2 provider lock could not read the current selection', error);
            return;
        }
        if (current === target)
            return;
        inFlight = true;
        void runtime.speechToText.configure({ providerId: target })
            .catch((error) => {
            if (!disposed)
                runtime.logger.warn(`FireRedASR2 provider lock could not select ${target}`, error);
        })
            .finally(() => {
            inFlight = false;
            if (rerun && !disposed) {
                rerun = false;
                enforce();
            }
        });
    };
    const controller = new AbortController();
    const watch = async () => {
        try {
            for await (const snapshot of runtime.speechToText.follow(controller.signal)) {
                if (snapshot.selection.providerId !== target)
                    enforce();
            }
        }
        catch (error) {
            if (!disposed && !controller.signal.aborted) {
                runtime.logger.warn('FireRedASR2 provider lock lost the speech catalog', error);
            }
        }
    };
    void watch();
    enforce();
    return () => {
        disposed = true;
        controller.abort();
        restore();
    };
}
//# sourceMappingURL=provider-lock.js.map