/**
 * Resolve the running DSH installation's official helpers instead of installing a private copy.
 *
 * The official speech-to-text package and timeout package are versioned with DSH. A profile-level
 * dependency on them would shadow the running bundle; resolving them from the running DSH install
 * keeps one source of truth and reuses the official implementations.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

// `process.getBuiltinModule` bypasses module mocks in the unit tests; this lookup must always use
// the real Node loader, just like DSH itself does.
const { createRequire } = process.getBuiltinModule('node:module')
const require = createRequire(import.meta.url)

function isDshCli(dir: string): boolean {
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: unknown }
    return manifest.name === '@deepseek-ai/dsh'
  } catch {
    return false
  }
}

function isDshRoot(dir: string): boolean {
  return existsSync(join(dir, 'apps/cli/package.json')) && existsSync(join(dir, 'vendor/loader'))
}

/** Directory of `process.argv[1]`, falling back to its lexical parent when the path is absent. */
function entryDirectory(): string | undefined {
  const entry = process.argv[1]
  if (entry === undefined) return undefined
  try { return dirname(realpathSync(entry)) } catch { return dirname(entry) }
}

/**
 * Whether `dir` can resolve the official voice-input bundle. That is the only property
 * downstream code needs from the installation root; the Electron desktop runtime
 * (`@deepseek-ai/dsh-desktop-runtime`) satisfies it without being the CLI package.
 */
function resolvesOfficialBundle(dir: string): boolean {
  try {
    require.resolve('@deepseek-ai/dsh-experimental-voice-input-bundle/package.json', { paths: [dir] })
    return true
  } catch {
    return false
  }
}

/**
 * Electron install roots: `process.resourcesPath` when present, plus the executable-relative
 * resources directory. Deduplicated because Electron normally makes both spellings equal.
 * @param resourcesPath - Electron's resources directory, or undefined outside Electron.
 * @param executable - `process.execPath`, used for the unpackaged layout.
 * @returns candidate runtime directories in lookup order.
 */
export function electronInstallRoots(resourcesPath: string | undefined, executable: string): string[] {
  const roots: string[] = []
  if (resourcesPath !== undefined) {
    roots.push(join(resourcesPath, 'app.asar', 'dsh'), join(resourcesPath, 'app', 'dsh'))
  }
  const executableDir = dirname(executable)
  roots.push(join(executableDir, 'resources', 'app.asar', 'dsh'), join(executableDir, 'resources', 'app', 'dsh'))
  return [...new Set(roots)]
}

function installRootStarts(): (string | undefined)[] {
  const resourcesPath = (process as { resourcesPath?: unknown }).resourcesPath
  return [
    process.env.DSH_INSTALL_DIR,
    entryDirectory(),
    process.cwd(),
    ...electronInstallRoots(typeof resourcesPath === 'string' && resourcesPath.length > 0 ? resourcesPath : undefined,
      process.execPath),
  ]
}

/** Walk each start upward and return the first directory accepted by `judge`. */
function locate(starts: readonly (string | undefined)[], judge: (dir: string) => string | undefined): string | undefined {
  for (const start of starts) {
    if (start === undefined) continue
    let dir = start
    for (;;) {
      const found = judge(dir)
      if (found !== undefined) return found
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return undefined
}

/**
 * Locate the running DSH installation from the environment, the process entry, the working
 * directory, or Electron's resource layout. The first pass keeps the existing CLI/checkout rules
 * untouched, so a working web host resolves exactly as before; only when every legacy start fails
 * does the second pass accept a directory that resolves the official helper bundle. This keeps web
 * priority while allowing the Electron runtime directory (`@deepseek-ai/dsh-desktop-runtime`).
 * @param starts - explicit roots first; each is walked upward.
 * @returns the installation directory that can resolve the official helpers.
 */
export function findDshCli(starts: readonly (string | undefined)[] = installRootStarts()): string {
  const legacy = locate(starts, dir => isDshCli(dir) ? dir : isDshRoot(dir) ? join(dir, 'apps/cli') : undefined)
  if (legacy !== undefined) return legacy
  const byHelpers = locate(starts, dir => resolvesOfficialBundle(dir) ? dir : undefined)
  if (byHelpers !== undefined) return byHelpers
  throw new Error('Unable to locate the running DSH installation; no candidate directory resolves the official helper packages')
}

/**
 * The resolved installation root (CLI directory, checkout `apps/cli`, or Electron runtime dir).
 * The worker subprocess is handed this root through `DSH_INSTALL_DIR`: its own entry point and
 * cwd live outside the DSH installation, so it cannot rediscover it.
 */
export const hostRoot = findDshCli()

// The official voice bundle owns the speech-to-text package and the sensevoice provider; resolving
// through it follows the running DSH installation even when the bundle's dependencies are nested.
const fromBundle = createRequire(require.resolve(
  '@deepseek-ai/dsh-experimental-voice-input-bundle/package.json', { paths: [hostRoot] },
))
const fromSenseVoice = createRequire(fromBundle.resolve(
  '@deepseek-ai/dsh-experimental-speech-to-text-sensevoice/package.json',
))

const wave = await import(pathToFileURL(
  fromBundle.resolve('@deepseek-ai/dsh-experimental-speech-to-text/wave'),
).href) as typeof import('@deepseek-ai/dsh-experimental-speech-to-text/wave')
const timeout = await import(pathToFileURL(
  fromSenseVoice.resolve('@deepseek-ai/dsh-timeout'),
).href) as typeof import('@deepseek-ai/dsh-timeout')

/** Official canonical WAV validator from the running DSH installation. */
export const validateWave = wave.validateWave
/** Official timeout helpers from the running DSH installation. */
export { timeout }
