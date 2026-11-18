/** Deterministic VAD segment planning and script-aware transcript joining. */
/** One VAD speech segment in absolute sample coordinates. */
export interface VadSegment {
    readonly start: number;
    readonly length: number;
}
/** One decoded window after onset/tail padding and overlap suppression. */
export interface SegmentPlan {
    readonly start: number;
    readonly end: number;
    readonly isFirst: boolean;
    readonly isLast: boolean;
}
/** Recording bounds and the configured padding. */
export interface SegmentLimits {
    readonly totalSamples: number;
    readonly sampleRate: number;
    readonly onsetPaddingSeconds: number;
    readonly tailPaddingSeconds: number;
}
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
export declare function planSegments(segments: readonly VadSegment[], limits: SegmentLimits): SegmentPlan[];
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
export declare function joinTranscripts(parts: readonly string[]): string;
