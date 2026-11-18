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

/**
 * Locate the running DSH CLI from the environment, the process entry, or the working directory.
 * The Host process does not necessarily export `DSH_INSTALL_DIR`; the loader entry and cwd are the
 * fallbacks that keep the provider row loadable.
 * @param starts - explicit roots first; each is walked upward to a DSH CLI/checkout.
 * @returns the `@deepseek-ai/dsh` CLI directory.
 */
export function findDshCli(starts: readonly (string | undefined)[] = [
  process.env.DSH_INSTALL_DIR,
  process.argv[1] === undefined ? undefined : dirname(realpathSync(process.argv[1])),
  process.cwd(),
]): string {
  for (const start of starts) {
    if (start === undefined) continue
    let dir = start
    for (;;) {
      if (isDshCli(dir)) return dir
      if (isDshRoot(dir)) return join(dir, 'apps/cli')
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  throw new Error('Unable to locate the running DSH installation; set DSH_INSTALL_DIR or run from a DSH installation')
}

const hostRoot = findDshCli()

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
