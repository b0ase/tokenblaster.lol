import type { Metadata } from 'next';
import Link from 'next/link';
import { LaunchNav } from '@/components/launch/LaunchNav';
import { gpToken, ordfs, units } from '@/lib/gpToken';
import { rpc } from '@/lib/launch/server';
import { LAUNCH_CARD, shareImages } from '@/lib/og';
import { OUR_TOKENS } from '@/lib/ourTokens';

export const revalidate = 120;

const title = 'Every token on TokenBlaster.lol';
const description = 'All BlastPad coins and the other b0ase tokens on BSV, each with its own page: supply, holders and deploy transaction.';

export const metadata: Metadata = {
  title: `${title} · TokenBlaster.lol`,
  description,
  alternates: { canonical: '/tokens' },
  openGraph: { title, description, url: '/tokens', siteName: 'TokenBlaster.lol', type: 'website', images: shareImages(LAUNCH_CARD).openGraph },
  twitter: { card: 'summary_large_image', title, description, images: shareImages(LAUNCH_CARD).twitter },
};

/** TokenBlaster's own test coins stay off the index, as on the board (their pages still open by link). */
const HIDDEN = new Set(['342d637360569559810232fbbf9c4aea873e95c31d710396b0c9ac2e832ce628_1']); // $TBTEST

type BoardRow = { token_id: string; sym: string; name: string; holders: number; graduated_at: string | null; created_at: string };

export default async function Page() {
  const [board, others] = await Promise.all([
    rpc<BoardRow[]>('tokenblaster_launch_board', {}, false).catch(() => [] as BoardRow[]),
    Promise.all(OUR_TOKENS.map(async (t) => ({ t, gp: await gpToken(t.id) }))),
  ]);
  const coins = board.filter((c) => c.token_id && !HIDDEN.has(c.token_id));

  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-3 p-2.5">
      <LaunchNav />
      <section className="panel">
        <p className="text-xs text-muted">
          <span className="border border-hot px-1.5 py-0.5 text-hot">TOKENS</span> {'// EVERY COIN, ONE PAGE EACH'}
        </p>
        <h1 className="mt-3 text-3xl font-bold leading-tight text-hot sm:text-4xl">All our tokens</h1>
        <p className="mt-2 text-sm text-dim">
          BlastPad coins trade on their own bonding curve here. The other b0ase tokens are shown read-only, straight from the chain. Short links work too:
          <span className="text-fg"> tokenblaster.lol/launch/TERRORNODE</span>.
        </p>
      </section>

      <section className="panel">
        <p className="panel-title mb-2">BlastPad coins · {coins.length}</p>
        {!coins.length && <p className="text-xs text-muted">The board did not answer just now.</p>}
        <ul className="grid gap-1 sm:grid-cols-2">
          {coins.map((c) => (
            <li key={c.token_id}>
              <Row
                href={`/launch/${c.token_id}`}
                icon={ordfs(`${c.token_id.split('_')[0]}_0`)}
                sym={c.sym}
                name={c.name}
                right={`${c.holders} holder${c.holders === 1 ? '' : 's'}`}
                tag={c.graduated_at ? 'GRADUATED' : 'LIVE'}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <p className="panel-title mb-2">Other b0ase tokens · {others.length}</p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {others.map(({ t, gp }) => (
            <li key={t.id}>
              <Row
                href={`/token/${t.id}`}
                icon={gp?.icon ? ordfs(gp.icon) : null}
                sym={t.sym.replace(/^\$/, '')}
                name={`${t.name} · ${t.project.name}`}
                right={gp ? `${units(gp.amt, gp.dec)} supply` : ''}
                tag={t.legacy ? 'LEGACY' : 'READ-ONLY'}
              />
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function Row({ href, icon, sym, name, right, tag }: { href: string; icon: string | null; sym: string; name: string; right: string; tag: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 px-1 py-1.5 hover:bg-active">
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={icon} alt="" className="h-10 w-10 shrink-0 rounded object-cover" loading="lazy" />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-hot text-xs font-bold text-hot">{sym.slice(0, 3)}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block overflow-hidden text-ellipsis whitespace-nowrap font-bold">${sym}</span>
        <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted">{name}</span>
      </span>
      <span className="shrink-0 text-right text-xs">
        <span className="block text-dim">{right}</span>
        <span className="block text-muted">{tag}</span>
      </span>
    </Link>
  );
}
