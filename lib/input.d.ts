/** Language hints accepted by provider metadata and the Remote consumer. */
export declare const languages: readonly string[];
/** A request rejected before native inference; the loaded worker remains reusable. */
export declare class SpeechInputError extends Error {
}
/**
 * Validate a recording before touching the native recognizer.
 * @param audio - untrusted WAV request bytes.
 * @param language - requested language hint; AED itself detects the language.
 * @param maxAudioBytes - configured worker byte limit.
 * @returns validated audio duration in seconds; invalid inputs throw SpeechInputError.
 */
export declare function validateInput(audio: Uint8Array, language: string, maxAudioBytes: number): number;
/**
 * Convert canonical PCM16 WAV bytes to normalized mono float samples.
 * @param audio - WAV bytes already accepted by {@link validateInput}.
 * @returns one normalized sample per input sample.
 */
export declare function waveToSamples(audio: Uint8Array): Float32Array;
