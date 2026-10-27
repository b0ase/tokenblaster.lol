import * as THREE from 'three';

/**
 * ONE WebGL context for every small 3D preview on a page (loadout gun cards, CHOOSE YOUR GIRL). Each preview owns a
 * plain 2D canvas; the shared renderer draws its scene off screen and the pixels are copied across with drawImage.
 * One requestAnimationFrame drives them all. When the last preview unmounts (the game starts) the context is
 * disposed and force-lost at once, so it never lingers in GPU memory waiting for garbage collection; the next
 * loadout opens a fresh one. Before this every card opened its own context and every LOADOUT opened four more.
 */
export type PreviewView = {
  /** The 2D canvas on the page. */
  canvas: HTMLCanvasElement;
  /** Render into the shared renderer (already sized to the canvas, cleared). Return false to skip this frame. */
  draw: (r: THREE.WebGLRenderer, t: number, dt: number) => boolean | void;
  /** Min ms between frames for this view (default 0 = every frame). */
  every?: number;
  last?: number;
};

let renderer: THREE.WebGLRenderer | null = null;
const views = new Set<PreviewView>();
let raf = 0;
let prev = 0;

function frame(now: number) {
  raf = requestAnimationFrame(frame);
  if (!renderer || document.hidden) return;
  const dt = Math.min(0.05, prev ? (now - prev) / 1000 : 0);
  prev = now;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const v of views) {
    if (v.every && v.last && now - v.last < v.every) continue;
    const cv = v.canvas;
    if (!cv.isConnected) continue;
    const r = cv.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
    v.last = now;
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) renderer.setSize(w, h, false);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    if (v.draw(renderer, now / 1000, dt) === false) continue;
    const ctx = cv.getContext('2d');
    if (!ctx) continue;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(renderer.domElement, 0, 0, w, h, 0, 0, w, h);
  }
}

/** Register a preview; returns the release function. Null when WebGL is unavailable. */
export function addPreview(v: PreviewView): (() => void) | null {
  if (!renderer) {
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      return null;
    }
    renderer.setPixelRatio(1); // canvases are sized in device px already
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.autoClear = false;
    prev = 0;
    raf = requestAnimationFrame(frame);
  }
  views.add(v);
  return () => {
    views.delete(v);
    if (views.size || !renderer) return;
    cancelAnimationFrame(raf);
    renderer.dispose();
    renderer.forceContextLoss();
    renderer = null;
  };
}

/** For tests / probes: how many previews and contexts are live. */
export const previewStats = () => ({ views: views.size, context: renderer ? 1 : 0 });
