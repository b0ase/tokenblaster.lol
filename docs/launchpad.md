# BlastPad (/launch): BSV-21 launchpad on a bonding curve

Our answer to MEMEPOOL (txblaster.xyz/memepool). Same curve, cheaper, and every coin is ammo in the games.

## Curve and fees (`src/lib/launch/curve.ts`)
- 1,000,000,000 tokens, 0 decimals, all minted into the pool at launch. Virtual reserves 1 BSV / 1.073B tokens:
  start ≈0.093 sats/token (0.93 BSV mcap), graduates at 793.1M sold (≈2.83 BSV in the pool, 13.7 BSV mcap).
  Keeps trading on the same curve after graduation.
- 1.0% of the BSV side: 0.70% house (`NEXT_PUBLIC_TB_HOUSE_ADDRESS`), 0.30% to the coin's signed route.
  Launch 25,000 sats. Index fund 1,000 sats per token output (max 5,000 per trade). Buys 0.0001–20 BSV.

## Custody
Pool, reserve and vault keys per coin are BRC-42 children of `LAUNCH_POOL_WIF` (server env only).
The database (Hetzner Supabase, `db/007`, `db/008`) is the ledger; writes go through functions gated by
`tokenblaster_secrets.launch` = `LAUNCH_SECRET`. Coin pages show a proof of reserves (curve vs ledger vs chain).

## A trade (`/api/launch/trade`, `src/lib/launch/client.ts`)
1. prepare: lease the coin (90 s, one trade at a time), quote, return pool inputs + fixed outputs + BEEF.
2. The browser checks the plan against its own quote; the wallet `createAction`s around it (signAndProcess false).
3. sign: the server checks the tx (`matchesPlan`, no foreign token inputs, no extra tokens out) and signs pool inputs.
4. The wallet signs its inputs (sells: token coins via createSignature) and broadcasts; commit re-checks,
   broadcasts to ARC (idempotent) and moves the pool. A signed-but-uncommitted trade is booked later by `reconcile()`.
Sell proceeds land as the wallet's change (BRC-100 wallets count external input value).

## Launch (`/api/launch/new`)
Creator signs the launch message (BRC-3, protocol `[1,"tokenblaster launch"]`, keyID = slot). Launch tx:
`[0]` image inscription → creator, `[1]` deploy+mint 1B (icon `_0`) → token pool, `[2]` 25,000 sats → house.
Token id = `<txid>_1`.

## Routes and the vault (`src/lib/launch/vault.ts`, `worker/vault.ts`)
- creator: paid inline to the payout address signed at launch.
- split: vault pays shares once the smallest is ≥600 sats.
- holders: vault credits holders (≥100k tokens, from curve trades) pro rata; they Claim on /launch/rewards
  (BRC-29 payment, internalized into the wallet).
- buyback: from 100,000 sats, vault buys on the curve (≤2% move) and sends tokens to the burn address (marked MM).
Only confirmed vault coins are spent. `worker/vault.ts` (pm2 on Hetzner) calls POST /api/launch/vault every 7–13 min.

## Go-live checklist
1. Apply `db/007_launchpad.sql`, `db/008_launchpad_vault.sql`; insert the `launch` secret.
2. Vercel env: `LAUNCH_POOL_WIF` (fresh key, backed up), `LAUNCH_SECRET`, `LAUNCH_CRON_SECRET`.
3. `pnpm vault:build`, run `worker/dist/vault.mjs` under pm2 with `LAUNCH_CRON_SECRET`.
4. Test launch + buy + sell with small amounts from bWallet and Yours before announcing.
