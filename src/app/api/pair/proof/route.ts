/**
 * POST /api/pair/proof {c,k,o,e[,ret,rid,b]} → { s, s2 } (either may be null)
 * s2 is the v2 return proof (bwallet docs/PAIRING-ORIGIN-PROOF.md), signed only when ret/rid/b fit.
 * Signs a bWalletX pairing QR for this origin (see src/lib/pair/origin-proof.ts). With no key set it
 * answers { s: null } and the page shows today's unsigned QR.
 */
import { signPairRequestV2 } from '@/lib/pair/origin-proof';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    /* fall through: null → unsigned */
  }
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const { s, s2 } = signPairRequestV2(body, host, req.headers.get('origin'));
  return Response.json({ s, s2 }, { headers: { 'Cache-Control': 'no-store' } });
}
