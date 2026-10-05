import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OrdnanceStore } from '@/components/OrdnanceStore';
import { ORDNANCE, bySlug, ogPath, slugOf } from '@/lib/ordnance';

export function generateStaticParams() {
  return ORDNANCE.map((o) => ({ slug: slugOf(o) }));
}

export async function generateMetadata({ params }: PageProps<'/1satordnance/store/[slug]'>): Promise<Metadata> {
  const o = bySlug((await params).slug);
  if (!o) return {};
  const title = `${o.name.toUpperCase()}: ${o.tagline}`;
  const description = `${o.description} A real 1Sat ordinal, inscribed straight to your wallet. Hold it and it unlocks in Double-O Kweg and the Arena.`;
  const images = [{ url: ogPath(o), width: 1200, height: 630, alt: `${o.name}, a ${o.rarity} 1Sat Ordnance weapon` }];
  return {
    title: `${o.name} · 1Sat Ordnance · TokenBlaster.lol`,
    description,
    openGraph: { title, description, url: `/1satordnance/store/${slugOf(o)}`, images },
    twitter: { card: 'summary_large_image', title, description, images },
  };
}

/** One weapon's own page: shareable, with its own poster as the share image. */
export default async function WeaponPage({ params }: PageProps<'/1satordnance/store/[slug]'>) {
  const o = bySlug((await params).slug);
  if (!o) notFound();
  return (
    <main className="mx-auto flex w-full max-w-[720px] flex-col gap-3 p-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <Link href="/1satordnance/store" className="text-dim hover:text-hot">
          &lt; all {ORDNANCE.length} weapons
        </Link>
        <span className="text-xs tracking-widest text-dim">1SAT ORDNANCE · Q BRANCH</span>
      </div>
      <OrdnanceStore only={o.id} />
    </main>
  );
}
