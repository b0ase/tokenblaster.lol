# Player identity: X handles over players' heads

Code: `src/lib/identity.ts`, `src/lib/avatarTag.ts`, `src/components/PlayerBadge.tsx`, `src/app/api/avatar/[handle]/route.ts`.
Used by Arena, bRacer and Token Rally (via `src/lib/racemp`). Identity is cosmetic: payments still go to each
player's gun/wallet address and never depend on a handle.

## Phase 1: typed handle (unverified, live)

The player types their X handle once (`localStorage['tb.xhandle']`, checked against `^[A-Za-z0-9_]{1,15}$`).
Other players see the avatar from `/api/avatar/<handle>`: a same-origin proxy of `https://unavatar.io/x/<handle>`
(no key; 256 KB cap; image types only; 1-day edge cache) that falls back to a generated identicon, so WebGL
textures never hit CORS. No tick: anyone can type any handle.

## Phase 2: verified tick (live, needs nothing new)

bWalletX's sign-in service only registers the paymail `<handle>.x@bwallet.space` (lowercase, `_` → `-`) after a
real X OAuth sign-in (`bwalletX-launchpad/site/lib/social.js`). Its public PKI
(`https://pay.bwallet.space/api/paymail/id/<alias>@bwallet.space`, CORS `*`) returns that paymail's identity key.

1. The player's connected BRC-100 wallet: `getPublicKey({ identityKey: true })` must equal the PKI key.
2. It signs `"<handle lowercased> <session id>"` with `createSignature({ protocolID: [1, 'tokenblaster x handle'], keyID: '1', counterparty: 'anyone' })`.
3. The handle travels as `{ x, xk, xs }` in presence (racemp profile) or the Arena pose.
4. Each peer re-fetches the PKI key for `x`, checks it equals `xk`, and verifies `xs` with
   `ProtoWallet(PrivateKey(1)).verifySignature({ counterparty: xk })`. The session id is the player's random room id,
   so a copied proof doesn't work for someone else.

Override the PKI with `NEXT_PUBLIC_BWALLETX_PKI` (`{alias}` placeholder).

### Limits

- We trust bWalletX's paymail server to have run X OAuth before registering `<name>.x`, and to drop the alias
  when the user unlinks. A renamed X account keeps the old alias until bWalletX updates it.
- Only wallets whose identity key is the one bWalletX registered get the tick (bWalletX itself). Other BRC-100
  wallets stay unverified.
- `src/lib/socialId.ts` (Double-O) holds the stronger BRC-52 certificate route
  (`docs/handoff-bwalletx-social-identity.md`): it needs bWalletX to issue `bwalletx:social:x` certificates and
  `NEXT_PUBLIC_BWALLETX_CERTIFIER` to be set. When that ships, `proveHandle` can try the certificate first.

### What would make it stronger (asks for bWalletX / $401)

- bWalletX: a signed attestation in the PKI/profile response (`{ alias, xUserId, identityKey, issuedAt }` signed by a
  published bWalletX key), so peers don't have to trust TLS to `pay.bwallet.space` alone; or issue the BRC-52
  certificate above.
- $401 (path401.com): `/api/identity/resolve?handle=` is public and CORS-open, but strands are bound to a $401
  address, not to a BRC-100 identity key, and there is no wallet call to sign with that address. A $401 strand that
  records the holder's BRC-100 identity key (or a wallet call to sign with the root key) would let us accept $401 X
  strands the same way.
