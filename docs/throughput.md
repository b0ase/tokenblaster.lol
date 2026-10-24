# Browser storm throughput (ASSAULT LIVE sender)

Goal for the 31 Oct BSV stress test: the in-browser game sustains **2,000+ ARC-accepted tx/s**, with headroom
(target 3,000+).

## Send path

`ShootingGallery` → `useBlaster.storm` → `Gun.storm()` (src/lib/gun.ts) → `runStorm()` (src/lib/stormRun.ts) →
one worker per core (public/storm-worker.js, built from src/workers/storm.ts).

Each worker owns some lanes (unconfirmed chains off the split tx). Per round, every live lane chains up to
`STREAM_STEP` blasts. The round goes to ARC in parallel `/v1/txs` requests of at most 600 txs each, always
whole lanes. While those requests are in flight, the worker signs the next round.

## Bench (no spending, no keys)

`pnpm storm:bench` runs the real worker and the real fan-out (`runStorm`) in headless Chrome against a local
**mock ARC**: HTTP/2 over TLS, like arc.gorillapool.io. The mock answers every tx `SEEN_ON_NETWORK` after
`rtt + perTx × batch` ms. The key is generated fresh for each run and never funded. The split tx spends a
made-up outpoint, and every request goes to 127.0.0.1.

```
pnpm storm:bench                              # new sender, this machine (workers = cores - 1, max 12)
pnpm storm:bench --worker baseline            # the PR #38 sender, for comparison
pnpm storm:bench --cores 3 --rtt 1500 --per-tx 1
pnpm storm:bench --cores 3 --ecores           # Chrome on the Mac's efficiency cores at background QoS (extreme low end)
```

`--worker baseline` runs scripts/storm-bench/baseline-worker.ts: the PR #38 worker, changed only to take the
mock ARC's URL.

### Results: Apple M4 Mac mini, headless Chrome, 100 lanes, 20 s runs, tx/s accepted by the mock ARC

