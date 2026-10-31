/**
 * Leaderboard indexer (runs on Hetzner under pm2). Follows the GorillaPool JungleBus subscription
 * that matches only blasts (Contexts = "tokenblaster.lol") and records each one in
 * public.tokenblaster_blasts. Mempool sightings count straight away; the block channel fills in
 * block height and time and replays anything missed while the worker was down.
 *
 *   JUNGLEBUS_BLASTS_SUBSCRIPTION_ID=… DATABASE_URL=postgres://… START_BLOCK=969470 node indexer.mjs
 */
import { Centrifuge } from 'centrifuge';
import WebSocket from 'ws';
import pg from 'pg';
import { classify } from '../src/lib/feed';

const HOST = 'https://junglebus.gorillapool.io';
const SUB = process.env.JUNGLEBUS_BLASTS_SUBSCRIPTION_ID;
const DB = process.env.DATABASE_URL;
if (!SUB || !DB) throw new Error('Set JUNGLEBUS_BLASTS_SUBSCRIPTION_ID and DATABASE_URL.');

const db = new pg.Pool({ connectionString: DB, max: 3 });
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function state(key: string): Promise<string | null> {
  const r = await db.query('select value from tokenblaster_state where key = $1', [key]);
  return r.rows[0]?.value ?? null;
}
const setState = (key: string, value: string) =>
  db.query('insert into tokenblaster_state (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value', [key, value]);

type Row = [txid: string, token: string, height: number | null, time: Date | null, game: string | null];
let queue: Row[] = [];
let flushing = false;

/**
 * Rows are written in batches (one multi-row insert per flush): one insert per tx managed ~100/s, far below a
 * stress run's ~1,000 tx/s, and the indexer fell hours behind (31 Oct 2026). Later duplicates of a txid in a batch
 * are merged first, since one insert can't touch the same row twice.
 */
async function flush() {
  if (flushing || !queue.length) return;
  flushing = true;
  const batch = queue.splice(0, 5000);
  const byId = new Map<string, Row>();
  for (const r of batch) {
    const p = byId.get(r[0]);
    byId.set(r[0], p ? [r[0], r[1], r[2] ?? p[2], r[3] ?? p[3], r[4] ?? p[4]] : r);
  }
  const rows = [...byId.values()];
  try {
    await db.query(
      `insert into tokenblaster_blasts (txid, token, block_height, block_time, game)
       select * from unnest($1::text[], $2::text[], $3::int[], $4::timestamptz[], $5::text[])
       on conflict (txid) do update set block_height = coalesce(excluded.block_height, tokenblaster_blasts.block_height),
                                        block_time = coalesce(excluded.block_time, tokenblaster_blasts.block_time),
                                        game = coalesce(excluded.game, tokenblaster_blasts.game)`,
      [rows.map((r) => r[0]), rows.map((r) => r[1]), rows.map((r) => r[2]), rows.map((r) => r[3]), rows.map((r) => r[4])],
    );
    const mined = rows.filter((r) => r[2] !== null);
    log(`recorded ${rows.length} (${mined.length} mined${mined.length ? ` up to ${Math.max(...mined.map((r) => r[2]!))}` : ''}) · queue ${queue.length}`);
  } catch (e) {
    queue.unshift(...batch); // keep them; retried on the next flush
    log('db error', e instanceof Error ? e.message : e);
  } finally {
    flushing = false;
  }
}
setInterval(() => void flush(), 250);

async function record(d: { id?: string; transaction?: string; block_height?: number; block_time?: number }, mined: boolean) {
  if (!d.id || !d.transaction) return;
  const f = classify(d.id, Buffer.from(d.transaction, 'base64').toString('hex'), mined);
  if (f?.kind !== 'blast' || !f.token) return;
  queue.push([d.id, f.token, mined && d.block_height ? d.block_height : null, mined && d.block_time ? new Date(d.block_time * 1000) : null, f.game ?? null]);
}

async function main() {
  const from = Number((await state('last_block')) ?? process.env.START_BLOCK ?? 0) + 1;
  let token = '';
  const centrifuge = new Centrifuge('wss://junglebus.gorillapool.io/connection/websocket', {
    websocket: WebSocket,
    getToken: async () => {
      const r = token
        ? await fetch(`${HOST}/v1/user/refresh-token`, { headers: { token } })
        : await fetch(`${HOST}/v1/user/subscription-token`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: SUB }),
          });
      if (!r.ok) throw new Error(`JungleBus token ${r.status}`);
      token = ((await r.json()) as { token: string }).token;
      return token;
    },
  });
  centrifuge.on('connected', () => log('connected'));
  centrifuge.on('disconnected', (c) => log('disconnected', c.reason));
  centrifuge.on('error', (e) => log('error', e.error?.message ?? e));

  const listen = (channel: string, onData: (d: Record<string, unknown>) => Promise<void>) => {
    const s = centrifuge.newSubscription(channel);
    s.on('publication', (ctx) => onData(ctx.data).catch((e) => log('db error', e.message)));
    s.on('error', (e) => log('subscription error', channel, e.error?.message ?? e));
    s.subscribe();
  };
  listen(`query:${SUB}:mempool`, (d) => record(d, false));
  listen(`query:${SUB}:${from}`, (d) => record(d, true));
  listen(`query:${SUB}:control`, async (d) => {
    // 200 = block done: everything up to it is recorded.
    if (Number(d.statusCode) === 200 && d.block) {
      while (queue.length || flushing) await new Promise((r) => setTimeout(r, 100));
      await setState('last_block', String(d.block));
    }
  });
  log(`following blasts from block ${from}`);
  centrifuge.connect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
