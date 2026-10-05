import type { Metadata } from 'next';
import { Rewards } from '@/components/launch/Rewards';

export const metadata: Metadata = { title: 'Rewards · BlastPad · TokenBlaster.lol' };

export default function Page() {
  return <Rewards />;
}
