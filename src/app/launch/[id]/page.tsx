import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CoinView } from '@/components/launch/CoinView';
import { rpc } from '@/lib/launch/server';

type Props = { params: Promise<{ id: string }> };

/** Each coin shares under its own name (the card itself comes from opengraph-image.tsx). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const rows = /^[0-9a-f]{64}_\d+$/.test(id) ? await rpc<{ sym: string; name: string; description: string }[]>('tokenblaster_launch_coin', { p_token: id }, false).catch(() => []) : [];
  const c = rows[0];
  if (!c) return { title: 'Coin · BlastPad · TokenBlaster.lol' };
  const title = `$${c.sym} · ${c.name} on BlastPad`;
  const description = c.description || `$${c.sym} on BlastPad: a BSV-21 coin on a bonding curve. Buy it, sell it, shoot it in the Arena.`;
  return {
    title: `${title} · TokenBlaster.lol`,
    description,
    openGraph: { title, description, url: `/launch/${id}` },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  if (!/^[0-9a-f]{64}_\d+$/.test(id)) notFound();
  return <CoinView id={id} />;
}
