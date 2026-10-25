import Link from 'next/link';

/**
 * SOLO / TEAM for TERRORNODE: the single-player assault and the up-to-16-player team mode. A compact pill in the
 * game bar (owner, 25 Oct 2026: moved out of the page top, where two big tabs pushed the game down).
 */
export function ModeSwitch({ active }: { active: 'solo' | 'team' }) {
  const tab = (id: 'solo' | 'team', href: string, label: string, sub: string) => (
    <Link
      href={href}
      data-mode-tab={id}
      aria-current={active === id ? 'page' : undefined}
      title={sub}
      className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] transition ${active === id ? 'bg-[#ff2a46] text-white shadow-[0_0_14px_-4px_#ff2a46]' : 'text-white/65 hover:text-white'}`}
    >
      {label}
    </Link>
  );
  return (
    <nav className="flex h-9 shrink-0 items-center gap-0.5 rounded-full border border-white/15 bg-black/40 p-1" aria-label="TERRORNODE mode">
      {tab('solo', '/arcade/terrornode', 'Solo', 'Single player')}
      {tab('team', '/arcade/terrornode/team', 'Team', 'Up to 16 · co-op or 8v8')}
    </nav>
  );
}
