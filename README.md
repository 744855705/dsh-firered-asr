# dsh-firered-asr

DeepSeek Harness（dsh）的本地离线语音识别 provider。麦克风录音由本机 CPU 上的
**FireRedASR2-AED int8**（sherpa-onnx）转写，再用 **CT-Transformer** 补中文/英文标点；
官方语音输入 UI 的“识别器”列表会多出 **FireRedASR2-AED (int8)**；音频不上传、不落盘。

本包只注册一个 `host-local` 的 `speechToText` provider，不替换官方麦克风 UI，也不重复
插入官方 voice-input 的 `speech-to-text` / `api-speech-to-text` / `client-ui-voice-input`
行。官方 `@deepseek-ai/dsh-experimental-voice-input-bundle` 已启用时，安装本包后即可在
**设置 → 语音 → 识别器**看到并切换。

## 特性

- **本地 CPU 推理**：无 CUDA/ROCm、无 Python、无编译依赖；使用已发布的
  `sherpa-onnx-node@1.13.8` 及其预编译 ONNX Runtime。
- **复用运行中 DSH 的官方实现**：不把 `@deepseek-ai/dsh-experimental-speech-to-text` /
  `@deepseek-ai/dsh-timeout` 装进 profile；启动时在 DSH 安装根（`DSH_INSTALL_DIR`，否则
  argv/cwd 回退）解析 DSH 自带的官方 voice-input bundle，动态 import 官方 `validateWave` 与
  timeout helper，并把该安装根显式传给 worker 子进程；官方服务行与 FireRed provider 行保持
  独立，provider 行失败不会拖垮官方 SenseVoice 服务行。
- **按需准备**：激活只检查磁盘缓存，不下载、不加载模型；用户点“准备”才下载
  838,589,068 B 的 tar.bz2（以及 1.8 MB Silero VAD），并在解压后逐文件校验大小和
  SHA-256。
- **修正 SenseVoice 分段丢字**：≤ 30s 整段解码；> 30s 用 Silero VAD 切段，每段起点向
  前回填 0.3s、终点向后补 0.25s，且起点不越过上一段结束点、终点不超过总长；段间按
  CJK/英文规则拼接，而不是统一 `join(' ')`。
- **标点恢复（默认开）**：worker 内与 ASR 一起加载 64.7 MB 的中英 CT-Transformer
  标点模型，对**最终拼接后的整段文本**只调用一次 `addPunct`。标点模型缺失时激活会标记为
  **待准备**，官方“准备”按钮出现并下载标点包；准备/加载/推理失败时 fail-open 返回原文。
  `punctuation=false` 时完全不加载标点模型。
- **受管子进程**：一次只跑一个任务；回环 HTTP + 随机 bearer token；取消时终止并等待
  进程退出；空闲 5 分钟停止 worker，模型缓存保留，下次录音重新唤醒。

## 环境要求

- dsh `>= 0.2.2-rc.1 <= 0.5.0`（兼容检查开启 includePrerelease，0.2.2-rc.1/0.5.0/0.5.0-rc 可用，0.5.1 不保证），Node `>= 24.9.0`。
- 运行时不需要手动设置 `DSH_INSTALL_DIR`；0.1.4 起的 host 会从 `DSH_INSTALL_DIR` →
  `process.argv[1]` → `process.cwd()` 逐级找 DSH 安装根，再从官方 voice-input bundle 解析
  speech-to-text/timeout；解析出的安装根还会显式传给 worker 子进程（worker 的 argv/cwd 不在
  DSH 安装内，不能自行回退）。只有三者都找不到 DSH 安装时才明确报错。
- 官方 voice-input bundle（默认 web profile 已包含）：
  `@deepseek-ai/dsh-experimental-voice-input-bundle`。
- CPU 推理；首次准备磁盘约 2.7 GB（ASR 压缩包/解压模型 + VAD + 64.7 MB 标点包 + 临时
  空间），运行内存约 3–4 GB，标点模型实测另加约 33 MB（保守按 <150 MB 估算）。16 核
  CPU 上 10s 音频约 1.5–3.2s 解码（RTF 0.15–0.32，实测见下）。

## 安装

### 从 tarball（推荐先验证构建产物）

```bash
dsh plugin --profile web add ./dsh-firered-asr-0.1.5.tgz
```

