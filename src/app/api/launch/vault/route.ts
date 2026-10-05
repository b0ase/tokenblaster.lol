/** Run the fee vaults (split payouts, holder credits, buybacks). Called by worker/vault.ts with LAUNCH_CRON_SECRET. */
import { NextResponse } from 'next/server';
import { configured } from '@/lib/launch/server';
import { runVaults } from '@/lib/launch/vault';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  const secret = process.env.LAUNCH_CRON_SECRET;
  if (!configured() || !secret || req.headers.get('x-cron-secret') !== secret) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  try {
    return NextResponse.json({ log: await runVaults() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
