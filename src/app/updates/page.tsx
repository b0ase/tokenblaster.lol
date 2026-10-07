import Link from 'next/link';
import { PageHead } from '@/components/dr/site';

export const metadata = { title: 'Updates · TokenBlaster.lol', description: 'What we shipped, day by day.' };

const UPDATES = [
  { href: '/updates/2026-10-07', date: '7 Oct 2026', title: 'Token Rally, an Arena and Double-O Satoshi glow-up, and 10p coin-op' },
  { href: '/updates/2026-10-06', date: '6 Oct 2026', title: 'BlastPad opens, four game coins, and Chain Frogger takes $FROGGER' },
  { href: '/updates/2026-10-05', date: '5 Oct 2026', title: 'Guns you actually own, ammo tokens, a spy story, new monsters, gold everything' }];

export default function Updates() {
  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-3 p-2.5">
      <PageHead title="Updates" code={`TB-LOG / ${UPDATES.length} ENTRIES`} kana="アップデート" icon="flag" back={['/', 'TokenBlaster.lol']} sub="What we shipped, day by day." />
      {UPDATES.map((u, i) => (
        <Link key={u.href} href={u.href} className="panel group hover:border-[var(--hot)]">
          <p className="dr-code">
            LOG-{String(UPDATES.length - i).padStart(3, '0')} / {u.date}
          </p>
          <p className="dr-display mt-1 text-[clamp(22px,3.6vw,32px)] text-hot group-hover:text-[var(--accent)]">{u.title}</p>
        </Link>
      ))}
    </main>
  );
}
