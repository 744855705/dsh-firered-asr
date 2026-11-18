import type { Transcript } from '@deepseek-ai/dsh-experimental-speech-to-text/types';
import type { Config } from './config.ts';
/** Verified files and validated inference settings sent by the Host. */
export interface InferenceConfig extends Config {
    readonly encoder: string;
    readonly decoder: string;
    readonly tokens: string;
    readonly vad: string;
    /** Verified punctuation model; absent means fail-open without punctuation. */
    readonly punctuationModel?: string | undefined;
}
/** Native inference result with decoded-window and punctuation diagnostics. */
export interface Transcription extends Transcript {
    readonly segments: number;
    readonly punctuated: boolean;
    /** Time spent inside `addPunct`, isolated from ASR for the punctuation-overhead measurement. */
    readonly punctuationSeconds: number;
}
/**
 * Load one native model pair and expose synchronous transcription for its dedicated process.
 * @param config - verified ONNX paths and explicit CPU/VAD limits.
 * @returns synchronous inference confined to its dedicated process.
 */
export declare function createTranscriber(config: InferenceConfig): (audio: Uint8Array, language: string) => Transcription;
