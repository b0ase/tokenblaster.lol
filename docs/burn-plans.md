# Burn plans (design only, no code)

## A. Cross-coin burns (coin A's fees buy and burn coin B)

**What it is.** A new route, `{ kind: 'burn', target: '<token B id>' }`. A's 0.30% route fee still goes to A's vault, exactly as it does today. The vault job then buys **B** on B's curve and burns it. This is MEMEPOOL's "$ASH fees burn $HODL".

**What changes**
- `shape.ts` route union + `ROUTES` copy + launch-form picker: pick a target coin (BlastPad coins only, `status='live'`).
- Validation at launch: the target must exist and must not be A itself (that is just `buyback`). Decide whether the target can be changed later. Recommended: no. Make it fixed at launch like every other route, so holders can rely on it.
- `vault.ts`: `buyback()` already takes the vault's UTXOs and a coin row. Generalise it to `buybackInto(targetRow, sourceVaultUtxos, sourceVaultKey)`: lease **B's** pool and spend **A's** vault inputs. Change goes back to A's vault.
- Ledger: the burn row is a `side:'burn'` trade on **B**, with `trader = A's vault address`. The payout row sits on **A**'s slot (kind `buyback`, `detail.target = B`). Increment `burned` on **B**, not A. That needs `tokenblaster_launch_payout` to take a target slot. It is a new migration and should come with 017's idempotency rule.
- Display: B's coin page gets "burned by $A's fees" in its burn history. A's page shows "your fees burned N $B".

**Trade shapes: unaffected.** User trades on A still pay the route fee to A's vault address, and that output already exists. The buyback transaction on B is built by the server and never passes through bWalletX's Launchpad validator, because it is not a user trade plan. The one thing to confirm with bWalletX: if their validator also *watches* pool transactions, it must accept a pool spend whose extra inputs come from a different coin's vault.

**Risks**
- **Lease contention.** A popular B gets leased by many source vaults. Run them one after another and let them skip if the lease is busy (they already do).
- **Manipulation / wash routing.** Someone launches A with target B, wash-trades A to pump B through the burns. It costs them 1% per trade, so it is self-limiting, but it creates an "endorsement" between coins. Show it plainly on both pages.
- **Dead targets.** If B ever stops trading, A's vault just accrues. Add a fallback to `buyback` of A after N days, decided at launch.
- **Legal/optics.** One coin's fees supporting another's price. Fine for memecoins, but keep the wording factual ("buys and burns"), not "price support".

## B. Arcade → burn (house-received game-coin shots, burned in batches)

**Today.** In LIVE play, token shots and Frogger hops send 1 whole game-coin token per action to the house address `NEXT_PUBLIC_TB_HOUSE_ADDRESS` (`src/lib/actionPay.ts`, `useBlaster`). So the house wallet slowly piles up $ARENA, $DOUBLEO, $FROGGER and $BSVGUN as many small 1-token UTXOs. (Arena/BSVGun shots fired *at the burn address* already burn directly, at `gun.ts:457`.)

**The job: `worker/arcade-burn.ts`** (pm2, daily), calling `POST /api/arcade/burn` with a cron secret:
1. For each game coin in `GAME_COINS`, list the house address's BSV-21 UTXOs for that token id (GorillaPool `/bsv20/<house>/id/<id>`, status 1 only).
2. If total ≥ `ARCADE_BURN_MIN` (say 1,000 tokens) or the oldest is > 7 days old: build **one** transaction with up to ~500 token inputs and **one** `tokenOut(id, total, BURN_ADDRESS)`, plus BSV-21 indexer fund fee and network fee from a small house BSV UTXO. Batching keeps the fee per token tiny (BSV-21 merges inputs of one id into one output).
3. Book it in a new table `tokenblaster_arcade_burns(txid pk, token_id, tokens, inputs, created_at)` through a secret-gated RPC, with idempotency like 017. Public read RPC `tokenblaster_arcade_burns_for(token_id)`.
4. If `coins.burned` exists for that game coin, also add to it. Then the coin page's "burned so far" covers both sources. Keep a `source` column so we can show "vault 12M · arcade 340K".

**Display.** In the ticker: "🔥 1,204 $ARENA burned by Arena players" (links to a share card like the buyback one). On the game's lobby: "Play Arena → $ARENA gets scarcer: N burned this week". On the coin page, burn history entries tagged `arcade`.

**Owner decisions needed (money)**
- **Is the house giving up revenue?** The house currently *keeps* those tokens, which have market value on the curve. Burning them is a choice to turn house income into scarcity. The alternative is to sell some into the curve first. That needs a split ratio, and the owner has to pick it.
- **Which key signs.** The house address key has to sign the burn transaction. Today that key is presumably outside the app. Either (a) the owner runs the job locally with the house key, or (b) the owner moves arcade receipts to a derived key under `LAUNCH_POOL_WIF` (a change to `actionPay`'s destination, which is a protocol/UX change). **Never put the house key into Vercel env without the owner's sign-off.**
- **Fees.** The index-fund fee (1,000 sats per token output) and the network fee come from house BSV each run. That is cheap, but it is still the owner's sats.
- **Cadence / threshold**, and whether sats-only shots (1 sat to the house) should also fund buyback-and-burn of the game coin. That would be a cross-coin-style buyback from house sats: the same build as plan A with the house as the source vault.