### 从 GitHub（公开仓库）

```bash
dsh plugin --profile web add github:744855705/dsh-firered-asr
```

### 从本地目录

```bash
dsh plugin --profile web add /absolute/path/to/packages/experimental/speech-to-text-firered
```

安装后重启/刷新 dsh（由 dsh 插件管理决定），首次使用：

1. 打开 **设置 → 语音 → 识别器**，选择 **FireRedASR2-AED (int8)**。
2. 点 **准备**：下载 ASR 模型 + VAD + 标点模型 → 解压 → 校验 → 加载 worker。下载进度
   显示真实字节；解压/校验/加载显示等待时间。准备阶段标点不可用不会阻塞 ASR（ready 后无标点）。
3. 回到输入框，点麦克风录音；停止后文本进入草稿，可编辑后发送。

模型缓存默认在 `$DSH_HOME`（非空）否则 `~/.dsh` 下的 `speech-to-text/firered`。这个默认值
由代码解析（见 `src/config.ts` 的 `defaultDataRoot`），bundle patch 不再用 `!!js`；**同一台
机器上的所有 profile 共用这一份模型缓存**，桌面端和 CLI 行为一致。需要分开缓存时，在
profile 的 `cordis.patch.yml` 里显式覆盖 `dataRoot`。

## 卸载 / 回滚

```bash
# 卸载 bundle（同时移除 firered-asr 行；模型缓存保留）
dsh plugin --profile web remove dsh-firered-asr

# 如确认不再使用，可删除模型缓存（用户自行确认路径）
rm -rf ~/.dsh/speech-to-text/firered
```

只想临时停用、不卸载：在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 追加

```yaml
- id: firered-asr
  disabled: true
```

本包不改官方 `packages/experimental/*` 现有文件；回滚只需移除本包/插件行。

## 配置

在 profile 的 `cordis.patch.yml` 中按 `id: firered-asr` 覆盖；`dataRoot` 必须是绝对路径。

| 字段 | 默认值 | 说明 |
|---|---|---|
| `providerId` | `firered-local` | 注册 id；UI 用它切换。 |
| `dataRoot` | `$DSH_HOME`（非空）否则 `~/.dsh` + `speech-to-text/firered`，代码解析 | 模型缓存、下载缓存、worker cwd 的绝对根目录；同机所有 profile 共用一份。 |
| `modelDirectory` | — | 已解压目录（含 `encoder.int8.onnx`、`decoder.int8.onnx`、`tokens.txt`，可含 `silero_vad.onnx`）；跳过下载/解压，仍校验大小与 SHA-256。与 `archivePath` 互斥。 |
| `archivePath` | — | 离线 tar.bz2 绝对路径；跳过下载，仍解压并逐文件校验。与 `modelDirectory` 互斥。 |
| `modelUrl` | GitHub release 的固定 URL | 覆盖下载地址；**必须同时提供 `modelSha256`**，且只接受 HTTPS、无凭据。 |
| `modelSha256` | 固定值（默认 URL 时） | 覆盖时必填；同时会决定下载后校验的哈希。 |
| `punctuation` | `true` | 是否加载中英标点模型；`false` 时完全不构造 `OfflinePunctuation`。 |
| `punctuationModelDirectory` | — | 已解压标点目录（含 `model.int8.onnx`）；离线使用，跳过下载/解压，仍校验大小与 SHA-256。目录缺失时激活待准备；prepare 失败则 ready 无标点原文。 |
| `punctuationModelUrl` | GitHub release 的固定 URL | 标点包下载地址；覆盖时**必须同时提供 `punctuationModelSha256`**，只接受 HTTPS、无凭据。 |
| `punctuationModelSha256` | 固定值（默认 URL 时） | 覆盖标点包时必填；决定下载后校验的哈希。 |
| `threads` | 8 | CPU intra-op 线程数（ASR 与标点共用）。 |
| `directDecodeSeconds` | 30 | ≤ 此长度的录音整段解码，不切 VAD。 |
| `segmentSeconds` | 30 | VAD 最大语音段（再叠加两端 padding 后不超过此窗口）；也用于 VAD buffer 预算。 |
| `vadThreshold` | 0.5 | Silero 语音概率阈值。 |
| `minSpeechSeconds` | 0.1 | 最短语音段。 |
| `minSilenceSeconds` | 0.8 | 段间最小静音。 |
| `vadOnsetPaddingSeconds` | 0.3 | 每段起点向前回填；不越过上一段结束点。 |
| `vadTailPaddingSeconds` | 0.25 | 每段终点向后补齐；不超过录音总长。 |
| `maxAudioBytes` | 4194304（≈131s） | 解码 WAV 字节上限；超限在 worker 前拒绝。 |
| `prepareTimeoutMs` | 3600000 | 下载 + 解压 + 冷加载的预算。 |
| `inferenceTimeoutMs` | 600000 | 单次推理预算（CPU 慢，给足）。 |
| `idleTimeoutMs` | 300000 | 空闲后停止 worker；0 表示保持常驻。 |
| `maxPending` | 4 | 运行 + 排队任务上限。 |
| `graceMs` | 1000 | 终止 tar/worker 的宽限。 |
| `maxLogBytes` | 65536 | worker/tar stderr 保留上限。 |
| `maxResponseBytes` | 131072 | worker 响应上限。 |
| `progressIntervalMs` | 100 | 下载进度通知节流。 |

