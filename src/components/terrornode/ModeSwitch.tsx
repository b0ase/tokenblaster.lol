import Link from 'next/link';

/** SOLO / TEAM tabs at the top of TERRORNODE: the single-player assault and the up-to-16-player team mode. */
export function ModeSwitch({ active }: { active: 'solo' | 'team' }) {
  const tab = (id: 'solo' | 'team', href: string, label: string, sub: string) => (
    <Link
      href={href}
      data-mode-tab={id}
      aria-current={active === id ? 'page' : undefined}
      className={`flex flex-1 flex-col items-center rounded-xl border px-4 py-2 text-center transition sm:flex-none sm:px-8 ${active === id ? 'border-[#ff2a46] bg-[#ff2a46]/15 text-white shadow-[0_0_24px_-8px_#ff2a46]' : 'border-white/15 bg-black/40 text-white/70 hover:border-[#2ec8e0] hover:text-white'}`}
    >
      <span className="text-sm font-black uppercase tracking-[0.25em]">{label}</span>
      <span className="text-[10px] uppercase tracking-widest text-white/50">{sub}</span>
    </Link>
  );
  return (
    <nav className="mx-auto flex w-full max-w-md gap-2 px-4 py-2" aria-label="TERRORNODE mode">
      {tab('solo', '/arcade/terrornode', 'Solo', 'Single player')}
      {tab('team', '/arcade/terrornode/team', 'Team', 'Up to 16 · co-op or 8v8')}
    </nav>
  );
}
