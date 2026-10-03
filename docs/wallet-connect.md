# Wallet Connect: chooser, discovery and phone (QR) pairing

Status: **draft v0.2**, 3 Oct 2026 (v0.2: code homes, bwallet.space domains, rdns ids, event collision). Owner: b0ase. Applies to every b0ase site that talks to a
BRC-100 wallet (TokenBlaster, bMovies, bWalletX web, …) and to the wallets we ship (bWallet on
iPhone/Android, the bWalletX extension, bWalletX web).

Code homes once agreed: site side in `@b0ase/wallet`; phone app **and** bWalletX extension in
`bitcoin-corp/bwallet` (`main`; phone code under `src/mobile/`, extension built by `pnpm build`); relay
as a small service on Hetzner. `b0ase/yours-mobile` (`mobile`, tag `yours-mobile-v0.1`) is the frozen
Yours-branded handoff and gets none of this.

---

## 1. The problem

A site that "connects a BRC-100 wallet" today grabs `window.CWI` and hopes. In practice:

- **`window.CWI` holds one wallet.** The Yours extension and bWalletX (a Yours fork) both inject it.
  Whichever content script runs last wins, silently. The site can't tell which it got, and the
  user can't choose. Worse: both use `@1sat/wallet-browser`'s `createEventCWI`, which sends each call
  as a page event with the same event names, so **both extensions' content scripts may answer one
  request** (two approval windows). Untested; wallets must also use their own event names (§3.2).
