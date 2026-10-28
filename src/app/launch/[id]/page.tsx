import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { CoinView } from '@/components/launch/CoinView';
import { rpc } from '@/lib/launch/server';
import { parseBuyUsd } from '@/lib/buyPreset';
import { isOutpoint } from '@/lib/launch/ticker';
import { outpointForTicker } from '@/lib/launch/tickerServer';
import { tokenPageRule } from '@/lib/launch/tokenPage';

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> };

/** Each coin shares under its own name (the card itself comes from opengraph-image.tsx). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const rows = /^[0-9a-f]{64}_\d+$/.test(id) ? await rpc<{ sym: string; name: string; description: string }[]>('tokenblaster_launch_coin', { p_token: id }, false).catch(() => []) : [];
  const c = rows[0];
  if (!c) return { title: 'Coin · BlastPad · TokenBlaster.lol' };
  const rule = tokenPageRule(id);
  const title = rule.metaTitle ?? `$${c.sym} · ${rule.name ?? c.name} on BlastPad`;
  const description = rule.description || c.description || `$${c.sym} on BlastPad: a BSV-21 coin on a bonding curve. Buy it, sell it, shoot it in the Arena.`;
  return {
    title: `${title} · TokenBlaster.lol`,
    description,
    openGraph: { title, description, url: `/launch/${id}` },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function Page({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const presetUsd = parseBuyUsd(sp?.buy);
  if (!isOutpoint(id)) {
    // Short link: /launch/TERRORNODE (any case, optional $) → 308 to the one canonical /launch/<outpoint>.
    const op = await outpointForTicker(id);
    if (!op) notFound();
    const buy = typeof sp?.buy === 'string' ? `?buy=${encodeURIComponent(sp.buy)}` : '';
    permanentRedirect(`/launch/${op}${buy}`);
  }
  return <CoinView id={id} presetUsd={presetUsd} />;
}
