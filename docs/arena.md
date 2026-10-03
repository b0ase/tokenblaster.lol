# Arena

DOOM-style arena at `/arena` (`src/components/Arena.tsx`, Three.js). Every trigger pull is a real
blast from the in-browser gun (`src/lib/gun.ts` via `src/lib/useBlaster.ts`), tagged:

    OP_FALSE OP_RETURN "tokenblaster.lol" <token id> <n> "arena" <hit|kill|miss>

The leaderboard counts arena shots like any other blast (it reads only the tag and the token).

## Stages

1. **Solo drones (shipped 3 Oct 2026).** Pixelated maze, token-faced drones, DOOM status bar,
   desktop (pointer lock, WASD, arrows) and touch controls. Shots queue for the chain; the gun
   overheats at 12 queued shots so play can't outrun the chain.
2. **Multiplayer.** Game server on Hetzner (websocket) holds positions and decides hits; up to 8
   players; players shown as sprites with their token's icon. Shot tag gains the target player id.
3. **Frags board.** The indexer counts arena kills per player and per token ("most lethal token").

## Later: live ammo (token transfers)

A hit sends the victim a slice of the shooter's token. Playing means agreeing to receive tokens,
always at a separate receive address, never the main wallet:

- Preferred: bWallet provisions a per-app TokenBlaster receive key (BRC-42/43 derived) and shows a
  Games section. Needs work in `bitcoin-corp/bwallet`; add to the wallet spec.
- Fallback: a TokenBlaster receive key in the browser with "send to my wallet".

The gun would need to hold BSV-21 tokens as well as sats (load tokens once, each hit transfers a
slice). Free to play still holds (no stake, no prize), but show a clear "you lose what you fire".
