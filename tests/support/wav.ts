/** Canonical and deliberately malformed WAV fixtures for the provider tests. */

export interface WaveOptions {
  sampleRate?: number
  channels?: number
  bits?: number
  format?: number
  riffSize?: number
  dataSize?: number
  byteRate?: number
  blockAlign?: number
}

/** Build a 44-byte PCM WAV with the requested header fields. */
export function makeWave(pcm: Buffer, options: WaveOptions = {}): Uint8Array {
  const sampleRate = options.sampleRate ?? 16000
  const channels = options.channels ?? 1
  const bits = options.bits ?? 16
  const bytes = Buffer.alloc(44 + pcm.length)
  bytes.write('RIFF', 0, 'ascii')
  bytes.writeUInt32LE(options.riffSize ?? bytes.length - 8, 4)
  bytes.write('WAVE', 8, 'ascii')
  bytes.write('fmt ', 12, 'ascii')
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(options.format ?? 1, 20)
  bytes.writeUInt16LE(channels, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(options.byteRate ?? sampleRate * channels * bits / 8, 28)
  bytes.writeUInt16LE(options.blockAlign ?? channels * bits / 8, 32)
  bytes.writeUInt16LE(bits, 34)
  bytes.write('data', 36, 'ascii')
  bytes.writeUInt32LE(options.dataSize ?? pcm.length, 40)
  pcm.copy(bytes, 44)
  return new Uint8Array(bytes)
}

/** Build a canonical 16 kHz mono PCM16 WAV from a count of synthetic samples. */
export function samplesWave(samples: number, first = 0): Uint8Array {
  const pcm = Buffer.alloc(samples * 2)
  for (let index = 0; index < samples; index++) pcm.writeInt16LE(first + index, index * 2)
  return makeWave(pcm)
}

/** Read the PCM payload of a canonical WAV fixture. */
export function readPcm(wave: Uint8Array): Buffer {
  const bytes = Buffer.from(wave.buffer, wave.byteOffset, wave.byteLength)
  return Buffer.from(bytes.subarray(44))
}

/** Concatenate canonical WAV recordings with optional silence between them, preserving 16 kHz mono PCM16. */
export function concatWaves(waves: readonly Uint8Array[], gapSeconds = 0): Uint8Array {
  const gap = Buffer.alloc(Math.round(gapSeconds * 32000))
  const pcm = Buffer.concat(waves.flatMap(wave => [readPcm(wave), gap]))
  return makeWave(pcm)
}

/** Repeat one canonical recording until it reaches the requested duration. */
export function exactWave(source: Uint8Array, seconds: number): Uint8Array {
  const sourcePcm = readPcm(source)
  const target = Math.round(seconds * 32000)
  const pcm = Buffer.alloc(target)
  for (let offset = 0; offset < target; offset += sourcePcm.length) {
    sourcePcm.copy(pcm, offset, 0, Math.min(sourcePcm.length, target - offset))
  }
  return makeWave(pcm)
}
