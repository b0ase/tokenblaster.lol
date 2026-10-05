import { notFound } from 'next/navigation';
import { AmmoMint } from '@/components/AmmoMint';

export const metadata = { title: 'Q Branch ammo bench · 1Sat Ordnance', robots: { index: false, follow: false } };

/** Owner-only tool, not linked: hidden unless NEXT_PUBLIC_TB_ADMIN=1 or ?qbranch=1. Nothing here holds a key: the connected wallet builds, signs and broadcasts. */
export default async function AmmoMintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  if (process.env.NEXT_PUBLIC_TB_ADMIN !== '1' && q.qbranch !== '1') notFound();
  return (
    <main className="mx-auto flex w-full max-w-[1000px] flex-col gap-3 p-2.5">
      <AmmoMint />
    </main>
  );
}
