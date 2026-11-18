# dsh-firered-asr

DeepSeek Harness（dsh）的本地离线语音识别 provider。麦克风录音由本机 CPU 上的
**FireRedASR2-AED int8**（sherpa-onnx）转写，官方语音输入 UI 的“识别器”列表会多出
**FireRedASR2-AED (int8)**；音频不上传、不落盘。

本包只注册一个 `host-local` 的 `speechToText` provider，不替换官方麦克风 UI，也不重复
插入官方 voice-input 的 `speech-to-text` / `api-speech-to-text` / `client-ui-voice-input`
行。官方 `@deepseek-ai/dsh-experimental-voice-input-bundle` 已启用时，安装本包后即可在
**设置 → 语音 → 识别器**看到并切换。

## 特性

- **本地 CPU 推理**：无 CUDA/ROCm、无 Python、无编译依赖；使用已发布的
  `sherpa-onnx-node@1.13.8` 及其预编译 ONNX Runtime。
- **按需准备**：激活只检查磁盘缓存，不下载、不加载模型；用户点“准备”才下载
  838,589,068 B 的 tar.bz2（以及 1.8 MB Silero VAD），并在解压后逐文件校验大小和
  SHA-256。
- **修正 SenseVoice 分段丢字**：≤ 30s 整段解码；> 30s 用 Silero VAD 切段，每段起点向
  前回填 0.3s、终点向后补 0.25s，且起点不越过上一段结束点、终点不超过总长；段间按
  CJK/英文规则拼接，而不是统一 `join(' ')`。
- **受管子进程**：一次只跑一个任务；回环 HTTP + 随机 bearer token；取消时终止并等待
  进程退出；空闲 5 分钟停止 worker，模型缓存保留，下次录音重新唤醒。

## 环境要求

- dsh `>= 0.2.2-rc.3 < 0.3.0`，Node `>= 24.9.0`。
- 官方 voice-input bundle（默认 web profile 已包含）：
  `@deepseek-ai/dsh-experimental-voice-input-bundle`。
- CPU 推理；首次准备磁盘约 2.6 GB（压缩包 + 解压模型 + VAD + 临时空间），运行内存约
  3–4 GB。16 核 CPU 上 10s 音频约 1.5s 解码（RTF ≈ 0.15，实测见下）。

## 安装

### 从 tarball（推荐先验证构建产物）

```bash
dsh plugin --profile web add ./dsh-firered-asr-0.1.0.tgz
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
2. 点 **准备**：下载模型 → 解压 → 校验 → 加载 worker。下载进度显示真实字节；解压/
   校验/加载显示等待时间。
3. 回到输入框，点麦克风录音；停止后文本进入草稿，可编辑后发送。

模型缓存默认在 `~/.dsh/speech-to-text/firered`（bundle patch 里的 `dataRoot`）。

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
| `dataRoot` | bundle patch 设为 `dshHomePath('speech-to-text','firered')` | 模型缓存、下载缓存、worker cwd 的绝对根目录。 |
| `modelDirectory` | — | 已解压目录（含 `encoder.int8.onnx`、`decoder.int8.onnx`、`tokens.txt`，可含 `silero_vad.onnx`）；跳过下载/解压，仍校验大小与 SHA-256。与 `archivePath` 互斥。 |
| `archivePath` | — | 离线 tar.bz2 绝对路径；跳过下载，仍解压并逐文件校验。与 `modelDirectory` 互斥。 |
| `modelUrl` | GitHub release 的固定 URL | 覆盖下载地址；**必须同时提供 `modelSha256`**，且只接受 HTTPS、无凭据。 |
| `modelSha256` | 固定值（默认 URL 时） | 覆盖时必填；同时会决定下载后校验的哈希。 |
| `threads` | 8 | CPU intra-op 线程数。 |
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
```

## 离线用法

1. 下载一次
   `sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2`（838,589,068 B，
   SHA-256 见下表），放到本机任意绝对路径。
2. 准备 Silero VAD：把 `silero_vad.onnx` 放到 `<dataRoot>/models/silero/silero_vad.onnx`，
   或放到 `modelDirectory` 同目录（推荐后者，`modelDirectory` 模式完全不需要网络）。
3. 选择任一种离线配置：
   - `archivePath`：插件解压到 `dataRoot/models/...`，逐文件校验；VAD 需按上一步预置。
   - `modelDirectory`：直接使用已解压目录（含 `silero_vad.onnx`），完全不下载、不解压。
4. `modelUrl` 覆盖时一定同时给 `modelSha256`；否则激活即报错，不会静默下载。

## 模型来源、版本与许可

