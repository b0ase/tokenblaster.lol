import type { Metadata } from 'next';
import { Board } from '@/components/launch/Board';

export const metadata: Metadata = {
  title: 'BlastPad · launch a BSV-21 coin on a bonding curve · TokenBlaster.lol',
  description: 'Launch a memecoin on BSV, trade it on its bonding curve in one atomic transaction, then shoot it in the Arena.',
};

export default function Page() {
  return <Board />;
}
