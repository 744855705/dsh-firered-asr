/** Optional local FireRedASR2-AED provider; activation performs no downloads or model loading. */
import type { Context } from '@deepseek-ai/cordis';
import { Config } from './config.ts';
export { Config } from './config.ts';
export declare const name = "speech-to-text-firered";
export declare const inject: string[];
/**
 * Register the local recognizer and inspect disk caches without downloading or loading models.
 * @param ctx - Host registry and subprocess owner.
 * @param config - validated runtime configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
