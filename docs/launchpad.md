# BlastPad (/launch): BSV-21 launchpad on a bonding curve

Our answer to MEMEPOOL (txblaster.xyz/memepool). Same curve, cheaper, and every coin is ammo in the games.

## Curve and fees (`src/lib/launch/curve.ts`)
- 1,000,000,000 tokens, 0 decimals, all minted into the pool at launch. Virtual reserves 1 BSV / 1.073B tokens:
  start ≈0.093 sats/token (0.93 BSV mcap), graduates at 793.1M sold (≈2.83 BSV in the pool, 13.7 BSV mcap).
  Keeps trading on the same curve after graduation.
- 1.0% of the BSV side: 0.70% house (`NEXT_PUBLIC_TB_HOUSE_ADDRESS`), 0.30% to the coin's signed route.
  Launch 25,000 sats + 0.1 BSV index money. Index fund 1,000 sats per token output (max 5,000 per trade). Buys 0.0001–20 BSV.
- GorillaPool only indexes ("includes") a BSV-21 token once its fund reaches 0.1 BSV (10,000,000 sats); before that wallets
  can't see transfers and sells can't be verified. So the launch pays 0.1 BSV to the coin's `index` key, and
  `forwardIndexFund` (at commit, then every vault run) sends it to the fund address once GorillaPool publishes it.

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

## Ammo coins: swap on load, tagged rounds, one bulk burn (`src/lib/launch/ammoCoins.ts`, `swapLoad.ts`)
At LOCK & LOAD a cabinet can sell a BlastPad coin as ammo at the plain curve price (no discount). One buy (`to` = the
gun's address) delivers the tokens to the gun; the wallet adds the gunpowder as an extra output of the same
createAction: ONE approval. Rounds = min(tokens / burnPer, gunpowder / shot cost).
Option A (owner, 25 Oct): each shot is a plain sats storm round tagged `tokenblaster.lol <token id> <n> gallery
<paymail>` (no token output, one signature), which bsv.lol files as TokenBlaster with the coin's label. The gun counts
the accepted rounds (`Gun.oweBurn`, saved in localStorage) and at session end sends ONE tx burning exactly
rounds × burnPer to 1BitcoinEater, the rest back to the gun (`Gun.burnOwed`, ≤ 2 token outputs → ~2,000 sats of
index fund per session). A burn left owed (tab closed) runs first on the next load or UNLOAD.
Per-shot token burns in lanes (fastBlast `burn`, stormCore burn mode) remain behind `PER_SHOT_BURN` (off): they
cost ~2,000 sats of index fund per shot.

## Launch (`/api/launch/new`)
Creator signs the launch message (BRC-3, protocol `[1,"tokenblaster launch"]`, keyID = slot). Launch tx:
`[0]` image inscription → creator, `[1]` deploy+mint 1B (icon `_0`) → token pool, `[2]` 25,000 sats → house, `[3]` 0.1 BSV → the coin's index key (forwarded to its GorillaPool fund).
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

## Coin API extras for the bWalletX Exchange (`/api/launch/coins`, `/api/launch/coin`)
Every coin row (in `coins[]` and in `coin`) also carries (CORS `*`, as before):
- `price_sats` (number): the current curve price of one token in sats (`price(sold)`, `src/lib/launch/curve.ts`).
- `theme` (optional): bWalletX theme v2, same schema as `public/.well-known/bwalletx-theme.json`
  (`v, name, mode, accent, accentHi, bg, surface, text, logo, cardArt`). `logo`/`cardArt` are absolute URLs on
  https://www.tokenblaster.lol (the site origin; the apex 308s there); logo ≤ 64 KB, cardArt ≤ 256 KB.
- `room` (optional): bChatX room ticker, `^[A-Z0-9]{1,20}$`.
- `merch_url` (optional): an https URL.

`theme`, `room` and `merch_url` live in `src/lib/launch/coinMeta.ts` keyed by `token_id` (no DB migration);
`src/lib/coinMeta.test.ts` checks the schema, contrast (text 4.5:1, accent 3:1) and image sizes. Fields are left out
when a coin has none.

## Play-to-earn coins: `trading` and `earn_url` (25 Oct 2026)

`/api/launch/coins` and `/api/launch/coin` give every coin `trading: true | false`. For play-to-earn coins
(today only $TERRORNODE, `d5ffbbfd…de02_1`) it is `false` until the coin graduates, with
`earn_url: "https://www.tokenblaster.lol/arcade/terrornode"`, `receipts_issued` and `graduate_at`.
The trade route refuses buy and sell for them (403) until graduation, the coin page shows "Earn $TERRORNODE by playing Assault on
Terrornode", and the bWalletX Exchange hides curve buy/sell when `trading` is false. The list lives in
`src/lib/launch/receipts.ts` (`NO_TRADE`).

### $TERRORNODE receipts

Every LIVE bullet in Escape from TERRORNODE buys 1 receipt. Receipt #n costs
`1 + 199 × (n − 1) / (1e9 − 1)` sats: linear from 1 sat to 200 sats, fixed in sats (owner, 27 Oct 2026; no USD
conversion). A range is summed in closed form with bigint and rounded up once (`rangeSats` in
`src/lib/launch/receipts.ts`); the gun pays that and the server checks the same sum (db/022's reserve with
`p_penny = 200`, no migration). Example: a 1,000,000-shot session from #1 pays 1,099,500 sats of receipts. At session end the gun sends
ONE settlement tx: an OP_RETURN `tokenblaster.lol terrornode receipts <count> <recipient> <session> <handle>`, the
receipt money to the creator `1F4J9KkMoqtznXPJuCgb98LRymssc8MFfd` and 300 sats of transfer gas to the pool's token
address. `POST /api/terrornode/receipts {txid}` reads it from the chain, reserves the receipt range in the ledger
(`db/022_terrornode_receipts.sql`, checks the payment, idempotent per txid) and sends the tokens from the pool in one
transfer. Off until `RECEIPTS_LIVE=1`.

**Graduation (10,000,000 receipts).** When the ledger's issued count (`tokenblaster_receipts_issued`, cached 30 s in
`src/lib/launch/receiptsIssued.ts`) reaches `GRADUATE_AT` = 10,000,000, `trading` turns true for $TERRORNODE: the
trade route allows buy/sell on its BlastPad curve and the coin page and bWalletX Exchange show trading. Before that the
coin page shows "N / 10M shots to graduation". Earning by playing carries on after graduation at the same receipt
curve until all 1B are issued.

**Sell-out (all 1B issued).** Receipts stop: the GET quote says `soldOut: true`, `live: false`; the game keeps
working as plain rounds and the gun shows "All $TERRORNODE earned". Rounds still owed in a browser are let go.

**Phase 2 design note (not built).** After sell-out, play could cost $TERRORNODE instead: each live shot spends
tokens from the gun (priced in tokens per shot, set from the curve price at sell-out), and every spent token goes to a
prize pool address rather than being burned. The pool pays out on game results (leaderboard / level prizes), so
the tokens circulate between players. Needs: a token-spend settlement tx like the receipts one (one tx per session,
OP_RETURN tag, tokens to the prize pool), a prize-pool key on the server, and payout rules. Owner to confirm before
building.
