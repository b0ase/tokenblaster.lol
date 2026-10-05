/**
 * Classify a raw transaction from the GorillaPool JungleBus stream by what its outputs carry.
 * Cheap hex matching on the output scripts; good enough to sort traffic into lanes.
 */
import { Transaction, Utils } from '@bsv/sdk';

export type TxKind = 'blast' | 'token' | 'inscription' | 'social' | 'data' | 'payment';

export const KINDS: { id: TxKind; label: string; color: string }[] = [
  { id: 'blast', label: 'TokenBlaster blast', color: '#ffffff' },
  { id: 'token', label: 'BSV-20/21 token', color: '#d4a843' },
  { id: 'inscription', label: 'Ordinal inscription', color: '#ff5a48' },
  { id: 'social', label: 'Social (B / MAP)', color: '#ff9a85' },
  { id: 'data', label: 'Other data', color: '#b0302a' },
  { id: 'payment', label: 'Payment', color: '#ffd0c0' },
];

/** Finer app/protocol detection than `kind` (which drives game lanes): for the dashboard. */
export type AppId = 'tokenblaster' | 'txblaster' | 'bsv21' | 'bsv20' | 'ordinal' | 'twetch' | 'treechat' | 'map' | 'b' | 'aip' | 'opreturn' | 'payment';

export const APPS: { id: AppId; label: string; color: string }[] = [
  { id: 'tokenblaster', label: 'TokenBlaster', color: '#ffffff' },
  { id: 'txblaster', label: 'TXBLASTER 🔥', color: '#ff7a00' },
  { id: 'bsv21', label: 'BSV-21', color: '#d4a843' },
  { id: 'bsv20', label: 'BSV-20', color: '#b08a30' },
  { id: 'ordinal', label: '1Sat ordinal', color: '#ff5a48' },
  { id: 'twetch', label: 'Twetch', color: '#ff9a85' },
  { id: 'treechat', label: 'TreeChat', color: '#e86ab0' },
  { id: 'map', label: 'MAP', color: '#c07060' },
  { id: 'b', label: 'B://', color: '#e0958a' },
  { id: 'aip', label: 'AIP', color: '#a05a8a' },
  { id: 'opreturn', label: 'OP_RETURN', color: '#b0302a' },
  { id: 'payment', label: 'Payment', color: '#ffd0c0' },
];
export const APP_COLOR = Object.fromEntries(APPS.map((a) => [a.id, a.color])) as Record<AppId, string>;

export type FeedTx = {
  id: string;
  kind: TxKind;
  bytes: number;
  sats: number;
  mined: boolean;
  token?: string;
  op?: string;
  amt?: string;
  /** Dashboard extras (optional so hand-made FeedTx literals keep compiling). */
  app?: AppId;
  /** Label shown in breakdowns, e.g. "MAP · hodlocker". */
  appName?: string;
  ins?: number;
  outs?: number;
  /** Human preview: social text, mime + size, OP_RETURN text. */
  preview?: string;
  /** Blasts: which game sent it (the push after the count), e.g. 'bsvgun'. */
  game?: string;
  /** First OP_RETURN script hex (truncated). */
  opReturn?: string;
  at?: number;
};

/** Every classified tx is re-broadcast on window as this event, so the gun can see its blasts land. */
export const FEED_EVENT = 'tokenblaster:tx';

/** Script push of a short hex payload (< 76 bytes). */
const push = (h: string) => (h.length / 2).toString(16).padStart(2, '0') + h;
const hex = (s: string) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('');
const ORD = '0063036f7264'; // OP_FALSE OP_IF "ord"
const BSV20 = hex('bsv-20');
const BLAST = '006a' + push(hex('tokenblaster.lol'));
const B = hex('19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut');
const MAP = hex('1PuQa7K62MiKCtssSLKy1kh56WWU7MtUR5');

