import Link from 'next/link';
import { HighScoresPanel } from '@/components/HighScores';
import { KwegExpedition } from '@/components/KwegExpedition';

const description =
  "Pilot Professor Doctor Sir Kweg S Wong esq.'s pachyderm-powered submarine through the live BSV chain, race three rivals to Satoshi's submarine coordinates and collect $KWEG.";
export const metadata = {
  title: "Kweg's Expedition · TokenBlaster.lol",
  description,
  openGraph: { title: "Kweg's Expedition", description, url: '/arcade/kweg' },
  twitter: { card: 'summary_large_image', title: "Kweg's Expedition", description },
};

export default function KwegPage() {
  return (
    <main className="mx-auto flex w-full max-w-[1200px] flex-col gap-3 p-2.5">
      <header className="panel">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-bold text-hot">
            Kweg&apos;s Expedition<span className="blink">_</span>
          </h1>
          <Link href="/arcade" className="text-dim hover:text-hot">
            &lt; Arcade
          </Link>
        </div>
        <p className="mt-1 text-dim">
          Professor Doctor Sir Kweg S Wong esq., CEO of Bitcoin (self-appointed) and the only man with a valid license to practice Aeronautical Zoological Law on the
          blockchain, sets off from the Maritime Pachyderm Suite after Satoshi&apos;s submarine coordinates. Ping the sonar for hidden $KWEG, stamp a patent through anything in
          the way, and outrace Brian Headstrong, Michael Fayloor and Seizey Binants. More Kweg at{' '}
          <a href="https://kwegwong.com" target="_blank" rel="noopener noreferrer" className="text-accent underline">
            kwegwong.com ↗
          </a>
          .
        </p>
      </header>
      <KwegExpedition />
      <HighScoresPanel games={['kweg']} />
    </main>
  );
}
