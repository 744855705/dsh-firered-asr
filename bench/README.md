# FireRedASR2-AED int8 + CT-Transformer punctuation benchmark

Environment: Linux x64, 16 logical CPUs, AMD CPU (no CUDA), 91 GB RAM, Node v24.22.0,
`sherpa-onnx-node@1.13.8`, ASR model `sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26`,
punctuation model `sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8`,
`threads=8`, `provider=cpu`. The host is shared; `/proc/loadavg` was ~16 during the 0.1.1
runs, so absolute RTF is high and the ASR-only / +punctuation pair matters more.

Commands (after `pnpm build`):

```bash
# ASR only
FIRERED_MODEL_DIR=/abs/model FIRERED_PUNCT=0 node scripts/bench.mjs

# ASR + punctuation
FIRERED_MODEL_DIR=/abs/model \
FIRERED_PUNCT_MODEL=/abs/punct/model.int8.onnx \
  node scripts/bench.mjs
```

`scripts/bench.mjs` builds 5/10/30 s clips from `test_wavs/0.wav`, decodes each three times,
reports the median, RTF, cold model load, `maxRSS`, and `addPunct` time when available.

## 0.1.1 results (2026-11-19; shared host, load ~16.6)

| Clip | ASR-only | ASR + punctuation | RTF ASR-only | RTF + punctuation | ΔRTF |
|---|---:|---:|---:|---:|---:|
| 5 s | 1.245 s | 1.246 s | 0.250 | 0.249 | -0.2% |
| 10 s | 3.205 s | 3.121 s | 0.321 | 0.312 | -2.6% |
| 30 s | 14.299 s | 14.568 s | 0.477 | 0.486 | +1.9% |

- Cold load: ASR-only 3.182 s; +punctuation 3.277 s.
- Peak RSS: ASR-only 2,444,144,640 B; +punctuation 2,478,878,720 B; **Δ +34,734,080 B
  (≈33 MB, <150 MB)**.
- `addPunct` alone: 0.79–2.67 ms on short spike texts; 2.83–8.40 ms on the 0/1/3
  transcripts (0.1–0.5% of inference). It is applied to the final joined transcript once
  per recording.
- The 30 s clip is the worst-case delta (+1.9% RTF, <5%); 5/10 s show no regression.

Earlier 0.1.0 runs at lower host load are retained in `bench/results.json` (5/10/30 s
RTF 0.14–0.44) to show host-load variance; they are not an A/B punctuation comparison.

End-to-end worker run from `tests/integration/local.e2e.ts` (ASR + punctuation):

- worker cold start (hash + spawn + both models): 4.163 s
- `test_wavs/0.wav`: 10.053 s audio, 2.667 s, 1 segment, punctuated, addPunct 2.83 ms
- `test_wavs/1.wav`: 5.100 s audio, 1.590 s, punctuated, addPunct 8.40 ms
- `test_wavs/3.wav`: 8.830 s audio, 2.921 s, punctuated, addPunct 8.25 ms
- 6×0.wav + 1 s gaps: 66.319 s audio, 12 VAD windows, 15.503 s, punctuated
- missing punctuation directory: raw text returned, `punctuated: false` (fail-open)

Raw output: `bench/results.json`; raw 0.1.1 runs in the delivery task evidence
(`bench-asr.json`, `bench-punct.json`).