| 资源 | 字节 | SHA-256 |
|---|---:|---|
| `sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2` | 838,589,068 | `43015b3f1643a5688b4821e8ed323473d38b798c4ec291471fe00df1bcfc4f1c` |
| `encoder.int8.onnx` | 817,286,833 | `54048d66b6e8f3c80ea7ce95efe794587b0fd81d7271651d0decd3803852ae82` |
| `decoder.int8.onnx` | 417,291,928 | `b840ce7196ae4a14d05ae84bbf56082b6b61ccec5610fda907dddbcea37354ff` |
| `tokens.txt` | 79,172 | `1bc613de2112d257e61a349c3e72d1b1a9cf19c33d3ca954197ad2171e5ea07b` |
| `silero_vad.onnx` | 1,807,522 | `a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28` |

- 模型：**FireRedASR2-AED int8**，由 sherpa-onnx 转换；上游
  <https://www.modelscope.cn/models/FireRedTeam/FireRedASR2-AED>，
  下载自
  <https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-fire-red-asr2-zh_en-int8-2026-02-26.tar.bz2>。
- 许可：模型 **Apache-2.0**（上游 FireRedASR2-AED 声明）；sherpa-onnx /
  sherpa-onnx-node **Apache-2.0**；Silero VAD **MIT**。本插件代码 **MIT**。
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

## 开发、测试与性能

```bash
pnpm install
pnpm build
pnpm test                 # 79 个单测：配置/WAV/哈希/padding/CJK/队列/取消/协议/注册/兼容
# 真实模型集成（模型已解压 + 同目录 silero_vad.onnx）：
FIRERED_E2E_MODEL_DIR=/abs/model \
FIRERED_E2E_VAD=/abs/silero_vad.onnx \
  pnpm test:integration
# 5/10/30s RTF、冷启动、峰值 RSS：
FIRERED_MODEL_DIR=/abs/model pnpm bench
```

本机实测（Linux x64，16 核 AMD CPU，无 CUDA，`threads=8`，`sherpa-onnx-node@1.13.8`）。
主机是共享的，第二轮 `/proc/loadavg` 为 14.22，因此给出实测区间而不是单一承诺值：

| 片段 | 解码耗时 | RTF |
|---|---:|---:|
| 5s | 0.68–1.20s | 0.14–0.24 |
| 10s | 1.65–2.79s | 0.17–0.28 |
| 30s | 8.87–13.34s | 0.30–0.44 |

- 冷加载：1.7–2.6s（进程内构造 recognizer）；worker 端到端冷启动 2.33s（含 spawn + 模型加载）。
- 峰值 RSS：2.42–2.46GB（bench 进程，30s 片段，8 threads；10s 片段约 1.8GB）。
- 真实样本：`0.wav` 10.05s → 1.49–1.70s（RTF ≈0.15–0.17）；`1.wav` 5.1s → 0.82–0.86s；
  66.3s（6×`0.wav` + 1s 间隔）→ 12 个 VAD 段、8.52s（RTF 0.128）；取消后进程退出，
  下次录音启动新 worker。
- 规划建议：共享主机按 RTF ≈0.3–0.45 估算；120s 录音约 36–54s，worker 需约 2.5–4GB。
- 原始数据：`bench/results.json`；脚本 `scripts/bench.mjs`；复现命令见 `bench/README.md`。

## 已知限制

- **CPU only**：AMD 无 CUDA/ROCm；不提供 GPU provider，也不自动降级到云端。
- **无流式**：官方 `SpeechProvider` 只接受完整录音；本插件不做实时字幕。
- **无热词**：AED 路径不支持 hotwords；不要设置 `hotwords`。
- **AED 有效窗口**：单段解码不超过约 30s；超长录音靠 VAD 分段 + padding。
- **首次加载慢/内存高**：int8 权重约 1.23 GB，ONNX Runtime 加载后 RSS 约 1.8 GB（10s
  片段）/2.4 GB（30s 批量 bench），长音频会继续增长；`expectedMemoryBytes` 只是规划估计。
- **录音上限**：`maxAudioBytes` 默认 4 MiB ≈ 131s；更长的录音在进入 worker 前被拒绝。
- **离线 VAD**：`archivePath` 模式仍需 VAD；请按“离线用法”预置，否则会尝试下载。
- **解压依赖系统 `tar`**：Linux/macOS 自带；Windows 10+ 的 bsdtar 可用。若环境没有
  `tar`，准备阶段会明确报错。
- **模型哈希固定**：`modelDirectory`/`archivePath` 必须是上述 int8 发布版；换模型（如
  fp32、v1）需自行改 `runtime/assets.json` 并重跑校验，不在本包支持范围。

## 许可

本插件代码以 **MIT** 发布（见 `LICENSE`）。模型与运行时许可见
`THIRD_PARTY_NOTICES.md`；模型权重不随包分发，下载后仍受上游 Apache-2.0 约束。