| mock ARC answer | workers | before (PR #38: SDK signing, step 20, serial) | after (this PR) |
|---|---|---|---|
| 250 ms + 0.2 ms/tx | 9 | 1,660 sustained (peak 2,220) | **13,459** (peak 20,000) |
| 250 ms + 0.2 ms/tx | 3 ("4-core laptop") | 962 | **19,600** |
| 800 ms + 0.2 ms/tx | 9 | 1,431 | **10,404** |
| 800 ms + 0.2 ms/tx | 3 | 1,000 | **10,000** |
| 1,500 ms + 1 ms/tx (slow ARC) | 9 | 889 | **4,167** |
| 1,500 ms + 1 ms/tx | 3 | 500 | **4,167** |
| 800 ms, 34 lanes (old lane count for 10k rounds) | 3 | n/a | 3,600 |
| 800 ms, E-cores at background QoS | 3 | ~0 (first accept after 22 s) | 577 (CPU-bound: 360 signs/s per worker) |

"Sustained" is the mean of the per-second counts, leaving out the first two seconds and the last one.
Signing measured inside the workers: **~2,500 to 8,000 blasts/s per worker** with @noble/curves. @bsv/sdk did
~800/s per core.

The 9-worker rows can come out below the 3-worker rows. That is not a bug: 9 workers on a 10-core machine
compete with Chrome's own threads and with the mock server. In both cases the cap is the round size divided by
the ARC answer time, not the worker count.

### Bottlenecks found (PR #38 sender)

1. **Serial rounds.** Each worker signed a round, posted it, waited for ARC, then started signing again.
   Signing time and ARC time added up.
2. **Small rounds.** 100 lanes × 20 = 2,000 tx per round is an absolute ceiling of 2,000 tx/s, and only with a
   0 ms ARC. Any real round trip pulls it lower (1,400 at 800 ms). Small packs were worse: lanes were
   ceil(rounds / 300), so a 10k pack had 34 lanes, a ceiling of 680 per round.
3. **Slow signing.** @bsv/sdk's pure-JS ECDSA plus its Transaction/Script objects run at ~800 tx/s per core.
   On a 4-core laptop (3 workers) that is under 2,400/s before any network time.
4. **The trigger capped it at 2,000.** The sender pauses whenever it is ahead of the visual fire, and the
   volume guns fired at 2,000/s. So the average could never beat 2,000.
5. **The HUD lied.** In LIVE mode, tx/s showed the simulated trigger rate, not what ARC accepted.

### Fixes

- **src/lib/fastBlast.ts:** raw-byte blast builder and signer (@noble/curves secp256k1, RFC 6979, low-S,
  SIGHASH_ALL|FORKID). It is the same transaction as blaster/signer.mjs. The tests check every blast with
  @bsv/sdk's script interpreter (Spend) and check the EF form and txid. The fee is ≥ 100 sat/kB on the real size
  and never more than the gallery's `shotSats` + 2.
- **Pipelined worker:** round N+1 is signed while round N is on the wire. Round N+1 is only sent after ARC has
  answered round N. Each round is split into parallel requests of ≤ 600 txs (whole lanes). The first round is
  short (10 per lane, then ×4 up to the step), so the first accept lands in ~0.5 to 1 s.
- **`STREAM_STEP` 20 → 100. Lanes ceil(rounds / 300) → ceil(rounds / 100), max 100.** Every pack of 10k or more
  gets 100 lanes, i.e. 10,000 tx per round. `ROUND_SECS` = 1.5 s is the planning figure for one ARC answer.
  Lane overhead (60 sat per lane + 1,000) follows `lanesFor` in both `overheadSats` and BSVGun's `costOf`.
- **Volume guns 2,000 → 3,000 tx/s** (`STREAM_RATES`), so the trigger leaves headroom above 2,000.
- **Honest HUD:** in LIVE mode, tx/s is ARC-accepted txs per second over a 2 s window (src/lib/txMeter.ts).
  Practice and dry-run modes still show the simulated rate, labelled rounds/s.

### Double-spend safety (unchanged rules)

- A lane only carries on from a blast ARC accepted. If any blast in a lane gets an answer matching
  REJECT, DOUBLE, INVALID or ERROR, or gets no answer, the lane stops for good.
- That lane's pre-signed next round is thrown away and never sent. A coin of unknown fate is never spent again.
- A lane's chain always goes in order, within one request, to one ARC.
- The session-end merge (`consolidate`) and coin selection (`spent` set, `candidates()`) are unchanged.

### Not done / next levers

- **TAAL in parallel:** the worker takes `arcs: string[]` and pins each lane to one ARC. But arc.taal.com needs
  an API key, and the browser cannot hold a secret. Keyless TAAL, or a proxy, is a separate decision.
- **`X-WaitFor: RECEIVED`:** GorillaPool's CORS allows this header. It would shorten each answer, as in the CLI
  harness. It is not enabled, so "accepted" keeps its current meaning.
- **WASM libsecp256k1:** signing only limits throughput on very slow devices.
- **Chain depth:** a 1M pack is 10,000 deep per lane. The ancestor limits of GorillaPool's nodes for
  unconfirmed chains are not measured. The CLI run used 1,000 chains.

## Paid browser test (NEEDS OWNER APPROVAL — not run)

Nothing in this PR has broadcast a transaction.

**What:** one ASSAULT LIVE session of **30,000 rounds**, anonymous ammo (`sats`, no handle), on the Vercel
preview of this branch.

**Cost** (src/lib/gallery.ts `quote(30_000, false, 0)`; the platform fee is 0 until 31 Oct inclusive):

- network: 30,000 × 26 sat + 100 lanes × 60 + 1,000 = **787,000 sat = 0.00787 BSV**
- at $25 to $50 per BSV: **about $0.20 to $0.40**. The unspent change returns to the gun and can be unloaded
  back to the wallet.

**Steps**

1. Open `https://<preview-url>/arcade/assault` in desktop Chrome with bWalletX connected. Open DevTools →
   Console and filter on `tb-`.
2. Insert coins for 30,000 rounds, PAY (one wallet approval), NAME is optional, then LOCK & LOAD. Watch the
   `[tb-load]` lines for the split.
3. Hold the trigger on a volume gun (minigun) until the rounds run out, about 10 to 15 s at 2,000 to 3,000 tx/s.
4. Record:
   - HUD tx/s (now ARC-accepted).
   - The `[tb-fire]` lines and any STALL.
   - The split txid and the last txid.
5. Check on chain: `https://whatsonchain.com/address/<gun address>`. Count the `gallery`-tagged txs, e.g.
   `pnpm blast` tooling or a JungleBus query on `tokenblaster.lol`.
6. Pass:
   - ≥ 2,000 accepted tx/s sustained over the session (accepted ÷ seconds of trigger held).
   - No lane stopped with DOUBLE_SPEND.
   - The session-end merge saves the change.
7. If it passes, repeat once with 100,000 rounds (2.6M sat ≈ 0.0261 BSV, about $0.65 to $1.30) to check that
   it holds over 30+ s.
