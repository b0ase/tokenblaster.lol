import { GameShell } from '@/components/GameShell';
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
    <GameShell
      title="Kweg&apos;s Expedition"
      below={
        <>
          <p className="panel text-dim">Professor Doctor Sir Kweg S Wong esq., CEO of Bitcoin (self-appointed) and the only man with a valid license to practice Aeronautical Zoological Law on the
          blockchain, sets off from the Maritime Pachyderm Suite after Satoshi&apos;s submarine coordinates. Ping the sonar for hidden $KWEG, stamp a patent through anything in
          the way, and outrace Brian Headstrong, Michael Fayloor and Seizey Binants. More Kweg at{' '}
          <a href="https://kwegwong.com" target="_blank" rel="noopener noreferrer" className="text-accent underline">
            kwegwong.com ↗
          </a>
          .</p>
        <HighScoresPanel games={['kweg']} />
        </>
      }
    >
        <KwegExpedition />
    </GameShell>
  );
}
