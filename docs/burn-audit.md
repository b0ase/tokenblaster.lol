# BlastPad "Buyback & burn": audit (7 Oct 2026)

**Verdict: implemented end to end in code, never shown to be exercised, with real failure-handling bugs.** Three are fixed on this branch: one needs migration 017, and two are code-only. Some risks remain (listed below). None of the fixes touch `/api/launch/*` trade or launch shapes.

## How it works (the path, step by step)

1. **Choosing the route.** At launch the creator picks `{ kind: 'buyback' }` (`src/lib/launch/shape.ts:98,104,112`). It is stored in `tokenblaster_launch_coins.route` (`db/007_launchpad.sql:15`). The coin also gets a vault key and address (`src/lib/launch/server.ts:65-70`, role `vault`).
2. **Accrual.** Each user trade pays the 0.30% route fee to the coin's `vault_address`. That output is part of the trade shape, which was not changed here. `commit` adds the fee to `route_accrued` (`db/007_launchpad.sql:204`). `route_accrued` only ever counts up: it is lifetime fees, not the current vault balance, and the vault never lowers it. The coin page labels it "In the vault so far" (`CoinView.tsx` Audit), which is wrong once a burn has happened. This is cosmetic and worth relabelling "Route fees so far".
3. **Trigger.** `worker/vault.ts` (pm2 on Hetzner) calls `POST /api/launch/vault` every 7 to 13 minutes, authenticated with `LAUNCH_CRON_SECRET` (`src/app/api/launch/vault/route.ts`). That runs `runVaults()` (`src/lib/launch/vault.ts:90`).
4. **Vault balance.** `runVaults` lists the buyback coins (`tokenblaster_launch_vault_coins`, `db/008_launchpad_vault.sql:32`). It reads only *confirmed* vault UTXOs from WhatsOnChain and skips 1-sat outputs (`vault.ts:102`, `confirmedUtxos` at `vault.ts:28`). `free = balance − owed − 500` (`vault.ts:104`).
5. **Threshold.** A buyback runs when `free ≥ 100,000` sats (`BUYBACK_MIN`, `src/lib/launch/burn.ts`). The spend is capped so the price moves at most ~2% (`buybackSpend`, `burn.ts`), which is the same formula as before, now unit-tested. Nothing runs below 10,000 sats.
6. **The transaction** (`vault.ts:135-218`). It leases the pool, which stops anyone else trading that coin. Then it builds one transaction:
   - Inputs: pool token UTXO, pool reserve UTXO, every confirmed vault UTXO.
   - Outputs: **burn output** (`tokenOut(id, tokens, BURN_ADDRESS)`, 1 sat, `vault.ts:168`), pool token change, reserve (+curveSats), house 0.70%, GorillaPool index fund fee, vault change.

   So the buyback really does buy on the curve: the reserve grows by `curveSats` and `sold` moves forward by the quoted tokens. Those tokens leave the pool to the burn output in the same transaction. There is no route fee on a buyback (`vault.ts:183`).
7. **Booking.** `tokenblaster_launch_commit` with `side: 'burn'`, `mm: true` writes a trades row (so burns already appear in `/api/launch/trades` and the board feed). Then `tokenblaster_launch_payout(kind 'buyback')` inserts a payouts row and adds the tokens to `coins.burned` (`db/008_launchpad_vault.sql:50-59`).

## Is the burn provable?

`BURN_ADDRESS = 1BitcoinEaterAddressDontSendf59kuE` (`src/lib/gun.ts:20`). This is the standard "nobody has the key" address: its hash160 was picked by hand, so finding a key for it is practically impossible. That makes it **conventionally** unspendable, but not **provably** unspendable the way an `OP_FALSE OP_RETURN` script is. The BSV-21 indexer also still counts these tokens as held by that address. Any "supply now" figure is therefore our own ledger's number (`SUPPLY − burned`), not the indexer's. Everyone in the ecosystem accepts 1BitcoinEater, and the Arena/BSVGun token shots already burn there (`gun.ts:457`). Moving to a provable burn would mean changing the buyback's output script. That is not a user trade shape, but check that bWalletX's validator never sees buyback transactions before changing it. Flagged for a decision, not changed.

## Has it ever run?

**Not shown.** No commit or log in the repo shows a burn, and I did not query the live DB, by design. To check (read only):