示例：使用本地 tar.bz2 与自定义缓存目录：

```yaml
- id: firered-asr
  name: 'dsh-firered-asr'
  config:
    dataRoot: /data/dsh-speech/firered
    archivePath: /data/models/sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2
    punctuationModelDirectory: /data/models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8
```

## 离线用法

1. 下载一次 ASR 包
   `sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2`（838,589,068 B，
   SHA-256 见下表），放到本机任意绝对路径。
2. 准备 Silero VAD：把 `silero_vad.onnx` 放到 `<dataRoot>/models/silero/silero_vad.onnx`，
   或放到 `modelDirectory` 同目录（推荐后者，`modelDirectory` 模式完全不需要网络）。
3. 标点模型（可选但默认开）：下载
   `sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2`
   （64,717,756 B）并解压；把解压目录配给 `punctuationModelDirectory`（目录含
   `model.int8.onnx`）。不配或目录缺失时激活会提示准备；准备失败则 ready 但无标点原文。
4. 选择任一种 ASR 离线配置：
   - `archivePath`：插件解压到 `dataRoot/models/...`，逐文件校验；VAD 需按上一步预置。
   - `modelDirectory`：直接使用已解压目录（含 `silero_vad.onnx`），完全不下载、不解压。
5. `modelUrl`/`punctuationModelUrl` 覆盖时一定同时给对应 `modelSha256`/
   `punctuationModelSha256`；否则激活即报错，不会静默下载。

## 模型来源、版本与许可

| 资源 | 字节 | SHA-256 |
|---|---:|---|
| `sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2` | 838,589,068 | `43015b3f1643a5688b4821e8ed323473d38b798c4ec291471fe00df1bcfc4f1c` |
| `encoder.int8.onnx` | 817,286,833 | `54048d66b6e8f3c80ea7ce95efe794587b0fd81d7271651d0decd3803852ae82` |
| `decoder.int8.onnx` | 417,291,928 | `b840ce7196ae4a14d05ae84bbf56082b6b61ccec5610fda907dddbcea37354ff` |
| `tokens.txt` | 79,172 | `1bc613de2112d257e61a349c3e72d1b1a9cf19c33d3ca954197ad2171e5ea07b` |
| `silero_vad.onnx` | 1,807,522 | `a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28` |
| `sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2` | 64,717,756 | `c0d5aa5f8eeb686032345e180bedf39319dc2e0556781c6264bcadba8328a6e1` |
| `model.int8.onnx`（标点） | 75,519,198 | `65a3fb9f5ad7bfb96bf69e0dc4481df97f6ee60513c1d94ce981ba6effd524b1` |

- ASR 模型：**FireRedASR2-AED int8**，由 sherpa-onnx 转换；上游
  <https://www.modelscope.cn/models/FireRedTeam/FireRedASR2-AED>，
  下载自
  <https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2>。
- 标点模型：**CT-Transformer zh-en int8**，由 sherpa-onnx 转换；上游
  <https://www.modelscope.cn/models/iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch>
  （ModelScope 模型卡声明 **Apache-2.0**），下载自
  <https://github.com/k2-fsa/sherpa-onnx/releases/download/punctuation-models/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8.tar.bz2>。
