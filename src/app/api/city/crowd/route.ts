import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Satoshi City crowd brain: what does each walker do at the corner they're about to reach?
 * One batched Jev (TypeSafe System One) call per request, one Choice question per walker, all in parallel.
 * Body: { peds: { id: string, ...facts }[] } (≤ 16). Returns { decisions: { [id]: { action, confidence } } }.
 * Code keeps the safety rules (the client never crosses into traffic, whatever Jev says); Jev only supplies the
 * "what would a person here feel like doing" judgment. No key or an upstream error → 503 and the client uses rules.
 */
const ACTIONS = {
  continue: 'Turn the corner and keep walking around this block.',
  cross: 'Cross the street to the next block over.',
  turn_back: 'Turn around and walk back the way they came.',
  pause: 'Stop on the corner for a few seconds (look around, wait, watch the traffic or the race).',
} as const;
export type CrowdAction = keyof typeof ACTIONS;

const MAX_PEDS = 16;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 40; // per server instance; each call is a fraction of a cent, this just stops a runaway loop
let windowStart = 0;
let used = 0;

export async function POST(request: Request) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return NextResponse.json({ error: 'crowd brain offline' }, { status: 503 });

  let peds: unknown;
  try {
    peds = ((await request.json()) as { peds?: unknown }).peds;
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  if (!Array.isArray(peds) || !peds.length || peds.length > MAX_PEDS || peds.some((p) => typeof p?.id !== 'string' || !/^\w{1,12}$/.test(p.id)))
    return NextResponse.json({ error: `peds: 1–${MAX_PEDS} objects with a short id` }, { status: 400 });

  const now = Date.now();
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    used = 0;
  }
  if (++used > MAX_PER_WINDOW) return NextResponse.json({ error: 'busy' }, { status: 429 });

  const state: Record<string, unknown> = {
    setting: 'Satoshi City, a busy neon downtown in an arcade racing game. Pedestrians walk the sidewalks around city blocks; players race cars through the streets.',
    pedestrians: {},
  };
  const questions: Record<string, unknown> = {};
  for (const p of peds as { id: string }[]) {
    const { id, ...facts } = p;
    (state.pedestrians as Record<string, unknown>)[id] = facts;
    questions[id] = {
      type: 'choice',
      instructions: `Pedestrian \`pedestrians.${id}\` is about to reach a street corner. Given what is around them, what would a believable city walker most likely do next?`,
      criteria: ACTIONS,
    };
  }

  let res: Response;
  try {
    res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state, questions }),
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    return NextResponse.json({ error: 'crowd brain timeout' }, { status: 503 });
  }
  if (!res.ok) return NextResponse.json({ error: `crowd brain ${res.status}` }, { status: 503 });
  const out = (await res.json()) as { model?: string; answers?: Record<string, { choice?: string; confidence?: number }> };
  const decisions: Record<string, { action: CrowdAction; confidence: number }> = {};
  for (const [id, a] of Object.entries(out.answers ?? {}))
    if (a?.choice && a.choice in ACTIONS) decisions[id] = { action: a.choice as CrowdAction, confidence: a.confidence ?? 0 };
  return NextResponse.json({ model: out.model, decisions });
}
