/** Deterministic VAD segment planning and script-aware transcript joining. */

/** One VAD speech segment in absolute sample coordinates. */
export interface VadSegment {
  readonly start: number
  readonly length: number
}

/** One decoded window after onset/tail padding and overlap suppression. */
export interface SegmentPlan {
  readonly start: number
  readonly end: number
  readonly isFirst: boolean
  readonly isLast: boolean
}

/** Recording bounds and the configured padding. */
export interface SegmentLimits {
  readonly totalSamples: number
  readonly sampleRate: number
  readonly onsetPaddingSeconds: number
  readonly tailPaddingSeconds: number
}

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

/**
 * Pad every VAD segment on both sides without crossing the recording or the previous window.
 *
 * The previous window end, not the previous VAD end, is the lower bound: a padded tail
 * already covers audio the next VAD segment would otherwise repeat, so clamping there keeps
 * decoded text non-duplicated and keeps the windows disjoint.
 *
 * @param segments - ordered VAD segments in absolute sample coordinates.
 * @param limits - recording length, sample rate, and symmetric padding settings.
 * @returns ordered, non-overlapping windows clamped to `[0, totalSamples]`.
 */
export function planSegments(segments: readonly VadSegment[], limits: SegmentLimits): SegmentPlan[] {
  const onset = Math.max(0, Math.round(limits.onsetPaddingSeconds * limits.sampleRate))
  const tail = Math.max(0, Math.round(limits.tailPaddingSeconds * limits.sampleRate))
  const total = Math.max(0, limits.totalSamples)
  const ordered = [...segments].sort((left, right) => left.start - right.start)
  const plans: SegmentPlan[] = []
  let previousEnd = 0
  for (const segment of ordered) {
    const rawStart = Math.max(0, Math.min(total, segment.start))
    const rawEnd = Math.max(rawStart, Math.min(total, segment.start + segment.length))
    if (rawEnd <= rawStart) continue
    const start = Math.max(previousEnd, rawStart - onset)
    const end = Math.min(total, rawEnd + tail)
    if (end <= start) continue
    plans.push({ start, end, isFirst: plans.length === 0, isLast: false })
    previousEnd = end
  }
  if (plans.length > 0) {
    const last = plans[plans.length - 1]!
    plans[plans.length - 1] = { ...last, isLast: true }
  }
  return plans
}

/**
 * Join decoded segment texts using script-aware boundaries.
 *
 * The two boundary characters decide the separator: if either adjacent character is CJK the
 * parts join directly (Chinese text has no word spaces and mixed Chinese/English is
 * conventionally compact); two non-CJK boundary characters use one space. Looking only at the
 * boundary avoids gluing English words together when an earlier part of the segment was
 * Chinese. Empty segments are dropped rather than producing doubled separators.
 *
 * @param parts - decoded text from each window, in order.
 * @returns the joined transcript.
 */
export function joinTranscripts(parts: readonly string[]): string {
  const kept = parts.map(part => part.trim()).filter(part => part.length > 0)
  let text = ''
  let previous = ''
  for (const part of kept) {
    if (previous === '') {
      text = part
      previous = part
      continue
    }
    const last = Array.from(previous).at(-1) ?? ''
    const first = Array.from(part)[0] ?? ''
    text += `${CJK.test(last) || CJK.test(first) ? '' : ' '}${part}`
    previous = part
  }
  return text
}