- **BSV MetaNet Desktop isn't on `window` at all.** It answers HTTP on `localhost:3321`. Sites that
  probe it as a fallback (bMovies' `connectWallet()`) can end up on a different wallet than the
  user meant, and the probe hangs inside phone webviews.
- **A phone wallet isn't reachable from a desktop browser at all.**
- **Forks look the same as the original.** bWalletX reported Yours' version
  (`yours-wallet-5.1.0`, hard-coded in `src/background.ts`), so even `getVersion()` couldn't tell
  them apart.

The user may have all of these at once. **The site must never pick a wallet for the user.** It
shows what is available, including the phone, and remembers what the user picked.

## 2. The chooser (site UX)

One popup, opened by the site's single "Connect wallet" button:

```
┌ Connect a wallet ───────────────────────────┐
│  [icon] bWalletX            browser ext.   ›│
│  [icon] Yours Wallet        browser ext.   ›│
│  [icon] MetaNet Desktop     this computer  ›│
│ ─────────────────────────────────────────── │
│  ▣▣▣  Use bWallet on your phone             │
│  ▣▣▣  Scan with the bWallet app             │
│  ▣▣▣  (QR, refreshes every 2 min)           │
│ ─────────────────────────────────────────── │
│  No wallet? Get bWallet →                   │
└─────────────────────────────────────────────┘
```

Rules:

1. **Always show the phone QR** on desktop. It's an equal option, not a fallback. On a phone's own
   browser, show "Open in bWallet" (deep link) instead of the QR.
2. **List every wallet discovered (§3)**, each with its own name and icon. Never merge entries.
3. **Inside bWallet's in-app browser there is exactly one wallet.** Skip the chooser and use it
   (detected by the announced in-app wallet, `kind: 'in-app'`; a `bWallet/` user-agent marker is a
   hint only. Note: the frozen Yours branch adds `YoursWalletMobile/1`, current bWallet adds none yet).
4. **Remember the choice per site** (`localStorage`: wallet `rdns`, or the phone pairing). On the
   next visit, reconnect to that wallet without the chooser. If it's gone, show the chooser with a
   note: "bWalletX isn't available any more".
5. **Always offer "Switch wallet"** wherever the connected wallet is shown.
6. **Probe nothing until the chooser opens.** MetaNet's localhost probe runs only when the chooser
   opens, with a 1.5 s timeout, and never inside a phone webview.

## 3. Discovery: wallets announce themselves

Modelled on Ethereum's EIP-6963 (multi-injected-provider discovery), which solved the same
`window.ethereum` collision. It uses plain DOM events, so it works in any page and needs no shared
global.

### 3.1 Events

```ts
// Site → wallets: "who is here?" (also re-sent when the chooser opens)
window.dispatchEvent(new Event('brc100:requestWallet'));

// Wallet → site: one announcement per wallet, sent on load AND in reply to every request
window.dispatchEvent(new CustomEvent('brc100:announceWallet', {
  detail: Object.freeze({
    info: {
      uuid: '<random per page load>',          // dedupe key for this page view
      name: 'bWalletX',                        // human name, never another wallet's
      icon: 'data:image/svg+xml;base64,…',     // data URI, ≥ 96×96, square
      rdns: 'com.bwalletx.extension',                   // stable reverse-DNS id: remembered per site
      kind: 'extension',                       // 'extension' | 'in-app' | 'web'
    },
    wallet: walletInterface,                   // a BRC-100 WalletInterface
  }),
}));
```

### 3.2 Wallet obligations (bWallet, bWalletX, and asked of others)

- Announce as above with a **unique `rdns`**: a reversed domain we own. Ids: bWalletX extension
  `com.bwalletx.extension`, bWallet in-app browser `space.bwallet.mobile`, bWalletX web
  `com.bwalletx.web`.
- **`getVersion()` returns your own name**, e.g. `bwalletx-1.0.0`, not `yours-wallet-…`. (The
  extension is already named bWalletX and opens in Chrome's side panel.)
- **Use your own page-event names** for the `window.CWI` transport, so a request sent to one wallet
  is never answered by another that shares the same library.
- **Set `window.CWI` only if it's empty.** Never overwrite another wallet's injection. Keep
  setting it for old sites, but discovery is the real interface.
- Every request reaches the wallet with the **page's real origin** (the content script's
  `window.location.host`), as `src/content.ts` already does.

### 3.3 Finding wallets that don't announce

| Source | How | Label in chooser |
|---|---|---|
| Announced wallets | §3.1 | `info.name` |
| `window.CWI` set, but nothing announced it | `getVersion()` → e.g. `yours-wallet-5.0.2` → "Yours Wallet" | Name from version, else "Browser wallet" |
| MetaNet Desktop | `HTTPWalletJSON` to `http://localhost:3321`, `getVersion` with a 1.5 s timeout, chooser open only | "MetaNet Desktop" |
| Phone | §4 | "bWallet on your phone" |

If an announced wallet is also the one sitting on `window.CWI`, show it once, under its announced
name.

## 4. Phone pairing (QR)

### 4.1 Pieces

- **Site:** shows the QR. After pairing it gets a `WalletInterface` whose calls travel over the
  relay. To the site's code this looks exactly like any other wallet in the chooser.
- **Relay** (`wss://relay.bwallet.space`): forwards encrypted frames between the two ends
  of a channel. It can't read or alter them, stores nothing on disk, and can be swapped out.
- **Phone (bWallet):** scans, asks the user to confirm, then passes each request into the
  **existing** approval path, the same `chrome.runtime.sendMessage({ action, params, originator })`
  that the in-app browser's `src/content.ts` uses. The approval prompts, per-site permissions and
  spending rules are all reused unchanged.

### 4.2 Pairing flow

```
Site                         Relay                           Phone (bWallet)
 │ make site key S, channel C  │                                 │
 │── WS /v1/c/C?role=site ────▶│ records Origin header of the WS │
 │ show QR(C, S.pub, origin)   │                                 │
 │                             │◀──── WS /v1/c/C?role=wallet ────│ scan QR
 │                             │── {verifiedOrigin} ────────────▶│ check verifiedOrigin == QR origin
 │                             │                                 │ user: "Connect tokenblaster.lol?" ✓
 │◀──── hello {P.pub, info} ───│◀──── hello {P.pub, info} ───────│ make phone key P
 │ key = ECDH(S, P.pub)        │                                 │ key = ECDH(P, S.pub)
 │ show 4-digit code           │                                 │ show the same 4-digit code
 │◀═══ encrypted frames ══════▶│◀═══════ encrypted frames ══════▶│
```

### 4.3 QR content

A universal link, so the phone's own camera app opens bWallet (and it degrades to an install page):

```
https://bwallet.space/pair?v=1&r=relay.bwallet.space&c=<channel b64url>&k=<S pubkey hex>&o=<site origin>&e=<expiry unix>
```

The custom scheme `bwallet://pair?…` (same parameters) is the fallback. `c` is 16 random bytes.
`k` is a compressed secp256k1 public key. `e` = now + 120 s. The site makes a fresh QR when `e`
passes.

### 4.4 Proving which site it is (the part that matters most)

The wallet's approval screen and permissions trust the **origin**. A QR can say anything: an
attacker's page could show a QR with `o=tokenblaster.lol`. So the origin comes from something a web
page can't fake:

1. **The relay reads the `Origin` header** of the site's websocket. Browsers set that header and
   page scripts can't change it. The relay ties channel C to that origin and sends
   `{ verifiedOrigin }` to the phone when it joins.
2. **The phone refuses to pair** unless `verifiedOrigin` equals the QR's `o`, and it shows
   `verifiedOrigin` (not anything the page supplied) on the confirm screen.
3. **Every request carries `originator = verifiedOrigin`**, fixed for the life of the session. The
   site can't change it later.
4. **The 4-digit code** (the first 2 bytes of SHA-256(shared key), shown on both screens) catches a
   swapped QR, e.g. a scam page showing another site's QR in a frame.

This means trusting the relay to report Origin honestly. That's acceptable for v1 because we run
it. v2 option: the site also signs the QR fields with a key published at
`https://<origin>/.well-known/bwallet-pair.json`, so the relay no longer needs to be trusted.

### 4.5 Encryption and frames

- Shared key: ECDH (secp256k1, `@bsv/sdk` `PrivateKey.deriveSharedSecret`) → HKDF-SHA256
  (salt = C, info = `bwallet-pair-v1`) → 32-byte AES-256-GCM key (`SymmetricKey`).
- Frame on the wire: `{ s: <sender seq, increments by 1>, n: <nonce b64>, d: <ciphertext b64> }`.
  The receiver drops frames whose `s` isn't greater than the last one it accepted (stops replays).
- Plaintext messages:

```jsonc
// site → phone
{ "t": "req", "id": "<uuid>", "action": "createAction", "params": { /* BRC-100 args */ } }
// phone → site
{ "t": "res", "id": "<uuid>", "result": { /* … */ } }
{ "t": "res", "id": "<uuid>", "error": { "code": "USER_REJECTED", "message": "…" } }
// either side
{ "t": "ping" } | { "t": "close", "reason": "user unpaired" }
```

`action` uses the BRC-100 `WalletInterface` method names (`getPublicKey`, `createAction`,
`createSignature`, `listOutputs`, …), the same names the Yours content script forwards today.

### 4.6 Session life

- **Site:** keeps S, C and the phone's public key in `sessionStorage`, so a reload rejoins the same
  channel without a new QR. Closing the tab ends the session.
- **Phone:** shows a "Paired sites" list (origin, icon, last used) with **Disconnect**. Disconnect
  sends `close` and forgets the key.
- **Idle limit:** 24 h without a request → both ends drop the session.
- **App in the background:** the phone's socket drops when the app is backgrounded or the screen
  locks. The relay holds up to 20 frames for 60 s while one end is gone. The site shows "Waiting
  for your phone… open bWallet" while a request is outstanding. Push notifications to wake the app
  are out of scope for v1.

### 4.7 Relay

- `GET wss://<relay>/v1/c/<channel>?role=site|wallet`: at most one socket per role per channel.
- Ties the channel to the site socket's `Origin`. Rejects a `wallet` join if no `site` is
  connected, or if the QR has expired.
- Limits: frame ≤ 4 MB (large transaction bundles), 60 frames a minute per channel, 1,000 open
  channels per IP.
- Logs connection counts only, never frame contents. Nothing is stored on disk.
- Hosting: Node/Bun on Hetzner behind the existing proxy (websockets need a long-running server).

## 5. Build order

1. **Agree this spec** (both terminals).
2. **Discovery (§3)** in `bitcoin-corp/bwallet`: announce, own `getVersion`, own event names, don't
   overwrite `window.CWI`, for both the bWalletX extension and the in-app browser. Small change, and
   it ends the collisions on its own.
3. **`@b0ase/wallet`:** chooser UI + discovery + MetaNet probe, used first by TokenBlaster (replaces
   `src/lib/wallet.ts`).
4. **Relay** + the site side of pairing (§4) in `@b0ase/wallet`.
5. **Phone side** in `bitcoin-corp/bwallet`: camera scanning plugin (iOS/Android), confirm screen, bridge
   into the approval path, Paired sites screen. Store review needs the camera reason text added
   before the next build after iOS build 7.
6. bMovies and bWalletX web switch to `@b0ase/wallet`.

## 6. Open questions

- ~~Domains~~ **Decided:** `bwallet.space` (we don't own `bwallet.app`). The store app's own domain,
  so the App Store bWallet never links to the bwalletx.com exchange. Host `apple-app-site-association`
  and `assetlinks.json` there for the `/pair` universal link.
- Should bWalletX **web** also appear in the chooser? A web wallet can't inject into other sites,
  so it would pair like the phone (QR or popup window). Suggest v2.
- Ask upstream Yours and MetaNet Desktop to adopt the announce event? It costs them a few lines and
  makes every site's chooser accurate.
- `@b0ase/wallet` (`b0ase-wallet/`) isn't a git repo yet. Initialise it before step 3.
