/** FireRedASR2 language support, canonical WAV validation, and input failures that leave native inference untouched. */
import { validateWave } from './host.ts'

/** Language hints accepted by provider metadata and the Remote consumer. */
export const languages: readonly string[] = ['auto', 'zh', 'en']

/** A request rejected before native inference; the loaded worker remains reusable. */
export class SpeechInputError extends Error {}

/**
 * Validate a recording before touching the native recognizer.
 * @param audio - untrusted WAV request bytes.
 * @param language - requested language hint; AED itself detects the language.
 * @param maxAudioBytes - configured worker byte limit.
 * @returns validated audio duration in seconds; invalid inputs throw SpeechInputError.
 */
export function validateInput(audio: Uint8Array, language: string, maxAudioBytes: number): number {
  if (!languages.includes(language)) throw new SpeechInputError('Unsupported FireRedASR2 language')
  if (audio.byteLength > maxAudioBytes) throw new SpeechInputError('Speech audio exceeds the worker byte limit')
  try { return validateWave(audio, maxAudioBytes / 32000) }
  catch (error) { throw new SpeechInputError('Invalid speech WAV', { cause: error }) }
}

/**
 * Convert canonical PCM16 WAV bytes to normalized mono float samples.
 * @param audio - WAV bytes already accepted by {@link validateInput}.
 * @returns one normalized sample per input sample.
 */
export function waveToSamples(audio: Uint8Array): Float32Array {
  const pcm = new DataView(audio.buffer, audio.byteOffset + 44, audio.byteLength - 44)
  return Float32Array.from({ length: pcm.byteLength / 2 }, (_, index) => pcm.getInt16(index * 2, true) / 32768)
}
