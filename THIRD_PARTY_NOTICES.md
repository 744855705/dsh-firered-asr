# Third-party notices

This package contains only MIT-licensed plugin code. It does **not** contain
model weights. The recognizer downloads the following at the user's explicit
preparation request, verifies size and SHA-256, and stores them under
`dataRoot`.

| Component | Version / identity | License | Distribution |
|---|---|---|---|
| FireRedASR2-AED int8 ONNX (converted by sherpa-onnx) | `sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26` | Apache-2.0 | Downloaded at prepare time from the k2-fsa/sherpa-onnx release; upstream model: <https://www.modelscope.cn/models/FireRedTeam/FireRedASR2-AED> |
| Silero VAD ONNX | `silero_vad.onnx` (revision `fba88cd2e921609e7675c3aaf51e0b9b295da4bc`) | MIT | Downloaded at prepare time from `csukuangfj/vad` on Hugging Face, with the hf-mirror fallback |
| sherpa-onnx-node | 1.13.8 | Apache-2.0 | npm dependency; includes the ONNX Runtime native binding |
| @deepseek-ai/dsh-experimental-speech-to-text | 0.2.2-rc.3 | MIT | npm dependency, used for the canonical 16 kHz mono PCM16 WAV validator (`/wave`) |
| @deepseek-ai/dsh-timeout | 0.2.2-rc.3 | MIT | npm dependency |
| @deepseek-ai/schemastery | 3.19.0 | MIT | npm dependency |
| zod | 4.6.6 | MIT | npm dependency |

The FireRedASR2-AED model card and the sherpa-onnx model release are the
authoritative source for the upstream attribution and license text. Nothing
in this repository relicenses the model weights.
