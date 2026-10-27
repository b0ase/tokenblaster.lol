'use client';

/**
 * TERRORNODE TEAM MODE (/arcade/terrornode/team): up to 64 players in one match, on the Neo-Tokyo street or the
 * TERRORNODE MELEE plaza (the 64-player arena round the tower).
 *  - CO-OP SQUADS: everyone is NPG, the server runs the Erobot horde (sized to the crowd).
 *  - NPG vs EROBOTZ: up to 32 v 32 team PvP, friendly fire off, first to 50 frags or most frags at 10:00.
 *  - SOLO on an arena level (?level=melee&solo=1, from the solo level select): a one-player co-op match that starts
 *    itself once you are loaded.
 * The HUD's ROOM TX/SEC is the server's sum of every player's reported paid rounds (0 in free play / for bots).
 * The lobby makes a match code and an invite link (?match=CODE) that the bChatX TERRORNODE room can generate too
 * (POST /api/terrornode/team). Server: server/terrornode-team (authoritative, 20 Hz).
 *
 * Pay-to-play is the solo cabinet (src/components/coinop): coins 1c–$1 tally up, LOCK & LOAD is ONE wallet request
 * that funds the player's own browser gun, then every trigger pull is a real BSV transaction tagged
 * "tokenblaster.lol" <ammo> <n> "terrornode-team" <match id> <team>. `?dryrun=1` (dev) and NEXT_PUBLIC_GALLERY_PAID=0
 * (free play) skip the wallet: nothing is paid or broadcast.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brand } from '@/components/Brand';
import Link from 'next/link';
import { useBlaster } from '@/lib/useBlaster';
import { useCabinet } from '../coinop/useCabinet';
import { CabinetModals, CoinCabinet } from '../coinop/CoinCabinet';
import { usePlayerName } from '../coinop/usePlayerName';
import { satsToUsd, usdToSats } from '@/lib/coinop/credit';
import { SiteWalletChooser } from '@/components/SiteWalletChooser';
import { GO_LIVE_EVENT } from '@/components/GoLiveButton';
import { DEFAULT_AMMO } from '@/lib/gallery';
import { TeamClient, createTeamMatch, type TeamStatus } from '@/lib/teammode/client';
import TeamChat, { useTeamChat } from './TeamChat';
import { MAX_PER_SIDE, MAX_PLAYERS, RULES, SIDE_STATS, TEAM_NAME, teamShotPushes, type Counters, type Mode, type PublicState, type Snapshot, type Team } from '@/lib/teammode/match';
import type { TeamScene } from '@/lib/teammode/scene';
import dynamic from 'next/dynamic';
import { isLevelId, teamLevelOf, type LevelId } from '@/lib/teammode/levels';
import type { Progress } from '@/lib/terrornode/levels';
// the level select (and the full level table) is its own chunk
const LevelSelect = dynamic(() => import('./Levels').then((m) => m.LevelSelect), { ssr: false });

/** Sats per team-mode round: a ~300-byte tagged blast at 100 sat/kB plus margin (src/lib/gun.ts fireBatch). */
const PER_SHOT = 35;
const FLUSH_MS = 400;
const COLOUR: Record<Team, string> = { npg: '#2ec8e0', erobotz: '#ff2a46' };

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function TeamMode({ freePlay = false }: { freePlay?: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  const [dry, setDry] = useState(false);
  const [state, setState] = useState<PublicState | null>(null);
  const [status, setStatus] = useState<TeamStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [you, setYou] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rounds, setRounds] = useState<number | null>(null); // loaded rounds left (null: not loaded yet)
  const [hp, setHp] = useState(100);
  const [snapInfo, setSnapInfo] = useState<{ frags: Record<Team, number>; wave: number; endsAt: number | null; c: Counters | null } | null>(null);
  const [solo, setSolo] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const client = useRef<TeamClient | null>(null);
  const chat = useTeamChat();
  const [chatOk, setChatOk] = useState(false);
  // playable Erobotz (PvP only): the server lists 'erobotz' in its features; older servers keep the old look
  const [eroOk, setEroOk] = useState(false);
  const scene = useRef<TeamScene | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const roundsRef = useRef<number | null>(null);
  const queue = useRef(0);
  const sentN = useRef(0);
  const namesRef = useRef(new Map<string, string>());
  const [loadPct, setLoadPct] = useState(0);
  // the level the next match is made on (every level is open in team mode: the squad picks together)
  const [level, setLevel] = useState<LevelId>('assault');
  const [progress, setProgress] = useState<Progress>(() => ({ v: 1, reached: ['assault', 'market'], best: {} }));
  useEffect(() => {
    void import('@/lib/terrornode/levels').then((m) => setProgress(m.loadProgress()));
  }, []);

  const b = useBlaster();
  const cab = useCabinet(b, 'TERRORNODE Team', { dry });
  const { name: walletName, hasPaymail } = usePlayerName();
  const free = freePlay || dry;
  const myName = walletName || 'Player';

  // ?match=CODE (invite link) and ?dryrun=1
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const m = q.get('match');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the URL on mount
    if (m && /^[A-Za-z0-9]{5}$/.test(m)) setCode(m.toUpperCase());
    setDry(q.get('dryrun') === '1');
    const lv = q.get('level');
    if (isLevelId(lv)) setLevel(lv);
    setSolo(q.get('solo') === '1');
  }, []);

  // connect when there is a code
  useEffect(() => {
    if (!code) return;
    const c = new TeamClient(
      code,
      { name: myName, identityKey: b.wallet?.publicKey ?? null },
      {
        onState: (s) => {
          setState(s);
          namesRef.current = new Map(s.players.map((p) => [p.id, p.name]));
        },
        onSnap: (s: Snapshot) => {
          scene.current?.apply(s, namesRef.current);
          const me = s.p.find((p) => p[0] === c.you);
          if (me) setHp(me[4]);
          setSnapInfo({ frags: s.frags, wave: s.wave, endsAt: s.endsAt, c: s.c ?? null });
        },
        onWelcome: (id) => {
          setYou(id);
          if (scene.current) scene.current.me.id = id;
        },
        onError: (e) => setErr(e),
        onStatus: setStatus,
        onChat: chat.push,
        onChatError: (e) => {
          chat.setNote(e);
          setTimeout(() => chat.setNote(null), 3000);
        },
        onChatSupport: setChatOk,
        onErobotzSupport: setEroOk,
      },
    );
    client.current = c;
    chat.clear();
    return () => {
      c.close();
      client.current = null;
    };
    // name / key are sent on join; a later change does not reconnect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // GO LIVE (GameShell's button): tell the server which bChatX stream slot is this player's POV
  useEffect(() => {
    const on = (e: Event) => client.current?.live((e as CustomEvent<{ handle: string | null }>).detail.handle);
    window.addEventListener(GO_LIVE_EVENT, on);
    return () => window.removeEventListener(GO_LIVE_EVENT, on);
  }, []);

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, []);

  const meP = state?.players.find((p) => p.id === you) ?? null;
  const myTeam: Team = meP?.team ?? 'npg';
  const ero = eroOk && state?.mode === 'pvp';
  const iAmErobot = ero && myTeam === 'erobotz';
  const maxHp = ero ? SIDE_STATS[myTeam].hp : RULES.hp;
  const phase = state?.phase ?? null;
  const ready = free || (rounds ?? 0) > 0;

  /** One trigger pull: the server decides the hit now; the transaction joins the next batch to ARC. */
  const fire = useCallback((yaw: number) => {
    const c = client.current;
    if (!c || !c.you) return;
    if (!freePlay && !dry) {
      if ((roundsRef.current ?? 0) <= 0) return;
      roundsRef.current = (roundsRef.current ?? 0) - 1;
      setRounds(roundsRef.current);
      queue.current++;
    }
    c.shot(yaw);
  }, [freePlay, dry]);
  const eroRef = useRef(false);
  useEffect(() => {
    eroRef.current = ero;
    scene.current?.setErobotz(ero);
  }, [ero]);
  const fireRef = useRef(fire);
  useEffect(() => {
    fireRef.current = fire;
  }, [fire]);

  // the 3D scene runs from LOCK & LOAD (lobby) on; it is built once
  const wantScene = Boolean(code && you && ready);
  useEffect(() => {
    if (!wantScene || !canvas.current || scene.current) return;
    let live = true;
    void import('@/lib/teammode/scene').then(async ({ TeamScene }) => {
      if (!live || !canvas.current) return;
      const high = !window.matchMedia('(pointer: coarse)').matches && new URLSearchParams(location.search).get('q') !== 'low';
      const s = new TeamScene(canvas.current, { high, erobotz: eroRef.current });
      scene.current = s;
      s.me.id = client.current?.you ?? '';
      s.onMove = (x, z, yaw) => client.current?.move(x, z, yaw);
      s.onFire = (yaw) => fireRef.current(yaw);
      await s.init(setLoadPct);
      setLoadPct(1);
    });
    return () => {
      live = false;
    };
  }, [wantScene]);
  useEffect(() => () => scene.current?.dispose(), []);
  // the match's level: palette + dressing on the street
  useEffect(() => {
    if (state?.level && loadPct >= 1) void scene.current?.setLevel(state.level);
  }, [state?.level, loadPct]);

  // send queued rounds as real transactions, in batches, tagged with the match id and team
  const matchId = state?.id ?? null;
  useEffect(() => {
    if (free || !matchId) return;
    const i = setInterval(() => {
      const n = Math.min(queue.current, 50);
      if (n <= 0) return;
      queue.current -= n;
      const start = sentN.current;
      sentN.current += n;
      b.fireBatch(start, Array.from({ length: n }, () => teamShotPushes(matchId, myTeam)), undefined, DEFAULT_AMMO)
        .then((txids) => client.current?.confirmTx(txids.length))
        .catch((e) => console.warn('[tn-team] batch failed', e));
    }, FLUSH_MS);
    return () => clearInterval(i);
  }, [free, matchId, myTeam, b]);

  /** LOCK & LOAD: the coins are paid in ONE approval (cab.payThen), then the gun's balance becomes rounds. */
  const lockAndLoad = async () => {
    setErr(null);
    if (free) {
      roundsRef.current = 999_999;
      setRounds(roundsRef.current);
      return;
    }
    try {
      const avail = await b.refreshGun();
      const n = Math.floor(avail / PER_SHOT);
      if (n <= 0) throw new Error('Not enough ammo in your gun for a round. Put another coin in.');
      roundsRef.current = n;
      setRounds(n);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load.');
    }
  };
  const startCabinet = () => (free ? void lockAndLoad() : cab.payThen(() => void lockAndLoad()));

  const create = async (mode: Mode) => {
    setBusy(true);
    setErr(null);
    try {
      const m = await createTeamMatch(mode, null, level);
      history.replaceState(null, '', `?match=${m.code}${dry ? '&dryrun=1' : ''}`);
      setCode(m.code);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not make a match.');
    } finally {
      setBusy(false);
    }
  };
  const join = () => {
    const c = joinCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(c)) return setErr('Match codes are 5 letters / numbers.');
    history.replaceState(null, '', `?match=${c}${dry ? '&dryrun=1' : ''}`);
    setCode(c);
  };
  // SOLO on an arena level: make the one-player co-op match straight away, and start it once the gun is loaded
  const soloMade = useRef(false);
  useEffect(() => {
    if (!solo || code || soloMade.current) return;
    soloMade.current = true;
    void create('coop');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solo, code]);
  useEffect(() => {
    if (solo && phase === 'lobby' && meP?.host && ready && state?.players.length === 1) client.current?.start();
  }, [solo, phase, meP?.host, ready, state?.players.length]);

  const invite = useMemo(() => (code && typeof location !== 'undefined' ? `${location.origin}/arcade/terrornode/team?match=${code}` : ''), [code]);
  const watchUrl = code ? `/arcade/terrornode/watch?room=${code}` : '';
  const copy = () => {
    void navigator.clipboard?.writeText(invite).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const perShotUsd = satsToUsd(PER_SHOT, cab.bsvUsd);
  const buys = (usd: number) => {
    const s = usdToSats(usd, cab.bsvUsd);
    return s == null ? null : Math.floor(s / PER_SHOT);
  };

  const teams = state?.teams ?? [];
  const live = phase === 'live';
  const over = phase === 'over';
  const showCanvas = wantScene && (live || over || phase === 'lobby');

  return (
    <div ref={rootRef} className="relative min-h-[80vh] w-full overflow-hidden bg-[#05060f] text-white" data-team-mode>
      <canvas ref={canvas} className={`absolute inset-0 h-full w-full ${showCanvas ? '' : 'hidden'}`} />
      {showCanvas && loadPct < 1 && (
        <div className="absolute inset-x-0 top-1/2 z-10 mx-auto w-64 -translate-y-1/2 text-center text-xs uppercase tracking-widest text-white/70">
          Loading Neo-Tokyo… {Math.round(loadPct * 100)}%
          <div className="mt-2 h-1 rounded bg-white/10"><div className="h-1 rounded bg-[#2ec8e0]" style={{ width: `${loadPct * 100}%` }} /></div>
        </div>
      )}

      {/* ── MENU: pick a match type ── */}
      {!code && (
        <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center px-4 py-10">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-[#ff2a46]">Welcome to TERRORNODE · Team mode</p>
          <h1 className="mt-2 text-center text-3xl font-black tracking-tight sm:text-5xl">Squad up. Up to {MAX_PLAYERS} players.</h1>
          <p className="mt-3 max-w-xl text-center text-sm text-white/70">Neo-Tokyo, 2048. Make a match, send the invite link to your crew or the bChatX TERRORNODE room, and fight on the same street. Every bullet is a real BSV transaction from your own wallet.</p>
          <div className="mt-6 w-full">
            <LevelSelect progress={progress} active={level} onPick={setLevel} compact all />
          </div>
          <div className="mt-4 grid w-full gap-4 sm:grid-cols-2">
            <ModeCard title="Co-op squads" kicker={`PvE · up to ${MAX_PLAYERS}`} colour={COLOUR.npg} body={`Everyone fights for NPG against Dr Kweg Wong's Erobot horde on ${teamLevelOf(level).name}. ${teamLevelOf(level).waves} waves, each one bigger${teamLevelOf(level).bossHp ? ', and the Heart itself on the last' : ''}. Clear them all to take TERRORNODE HQ.`} onClick={() => void create('coop')} disabled={busy} cta="Make co-op match" />
            <ModeCard title="NPG vs EROBOTZ" kicker={`PvP · ${MAX_PER_SIDE} v ${MAX_PER_SIDE}`} colour={COLOUR.erobotz} body={`Two teams of up to ${MAX_PER_SIDE}. Pick a side in the lobby, friendly fire off. First team to 50 frags, or the most frags when the 10-minute clock runs out.`} onClick={() => void create('pvp')} disabled={busy} cta="Make PvP match" />
          </div>
          {teamLevelOf(level).arena === 'melee' && (
            <button type="button" disabled={busy} onClick={() => { soloMade.current = true; setSolo(true); void create('coop'); }} className="mt-3 text-xs font-bold uppercase tracking-[0.25em] text-[#2ec8e0] hover:text-white" data-melee-solo>
              Or play the plaza solo →
            </button>
          )}
          <div className="mt-6 flex w-full max-w-sm items-center gap-2">
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="MATCH CODE" maxLength={5} className="h-11 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 font-mono text-lg tracking-[0.3em] outline-none focus:border-[#2ec8e0]" />
            <button type="button" onClick={join} className="h-11 rounded-lg bg-white px-5 text-sm font-bold uppercase text-black">Join</button>
          </div>
          <Link href="/arcade/terrornode" className="mt-6 text-xs uppercase tracking-widest text-white/50 hover:text-white">← Solo</Link>
          {err && <p className="mt-4 text-sm text-[#ff6b7d]">{err}</p>}
        </div>
      )}

      {/* ── LOBBY ── */}
      {code && phase === 'lobby' && (
        <div className="relative z-10 mx-auto flex max-w-5xl flex-col items-center px-4 py-6">
          <div className="tbx-glass w-full rounded-2xl border border-white/10 bg-black/60 p-4 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/60">{state?.mode === 'pvp' ? `NPG vs EROBOTZ · ${MAX_PER_SIDE} v ${MAX_PER_SIDE}` : 'Co-op squads vs the horde'}{state?.level ? <> · <Brand>{teamLevelOf(state.level).name}</Brand></> : ''}{state?.tournamentId ? ` · ${state.tournamentId}` : ''}</p>
                <p className="font-mono text-3xl font-black tracking-[0.25em]" data-match-code>{code}</p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={copy} className="h-9 rounded-full border border-white/20 px-4 text-xs font-bold uppercase">{copied ? 'Copied' : 'Copy invite link'}</button>
                <a href={watchUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-full border border-white/20 px-4 text-xs font-bold uppercase" data-watch-link>Spectator view</a>
                {meP?.host && <button type="button" onClick={() => client.current?.start()} className="h-9 rounded-full bg-[#ff2a46] px-5 text-xs font-black uppercase">Start match</button>}
              </div>
            </div>
            <div className={`mt-4 grid gap-3 ${state?.mode === 'pvp' ? 'sm:grid-cols-2' : ''}`}>
              {teams.filter((t) => t.max > 0).map((t) => (
                <div key={t.id} className="rounded-xl border p-3" style={{ borderColor: `${COLOUR[t.id]}66`, background: `${COLOUR[t.id]}10` }}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-black uppercase tracking-widest" style={{ color: COLOUR[t.id] }}>{t.name} <span className="text-white/50">{t.size}/{t.max}</span></p>
                    {state?.mode === 'pvp' && meP && meP.team !== t.id && <button type="button" onClick={() => client.current?.side(t.id)} className="rounded-full border px-3 py-1 text-[11px] font-bold uppercase" style={{ borderColor: COLOUR[t.id] }}>Join {t.name}</button>}
                  </div>
                  {ero && <SideBlurb team={t.id} />}
                  <ul className="mt-2 grid grid-cols-2 gap-1 text-sm">
                    {state?.players.filter((p) => p.team === t.id).map((p) => (
                      <li key={p.id} className="truncate">{p.host ? '★ ' : ''}{p.name}{p.id === you ? ' (you)' : ''}{!p.connected ? ' · reconnecting' : ''}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-white/50">{status === 'live' ? 'Connected to the match server.' : status === 'retrying' ? 'Reconnecting…' : 'Connecting…'} The host starts the match. Load your gun while you wait.</p>
          </div>
          {!ready && (
            <div className="mx-auto mt-5 w-full max-w-md" data-team-cabinet>
              <CabinetModals modal={cab.modal} setModal={cab.setModal} reconnect={cab.reconnect} cancel={cab.cancel} retry={cab.retry} giveUp={cab.giveUp} approving={cab.stage === 'approve'} approveSince={cab.approveSince} walletName={cab.walletName} error={cab.err} />
              <CoinCabinet
                title="TERRORNODE Team"
                creditUsd={cab.creditUsd}
                creditReady={cab.creditReady}
                pendingUsd={cab.pending}
                bsvUsd={cab.bsvUsd}
                onCoin={cab.onCoin}
                onClear={cab.onClear}
                stage={cab.stage}
                stageText={cab.stageText}
                name={walletName}
                hasPaymail={hasPaymail}
                priceUsd={perShotUsd}
                priceNote={`Rounds at cost price. Each bullet is a real BSV transaction tagged with match ${state?.id ?? code} and your team.`}
                buys={buys}
                unit="shots"
                startLabel="Lock & load"
                onStart={startCabinet}
                error={cab.modal ? null : (err ?? cab.err)}
                walletLive={cab.walletLive}
                walletName={cab.walletName}
                freePlay={free}
              />
            </div>
          )}
          {ready && <p className="mt-4 rounded-full bg-black/60 px-4 py-2 text-xs font-bold uppercase tracking-widest text-[#2ec8e0]">Locked & loaded{rounds != null && !free ? ` · ${rounds.toLocaleString('en-US')} rounds` : ''} · waiting for the host</p>}
          {err && ready && <p className="mt-2 text-sm text-[#ff6b7d]">{err}</p>}
        </div>
      )}

      {/* ── joining / errors before the lobby state arrives ── */}
      {code && !state && (
        <div className="relative z-10 mx-auto max-w-md px-4 py-16 text-center">
          <p className="font-mono text-2xl tracking-[0.3em]">{code}</p>
          <p className="mt-2 text-sm text-white/60">{err ?? (status === 'retrying' ? 'The match server is not answering. Retrying…' : 'Joining…')}</p>
          <button type="button" onClick={() => { setCode(null); setErr(null); history.replaceState(null, '', location.pathname); }} className="mt-4 text-xs uppercase tracking-widest text-white/50">Back</button>
        </div>
      )}

      {/* ── live: need ammo first ── */}
      {code && live && !ready && (
        <div className="relative z-10 mx-auto mt-6 w-full max-w-md px-4">
          <p className="mb-2 text-center text-sm">{rounds === 0 ? 'Out of rounds. Put another coin in and LOCK & LOAD.' : 'The match has started. Put coins in and LOCK & LOAD to drop in.'}</p>
          <CoinCabinet title="TERRORNODE Team" creditUsd={cab.creditUsd} creditReady={cab.creditReady} pendingUsd={cab.pending} bsvUsd={cab.bsvUsd} onCoin={cab.onCoin} onClear={cab.onClear} stage={cab.stage} stageText={cab.stageText} name={walletName} hasPaymail={hasPaymail} priceUsd={perShotUsd} priceNote="Rounds at cost price." buys={buys} unit="shots" startLabel="Lock & load" onStart={startCabinet} error={err ?? cab.err} walletLive={cab.walletLive} walletName={cab.walletName} freePlay={free} />
        </div>
      )}

      {/* ── HUD ── */}
      {live && ready && (
        <div className="pointer-events-none absolute inset-0 z-10" data-team-hud>
          {/* the Erobot's HUD: a red visor vignette and scan lines over the cannon */}
          {iAmErobot && <div className="absolute inset-0" data-erobot-hud style={{ boxShadow: 'inset 0 0 140px rgba(255,42,70,0.38)', backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,42,70,0.05) 0 1px, transparent 1px 4px)' }} />}
          <div className="absolute inset-x-0 top-3 flex justify-center gap-3">
            <ScorePill label={state?.mode === 'pvp' ? 'NPG' : 'Squad'} value={snapInfo?.frags.npg ?? 0} colour={COLOUR.npg} />
            <div className="rounded-full bg-black/60 px-4 py-2 font-mono text-lg font-bold">{snapInfo?.endsAt ? fmtClock(snapInfo.endsAt - now) : '--:--'}</div>
            {state?.mode === 'pvp' ? <ScorePill label="EROBOTZ" value={snapInfo?.frags.erobotz ?? 0} colour={COLOUR.erobotz} /> : <ScorePill label={`Wave ${snapInfo?.wave ?? 1}/${state?.waves ?? RULES.waves}`} value={snapInfo?.c?.ec ?? state?.enemiesLive ?? 0} colour={COLOUR.erobotz} />}
          </div>
          {/* ROOM TX/SEC: the stream's headline, every player's paid rounds a second (server-summed) */}
          <div className="absolute right-4 top-3 rounded-xl border border-[#ffd21a55] bg-black/60 px-4 py-1.5 text-right" data-room-tps>
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-white/60">Room tx/sec</p>
            <p className="font-mono text-3xl font-black leading-none tabular-nums text-[#ffd21a]">{(snapInfo?.c?.tps ?? state?.txPerSec ?? 0).toLocaleString('en-US', { maximumFractionDigits: 1 })}</p>
            <p className="text-[10px] tabular-nums text-white/55">{snapInfo?.c?.pc ?? state?.players.length ?? 0} in the room</p>
          </div>
          {snapInfo?.c?.boss && (
            <div className="absolute inset-x-0 top-16 mx-auto w-[min(560px,80vw)]" data-boss-bar>
              <p className="text-center text-[11px] font-black uppercase tracking-[0.3em] text-[#ff2a46]">{teamLevelOf(state?.level).bossName ?? 'Boss'}</p>
              <div className="mt-1 h-2.5 rounded bg-white/10"><div className="h-2.5 rounded bg-gradient-to-r from-[#ff2a46] to-[#ffb21a]" style={{ width: `${(100 * snapInfo.c.boss[0]) / Math.max(1, snapInfo.c.boss[1])}%` }} /></div>
            </div>
          )}
          <div className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2" style={{ borderColor: COLOUR[myTeam] }} />
          <div className="absolute bottom-4 left-4 rounded-xl bg-black/60 px-4 py-2">
            <p className="text-[10px] uppercase tracking-widest text-white/60">{iAmErobot ? 'Armour' : 'Health'}</p>
            <div className="mt-1 h-2 w-40 rounded bg-white/10"><div className="h-2 rounded" style={{ width: `${Math.min(100, (100 * hp) / maxHp)}%`, background: hp > maxHp * 0.35 ? COLOUR[myTeam] : '#ff2a46' }} /></div>
          </div>
          <div className="absolute bottom-4 right-4 rounded-xl bg-black/60 px-4 py-2 text-right">
            <p className="text-[10px] uppercase tracking-widest text-white/60">{iAmErobot ? 'EROBOT · heavy cannon' : TEAM_NAME[myTeam]} · {meP?.kills ?? 0} kills</p>
            <p className="font-mono text-xl font-black">{free ? 'FREE PLAY' : `${(rounds ?? 0).toLocaleString('en-US')} rds`}</p>
          </div>
          {chatOk && (
            <TeamChat you={you} myTeam={myTeam} peers={state?.players ?? []} msgs={chat.msgs} note={chat.note} spectator={false} onSend={(ch, t, to) => client.current?.say(ch, t, to)} />
          )}
          {meP && !meP.alive && <p className="absolute inset-x-0 top-1/3 text-center text-3xl font-black uppercase tracking-widest text-[#ff2a46]">Flatlined · respawning</p>}
        </div>
      )}

      {/* ── END ── */}
      {over && state && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 px-4" data-team-over>
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#0a0b16] p-6 text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-white/50">Match {state.id} over</p>
            {chatOk && chat.msgs.length > 0 && (
              // Your own copy of the chat (only what you could see) lives in this tab; the server kept nothing.
              // TODO(bWalletX): hand chat.msgs to the bWalletX private (encrypted-to-your-key) mint hand-off once
              // tokenblaster has one. No payment, fee or minting code here, and never auto-save.
              <button type="button" disabled data-team-chat-save title="Coming soon: saves privately to your bWalletX" className="mt-2 rounded-full border border-white/15 px-3 py-1 text-[11px] uppercase tracking-widest text-white/40">
                Save this match chat to my wallet · soon
              </button>
            )}
            <h2 className="mt-2 text-4xl font-black uppercase" style={{ color: state.winner === 'erobotz' || state.winner === 'horde' ? COLOUR.erobotz : COLOUR.npg }}>
              {state.winner === 'squad' ? 'TERRORNODE taken' : state.winner === 'horde' ? 'The horde holds' : state.winner === 'draw' ? 'Draw' : `${TEAM_NAME[state.winner as Team]} win`}
            </h2>
            <div className="mt-4 flex justify-center gap-6 font-mono text-2xl">
              {state.teams.filter((t) => t.max > 0).map((t) => <span key={t.id} style={{ color: COLOUR[t.id] }}>{t.name} {t.frags}</span>)}
            </div>
            <ol className="mt-4 space-y-1 text-left text-sm">
              {[...state.players].sort((a, z) => z.score - a.score).map((p, i) => (
                <li key={p.id} className="flex justify-between rounded bg-white/5 px-3 py-1"><span><span style={{ color: COLOUR[p.team] }}>■</span> {i + 1}. {p.name}</span><span className="font-mono">{p.kills}K {p.deaths}D · {p.score} · {p.txShots} tx</span></li>
              ))}
            </ol>
            <div className="mt-5 flex justify-center gap-3">
              <button type="button" onClick={() => { scene.current?.dispose(); scene.current = null; setState(null); setYou(null); setCode(null); history.replaceState(null, '', location.pathname); }} className="h-10 rounded-full bg-white px-5 text-sm font-bold uppercase text-black">New match</button>
              <Link href="/arcade/terrornode" className="inline-flex h-10 items-center rounded-full border border-white/20 px-5 text-sm font-bold uppercase">Solo</Link>
            </div>
          </div>
        </div>
      )}
      <SiteWalletChooser />
    </div>
  );
}

/** PvP side card (playable-Erobotz servers): who you play and the side's numbers, straight from SIDE_STATS. */
function SideBlurb({ team }: { team: Team }) {
  const s = SIDE_STATS[team];
  const dps = Math.round((s.shotDamage * 1000) / s.shotGapMs);
  return (
    <p className="mt-1 text-[11px] text-white/60" data-side-stats={team}>
      {team === 'npg' ? 'Ninja Punk Girls: fast, full-auto blasters.' : 'Play as an Erobot: heavy armour, slower, a hard-hitting cannon.'} HP {s.hp} · speed {s.speed} m/s · {s.shotDamage} dmg · {dps} dmg/s
    </p>
  );
}

function ModeCard(p: { title: string; kicker: string; body: string; colour: string; cta: string; disabled?: boolean; onClick: () => void }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-b from-white/[0.06] to-transparent p-5" style={{ borderColor: `${p.colour}55`, boxShadow: `0 0 40px -12px ${p.colour}66` }}>
      <p className="text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color: p.colour }}><Brand>{p.kicker}</Brand></p>
      <h2 className="mt-1 text-2xl font-black uppercase"><Brand>{p.title}</Brand></h2>
      <p className="mt-2 text-sm text-white/70">{p.body}</p>
      <button type="button" disabled={p.disabled} onClick={p.onClick} className="mt-4 h-11 w-full rounded-xl text-sm font-black uppercase tracking-wider text-black disabled:opacity-50" style={{ background: p.colour }}>{p.cta}</button>
    </div>
  );
}

function ScorePill({ label, value, colour }: { label: string; value: number; colour: string }) {
  return (
    <div className="flex items-center gap-2 rounded-full border bg-black/60 px-4 py-2" style={{ borderColor: colour }}>
      <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: colour }}>{label}</span>
      <span className="font-mono text-lg font-black">{value}</span>
    </div>
  );
}
