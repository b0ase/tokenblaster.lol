# Satoshi City: the vision

> An open-world crime saga on a real blockchain. Every car is a live transaction, every job is a payment,
> and nobody can agree who Satoshi was, least of all the people claiming to be him.

**Tone:** *GTA* by way of *Hackers*, *Mr. Robot* and a 2013 darknet forum, in Designers Republic neon.
It's satire, played with a straight face. The city is full of conspiracy theories, and the game never settles them.
The player picks a side and gets lied to by every one of them.

**Satire rule (public repo):** all characters are fictional parodies. Real controversies (who Satoshi is, the block-size war,
darknet markets) are the city's *mythology*. Any question about who someone "really is" stays an in-world rumour or a branching
mystery, never a statement of fact about a real person.

---

## 1. The world

Satoshi City is an island chain-town built around one rule: **the ledger never forgets.** The city runs on a live BSV feed:

- **Traffic is the mempool.** Every vehicle is a real unconfirmed transaction (already true). Rush hour is the actual network load.
- **Weather is the chain.** A new block lands as a pulse of light across the skyline; a long gap between blocks brings fog.
- **The clock is block height.** Missions are timed in blocks, not seconds ("deliver before the next block").
- **Money is real but tiny.** Live mode = 1-sat actions (steal a car, land a hit, finish a job). Practice = same game, nothing sent.

### Districts (one per act; ordered by when they unlock)

| # | District | Feel | Core loop |
|---|---|---|---|
| 1 | **Genesis Square** | The neon plaza (exists today). Tourist trap, gold ₿ statue, buskers, pickpockets. | Tutorial, deliveries, the first job |
| 2 | **Silk Row** | A night market under tarps and onion-shaped lanterns. Vendors with five-star ratings and no faces. Escrow booths. "Trust me, bro" stalls. | Courier runs, escrow jobs, reputation |
| 3 | **Orphan Alley** | Rain-soaked back streets where stale blocks go to die. Rooftops, fire escapes, graffiti of discarded chain tips. | Chases, parkour, hiding from patrols |
| 4 | **The Mempool Interchange** | A six-level neon motorway knot. Traffic density = live mempool. | Races, convoy heists, fee-bidding lanes |
| 5 | **Miner's Docks** | Container port. Each block arrives as a cargo ship; cranes, ASIC heat-haze, fee barges. | Unload races, smuggling, sabotage |
| 6 | **Small Block Heights** | Gated hilltop enclave where the Keepers live. Everything is tiny: tiny cars, tiny doors, a 1 MB monument. Toll gates everywhere, Lightning-rail that keeps "temporarily" closing. | Infiltration, stealth, sabotage |
| 7 | **The Exchange** | Glass megatower. The board shows token prices; the 99th floor holds the *Genesis Vault*. | The final heist |

---

## 2. The cast (parodies)

- **You: "Anon."** A courier who wakes up in Genesis Square holding a USB stick nobody should have. Your face is your X avatar.
- **Dr. Greg Wrongly ("Faketoshi" to his enemies, "the Professor" to his fans).** Holds forty degrees, sues the weather, lives
  in the Exchange penthouse. Signs documents with great ceremony, never with *the* key. **The game's running question: genius, con
  man or spook?** Every act drops evidence for all three, and the player's choices decide which ending they get. He is never
  confirmed as any of them.
- **The Keepers of the Small Block (the "Core").** Hooded maintainers who guard the old rules from Small Block Heights. Their
  graffiti says "Don't trust, verify." Underground freedom fighters? Hackers who broke the original design? Or captured by
  a Silicon Valley VC fund and a Wall Street ETF desk, the "Suits"? Also never settled.
- **The Suits.** A venture fund and a bank trading desk who keep turning up wherever money gets made, offering to "custody" it.
- **Dread Pirate Robots.** Masked kingpin of Silk Row. Multiple people have worn the mask. Speaks only in PGP-signed riddles.
- **Mt. Grox.** A collapsed exchange run as a card-trading café. Its owner insists the coins are "just resting."
- **The Miners.** The city's police and its tax. Bribe-able by fee. Their patrol AI runs on Jev.
- **Hashcat.** A 19-year-old Orphan Alley fixer, your guide. Funny, paranoid, and probably double-crossing someone.
- **Uncle Nakamoto.** A noodle-cart owner in Genesis Square who may or may not be anybody. Says nothing useful, ever.
- **The Whale.** Never seen. Its transactions make the streets shake.

---

## 3. The story (seven acts)

Each act opens with an **animated cutscene** (in-engine: letterboxed camera moves, dialogue, music stings; later, full
pre-rendered films for the act openers). Each chapter is 2–4 missions plus free-roam side jobs.

