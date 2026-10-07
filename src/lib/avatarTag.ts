/**
 * The billboard over a remote player's head: circular X avatar in a DR-style team ring, @handle plate, blue tick when
 * verified. One THREE.Sprite (always faces the camera), depth-tested so walls hide it, kept readable by
 * `fitAvatarTag` (grows with distance up to a cap, so far players stay legible and near ones don't fill the screen).
 *
 * GTAOPass redraws the scene with an opaque override material: any game using AO must hide sprites during that pass
 * (Arena, Token Rally and Double-O already do).
 */
import * as THREE from 'three';
import { avatarUrl, identiconUrl } from './identity';

export type AvatarTagOpts = { handle: string | null; name: string; ring: string; verified?: boolean };

const W = 256;
const H = 320;
const imgs = new Map<string, Promise<HTMLImageElement | null>>();
function loadImg(src: string): Promise<HTMLImageElement | null> {
  let p = imgs.get(src);
  if (!p) {
    p = new Promise((res) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.decoding = 'async';
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = src;
    });
    imgs.set(src, p);
  }
  return p;
}

function draw(c: HTMLCanvasElement, o: AvatarTagOpts, im: HTMLImageElement | null) {
  const g = c.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, W, H);
  const cx = W / 2;
  const cy = 112;
  const r = 92;
  // Ring: hard black outline, team colour band, white inner hairline (DR kit).
  g.beginPath();
  g.arc(cx, cy, r + 14, 0, Math.PI * 2);
  g.fillStyle = '#000';
  g.fill();
  g.beginPath();
  g.arc(cx, cy, r + 10, 0, Math.PI * 2);
  g.fillStyle = o.ring;
  g.fill();
  g.beginPath();
  g.arc(cx, cy, r + 2, 0, Math.PI * 2);
  g.fillStyle = '#f4efe2';
  g.fill();
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = '#111';
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
  if (im) g.drawImage(im, cx - r, cy - r, r * 2, r * 2);
  else {
    g.fillStyle = o.ring;
    g.font = 'bold 110px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText((o.handle ?? o.name).slice(0, 1).toUpperCase() || '?', cx, cy + 6);
  }
  g.restore();
  // Name plate.
  const label = o.handle ? `@${o.handle}` : o.name.slice(0, 16);
  g.font = 'bold 34px monospace';
  const tw = Math.min(W - 8, g.measureText(label).width + (o.verified ? 44 : 0) + 24);
  const py = 236;
  g.fillStyle = '#000';
  g.fillRect(cx - tw / 2 - 3, py - 3, tw + 6, 56);
  g.fillStyle = o.ring;
  g.fillRect(cx - tw / 2, py, 8, 50);
  g.fillStyle = 'rgba(10,10,15,0.92)';
  g.fillRect(cx - tw / 2 + 8, py, tw - 8, 50);
  g.fillStyle = '#fff';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  const tx = cx - tw / 2 + 16;
  g.fillText(label, tx, py + 26, W - 60);
  if (o.verified) {
    const vx = Math.min(tx + g.measureText(label).width + 22, W - 24);
    g.beginPath();
    g.arc(vx, py + 25, 15, 0, Math.PI * 2);
    g.fillStyle = '#1d9bf0';
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(vx - 7, py + 25);
    g.lineTo(vx - 2, py + 31);
    g.lineTo(vx + 8, py + 18);
    g.stroke();
  }
}

/** A sprite showing a player's avatar + handle. `height` is the world height at distance 0 (see fitAvatarTag). */
export function makeAvatarTag(o: AvatarTagOpts, height = 0.9): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  draw(c, o, null);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false });
  const s = new THREE.Sprite(mat);
  s.center.set(0.5, 0);
  s.renderOrder = 10;
  s.userData.avatarTag = { base: height, key: tagKey(o) };
  s.scale.set((height * W) / H, height, 1);
  if (o.handle) {
    const h = o.handle;
    void loadImg(avatarUrl(h))
      .then((im) => im ?? loadImg(identiconUrl(h)))
      .then((im) => {
        if (!im || !s.parent) return;
        draw(c, o, im);
        tex.needsUpdate = true;
        // Dev/test hook: which avatars are on screen as billboards.
        if (process.env.NODE_ENV !== 'production') ((window as unknown as { __avatarTags?: string[] }).__avatarTags ??= []).push(`${h}${o.verified ? '+v' : ''}`);
      });
  }
  return s;
}

export const tagKey = (o: AvatarTagOpts) => `${o.handle ?? ''}|${o.name}|${o.ring}|${o.verified ? 1 : 0}`;

export function disposeAvatarTag(s: THREE.Sprite) {
  s.removeFromParent();
  s.material.map?.dispose();
  s.material.dispose();
}

const tmp = new THREE.Vector3();
/** Per frame: scale with distance so it stays readable (min..max world height). */
export function fitAvatarTag(s: THREE.Sprite, camera: THREE.Camera, k = 0.045, max = 4) {
  const base = (s.userData.avatarTag?.base as number) ?? 0.9;
  const d = s.getWorldPosition(tmp).distanceTo(camera.position);
  const h = Math.min(max, Math.max(base, d * k));
  s.scale.set((h * W) / H, h, 1);
}
