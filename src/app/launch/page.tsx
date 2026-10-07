import type { Metadata } from 'next';
import { LAUNCH_CARD, shareImages } from '@/lib/og';
import { Board } from '@/components/launch/Board';

const description = 'Launch a BSV-21 memecoin, trade it on its bonding curve in one atomic transaction, then shoot it in the Arena. Indexed from block one, with proof of reserves.';
const title = 'BLASTPAD: launch a coin. Blast it up the curve.';

export const metadata: Metadata = {
  title: 'BlastPad · launch a BSV-21 coin on a bonding curve · TokenBlaster.lol',
  description,
  openGraph: { title, description, url: '/launch', siteName: 'TokenBlaster.lol', type: 'website', images: shareImages(LAUNCH_CARD).openGraph },
  twitter: { card: 'summary_large_image', title, description, images: shareImages(LAUNCH_CARD).twitter },
};

export default function Page() {
  return <Board />;
}
