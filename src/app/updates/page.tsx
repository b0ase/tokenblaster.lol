import Link from 'next/link';

export const metadata = { title: 'Updates · TokenBlaster.lol', description: 'What we shipped, day by day.' };

const UPDATES = [{ href: '/updates/2026-10-05', date: '5 Oct 2026', title: 'Guns you actually own, ammo tokens, a spy story, new monsters, gold everything' }];

export default function Updates() {
  return (
    <main className="mx-auto flex w-full max-w-[960px] flex-col gap-3 p-2.5">
      <header className="panel">
        <h1 className="text-3xl font-bold text-hot">UPDATES</h1>
        <p className="text-dim">What we shipped, day by day.</p>
      </header>
      {UPDATES.map((u) => (
        <Link key={u.href} href={u.href} className="panel group hover:border-fg">
          <p className="text-xs tracking-widest text-dim">{u.date}</p>
          <p className="font-bold text-hot group-hover:underline">{u.title}</p>
        </Link>
      ))}
    </main>
  );
}
