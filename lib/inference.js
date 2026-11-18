/** CPU FireRedASR2-AED inference and padded Silero segmentation, confined to the recognition process. */
import { createRequire } from 'node:module';
import { validateInput, waveToSamples } from "./input.js";
import { joinTranscripts, planSegments } from "./segments.js";
function warn(message) {
    process.stderr.write(`[dsh-firered-asr] ${message}\n`);
}
/** Native configuration is fixed per process; language hints are metadata only for the AED model. */
function nativeRecognizerConfig(config) {
    return {
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
            // FireRedASR2-AED is an encoder/decoder pair; there is no single-file variant.
            fireRedAsr: { encoder: config.encoder, decoder: config.decoder },
            tokens: config.tokens,
            numThreads: config.threads,
            provider: 'cpu',
            debug: 0,
        },
    };
}
/** Silero window must be large enough for one maximum-duration segment plus its silence margin. */
function vadConfig(config) {
    const maxSpeechDuration = Math.max(0.1, config.segmentSeconds - config.vadOnsetPaddingSeconds - config.vadTailPaddingSeconds);
    return {
        sileroVad: {
            model: config.vad,
            threshold: config.vadThreshold,
            minSilenceDuration: config.minSilenceSeconds,
            minSpeechDuration: config.minSpeechSeconds,
            maxSpeechDuration,
            windowSize: 512,
        },
        sampleRate: 16000,
        numThreads: config.threads,
        provider: 'cpu',
        debug: 0,
    };
}
function decode(recognizer, samples) {
    const stream = recognizer.createStream();
    // Electron's V8 memory cage requires owned native buffers; every caller passes a copy.
    stream.acceptWaveform({ sampleRate: 16000, samples });
    recognizer.decode(stream);
    return recognizer.getResult(stream).text;
}
/**
 * Load one native model pair and expose synchronous transcription for its dedicated process.
 * @param config - verified ONNX paths and explicit CPU/VAD limits.
 * @returns synchronous inference confined to its dedicated process.
 */
export function createTranscriber(config) {
    // sherpa-onnx-node publishes a CommonJS Node-API binding with JSDoc but no declarations.
    const sherpa = createRequire(import.meta.url)('sherpa-onnx-node');
    const recognizer = new sherpa.OfflineRecognizer(nativeRecognizerConfig(config));
    const detector = new sherpa.Vad(vadConfig(config), config.segmentSeconds + config.minSilenceSeconds + 1);
    // Punctuation is optional and fail-open: a missing, unloadable, or failing model must never
    // prevent the ASR worker from returning its raw transcript.
    let punctuator;
    if (config.punctuation) {
        if (config.punctuationModel === undefined) {
            warn('punctuation model is unavailable; returning unpunctuated text');
        }
        else {
            try {
                punctuator = new sherpa.OfflinePunctuation({
                    model: { ctTransformer: config.punctuationModel, numThreads: config.threads, provider: 'cpu', debug: 0 },
                });
            }
            catch (error) {
                warn(`punctuation model failed to load; returning unpunctuated text: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    return (audio, language) => {
        let punctuated = false;
        let punctuationSeconds = 0;
        // One call for the final joined transcript: VAD segments have no reliable sentence context
        // on their own, so punctuating them separately would produce fragmented or duplicated marks.
        const punctuate = (text) => {
            if (punctuator === undefined || text.trim().length === 0)
                return text;
            try {
                const started = performance.now();
                const result = punctuator.addPunct(text);
                punctuationSeconds += (performance.now() - started) / 1000;
                if (result.trim().length === 0) {
                    warn('punctuation returned empty text; returning unpunctuated text');
                    punctuator = undefined;
                    return text;
                }
                punctuated = true;
                return result;
            }
            catch (error) {
                warn(`punctuation failed; returning unpunctuated text: ${error instanceof Error ? error.message : String(error)}`);
                punctuator = undefined;
                return text;
            }
        };
        const audioSeconds = validateInput(audio, language, config.maxAudioBytes);
        const samples = waveToSamples(audio);
        detector.reset();
        const started = performance.now();
        if (audioSeconds <= config.directDecodeSeconds) {
            // Short recordings are decoded whole: no VAD boundary, no padding, no join.
            const text = punctuate(decode(recognizer, samples).trim());
            return {
                text, audioSeconds, inferenceSeconds: (performance.now() - started) / 1000,
                segments: 1, punctuated, punctuationSeconds,
            };
        }
        const raw = [];
        const drain = () => {
            while (!detector.isEmpty()) {
                const segment = detector.front(false);
                raw.push({ start: segment.start, length: segment.samples.length });
                detector.pop();
            }
        };
        for (let offset = 0; offset < samples.length; offset += 512) {
            detector.acceptWaveform(samples.subarray(offset, offset + 512));
            drain();
        }
        detector.flush();
        drain();
        const plans = planSegments(raw, {
            totalSamples: samples.length,
            sampleRate: 16000,
            onsetPaddingSeconds: config.vadOnsetPaddingSeconds,
            tailPaddingSeconds: config.vadTailPaddingSeconds,
        });
        const texts = [];
        for (const plan of plans) {
            // Slice from the original recording so padding is real audio, not a VAD-internal copy.
            const window = Float32Array.from(samples.subarray(plan.start, plan.end));
            texts.push(decode(recognizer, window).trim());
        }
        return {
            text: punctuate(joinTranscripts(texts)), audioSeconds,
            inferenceSeconds: (performance.now() - started) / 1000, segments: plans.length, punctuated, punctuationSeconds,
        };
    };
}
//# sourceMappingURL=inference.js.map