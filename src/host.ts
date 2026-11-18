/**
 * Resolve the running DSH installation's official helpers instead of installing a private copy.
 *
 * The official speech-to-text package and timeout package are versioned with DSH. A profile-level
 * dependency on them would shadow the running bundle; resolving them from `DSH_INSTALL_DIR` keeps
 * one source of truth and reuses the official implementations.
 */
import { pathToFileURL } from 'node:url'

// `process.getBuiltinModule` bypasses module mocks in the unit tests; this lookup must always use
// the real Node loader, just like DSH itself does.
const { createRequire } = process.getBuiltinModule('node:module')
const require = createRequire(import.meta.url)
const hostRoot = process.env.DSH_INSTALL_DIR
if (hostRoot === undefined) {
  throw new Error('DSH_INSTALL_DIR is not set; FireRedASR2 must resolve the running DSH speech helpers')
}

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
