import type { Metadata } from 'next';
import { MyCoins } from '@/components/launch/Leaders';

export const metadata: Metadata = { title: 'My coins · BlastPad · TokenBlaster.lol' };

export default function Page() {
  return <MyCoins />;
}
