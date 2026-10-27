import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { LaunchNav } from '@/components/launch/LaunchNav';
import { gpHolders, gpToken, ordfs, share, units } from '@/lib/gpToken';
import { isOutpoint } from '@/lib/launch/ticker';
import { outpointForTicker } from '@/lib/launch/tickerServer';
import { rpc } from '@/lib/launch/server';
import { ourTokenById, ourTokenByTicker } from '@/lib/ourTokens';

export const revalidate = 300;

type Props = { params: Promise<{ id: string }> };

const WOC = 'https://whatsonchain.com';

/** Is this outpoint a BlastPad coin? Then its home is /launch/<id>. */
async function isBlastpad(id: string) {
  const rows = await rpc<{ token_id: string }[]>('tokenblaster_launch_coin', { p_token: id }, false).catch(() => []);
  return rows.length > 0;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const t = ourTokenById(id);
  if (!t) return { title: 'Token · TokenBlaster.lol' };
  const gp = await gpToken(id);
  const sym = t.sym.replace(/^\$/, '');
  const title = `$${sym} · ${t.name}`;
  const description = `${t.blurb} A ${t.project.name} token on BSV: supply, holders and deploy transaction, read from the chain.`;
  const icon = gp?.icon ? ordfs(gp.icon) : null;
  return {
    title: `${title} · TokenBlaster.lol`,
    description,
    alternates: { canonical: `/token/${id}` },
    openGraph: { title, description, url: `/token/${id}`, siteName: 'TokenBlaster.lol', type: 'website', ...(icon ? { images: [{ url: icon, alt: `$${sym} icon` }] } : {}) },
    twitter: { card: 'summary', title, description, ...(icon ? { images: [icon] } : {}) },
  };
}

export default async function Page({ params }: Props) {
  const { id: raw } = await params;
  if (!isOutpoint(raw)) {
    // Short link: /token/NPG, /token/$BOASE → the one canonical outpoint URL. BlastPad tickers go to /launch.
    const ours = ourTokenByTicker(raw);
    if (ours) permanentRedirect(`/token/${ours.id}`);
    const coin = await outpointForTicker(raw);
    if (coin) permanentRedirect(`/launch/${coin}`);
    notFound();
  }
  const t = ourTokenById(raw);
  if (!t) {
    if (await isBlastpad(raw)) permanentRedirect(`/launch/${raw}`);
    notFound();
  }
  const [gp, holders] = await Promise.all([gpToken(t.id), gpHolders(t.id, 10)]);
  const sym = (gp?.sym ?? t.sym).replace(/^\$/, '');
  const dec = gp?.dec ?? 0;
  const supply = gp?.amt ?? null;
  const top10 = supply && holders.length ? holders.reduce((s, h) => s + BigInt(h.amt), BigInt(0)).toString() : null;
  const txid = gp?.txid ?? t.id.split('_')[0];

  return (
    <main className="mx-auto flex w-full max-w-[1100px] flex-col gap-3 p-2.5">
      <LaunchNav />
      <p className="text-xs text-muted">
        <Link href="/tokens" className="hover:text-hot">
          ← All tokens
        </Link>
      </p>

      <section className="panel flex flex-col gap-4 sm:flex-row sm:items-center">
        {gp?.icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ordfs(gp.icon)} alt={`$${sym} icon`} className="h-24 w-24 shrink-0 rounded border border-hot object-cover" />
        ) : (
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded border border-hot text-3xl font-bold text-hot">{sym.slice(0, 3)}</div>
        )}
        <div className="min-w-0">
          <p className="flex flex-wrap gap-2 text-xs text-muted">
            <span className="border border-hot px-1.5 py-0.5 text-hot">B0ASE TOKEN</span>
            <span>{'// READ-ONLY · NOT A BLASTPAD COIN'}</span>
            {t.legacy && <span className="border border-hot px-1.5 py-0.5">LEGACY</span>}
          </p>
          <h1 className="mt-2 break-words text-4xl font-bold leading-tight text-hot sm:text-5xl">${sym}</h1>
          <p className="text-dim">{t.name}</p>
          <p className="mt-2 text-sm text-dim">{t.blurb}</p>
        </div>
      </section>

      {!gp && <p className="panel text-sm text-muted">GorillaPool did not answer just now, so the on-chain numbers are missing. Try again in a minute.</p>}

      <section className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Fact label="Supply" value={supply ? units(supply, dec) : '—'} sub="fixed at deploy" />
        <Fact label="Decimals" value={gp ? String(dec) : '—'} />
        <Fact label="Holders" value={gp?.accounts != null && gp.accounts > 0 ? gp.accounts.toLocaleString('en-US') : '—'} sub="GorillaPool index" />
        <Fact label="Top 10 hold" value={top10 && supply ? share(top10, supply) : '—'} sub="of supply" />
      </section>

      <section className="panel text-sm">
        <p className="panel-title mb-2">On chain</p>
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[140px_1fr]">
          <dt className="text-muted">Token ID</dt>
          <dd className="break-all font-mono text-xs">{t.id}</dd>
          <dt className="text-muted">Deploy tx</dt>
          <dd className="break-all">
            <a href={`${WOC}/tx/${txid}`} target="_blank" rel="noopener noreferrer" className="text-accent hover:text-hot">
              {txid.slice(0, 16)}…{txid.slice(-6)} ↗
            </a>
            {gp?.height ? <span className="text-muted"> · block {gp.height.toLocaleString('en-US')}</span> : null}
          </dd>
          <dt className="text-muted">Project</dt>
          <dd>
            <a href={t.project.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:text-hot">
              {t.project.name} ↗
            </a>
          </dd>
          <dt className="text-muted">Price</dt>
          <dd className="text-dim">None shown. This token does not trade on a BlastPad curve, so there is no market price to show.</dd>
        </dl>
      </section>

      {holders.length > 0 && supply && (
        <section className="panel text-sm">
          <p className="panel-title mb-2">Top holders</p>
          <ol className="flex flex-col gap-1">
            {holders.map((h, i) => (
              <li key={h.address} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right text-xs text-muted">{i + 1}</span>
                <a
                  href={`${WOC}/address/${h.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-accent hover:text-hot"
                >
                  {h.address}
                </a>
                <span className="shrink-0 text-xs">{units(h.amt, dec)}</span>
                <span className="w-14 shrink-0 text-right text-xs text-muted">{share(h.amt, supply)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="px-1 text-xs text-muted">Every number here is read from GorillaPool&apos;s index of the BSV chain. Tokens are toys, not investments.</p>
    </main>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 break-words text-lg font-bold text-hot">{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}
