/**
 * Draw a token pickup on a 2D canvas: the token's icon (or its symbol) in a glowing gold coin.
 * Shared by the arcade games so loot looks the same everywhere.
 */
import type { Loot } from './loot';
import { tokenMeta } from './tokenMeta';

export function drawLoot(ctx: CanvasRenderingContext2D, loot: Loot, x: number, y: number, size: number, t: number) {
  const r = size / 2;
  const pulse = 0.5 + 0.5 * Math.sin(t / 160 + x * 0.1);
  ctx.save();
  ctx.globalAlpha = 0.25 + 0.25 * pulse;
  ctx.fillStyle = '#d4a843';
  ctx.beginPath();
  ctx.arc(x, y, r + 3 + pulse * 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#2a1a04';
  ctx.strokeStyle = '#ffd36a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const img = tokenMeta(loot.id)?.icon;
  let drawn = false;
  if (img?.complete && img.naturalWidth) {
    try {
      ctx.beginPath();
      ctx.arc(x, y, r - 1.5, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, x - r + 1.5, y - r + 1.5, size - 3, size - 3);
      drawn = true;
    } catch {
      /* broken icon: fall back to the symbol */
    }
  }
  if (!drawn) {
    ctx.fillStyle = '#ffd36a';
    ctx.font = `bold ${Math.max(6, Math.round(size * 0.42))}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((tokenMeta(loot.id)?.sym ?? loot.sym).slice(0, 3), x, y + 0.5);
  }
  ctx.restore();
}

/** Refresh a pickup's symbol/icon once the token lookup lands (lootFrom may run before it does). */
export function refreshLoot(l: Loot): Loot {
  const m = tokenMeta(l.id);
  return m ? { id: l.id, sym: m.sym, icon: m.iconSrc } : l;
}
