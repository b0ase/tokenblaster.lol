import type { Metadata } from 'next';
import { Leaders } from '@/components/launch/Leaders';

export const metadata: Metadata = { title: 'Leaders · BlastPad · TokenBlaster.lol' };

export default function Page() {
  return <Leaders />;
}
