import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ShareBurn } from '@/components/launch/ShareBurn';
import { fmtBurn } from '@/lib/launch/burn';
import { burnOf, validIds } from '@/lib/launch/burnData';
import { fmtTokens } from '@/lib/launch/curve';

type Props = { params: Promise<{ id: string; txid: string }> };

/** One burn's share page; the card itself comes from opengraph-image.tsx next to it. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, txid } = await params;
  const b = await burnOf(id, txid);
  if (!b) return { title: 'Burn · BlastPad · TokenBlaster.lol' };
  const title = `🔥 ${fmtBurn(b.tokens)} $${b.sym} BURNED`;
  const description = `$${b.sym}'s fee vault bought ${fmtTokens(b.tokens)} back on the curve and burned them. ${b.pct.toFixed(2)}% of supply burned so far.`;
  return { title: `${title} · BlastPad`, description, openGraph: { title, description, url: `/launch/${id}/burn/${txid}` }, twitter: { card: 'summary_large_image', title, description } };
}

export default async function Page({ params }: Props) {
  const { id, txid } = await params;
  if (!validIds(id, txid)) notFound();
  const b = await burnOf(id, txid);
  if (!b) notFound();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
      <section className="panel flex flex-col gap-3">
        <p className="text-xs text-muted">
          <Link href={`/launch/${id}`} className="hover:text-hot">
            ← ${b.sym}
          </Link>
        </p>
        <h1 className="text-3xl font-bold text-hot">
          🔥 {fmtTokens(b.tokens)} ${b.sym} BURNED
        </h1>
        <p className="text-sm text-dim">
          The coin&apos;s fee vault bought these back on its own curve for {(b.sats / 1e8).toFixed(5)} BSV and sent them to the burn address in one transaction.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/launch/${id}/burn/${txid}/opengraph-image`} alt={`${fmtTokens(b.tokens)} $${b.sym} burned`} className="w-full border border-line" />
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="inset p-2">
            <p className="text-xs text-muted">Burned so far</p>
            <p className="font-bold text-hot">
              {fmtTokens(b.burned)} · {b.pct.toFixed(2)}%
            </p>
          </div>
          <div className="inset p-2">
            <p className="text-xs text-muted">Supply now</p>
            <p>{fmtTokens(b.supplyNow)}</p>
          </div>
        </div>
        <ShareBurn sym={b.sym} tokens={b.tokens} pct={b.pct} txid={txid} />
      </section>
    </main>
  );
}
