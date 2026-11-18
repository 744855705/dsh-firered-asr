/** Optional local FireRedASR2-AED provider; activation performs no downloads or model loading. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SpeechProviderId } from '@deepseek-ai/dsh-experimental-speech-to-text/types'
import { Config, validateConfig } from './config.ts'
import { languages } from './input.ts'
import { FireRedWorker } from './recognizer.ts'

export { Config } from './config.ts'
export const name = 'speech-to-text-firered'
export const inject = ['speechToText', 'subprocess']

/**
 * Register the local recognizer and inspect disk caches without downloading or loading models.
 * @param ctx - Host registry and subprocess owner.
 * @param config - validated runtime configuration.
 */
export function apply(ctx: Context, config: Config): void {
  validateConfig(config)
  const worker = new FireRedWorker(ctx, config)
  ctx.effect(() => {
    const unregister = ctx.speechToText.register({
      info: {
        id: config.providerId as SpeechProviderId,
        name: 'FireRedASR2-AED (int8)',
        location: 'host-local',
        languages,
        setupEstimate: {
          recommendedDiskBytes: 2_600_000_000,
          expectedMemoryBytes: 4_000_000_000,
          minimumMinutes: 2,
          maximumMinutes: 20,
        },
      },
      preparation: worker,
      transcribe: async (input, signal) => await worker.transcribe(input, signal),
    })
    worker.inspect()
    return async () => {
      const removing = unregister()
      await worker.dispose()
      await removing
    }
  })
}