- 许可：ASR 与标点模型 **Apache-2.0**；sherpa-onnx / sherpa-onnx-node **Apache-2.0**；
  Silero VAD **MIT**。本插件代码 **MIT**。
- 模型权重**不在 npm 包里**，只在用户点“准备”时下载到本地缓存；本仓库不转存权重。
- 归属与更多第三方说明见 `THIRD_PARTY_NOTICES.md`。

## 分段与拼接（本插件与官方 SenseVoice 的差异）

- **≤ `directDecodeSeconds`**：整个 WAV 直接送入一个 stream，不切 VAD；首字/尾字不因
  分段边界丢失。
- **> `directDecodeSeconds`**：Silero VAD 产出绝对样本段；每段：
  1. `start = max(0, 段起点 - onsetPadding)`，再 `start = max(start, 上一段 paddedEnd)`；
  2. `end = min(totalSamples, 段终点 + tailPadding)`；
  3. 从原始录音 `slice(start, end)` 后单独 decode。
- 这样**每一段**都有起点回填和尾部 padding（不是只对第一段），且相邻段严格不重叠。
- 拼接：只看相邻两段的**边界字符**——任一侧是 CJK（Han/平假名/片假名/韩文）→ 直接
  相连；两侧都非 CJK → 一个空格。避免中文被空格切开，也避免“英文段尾 + 英文段首”被
  粘在一起（此前整段含中文会导致 `MONDAY`/`TODAY` 粘连）。

## 标点恢复

- `punctuation` 默认 `true`。worker 启动时与 ASR 一起构造
  `new sherpa.OfflinePunctuation({ model: { ctTransformer, numThreads, provider: 'cpu', debug: 0 } })`。
- 无论直接解码还是 VAD 分段，都先得到**最终拼接文本**，再只调用一次 `addPunct(text)`；
  不逐段调用，避免句间上下文被切断。
- 标点模型缺失（未准备/删缓存/离线目录不存在）时，激活 inspect 返回 `unprepared`，官方
  准备卡片出现“准备”按钮；点准备才下载/解压标点包，并进入现有 `model` 步骤。
- 准备阶段标点下载/解压失败、构造失败、`addPunct` 抛错或返回空串时，一律 fail-open：
  进入/保持 ready 并返回未加标点原文，只写 warn，绝不丢转写；已加载 worker 的标点文件
  被删也返回原文。
- `punctuation=false` 时完全不加载标点模型，内存/启动开销为零；不新增
  `SpeechPreparationStepKind`。
- 标点包下载失败不阻塞 ASR：准备仍可进入 ready，只是本次 worker 不加载标点；重启/重载后
  会再次显示“准备”。

## 开发、测试与性能

```bash
pnpm install
pnpm build
pnpm test                 # 98 个单测：配置/WAV/哈希/padding/CJK/队列/取消/协议/注册/兼容/标点/fail-open
# 真实模型集成（ASR 目录含 silero_vad.onnx；标点目录含 model.int8.onnx）：
FIRERED_E2E_MODEL_DIR=/abs/model \
FIRERED_E2E_VAD=/abs/silero_vad.onnx \
FIRERED_E2E_PUNCT_DIR=/abs/punct \
  pnpm test:integration
# 5/10/30s RTF、冷启动、峰值 RSS（标点开/关各跑一次）：
FIRERED_MODEL_DIR=/abs/model FIRERED_PUNCT_MODEL=/abs/punct/model.int8.onnx pnpm bench
FIRERED_MODEL_DIR=/abs/model FIRERED_PUNCT=0 pnpm bench
```

本机实测（Linux x64，16 核 AMD CPU，无 CUDA，`threads=8`，`sherpa-onnx-node@1.13.8`）。
主机共享且本轮负载更高（`/proc/loadavg` 6–20）；以下同时给出 0.1.1/0.1.2 的 ASR-only bench、
早先较低负载的 ASR-only 区间，以及 ASR+标点的隔离成本：

