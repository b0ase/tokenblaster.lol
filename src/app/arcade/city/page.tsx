import Link from 'next/link';
import { SatoshiCity } from '@/components/SatoshiCity';

const description = 'An open-world island city where every car on the road is a live BSV mainnet transaction. Walk, steal any car, drift, deliver the next block before it is orphaned.';
export const metadata = {
  title: 'Satoshi City · TokenBlaster.lol',
  description,
  openGraph: { title: 'Satoshi City', description, url: '/arcade/city' },
  twitter: { card: 'summary_large_image', title: 'Satoshi City', description },
};

export default function CityPage() {
  return (
    <main className="mx-auto flex w-full max-w-[2200px] flex-col gap-2 px-2 py-2 sm:px-4">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Satoshi City<span className="blink">_</span>
          </h1>
          <Link href="/arcade" className="text-dim hover:text-hot">
            &lt; Arcade
          </Link>
        </div>
        <p className="mt-1 text-dim">Open world on the live chain: every car driving the grid is a real BSV transaction. Steal one, run deliveries, race the mempool.</p>
      </header>
      <SatoshiCity />
      <p className="text-center text-xs text-muted">
        Pedestrians: &quot;Bearded man&quot; and &quot;Low poly ordinary man&quot; by Agor_2012, &quot;Low Poly Female&quot; by Loves_Art (CC-BY 4.0, Sketchfab).
      </p>
    </main>
  );
}