export function classify(id: string, raw: string, mined: boolean): FeedTx | null {
  try {
    const tx = Transaction.fromHex(raw);
    const scripts = tx.outputs.map((o) => o.lockingScript.toHex());
    const all = scripts.join('');
    const blast = scripts.find((s) => s.startsWith(BLAST));
    const kind: TxKind = blast
      ? 'blast'
      : all.includes(BSV20)
      ? 'token'
      : all.includes(ORD)
        ? 'inscription'
        : all.includes(B) || all.includes(MAP)
          ? 'social'
          : scripts.some((s) => s.startsWith('6a') || s.startsWith('006a'))
            ? 'data'
            : 'payment';
    const sats = tx.outputs.reduce((n, o) => n + (o.satoshis ?? 0), 0);
    const f: FeedTx = { id, kind, bytes: raw.length / 2, sats, mined, ins: tx.inputs.length, outs: tx.outputs.length, at: Date.now() };
    detectApp(f, tx, scripts, !!blast);
    // BSV-20/21: which token, what operation, how much (from the first inscription's JSON).
    const ins = all.includes(BSV20) ? tokenJson(scripts.find((s) => s.includes(BSV20)) ?? '') : null;
    if (ins) {
      f.token = ins.id ?? ins.tick;
      f.op = ins.op;
      f.amt = ins.amt;
      if (ins.op === 'deploy+mint' && !ins.id) f.token = `${id}_0`;
    }
    if (blast) {
      // OP_FALSE OP_RETURN <tag> <token id> <n>: read the token id push.
      // Pushes after the tag: <token> <n> <game> … (game = 'bsvgun', 'arena', 'invaders', …).
      const pushes: string[] = [];
      let rest = blast.slice(BLAST.length);
      while (rest.length >= 2 && pushes.length < 3) {
        let len = parseInt(rest.slice(0, 2), 16);
        let skip = 2;
        if (len === 0x4c) {
          len = parseInt(rest.slice(2, 4), 16);
          skip = 4;
        } else if (len > 0x4c) break;
        pushes.push(Utils.toUTF8(Utils.toArray(rest.slice(skip, skip + len * 2), 'hex')));
        rest = rest.slice(skip + len * 2);
      }
      if (pushes[0]) f.token = pushes[0];
      if (pushes[2] && /^[a-z0-9_-]{1,24}$/i.test(pushes[2])) f.game = pushes[2].toLowerCase();
    }
    return f;
  } catch {
    return null;
  }
}

/** The `{"p":"bsv-20",…}` JSON inside an inscription script (hex). */
function tokenJson(hex: string): { op?: string; id?: string; tick?: string; amt?: string } | null {
  let text = '';
  for (let i = 0; i + 1 < hex.length; i += 2) text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  const m = text.match(/\{"p":"bsv-20"[^}]*\}/);
  try {
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

const AIP = hex('15PciHG22SNLQJXMoSUaWVi7WSqc7hCfva');
const TXBLAST = ['006a04f09f94a5', '6a04f09f94a5'];
const utf8 = (d?: number[]) => {
  if (!d) return '';
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(d));
  } catch {
    return '';
  }
};
const printable = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f\ufffd]+/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const kb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

