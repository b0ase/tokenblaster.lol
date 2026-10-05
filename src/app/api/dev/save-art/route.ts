import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * DEV ONLY: /1satordnance/render posts each weapon's rendered poster here and it is written to
 * public/ordnance/cards/. Refuses outside `next dev`.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV !== 'development') return new Response('Not found', { status: 404 });
  const { name, dataUrl } = (await request.json()) as { name: string; dataUrl: string };
  if (!/^[a-z0-9-]+(-og)?\.(webp|jpg)$/.test(name)) return Response.json({ error: 'bad name' }, { status: 400 });
  const m = /^data:image\/(webp|jpeg);base64,(.+)$/.exec(dataUrl);
  if (!m) return Response.json({ error: 'bad data' }, { status: 400 });
  await writeFile(path.join(process.cwd(), 'public/ordnance/cards', name), Buffer.from(m[2], 'base64'));
  return Response.json({ ok: true });
}