```sql
select c.sym, c.burned, c.route->>'kind' as route, c.route_accrued from tokenblaster_launch_coins c where c.route->>'kind' = 'buyback';
select * from tokenblaster_launch_payouts where kind = 'buyback' order by created_at desc;
select * from tokenblaster_launch_trades where side = 'burn';
```

Also check `pm2 logs vault` on Hetzner for lines that say `bought back and burned`. A coin needs about 0.333 BSV of user volume (0.30% → 100,000 sats) **confirmed** in its vault before its first buyback.

## Bugs found and fixed on this branch

| # | Bug | Effect | Fix |
|---|-----|--------|-----|
| 1 | The early `return null` paths inside `buyback()` (no token UTXO, spend under 10k, zero tokens quoted) left the lease held (old `vault.ts:136-145`). | Every vault run that decided not to buy locked the coin against **all user trades** for 60 s. | Release the lease on every no-op path. |
| 2 | The `catch` always released the lease, even **after** the broadcast succeeded (old `vault.ts:205-207`). If commit failed (DB blip, or a lease that expired after 60 s), the pool was freed while the ledger still pointed at spent coins. | The next trade gets built on spent pool UTXOs, so the pool is wedged and the burn is missing from the ledger. | Track `broadcasted`. After a broadcast, never release; retry commit and payout 3x (`bookBroadcastBurn`, `burn.ts`). On final failure, throw `BURN BROADCAST BUT NOT BOOKED <txid>` into the vault log. |
| 3 | The lease was 60 s, but the work between lease and commit includes several WhatsOnChain/GorillaPool calls (fund address, BEEF compaction, broadcast + WoC check). | The lease could expire mid-flight → "lease lost" after the broadcast (see #2). | Lease is now 180 s, and BEEF compaction runs before the commit call. |
| 4 | `tokenblaster_launch_payout` adds to `burned` even when the payout row already exists (`on conflict do nothing` + unconditional update). | A retried booking double-counts `burned`. | **`db/017_launch_burn_idempotent.sql`** (not applied): update `burned` only when the row was inserted. |
| 5 | Payout `detail.supplyLeft` was always `SUPPLY` (1B). | Wrong history data. | Now `SUPPLY − (burned + tokens)`. |

Tests: `src/lib/burn.test.ts` covers the threshold, the fee margin, the ≤2% price move at three reserve levels, burn stats, and retry/loud failure of booking. No network, no keys.

## Remaining risks / what's left

- **Manual recovery after "BROADCAST BUT NOT BOOKED".** The lease runs out after 180 s. Then trades will fail against the spent pool coins until someone books the txid by hand (commit with the txid's outputs). The trade route has an auto-recovery for *user* trades (`trade/route.ts:53-70`, `lease_quote.signed`). Buybacks need the same thing: store the built tx in `lease_quote` before the broadcast and teach `recover()` to book `side:'burn'`. That touches the trade route's recovery path, so it is **not done here**.
- **Unconfirmed vault coins are ignored on purpose.** A quiet coin may wait a block or more after crossing 100k.
- **The vault inputs every confirmed UTXO it has** (up to 200). Fine at current volumes. A big vault would make a big transaction.
- **`route_accrued` labelling** (see step 2).
- **No dry-run mode** for the vault job. Adding `?dry=1`, which builds and logs without broadcasting, would make the first live burn much safer to rehearse.

## What a first live burn needs

1. Apply `db/017_launch_burn_idempotent.sql` (run by hand on Hetzner).
2. Server env (already needed by the launchpad): `LAUNCH_POOL_WIF`, `LAUNCH_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_TB_HOUSE_ADDRESS`, `LAUNCH_CRON_SECRET`. Worker: `SITE_URL`, `LAUNCH_CRON_SECRET`, running under pm2.
3. A live coin with `route.kind = 'buyback'` and ≥ **100,000 sats confirmed** in its vault address. That comes from organic trade fees, or the owner tops up the vault address directly (an owner money decision). One run spends `min(free − 2,000, ~1% of (1 BSV + reserve))`, so a fresh coin spends at most about 1M sats a run, and a 100k vault spends about 98k. Roughly 98% goes to the curve, ~0.7% to the house, and 1–5k sats to the index fund.
4. Deploy this branch, then watch the next vault tick (or trigger it once with the cron secret). Expect a log line, a `burn` row in trades, and a payout row. The 🔥 then shows on the ticker, the coin page and the share card at `/launch/<id>/burn/<txid>`.
