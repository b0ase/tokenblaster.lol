/**
 * Backfill "Launched by <paymail>" for coins launched before db/023_launch_paymail.sql (or whose creator had no
 * paymail yet). Idempotent: it only asks for coins with no paymail, and the DB function never overwrites one.
 * A key with no paymail yet stays null and is retried on the next run. Needs db/023 applied first.
 *
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… LAUNCH_SECRET=… pnpm tsx scripts/launch-paymail-backfill.ts            dry run
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… LAUNCH_SECRET=… pnpm tsx scripts/launch-paymail-backfill.ts --write    store
 *
 * Secrets come from the environment only; nothing is printed but tickers, keys (public) and paymails.
 */
import { launchPaymail } from '../src/lib/launch/launchedBy';

const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SECRET = process.env.LAUNCH_SECRET;
const WRITE = process.argv.includes('--write');

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON!, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_secret: SECRET, ...args }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

async function main() {
  if (!URL_ || !ANON || !SECRET) throw new Error('Set SUPABASE_URL, SUPABASE_ANON_KEY and LAUNCH_SECRET.');
  const todo = await rpc<{ slot: string; token_id: string | null; sym: string; creator_key: string }[]>('tokenblaster_launch_paymail_todo', {});
  console.log(`${todo.length} coin(s) with no paymail${WRITE ? '' : ' (dry run: pass --write to store)'}`);
  let found = 0;
  for (const c of todo) {
    const paymail = await launchPaymail(c.creator_key);
    if (paymail) found++;
    console.log(`$${c.sym.padEnd(12)} ${c.creator_key.slice(0, 4)}…${c.creator_key.slice(-4)}  ${paymail ?? '(no paymail yet: retry later)'}`);
    if (WRITE) await rpc('tokenblaster_launch_set_paymail', { p_slot: c.slot, p_paymail: paymail });
  }
  console.log(`${found} found, ${todo.length - found} still without a paymail.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
