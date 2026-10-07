# Contributing to TokenBlaster.lol

Thanks for helping. Code PRs are welcome anywhere. The easiest way in is a **content pack**: a track or a ship for
**bRacer**, made from JSON alone. You don't need to touch engine code. Other games will get packs next.

## Make a bRacer track

1. Copy the example: `content/bracer/tracks/mempool-loop/` to `content/bracer/tracks/<your-slug>/`.
   The folder name is the track's id: 3-32 lowercase letters, digits or dashes.
2. Edit `track.json`:
   - `name`, `author`, `description`, `licence` (see below), plus `credit` if you need one.
   - `layout`: either `"type": "points"`, a closed loop of 8-200 control points `{ x, y, z, bank? }` in metres
     (bank in degrees, ±60; points 30-900 m apart), or `"type": "ring"`, the harmonic layout the launch circuits
     use (see `canyon/track.json`).
   - `features`: positions are fractions of the lap (0 = start line, 1 = back at the start). `loops` sit on a
     control-point index (`at`), plus `corkscrews`, `tunnels`, `halfPipes`, `jumps`, `boostPads` (with a `lane`
     offset), `pickups` (weapon pads) and the `pit` lane.
   - `theme`: a `palette` of hex colours (the sky, fog and neon are built from it), up to 4 `signs` (short text
     for the trackside boards) and a `music` station.
   - `par`: optional par lap time in seconds.
3. Run `pnpm dev` and open `http://localhost:3000/arcade/bracer?track=<your-slug>`. Race it in PRACTICE.
4. Run `pnpm content:check` until it passes (it runs `pnpm content:index` for you on `pnpm dev`; commit the
   updated `src/content/bracer.generated.ts`).
5. Open a pull request.

## Make a bRacer ship

Copy `content/bracer/ships/wedge/` to `content/bracer/ships/<your-slug>/` and edit `ship.json`: `stats`
(`vmax`, `accel`, `turn`, `grip`), the procedural `hull` (`span`, `length`, `sweep`) and an optional `livery`
(`base`, `accent`, `trim` colours, a `ticker` of up to 8 capitals and a `number` 1-99). Test it with
`/arcade/bracer?ship=<your-slug>`.

Stats are balanced by a budget: each stat scores 0 at its minimum and 1 at its maximum, and the four together may
not exceed 3.3. A fast ship has to give up handling somewhere.

A `model.glb` (up to 1.5 MB) is accepted and checked, but the game doesn't draw custom models yet. Your ship
flies with the procedural hull until it does.

## Limits

| What | Limit |
| --- | --- |
| `track.json` / `ship.json` | 64 KB |
| `model.glb` | 1.5 MB, real binary glTF |
| `preview.png` / `preview.jpg` | 300 KB |
| `CREDITS.md`, `README.md` | 8 KB |
| Other files | not allowed |
| Lap length | 4-12 km |
| Loops / corkscrews / tunnels / half-pipes | 3 / 4 / 6 / 4 |
| Boost pads / pickups / jumps | 16 / 10 / 8 |
| Ship stats | vmax 160-182, accel 40-54, turn 62-90, grip 2.3-3.1, budget 3.3 |

Packs are data only: no URLs, links or external files anywhere. `src/lib/content/schema.ts` holds every rule.

## Licences

- **Code** you contribute is MIT (see `LICENSE`).
- **Packs** must use one of these `licence` values: `own-work-CC0`, `CC0`, `CC-BY-4.0` or `MIT`. For `CC-BY-4.0`,
  fill in `credit` and add a `CREDITS.md` naming the original author and source.
- Only add work that is yours or openly licensed. Don't reuse the reserved brand assets listed in `NOTICE.md` (NPG
  characters, music, Ordnance art, logos, game names) in your pack, and don't carry them off into other projects.

## What gets reviewed

- `pnpm content:check`, `pnpm lint` and `pnpm test` pass. The tests also drive an autopilot round every track.
- The track is fun and fair: no unwinnable sections, no walls of pads.
- Names and sign text are friendly and contain no ads, links or other people's trademarks.
- A maintainer adds the high-score rows. Each track gets two boards, `bracer-<slug>` and `bracer-<slug>-hc`.
  `pnpm content:score-rows` prints the SQL the maintainer applies to the database.
