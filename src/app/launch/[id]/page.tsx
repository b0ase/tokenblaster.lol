import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CoinView } from '@/components/launch/CoinView';

export const metadata: Metadata = { title: 'Coin · BlastPad · TokenBlaster.lol' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{64}_\d+$/.test(id)) notFound();
  return <CoinView id={id} />;
}
