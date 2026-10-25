/**
 * GET /.well-known/bwalletx-pair.json → {"keys":["02…"]}
 * The phone fetches this itself (no redirects followed, ≤ 8 KB) to check the `s` proof in a pairing QR.
 * Keys come from the environment only; with none set it serves {"keys":[]} and pairing stays unsigned.
 */
import { publishedPairKeys } from '@/lib/pair/origin-proof';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { keys: publishedPairKeys() },
    { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300' } },
  );
}
