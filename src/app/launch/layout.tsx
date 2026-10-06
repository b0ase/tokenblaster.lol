import type { Metadata } from 'next';

const description = 'Launch a BSV-21 memecoin, trade it on its bonding curve in one atomic transaction, then shoot it in the Arena. Indexed from block one, with proof of reserves.';
const title = 'BLASTPAD: launch a coin. Blast it up the curve.';

/** Every BlastPad page shares as BlastPad (with the /launch card), not as the TokenBlaster home page. */
export const metadata: Metadata = {
  description,
  openGraph: { title, description, url: '/launch', siteName: 'TokenBlaster.lol', type: 'website' },
  twitter: { card: 'summary_large_image', title, description },
};

export default function LaunchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
