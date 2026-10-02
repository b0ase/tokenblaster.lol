# TokenBlaster.lol

Live BSV traffic, chain games, and token-blasting competitions. Part of the b0ase portfolio;
competitions are meant to be joined from bWallet's chat rooms and Market.

- `/`: the live "highway" (traffic density follows the mempool) and links
- `/blast`: the Blast arena: how a round works, the scoreboard (empty until the referee exists)
- `/api/chain`: live block height and mempool from WhatsOnChain
- `blaster/blast.ts`: the command-line blaster (`pnpm blast`), dry run unless `--broadcast`

```bash
pnpm install
pnpm dev            # http://localhost:3000
BLASTER_WIF=<throwaway key> pnpm blast --token <your token id> --count 100
```

## Prior art

- bsv.lol (GorillaPool): live BSV visualiser and retro games. No public source found (2 Oct 2026).
- [Bitcoin-com/TXBlaster](https://github.com/Bitcoin-com/TXBlaster) (Stress Test 2018): MIT, but the repo only has a LICENSE.
- TeraGun: no public source found.

## Next

1. Referee: count accepted transactions tagged `tokenblaster <round> <player>` per round (JungleBus / ARC callbacks).
2. Rounds and live scoreboard, linked from a bWallet chat room.
3. Real highway: decode live transactions by type (ordinals, locks, social…) instead of mempool density.
4. Arcade games on live traffic.

No entry fees or prize pools: free entry, bragging rights (gambling rules and App Store).
