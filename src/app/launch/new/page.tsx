import type { Metadata } from 'next';
import { LaunchForm } from '@/components/launch/LaunchForm';

export const metadata: Metadata = { title: 'Launch a coin · BlastPad · TokenBlaster.lol' };

export default function Page() {
  return <LaunchForm />;
}
