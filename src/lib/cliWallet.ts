/**
 * bwalletx-cli (`bwalletx serve`, localhost:3321) pairing. Since bwalletx-cli #20 every BRC-100 call needs
 * `Authorization: Bearer <token>`; getVersion and isAuthenticated stay open (isAuthenticated is false unpaired).
 *   POST /pair streams {"code":"12345678" first, then ,"approved":true,"token":"…"} once the owner approves in the terminal.
 * The token lives in this origin's localStorage. On a 401 it is dropped and we pair again. NEVER log the token.
 */
export const CLI_URL = 'http://localhost:3321';
const TOKEN_KEY = 'tb.cliWalletToken';

export function cliToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage blocked: pair again next load */
  }
}

/** Pairing state for the UI ("Approve in your terminal"). */
export type CliPairState = { k: 'idle' } | { k: 'code'; code: string } | { k: 'error'; message: string };
let state: CliPairState = { k: 'idle' };
const subs = new Set<(s: CliPairState) => void>();
const emit = (s: CliPairState) => {
  state = s;
  for (const f of subs) f(s);
};
export const cliPairState = () => state;
export function onCliPair(f: (s: CliPairState) => void): () => void {
  subs.add(f);
  return () => void subs.delete(f);
}

/** Read the /pair stream's text as it grows: the code first, then approval + token. Pure, tested. */
export function parsePairStream(text: string): { code?: string; approved: boolean; token?: string } {
  const code = /"code"\s*:\s*"(\d{8})"/.exec(text)?.[1];
  const approved = /"approved"\s*:\s*true/.test(text);
  const token = approved ? /"token"\s*:\s*"([^"]+)"/.exec(text)?.[1] : undefined;
  return { code, approved, token };
}

let pairing: Promise<string> | null = null;
/** Pair once (single flight): show the code, wait for the terminal approval, keep the token. */
export function pairCli(f: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<string> {
  if (pairing) return pairing;
  pairing = (async () => {
    try {
      const r = await f(`${CLI_URL}/pair`, { method: 'POST' });
      if (!r.ok || !r.body) throw new Error(`Pairing refused (${r.status}).`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let text = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (value) text += dec.decode(value, { stream: true });
        const p = parsePairStream(text);
        if (p.code && state.k !== 'code') emit({ k: 'code', code: p.code });
        if (p.token) {
          await reader.cancel().catch(() => undefined);
          setToken(p.token);
          emit({ k: 'idle' });
          return p.token;
        }
        if (done) throw new Error('Pairing was not approved.');
      }
    } catch (e) {
      emit({ k: 'error', message: e instanceof Error ? e.message : String(e) });
      throw e;
    } finally {
      pairing = null;
    }
  })();
  return pairing;
}

/**
 * fetch for HTTPWalletJSON: adds the Bearer token; on a 401 drops it, pairs again and retries once.
 * getVersion / isAuthenticated go through unchanged when there is no token (they are open).
 */
export function cliFetch(f: typeof fetch = globalThis.fetch.bind(globalThis)): typeof fetch {
  const withAuth = (init: RequestInit | undefined, token: string | null): RequestInit => {
    const h = new Headers(init?.headers);
    if (token) h.set('Authorization', `Bearer ${token}`);
    return { ...init, headers: h };
  };
  return async (input, init) => {
    const res = await f(input, withAuth(init, cliToken()));
    if (res.status !== 401) return res;
    setToken(null);
    const token = await pairCli(f);
    return f(input, withAuth(init, token));
  };
}
