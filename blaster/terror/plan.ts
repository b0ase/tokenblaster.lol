/**
 * TERRORNODE stress test: pure planning + safety maths (no network, no keys). Used by the runner, the CLI and tests.
 *
 * Shape (GorillaPool's rule: wide, never deeper than 2 unconfirmed):
 *   mined funding coin ──fan-out (depth 1, one per coin)──▶ W lane coins ──blast (depth 2)──▶ OP_RETURN tag + 1-sat change
 *
 * Bots are labels on one funding wallet: "terrornode-bot01" … "terrornode-bot20". Each bot owns a disjoint slice of the
 * funding coins, has its own shot quota and its own spend cap. Bot shots go straight to the broadcasters and never
 * through the game's receipts API, so bots earn NO $TERRORNODE receipts (NO_RECEIPTS is asserted in the CLI).
 */

export const NO_RECEIPTS = true as const;
export const BOT_PREFIX = 'terrornode-bot';
export const botName = (i: number) => `${BOT_PREFIX}${String(i).padStart(2, '0')}`;

/** "3" → [1,2,3]; "1-5" → [1..5]; "2,7,9" → [2,7,9]. Bot numbers are 1-based. */
export function parseBots(spec: string): number[] {
  const out = new Set<number>();
  for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)-(\d+)$/.exec(part);
    if (m) { for (let i = Number(m[1]); i <= Number(m[2]); i++) out.add(i); continue; }
    if (!/^\d+$/.test(part)) throw new Error(`bad --bots "${spec}"`);
    out.add(Number(part));
  }
  // A bare count means bots 1..N.
  if (!spec.includes('-') && !spec.includes(',') && out.size === 1) { const n = [...out][0]; return Array.from({ length: n }, (_, i) => i + 1); }
  const a = [...out].sort((x, y) => x - y);
  if (!a.length || a[0] < 1 || a[a.length - 1] > 99) throw new Error(`--bots must be within 1..99`);
  return a;
}

/** Give each bot a disjoint slice of the coins: coin i goes to bot (i mod totalBots). Same split on every machine. */
export function allocate<T>(coins: T[], totalBots: number, bot: number): T[] {
  return coins.filter((_, i) => i % totalBots === (bot - 1) % totalBots);
}

/** How many lanes a coin of `value` can fund, given lane value and fan-out fee per lane count. */
export function lanesFor(value: number, laneValue: number, fanFee: (lanes: number) => number, want = Infinity): number {
  let w = Math.min(want, Math.floor(value / laneValue));
  while (w > 0 && w * laneValue + fanFee(w) > value) w--;
  return Math.max(0, w);
}

/** Rolling error window: auto-stop once broadcast errors exceed `maxRatio` over at least `minWindow` results. */
export class ErrorWindow {
  private win: Uint8Array;
  private at = 0;
  private filled = 0;
  private bad = 0;
  constructor(private size = 5000, private maxRatio = 0.05, private minWindow = 1000) { this.win = new Uint8Array(size); }
  push(ok: number, bad: number) {
    for (let i = 0; i < ok + bad; i++) {
      const v = i < ok ? 0 : 1;
      if (this.filled === this.size) this.bad -= this.win[this.at]; else this.filled++;
      this.win[this.at] = v;
      this.bad += v;
      this.at = (this.at + 1) % this.size;
    }
  }
  get ratio() { return this.filled ? this.bad / this.filled : 0; }
  check(): string | undefined {
    if (this.filled >= this.minWindow && this.ratio > this.maxRatio)
      return `broadcast errors ${(this.ratio * 100).toFixed(1)}% over the last ${this.filled} > ${(this.maxRatio * 100).toFixed(0)}%`;
    return undefined;
  }
}

export type BotCaps = { shots: number; maxSats: number };

/** Projected cost of `shots` at a measured fee per shot (fan-out share included) and 1-sat change per blast. */
export function project(shots: number, feePerShot: number, bsvUsd: number) {
  const fees = Math.ceil(shots * feePerShot);
  const dust = shots; // 1-sat change outputs: still ours, but locked in dust until swept
  return { shots, fees, dust, bsv: fees / 1e8, usd: (fees / 1e8) * bsvUsd, withDustBsv: (fees + dust) / 1e8 };
}

/** Refuse a live plan that can't be afforded or breaks a cap. Returns the reason, or null. */
export function checkLive(o: { bots: number; shotsPerBot: number; feePerShot: number; botMaxSats: number; maxSats: number; walletSats: number }): string | null {
  const perBot = Math.ceil(o.shotsPerBot * (o.feePerShot + 1));
  if (perBot > o.botMaxSats) return `each bot needs ~${perBot.toLocaleString()} sats (fees + 1-sat change) for ${o.shotsPerBot.toLocaleString()} shots, over its cap of ${o.botMaxSats.toLocaleString()}; lower --shots or raise --bot-max-sats`;
  const fees = Math.ceil(o.bots * o.shotsPerBot * o.feePerShot);
  if (fees > o.maxSats) return `plan's fees ~${fees.toLocaleString()} sats > --max-sats ${o.maxSats.toLocaleString()}`;
  if (o.bots * perBot > o.walletSats) return `plan needs ~${(o.bots * perBot).toLocaleString()} sats; the wallet's confirmed coins hold ${o.walletSats.toLocaleString()}`;
  return null;
}

/**
 * Per-bot flags (owner 31 Oct 2026): every shot advertises a TERRORNODE asset in push 5, the slot bsv.lol shows in its
 * feed line. Bots take these in turn (bot01 → first). No investment wording.
 */
export const FLAGS = [
  '🎃👻💀😈🦇🕷️🧟👹 terrornode.com 👹🧟🕷️🦇😈💀👻🎃',
  '😈👹👺💀☠️🔥🎃👻 PLAY tokenblaster.lol/arcade/terrornode 👹🧟🕷️🦇😈💀👻🎃',
  '👻👻👻🎃🎃🎃💀💀 bmusicx.com/listen/terrornode 👹🧟🕷️🦇😈💀👻🎃',
  '🦇🕷️🕸️🧛🧟🧙🎃👻 bchatx.com/t/terrornode 👹🧟🕷️🦇😈💀👻🎃',
  '💀☠️⚰️🪦👻😱🎃🔥 $TERRORNODE · badvertisingx.com/campaign/terrornode 👹🧟🕷️🦇😈💀👻🎃',
  '🎃👻💀😈🦇🕷️🧟👹 FREE DR KWEG FROM THE EVIL EROBOTZ · terrornode.com 👹🧟🕷️🦇😈💀👻🎃',
  '😈👹👺💀☠️🔥🎃👻 PLAY TERRORNODE · tokenblaster.lol/arcade/terrornode 👹🧟🕷️🦇😈💀👻🎃',
  '👻👻👻🎃🎃🎃💀💀 Welcome to TERRORNODE · bmusicx.com/listen/terrornode 👹🧟🕷️🦇😈💀👻🎃',
  '🦇🕷️🕸️🧛🧟🧙🎃👻 STORM nSLAVE CORPORATION · terrornode.com 👹🧟🕷️🦇😈💀👻🎃',
  '💀☠️⚰️🪦👻😱🎃🔥 $TERRORNODE · bchatx.com/t/terrornode 👹🧟🕷️🦇😈💀👻🎃',
]
export const botFlag = (i: number, flags: string[] = FLAGS) => flags[(i - 1) % flags.length];
