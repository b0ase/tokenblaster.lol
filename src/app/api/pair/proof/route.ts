/**
 * POST /api/pair/proof {c,k,o,e} → { s } | { s: null }
 * Signs a bWalletX pairing QR for this origin (see src/lib/pair/origin-proof.ts). With no key set it
 * answers { s: null } and the page shows today's unsigned QR.
 */
import { signPairRequest } from '@/lib/pair/origin-proof';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    /* fall through: null → unsigned */
  }
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const s = signPairRequest(body, host, req.headers.get('origin'));
  return Response.json({ s }, { headers: { 'Cache-Control': 'no-store' } });
}
