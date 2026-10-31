/**
 * /api/scores reporting from the page (owner log, 31 Oct 2026: dozens of 429s during play). The page used to force a
 * report on every progress tick while the sender was caught up. Now at most one report per REPORT_MIN_MS (forced or
 * not), one per REPORT_EVERY_MS otherwise, and a 429 backs off (Retry-After if given, else doubling, capped).
 * A blocked forced report is not lost: the caller schedules it for `waitMs` later.
 */
export const REPORT_MIN_MS = 10_000;
export const REPORT_EVERY_MS = 60_000;
export const REPORT_BACKOFF_MAX_MS = 5 * 60_000;

export type ReportState = { lastAt: number; until: number; backoff: number };
export const freshReportState = (): ReportState => ({ lastAt: -Infinity, until: 0, backoff: 0 });

/** 0: report now. >0: wait this long first. */
export function reportWait(s: ReportState, now: number, force: boolean): number {
  const gap = force ? REPORT_MIN_MS : REPORT_EVERY_MS;
  return Math.max(0, s.until - now, s.lastAt + gap - now);
}

/** Record a report's answer. */
export function reportAnswered(s: ReportState, now: number, status: number | null, retryAfterSecs?: number | null): ReportState {
  if (status === 429) {
    const backoff = Math.min(REPORT_BACKOFF_MAX_MS, Math.max(REPORT_MIN_MS * 2, s.backoff * 2, (retryAfterSecs ?? 0) * 1000));
    return { lastAt: now, until: now + backoff, backoff };
  }
  return { lastAt: now, until: 0, backoff: 0 };
}
