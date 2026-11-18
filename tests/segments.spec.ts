/** Segment planning covers first/last edges and overlap suppression; joining is script-aware. */
import { describe, expect, it } from 'vitest'
import { joinTranscripts, planSegments, type SegmentLimits } from '../src/segments.ts'

const limits = (overrides: Partial<SegmentLimits> = {}): SegmentLimits => ({
  totalSamples: 40_000, sampleRate: 16_000, onsetPaddingSeconds: 0.3, tailPaddingSeconds: 0.25, ...overrides,
})

describe('planSegments', () => {
  it('clamps the first window at zero and pads both sides', () => {
    expect(planSegments([{ start: 1000, length: 2000 }], limits({ totalSamples: 16_000 }))).toEqual([
      { start: 0, end: 7000, isFirst: true, isLast: true },
    ])
  })

  it('clamps the last window at the recording end', () => {
    expect(planSegments([{ start: 10_000, length: 5000 }], limits({ totalSamples: 16_000 }))).toEqual([
      { start: 5200, end: 16_000, isFirst: true, isLast: true },
    ])
  })

  it('never starts a window before the previous padded end', () => {
    const plans = planSegments([
      { start: 4800, length: 8000 },
      { start: 12_800, length: 8000 },
    ], limits({ totalSamples: 40_000 }))
    expect(plans).toEqual([
      { start: 0, end: 16_800, isFirst: true, isLast: false },
      { start: 16_800, end: 24_800, isFirst: false, isLast: true },
    ])
    expect(plans[1]!.start).toBe(plans[0]!.end)
  })

  it('supports zero padding and drops empty or collapsed segments', () => {
    expect(planSegments([{ start: 1000, length: 2000 }], limits({ onsetPaddingSeconds: 0, tailPaddingSeconds: 0 })))
      .toEqual([{ start: 1000, end: 3000, isFirst: true, isLast: true }])
    expect(planSegments([], limits())).toEqual([])
    expect(planSegments([{ start: 500, length: 0 }], limits())).toEqual([])
    // The second segment ends inside the first segment's padded tail, so it collapses.
    expect(planSegments([{ start: 5000, length: 100 }, { start: 5000, length: 50 }], limits({ totalSamples: 10_000 })))
      .toEqual([{ start: 200, end: 9100, isFirst: true, isLast: true }])
  })

  it('sorts unsorted VAD output and keeps the windows disjoint', () => {
    const plans = planSegments([
      { start: 20_000, length: 2000 },
      { start: 2000, length: 2000 },
    ], limits())
    expect(plans.map(plan => [plan.start, plan.end])).toEqual([[0, 8000], [15_200, 26_000]])
    if (plans.length > 1) expect(plans[1]!.start).toBeGreaterThanOrEqual(plans[0]!.end)
  })
})

describe('joinTranscripts', () => {
  it.each([
    [['你好', '世界'], '你好世界'],
    [['hello', 'world'], 'hello world'],
    [['你好', 'hello'], '你好hello'],
    [['hello', '世界'], 'hello世界'],
    [['昨天是 MONDAY', 'TODAY IS礼拜二'], '昨天是 MONDAY TODAY IS礼拜二'],
    [['第一句。', '第二句。'], '第一句。第二句。'],
    [['Hello.', 'World.'], 'Hello. World.'],
    [['', ' 你好 ', ''], '你好'],
    [[], ''],
  ])('joins %j as %j', (parts, expected) => {
    expect(joinTranscripts(parts)).toBe(expected)
  })
})
