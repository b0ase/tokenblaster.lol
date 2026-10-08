import { GameShell } from '@/components/GameShell';
import { CITY_CARD, shareImages } from '@/lib/og';
import { SatoshiCity } from '@/components/SatoshiCity';

const description = 'An open-world island city where every car on the road is a live BSV mainnet transaction. Walk, steal any car, drift, deliver the next block before it is orphaned.';
export const metadata = {
  title: 'Satoshi City · TokenBlaster.lol',
  description,
  openGraph: { title: 'Satoshi City', description, url: '/arcade/city', images: shareImages(CITY_CARD).openGraph },
  twitter: { card: 'summary_large_image', title: 'Satoshi City', description, images: shareImages(CITY_CARD).twitter },
};

export default function CityPage() {
  return (
    <GameShell
      title="Satoshi City"
      below={
        <>
          <p className="panel text-dim">Open world on the live chain: every car driving the grid is a real BSV transaction. Steal one, run deliveries, race the mempool.</p>
        <p className="text-center text-xs text-muted">
          Pedestrians: &quot;Bearded man&quot; and &quot;Low poly ordinary man&quot; by Agor_2012, &quot;Low Poly Female&quot; by Loves_Art (CC-BY 4.0, Sketchfab).
        </p>
        </>
      }
    >
        <SatoshiCity />
    </GameShell>
  );
}
