/**
 * Token names and icons for the live feed: looked up once per token from the GorillaPool index,
 * cached, and their icons preloaded for drawing on canvas. bsv.lol shows "N tokens"; we show which.
 */
import { iconUrl, tokenById } from './tokens';

export type Meta = { sym: string; dec: number; icon: HTMLImageElement | null; iconSrc: string | null };

const cache = new Map<string, Meta | null>();
const pending = new Set<string>();

/** The token's meta if we have it; starts a lookup if not (returns null until it lands). */
export function tokenMeta(id: string): Meta | null {
  if (cache.has(id)) return cache.get(id) ?? null;
  if (!pending.has(id) && pending.size < 50) {
    pending.add(id);
    const isId = /^[0-9a-f]{64}_\d+$/.test(id);
    (isId ? tokenById(id) : Promise.resolve({ id, sym: id, dec: 0, icon: null }))
      .then((t) => {
        const src = iconUrl(t.icon);
        let img: HTMLImageElement | null = null;
        if (src) {
          img = new Image();
          img.crossOrigin = 'anonymous';
          img.src = src;
        }
        cache.set(id, { sym: t.sym, dec: t.dec, icon: img, iconSrc: src });
      })
      .catch(() => cache.set(id, { sym: id.slice(0, 8), dec: 0, icon: null, iconSrc: null }))
      .finally(() => pending.delete(id));
  }
  return null;
}
