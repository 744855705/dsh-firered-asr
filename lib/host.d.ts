/**
 * Locate the running DSH CLI from the environment, the process entry, or the working directory.
 * The Host process does not necessarily export `DSH_INSTALL_DIR`; the loader entry and cwd are the
 * fallbacks that keep the provider row loadable.
 * @param starts - explicit roots first; each is walked upward to a DSH CLI/checkout.
 * @returns the `@deepseek-ai/dsh` CLI directory.
 */
export declare function findDshCli(starts?: readonly (string | undefined)[]): string;
/**
 * The resolved CLI directory. The worker subprocess is handed this root through `DSH_INSTALL_DIR`:
 * its own entry point and cwd live outside the DSH installation, so it cannot rediscover it.
 */
export declare const hostRoot: string;
declare const timeout: typeof import("@deepseek-ai/dsh-timeout");
/** Official canonical WAV validator from the running DSH installation. */
export declare const validateWave: typeof import("@deepseek-ai/dsh-experimental-speech-to-text/wave").validateWave;
/** Official timeout helpers from the running DSH installation. */
export { timeout };
