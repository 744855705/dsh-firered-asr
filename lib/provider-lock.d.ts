import type { SpeechRequest, SpeechSelectionPatch, SpeechSpec } from '@deepseek-ai/dsh-experimental-speech-to-text/types';
/** Lock behaviour: soft reasserts, hard also blocks/forces the official service. */
export type ProviderLockMode = 'soft' | 'hard';
/** Validated lock-file contents. */
export interface ProviderLock {
    readonly providerId: string;
    readonly mode: ProviderLockMode;
}
/** Minimal logger consumed by the lock reader; `ctx.logger` satisfies it. */
export interface LockLogger {
    warn(message: string, error?: unknown): void;
}
/** Minimal speech-service surface used by the lock; the real service satisfies it. */
export interface LockSpeechService {
    snapshot(): {
        selection: {
            providerId: string;
        };
    };
    configure(patch: SpeechSelectionPatch): Promise<void>;
    resolve(request: SpeechRequest): SpeechSpec;
    /** Complete readiness snapshots; changes whenever the official speech catalog changes. */
    follow(caller: AbortSignal): AsyncIterable<{
        selection: {
            providerId: string;
        };
    }>;
}
/** Host-owned dependencies passed into the lock installer. */
export interface ProviderLockRuntime {
    readonly speechToText: LockSpeechService;
    readonly logger: LockLogger;
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
export declare function readProviderLock(path: string, expectedProviderId: string, logger: LockLogger): ProviderLock | undefined;
/**
 * Install a soft or hard selection lock. Soft reasserts the target provider at
 * startup and whenever the official catalog changes; hard additionally blocks
 * other provider selections and forces resolve() to the target.
 * @param runtime - speech service and logger.
 * @param lock - validated lock file.
 * @returns disposer stopping the catalog observer and restoring hard wrappers.
 */
export declare function installProviderLock(runtime: ProviderLockRuntime, lock: ProviderLock): () => void;
