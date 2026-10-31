import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_MIN_MS, freshReportState, reportAnswered, reportWait } from './scoreThrottle';

test('31 Oct: forced reports on every tick are held to one per 10 s', () => {
  let s = freshReportState();
  let sent = 0;
  for (let t = 0; t < 60_000; t += 250) {
    if (reportWait(s, t, true) === 0) {
      sent++;
      s = reportAnswered(s, t, 200);
    }
  }
  assert.ok(sent <= 6, `sent ${sent}`);
  assert.equal(reportWait(freshReportState(), 0, true), 0); // the first goes at once
});

test('a 429 backs off (Retry-After honoured, doubling, capped)', () => {
  let s = reportAnswered(freshReportState(), 0, 429);
  assert.ok(reportWait(s, 1000, true) >= REPORT_MIN_MS);
  const b1 = s.backoff;
  s = reportAnswered(s, 30_000, 429);
  assert.equal(s.backoff, b1 * 2);
  s = reportAnswered(s, 60_000, 429, 120);
  assert.ok(s.backoff >= 120_000);
  s = reportAnswered(s, 400_000, 200);
  assert.equal(s.until, 0);
});
