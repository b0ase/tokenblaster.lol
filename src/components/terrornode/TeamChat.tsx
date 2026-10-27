'use client';
/**
 * In-match TEXT chat panel for TERRORNODE team mode: Team / All / 1-to-1 tabs, unread dots, Enter to send,
 * local mute. Plain text only (React escapes it). Collapsible and pinned bottom-left above the health bar,
 * so it never covers the crosshair (phone landscape included). Rendered only when the server advertises chat.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CHAT_MAX, type ChatChannel, type ChatMsg } from '@/lib/teammode/chat';

type Peer = { id: string; name: string; team: string };
const KEEP = 100;

export function useTeamChat() {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const push = (m: ChatMsg) => setMsgs((l) => [...l.slice(-(KEEP - 1)), m]);
  return { msgs, push, note, setNote, clear: () => setMsgs([]) };
}

export default function TeamChat({
  you,
  myTeam,
  peers,
  msgs,
  note,
  spectator,
  onSend,
}: {
  you: string | null;
  myTeam: string;
  peers: Peer[];
  msgs: ChatMsg[];
  note: string | null;
  spectator: boolean;
  onSend: (ch: ChatChannel, text: string, to?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ChatChannel>(spectator ? 'all' : 'team');
  const [dmTo, setDmTo] = useState<string>('');
  const [text, setText] = useState('');
  const [muted, setMuted] = useState<Set<string>>(() => new Set());
  const [seen, setSeen] = useState<Record<ChatChannel, number>>({ team: 0, all: 0, dm: 0 });
  const input = useRef<HTMLInputElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);

  const visible = useMemo(() => msgs.filter((m) => !muted.has(m.from)), [msgs, muted]);
  const inTab = (ch: ChatChannel) => visible.filter((m) => m.ch === ch && (ch !== 'dm' || !dmTo || m.from === dmTo || m.to === dmTo));
  const count = (ch: ChatChannel) => visible.filter((m) => m.ch === ch && m.from !== you).length;
  const shown = inTab(tab);
  const unread = (ch: ChatChannel) => count(ch) > seen[ch] && (!open || tab !== ch);

  useEffect(() => {
    list.current?.scrollTo({ top: 1e9 });
  }, [open, tab, visible.length]);
  /** Leaving a tab (switching or closing) marks what it showed as read. */
  const leave = () => setSeen((s) => ({ ...s, [tab]: count(tab) }));

  // Enter (outside a text box) opens chat and focuses it; leaves pointer lock so you can type.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || spectator) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      document.exitPointerLock?.();
      setOpen(true);
      setTimeout(() => input.current?.focus(), 0);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [spectator]);

  const others = peers.filter((p) => p.id !== you);
  const nameOf = (id?: string) => peers.find((p) => p.id === id)?.name ?? 'player';
  const send = () => {
    const t = text.trim();
    if (!t) return;
    if (tab === 'dm' && !dmTo) return;
    onSend(tab, t, tab === 'dm' ? dmTo : undefined);
    setText('');
  };
  const tabs: ChatChannel[] = spectator ? ['all'] : ['team', 'all', 'dm'];
  const label: Record<ChatChannel, string> = { team: 'Team', all: 'All', dm: '1-to-1' };
  const anyUnread = tabs.some(unread);

  if (!open)
    return (
      <button
        type="button"
        data-team-chat-toggle
        onClick={() => setOpen(true)}
        className="pointer-events-auto absolute bottom-20 left-4 rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-white/80"
      >
        Chat{anyUnread && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-[#ffd21a]" />}
        <span className="ml-2 hidden text-white/40 sm:inline">Enter</span>
      </button>
    );

  return (
    <div
      data-team-chat
      className="pointer-events-auto absolute bottom-20 left-4 flex max-h-[38vh] w-[min(300px,40vw)] flex-col rounded-xl bg-black/70 text-xs text-white"
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1 border-b border-white/10 px-2 py-1">
        {tabs.map((ch) => (
          <button key={ch} type="button" onClick={() => {
              leave();
              setTab(ch);
            }} className={`rounded px-2 py-0.5 font-bold uppercase tracking-wider ${tab === ch ? 'bg-white/15 text-white' : 'text-white/55'}`}>
            {label[ch]}
            {unread(ch) && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[#ffd21a] align-middle" />}
          </button>
        ))}
        <button type="button" aria-label="Close chat" onClick={() => {
            leave();
            setOpen(false);
          }} className="ml-auto px-1 text-white/55">
          ×
        </button>
      </div>
      {tab === 'dm' && (
        <select value={dmTo} onChange={(e) => setDmTo(e.target.value)} className="mx-2 mt-1 rounded bg-white/10 px-1 py-0.5 text-white">
          <option value="">Pick a player…</option>
          {others.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.team !== myTeam ? ' (opponent)' : ''}
            </option>
          ))}
        </select>
      )}
      <div ref={list} className="min-h-[3rem] flex-1 overflow-y-auto px-2 py-1">
        {shown.length === 0 && <p className="text-white/40">{tab === 'team' ? 'Only your side sees this.' : tab === 'all' ? 'Everyone in the match sees this.' : 'Only the two of you see this.'}</p>}
        {shown.map((m, i) => (
          <p key={i} className="break-words leading-snug">
            <button type="button" title="Mute locally" onClick={() => m.from !== you && setMuted((s) => new Set(s).add(m.from))} className={m.team === myTeam ? 'font-bold text-[#4de8ff]' : 'font-bold text-[#ff2a46]'}>
              {m.from === you ? 'you' : m.name}
            </button>
            {m.ch === 'dm' && <span className="text-white/40"> → {m.to === you ? 'you' : nameOf(m.to)}</span>}
            <span className="text-white/90">: {m.text}</span>
          </p>
        ))}
      </div>
      {muted.size > 0 && (
        <button type="button" onClick={() => setMuted(new Set())} className="px-2 text-left text-[10px] text-white/40">
          {muted.size} muted · unmute all
        </button>
      )}
      {note && <p className="px-2 text-[10px] text-[#ffb21a]">{note}</p>}
      {spectator ? (
        <p className="px-2 py-1 text-[10px] text-white/40">Spectators read All only.</p>
      ) : (
        <input
          ref={input}
          value={text}
          maxLength={CHAT_MAX}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
            if (e.key === 'Escape') input.current?.blur();
          }}
          placeholder={tab === 'dm' && !dmTo ? 'Pick a player first' : `Message ${label[tab]}…`}
          className="m-1 rounded bg-white/10 px-2 py-1 text-white placeholder:text-white/35 focus:outline-none"
        />
      )}
    </div>
  );
}
