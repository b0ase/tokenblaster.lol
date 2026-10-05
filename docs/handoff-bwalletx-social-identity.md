# Handoff to the bWalletX agent: verified X (Twitter) handles for games and bApps

From: the tokenblaster.lol session, 2026-10-05. For: whoever works on the bWalletX wallet app.

## Goal

In Double-O Kweg multiplayer (tokenblaster.lol) every player sees their opponents' **X handle**
floating over their heads (`@handle ✓`, in X blue), so you know who you're shooting. The handle must
be *verified*: typed names stay as a fallback but anyone can type anything.

Identity should come from bWalletX: the user links X once in the wallet, and every game or bApp
that asks gets a provable handle. tokenblaster.lol's side is **already built and shipped**
(`src/lib/socialId.ts`); it switches on as soon as bWalletX issues certificates and we set
bWalletX's certifier key in `NEXT_PUBLIC_BWALLETX_CERTIFIER`.

## The contract (BRC-52 identity certificate, BRC-100 wallet calls)

### 1. Certificate bWalletX issues after the user links X

| | |
|---|---|
| **type** | `sbdKD0pJ9lVjvTfF3G+GdxcN0NKgA2nLwudNsJprock=` (= base64 of SHA-256 of the UTF-8 string `bwalletx:social:x`; must be 32 bytes) |
| **subject** | the user's wallet **identity key** |
| **certifier** | bWalletX's certifier identity key (one fixed key; publish its public key to us) |
| **fields** | `handle`: X username without `@`, matching `^[A-Za-z0-9_]{1,15}$`. `userId`: X numeric user id (stays the same when a handle is renamed). |
| **revocationOutpoint** | as your certifier normally does (all-zero outpoint is fine to start) |

Issue it only after a real X OAuth sign-in proves the account (OAuth 2.0 with PKCE, scope
`users.read`, then read `GET /2/users/me`). Re-issue when the handle changes; revoke when the user
unlinks. With @bsv/sdk on the certifier side: `MasterCertificate.issueCertificateForSubject(certifierWallet, subjectIdentityKey, { handle, userId }, TYPE)`,
then the wallet stores it (`acquireCertificate`, `acquisitionProtocol: 'direct'` or `'issuance'`).

### 2. Wallet calls a game makes (all three must work for a web origin like `https://www.tokenblaster.lol`)

```ts
// a) find it
wallet.listCertificates({ certifiers: [CERTIFIER], types: [TYPE], limit: 1 })
// b) reveal ONLY `handle` to the well-known "anyone" key (PrivateKey(1)), so every player can read it
wallet.proveCertificate({ certificate, fieldsToReveal: ['handle'], verifier: '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798' })
// c) bind it to this game session so a copied proof is useless
wallet.createSignature({ data: utf8(sessionId), protocolID: [1, 'tokenblaster social'], keyID: '1', counterparty: 'anyone' })
```

`userId` is never revealed; only `handle` is.

Permission UX: show **one** prompt the first time a site asks, e.g. "tokenblaster.lol wants to show
your X handle @b0ase to other players. [Allow once] [Always for this site] [No]", and cover a), b)
and c) for that origin with it. Don't prompt per game session. "No" should make `listCertificates`
return an empty list (the game falls back to the typed name), not throw a scary error.

### 3. What tokenblaster.lol does with it (already shipped)

Each player broadcasts `{ id: sessionId, proof }` to the room every 5 s. Every peer:
1. checks `type` and `certifier` match;
2. `VerifiableCertificate.verify()`: the certifier's signature;
3. `ProtoWallet(PrivateKey(1)).verifySignature({ ..., counterparty: proof.subject })` over the
   sender's session id: they hold the subject key, so it's not a replay;
4. decrypts `handle` with the revealed keyring, then shows `@handle ✓` over their agent.

A self-test with a throwaway certifier passes: own handle verifies, a peer verifies it, and the same
proof replayed under another session id is rejected.

## What we need from bWalletX (checklist)

- [ ] An X "Link account" flow in the wallet (Settings → Social), via OAuth 2.0 PKCE.
- [ ] A certifier (bWalletX server key, held server-side only) that issues the certificate above.
- [ ] The wallet stores the certificate and answers `listCertificates` / `proveCertificate` /
      `createSignature` for web origins (in-app browser **and** the extension/CWI connection).
- [ ] One-prompt permission per origin as described; "No" means an empty list.
- [ ] Re-issue on handle change; revoke on unlink.
- [ ] Send us the certifier's **public** identity key. We set `NEXT_PUBLIC_BWALLETX_CERTIFIER` on
      Vercel and it lights up. Nothing else changes on our side.

## Later (nice to have)

- The same pattern for other networks (`bwalletx:social:github`, `…:telegram`, `…:farcaster`): one
  type per network, same fields.
- An avatar: reveal a `pfpUrl` field too and the games can draw it on the name tag.
