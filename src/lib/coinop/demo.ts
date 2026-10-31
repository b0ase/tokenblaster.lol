/**
 * Demo (taste) mode logic, owner 31 Oct 2026 ("Try a 20s demo" must be friendly). Pure, so it is tested
 * (demo.test.ts) and shared by DemoOverlay, the coin-op gate and useCoinOp.
 *
 *  - The clock waits until the player actually starts a run ('waiting'), then counts down ('running').
 *    It used to start on the button press, so menus and the stage intro ate the 20 s before any play.
 *  - At 0 the demo is 'over': the caller pauses / stops ITS game through the game's own path. Nothing is
 *    patched globally and nothing outside the game stage is blocked.
 *  - A demo run never pays and never posts a score (playDecision, demoMayPay).
 */
export const DEMO_SECONDS = 20;

export type DemoPhase = 'waiting' | 'running' | 'over';
export type DemoState = { phase: DemoPhase; left: number; total: number };
export type DemoEvent = 'play' | 'tick' | 'again';

export const demoInit = (seconds = DEMO_SECONDS): DemoState => ({ phase: 'waiting', left: seconds, total: seconds });

export function demoReduce(s: DemoState, ev: DemoEvent): DemoState {
  if (ev === 'again') return demoInit(s.total);
  if (ev === 'play') return s.phase === 'waiting' ? { ...s, phase: 'running' } : s;
  // tick
  if (s.phase !== 'running') return s;
  const left = Math.max(0, s.left - 1);
  return { ...s, left, phase: left === 0 ? 'over' : 'running' };
}

/** The small corner chip. */
export const demoChipText = (s: DemoState) => (s.phase === 'waiting' ? `DEMO · ${s.left}s · starts when you play` : `DEMO · ${s.left}s`);

/** What a game's PLAY does: a demo run is always unpaid; otherwise use a paid play or pay one. */
export function playDecision(o: { demo: boolean; prepaid: number }): 'demo' | 'prepaid' | 'pay' {
  if (o.demo) return 'demo';
  return o.prepaid > 0 ? 'prepaid' : 'pay';
}

/** A payment (play, coin, score post) may only go out when this is not a demo. */
export const demoMayPay = (demo: boolean) => !demo;
