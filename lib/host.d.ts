/**
 * Electron install roots: `process.resourcesPath` when present, plus the executable-relative
 * resources directory. Deduplicated because Electron normally makes both spellings equal.
 * @param resourcesPath - Electron's resources directory, or undefined outside Electron.
 * @param executable - `process.execPath`, used for the unpackaged layout.
 * @returns candidate runtime directories in lookup order.
 */
export declare function electronInstallRoots(resourcesPath: string | undefined, executable: string): string[];
/**
 * Locate the running DSH installation from the environment, the process entry, the working
 * directory, or Electron's resource layout. The first pass keeps the existing CLI/checkout rules
 * untouched, so a working web host resolves exactly as before; only when every legacy start fails
 * does the second pass accept a directory that resolves the official helper bundle. This keeps web
 * priority while allowing the Electron runtime directory (`@deepseek-ai/dsh-desktop-runtime`).
 * @param starts - explicit roots first; each is walked upward.
 * @returns the installation directory that can resolve the official helpers.
 */
export declare function findDshCli(starts?: readonly (string | undefined)[]): string;
/**
 * The resolved installation root (CLI directory, checkout `apps/cli`, or Electron runtime dir).
 * The worker subprocess is handed this root through `DSH_INSTALL_DIR`: its own entry point and
 * cwd live outside the DSH installation, so it cannot rediscover it.
 */
export declare const hostRoot: string;
declare const timeout: typeof import("@deepseek-ai/dsh-timeout");
/** Official canonical WAV validator from the running DSH installation. */
export declare const validateWave: typeof import("@deepseek-ai/dsh-experimental-speech-to-text/wave").validateWave;
/** Official timeout helpers from the running DSH installation. */
export { timeout };
