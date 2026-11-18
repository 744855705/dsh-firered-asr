import { validateConfig } from "./config.js";
import { languages } from "./input.js";
import { FireRedWorker } from "./recognizer.js";
export { Config } from "./config.js";
export const name = 'speech-to-text-firered';
export const inject = ['speechToText', 'subprocess'];
/**
 * Register the local recognizer and inspect disk caches without downloading or loading models.
 * @param ctx - Host registry and subprocess owner.
 * @param config - validated runtime configuration.
 */
export function apply(ctx, config) {
    validateConfig(config);
    const worker = new FireRedWorker(ctx, config);
    ctx.effect(() => {
        const unregister = ctx.speechToText.register({
            info: {
                id: config.providerId,
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
        });
        worker.inspect();
        return async () => {
            const removing = unregister();
            await worker.dispose();
            await removing;
        };
    });
}
//# sourceMappingURL=index.js.map