/** Fill f.app / appName / preview / opReturn from the outputs. Never throws. */
function detectApp(f: FeedTx, tx: Transaction, scripts: string[], blast: boolean) {
  try {
    const opr = scripts.find((s) => s.startsWith('006a') || s.startsWith('6a'));
    if (opr) f.opReturn = opr.slice(0, 600);
    if (blast) {
      f.app = 'tokenblaster';
      f.preview = `blast ${f.token ? f.token.slice(0, 12) : ''}`;
      return;
    }
    if (scripts.some((s) => TXBLAST.includes(s))) {
      f.app = 'txblaster';
      f.preview = '🔥';
      return;
    }
    if (f.kind === 'token') {
      f.app = f.token && /_\d+$/.test(f.token) ? 'bsv21' : 'bsv20';
      f.preview = `${f.op ?? 'transfer'} ${f.amt ?? ''}`.trim();
      return;
    }
    // Inscription envelope: OP_FALSE OP_IF "ord" OP_1 <content-type> OP_0 <data> OP_ENDIF
    const oi = scripts.findIndex((s) => s.includes(ORD));
    if (oi >= 0) {
      const ch = tx.outputs[oi].lockingScript.chunks;
      let ct = '';
      let size = 0;
      let body: number[] | undefined;
      for (let i = 0; i + 2 < ch.length; i++) {
        if (ch[i].op === 0 && ch[i + 1].op === 0x63 && utf8(ch[i + 2].data) === 'ord') {
          for (let j = i + 3; j + 1 < ch.length && ch[j].op !== 0x68; j += 2) {
            if (ch[j].op === 0x51) ct = utf8(ch[j + 1].data);
            else if (ch[j].op === 0) body = ch[j + 1].data;
          }
          break;
        }
      }
      size = body?.length ?? 0;
      f.app = 'ordinal';
      f.appName = ct ? `ordinal · ${ct.split(';')[0]}` : 'ordinal';
      const text = ct.startsWith('text/') || ct.includes('json') ? clip(printable(utf8(body?.slice(0, 200)))) : '';
      f.preview = `${ct.split(';')[0] || 'inscription'} · ${kb(size)}${text ? ` · ${text}` : ''}`;
      return;
    }
    if (opr) {
      const oi2 = scripts.indexOf(opr);
      const ch = tx.outputs[oi2].lockingScript.chunks;
      const start = ch.findIndex((c) => c.op === 0x6a) + 1;
      // Split bitcom pushes on "|".
      const parts: string[][] = [[]];
      for (const c of ch.slice(start)) {
        const s = utf8(c.data);
        if (s === '|') parts.push([]);
        else parts[parts.length - 1].push(s);
      }
      const map = parts.find((p) => p[0] === '1PuQa7K62MiKCtssSLKy1kh56WWU7MtUR5');
      const b = parts.find((p) => p[0] === '19HxigV4QyBv3tHpQVcUEQyq1pzZVdoAut');
      let mapApp = '';
      let mapType = '';
      if (map) {
        for (let i = 2; i + 1 < map.length; i += 2) {
          if (map[i] === 'app') mapApp = map[i + 1];
          if (map[i] === 'type') mapType = map[i + 1];
        }
      }
      const bText = b && (b[2] ?? '').startsWith('text') ? clip(printable(b[1] ?? '')) : b ? `${b[2] || 'file'} · ${kb((b[1] ?? '').length)}` : '';
      const app = mapApp.toLowerCase();
      if (app.includes('twetch')) f.app = 'twetch';
      else if (app.includes('treechat')) f.app = 'treechat';
      else if (map) f.app = 'map';
      else if (b) f.app = 'b';
      else if (opr.includes(AIP)) f.app = 'aip';
      if (f.app) {
        f.appName = f.app === 'map' && mapApp ? `MAP · ${clip(mapApp, 20)}` : undefined;
        f.preview = [bText, mapType && !bText ? `${mapType}` : ''].filter(Boolean).join(' ') || (mapApp ? `${mapApp} ${mapType}` : '');
        return;
      }
      f.app = 'opreturn';
      const first = printable(utf8(ch[start]?.data));
      const txt = printable(ch.slice(start).map((c) => utf8(c.data)).join(' '));
      if (first && /^[\x20-\x7e]{3,40}$/.test(first)) f.appName = `OP_RETURN · ${clip(first, 24)}`;
      f.preview = clip(txt) || `${kb(opr.length / 2)} data`;
      return;
    }
    if (all(scripts, B) || all(scripts, MAP)) {
      f.app = 'b';
      return;
    }
    f.app = 'payment';
  } catch {
    f.app ??= 'payment';
  }
}
const all = (scripts: string[], needle: string) => scripts.some((s) => s.includes(needle));
