import { notFound } from 'next/navigation';
import { BRacerVehicleShow } from '@/components/BRacerVehicleShow';

// Turntable of bRacer's team vehicles (src/lib/hyper/vehicles), for reviewing and screenshotting the models without
// racing. Off in production unless asked for with ?vehicleshow=1; never indexed.
export const metadata = { title: 'bRacer vehicles · TokenBlaster.lol', robots: { index: false, follow: false } };

export default async function VehicleShowPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  if (process.env.NODE_ENV === 'production' && q.vehicleshow !== '1') notFound();
  return <BRacerVehicleShow />;
}
