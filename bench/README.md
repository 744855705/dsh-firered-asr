# FireRedASR2-AED int8 benchmark

Environment: Linux x64, 16 logical CPUs, AMD CPU (no CUDA), 91 GB RAM, Node v24.22.0,
`sherpa-onnx-node@1.13.8`, model `sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26`,
`threads=8`, `provider=cpu`. The host was shared; `/proc/loadavg` was 14.22 (1 min) during
the second run, so the two runs below bound the observed range rather than promise a rate.

Command (after `pnpm build`):

```bash
FIRERED_MODEL_DIR=/abs/model FIRERED_THREADS=8 node scripts/bench.mjs
```

`scripts/bench.mjs` builds 5/10/30 s clips from `test_wavs/0.wav`, decodes each three times,
reports the median wall time, RTF (`inferenceSeconds / audioSeconds`), cold model load, and
`process.resourceUsage().maxRSS`.

| Run | Cold load | Peak RSS | 5 s | 10 s | 30 s |
|---|---:|---:|---:|---:|---:|
| 1 (less contention; warm-pair medians) | 1.706 s | 2.46 GB | 0.711 s / RTF 0.142 | 1.871 s / RTF 0.187 | 8.874 s / RTF 0.296 |
| 2 (shared host; three-run medians) | 2.607 s | 2.42 GB | 1.200 s / RTF 0.240 | 2.787 s / RTF 0.279 | 13.340 s / RTF 0.445 |

End-to-end worker run from `tests/integration/local.e2e.ts` (same model, `threads=8`):

- worker cold start (spawn + model load): 2.331 s
- `test_wavs/0.wav`: 10.053 s audio, 1.649 s, RTF 0.164
- `test_wavs/1.wav`: 5.100 s audio, 0.818 s, RTF 0.160
- 6×0.wav + 1 s gaps: 66.319 s audio, 12 VAD windows, 8.522 s, RTF 0.128
- cancellation: abort during a 66 s inference; worker process exited and the next recording
  started a fresh worker successfully.

Planning guidance: use RTF ≈ 0.30–0.45 for a busy shared host; a 120 s recording can take
roughly 36–54 s and needs about 2.5–4 GB for the worker. The first load is slower than later
recordings; `prepareTimeoutMs=3600000` and `inferenceTimeoutMs=600000` are intentionally
generous.

Raw output: `bench/results.json`.