**Prologue: "The Stick."** Night. A delivery van is T-boned in Genesis Square. Anon crawls out holding a USB stick labelled
`wallet.dat — DO NOT`. Three factions arrive at once. Tutorial: walk, run, steal your first car, escape.

**Act I: Genesis.** Learn the city. Deliver blocks, meet Hashcat, sell rumours. Ends when the stick turns out to hold *half* of a
signature. The Professor's lawyers arrive the same night.

**Act II: Silk Row.** Courier work for Dread Pirate Robots. Escrow jobs: carry goods without opening them, build a seller
rating, survive the scam stalls. Ends with a raid: the Miners storm the market and the mask changes hands.

**Act III: Orphan Alley.** On the run. Chases, rooftops, hiding in the rain. Hashcat reveals the stick's other half was split
off in a chain fork years ago. Mid-act choice: hand the stick to the Keepers or to the Professor.

**Act IV: Fork Wars.** The city splits along your choice. Both factions hire you, the Suits fund both sides, and the traffic
literally forks: half the vehicles go one way at the interchange. A turf war across the Mempool Interchange.

**Act V: The Docks.** Smuggle the missing half off a block-ship before the Miners finish confirming it. Big set-piece heist.

**Act VI: Small Block Heights.** Stealth infiltration of the Keepers' enclave. Tiny doors. Toll gates. The Lightning rail is
closed for maintenance, again.

**Act VII: The Exchange.** The final heist on the Genesis Vault, 99 floors up. Whoever you sided with turns on you. You open the
vault, and what's inside depends on the evidence you collected:

- **Ending A: "Signed."** The key works. Nobody believes it anyway.
- **Ending B: "Agent."** The vault is an empty office with a government badge on the desk.
- **Ending C: "The Suits Win."** The vault was moved to an ETF custodian years ago.
- **Ending D: "Uncle Nakamoto."** The noodle-cart man closes his cart, smiles and walks away. Credits.

---

## 4. Gameplay systems (build order)

### Part 1: Story spine *(scaffolded now)*
- Data model: districts, characters, acts → chapters → missions (`src/lib/city/story/`).
- Cutscene player: letterbox, typewriter dialogue, speaker plates, camera shots, skip (`src/components/city/CutscenePlayer.tsx`).
- Save: chapter progress in local storage (later: on chain, so progress follows your wallet identity).
- The prologue cutscene plays on your first visit.

### Part 2: Mission engine
- Objective types: `goto`, `deliver`, `checkpoints`, `escape` (lose the heat), `steal` (a specific vehicle or tx), `escort`,
  `survive` (until next block), `talk`.
- Triggers start cutscenes; mission briefings come from characters in the world, not from menus.
- The existing deliver and rush jobs become the first two objective types.

### Part 3: Heat and the Miners
- Heat 1–5 stars. Patrols, roadblocks, a helicopter at 5.
- Lose heat by hiding, changing cars, or **paying a fee bribe** (a real 1-sat-per-level payment in live mode).
- Patrol decisions run on Jev ("where would the suspect go?").

### Part 4: Districts
- Silk Row first (night market kit), then Orphan Alley (rooftops), then the interchange.
- Each new district = a new block region added to `layout.ts`, with its own props, lighting mood and music.

### Part 5: Reputation and factions
- Standing with the Professor, the Keepers, Dread Pirate Robots and the Suits. It changes prices, who helps you,
  who ambushes you, and which ending you reach.
- **Evidence** pickups (court filings, mailing-list posts, unsigned messages) feed the Professor mystery.

### Part 6: Multiplayer
- Other players in the city with X avatars overhead (top priority across the arcade).
- Co-op heists, races, and **turf**: claim blocks by finishing jobs in them; the map resets every N blocks.

### Part 7: Films
- Act openers as pre-rendered films: storyboards from these scripts, Blender for the scenes, the same characters as in-game
  models. (Unreal is parked until there's a Mac Studio.)

---

## 5. What makes it fun (the rules we design to)

1. **Something happens within ten seconds**, everywhere.
2. **Every mission ends in a chase or a crash.**
3. **Jokes in the world, not in menus.** Billboards, graffiti, NPC chatter, radio ads.
4. **Real chain, real stakes, tiny prices.** The thrill is that it's live; the cost is a fraction of a cent.
5. **Never settle the mystery.** Every faction is plausible, every faction lies.

### Radio stations (driving)
- **Block FM:** news read off the live chain ("block 912,004 just landed, 3,201 transactions, none of them yours").
- **Court TV Radio:** a never-ending trial where the Professor is suing someone new.
- **Signal 1MB:** the Keepers' pirate station, all whispered and very serious about full nodes.
- **Silk Radio:** market ads. "Five stars. Trusted vendor. Do not ask."