| 片段 | ASR-only | ASR + 标点 | RTF（ASR-only / +标点） |
|---|---:|---:|---:|
| 5s | 1.25s | 1.25s | 0.250 / 0.249 |
| 10s | 3.21s | 3.12s | 0.321 / 0.312 |
| 30s | 14.30s | 14.57s | 0.477 / 0.486 |

- 早先较低负载的 ASR-only 实测：5s 0.68–1.20s（RTF 0.14–0.24）、10s 1.65–2.79s
  （0.17–0.28）、30s 8.87–13.34s（0.30–0.44）；负载波动大于标点差异。
- 标点增量：`addPunct` 本身 0.8–8.4ms（0/1/3 转写为 2.8–8.4ms；相对 ASR 时间
  0.1–0.5%）；同主机 5/10/30s 的 RTF 变化为 -0.2% / -2.6% / +1.9%（最大 +1.9%，
  <5%）。标点包下载 64.7MB；峰值 RSS ASR-only 2.444GB → +标点 2.479GB（+约 33MB，
  <150MB）；`punctuation=false` 时为零。
- 冷加载：ASR-only 3.18s；+标点 3.28s；worker 端到端冷启动 4.16s（含 hash/spawn/两模型）。
- ASR+标点 integration：`0.wav` 10.05s → 2.67s；`1.wav` 5.1s → 1.59s；`3.wav` 8.83s →
  2.92s；66.3s → 12 段 / 15.50s（共享主机高负载）；三条文本均含中文标点。
- 规划建议：共享主机按 RTF ≈0.3–0.5 估算；120s 录音约 36–60s，worker 需约 2.5–4GB。
- 原始数据：`bench/results.json`、`bench-asr.json`、`bench-punct.json`；脚本
  `scripts/bench.mjs`；复现命令见 `bench/README.md`。

## 已知限制

- **CPU only**：AMD 无 CUDA/ROCm；不提供 GPU provider，也不自动降级到云端。
- **无流式**：官方 `SpeechProvider` 只接受完整录音；本插件不做实时字幕。
- **无热词**：AED 路径不支持 hotwords；不要设置 `hotwords`。
- **AED 有效窗口**：单段解码不超过约 30s；超长录音靠 VAD 分段 + padding。
- **标点模型可选**：默认下载 64.7 MB；缺包、删缓存、离线目录缺失时激活显示待准备；准备
  失败、加载失败或 `addPunct` 失败时 fail-open 返回无标点原文；已加载 worker 的标点文件
  被删仍可转写。想要零标点开销时设 `punctuation: false`。
- **标点内存**：标点模型实测约 +33 MB RSS（保守 <150 MB）；内存紧张时关闭标点。
- **首次加载慢/内存高**：int8 权重约 1.23 GB，ONNX Runtime 加载后 RSS 约 1.8 GB（10s
  片段）/2.4 GB（30s 批量 bench），长音频会继续增长；`expectedMemoryBytes` 只是规划估计。
- **录音上限**：`maxAudioBytes` 默认 4 MiB ≈ 131s；更长的录音在进入 worker 前被拒绝。
- **离线 VAD**：`archivePath` 模式仍需 VAD；请按“离线用法”预置，否则会尝试下载。
- **解压依赖系统 `tar`**：Linux/macOS 自带；Windows 10+ 的 bsdtar 可用。若环境没有
  `tar`，准备阶段会明确报错。
- **模型哈希固定**：`modelDirectory`/`archivePath` 与 `punctuationModelDirectory` 必须是
  上述 int8 发布版；换模型（如 fp32、v1、不同标点模型）需自行改 `runtime/assets.json`
  并重跑校验，不在本包支持范围。
- **标点离线**：`punctuationModelDirectory` 指向已解压标点目录；不配且无缓存时会尝试
  下载。标点包下载失败不会阻塞 ASR。
- **宿主官方 helper**：`DSH_INSTALL_DIR`、`process.argv[1]`、`cwd` 都不在 DSH 安装路径，或
  运行中 DSH 的官方 `validateWave`/timeout API 发生破坏性变化时，FireRed provider 行会明确
  失败；官方 SenseVoice 服务行独立，不会因此整体禁用。

## 许可

本插件代码以 **MIT** 发布（见 `LICENSE`）。模型与运行时许可见
`THIRD_PARTY_NOTICES.md`；模型权重不随包分发，下载后仍受上游 Apache-2.0 约束。
