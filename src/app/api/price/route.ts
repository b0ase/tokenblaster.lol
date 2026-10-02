/** GET /api/price → { bsvUsd } from WhatsOnChain. */
export async function GET() {
  try {
    const r = await fetch('https://api.whatsonchain.com/v1/bsv/main/exchangerate', { cache: 'no-store' });
    const { rate } = (await r.json()) as { rate?: number };
    if (!rate) throw new Error('no rate');
    return Response.json({ bsvUsd: rate });
  } catch {
    return Response.json({ error: 'Price unavailable' }, { status: 502 });
  }
}
