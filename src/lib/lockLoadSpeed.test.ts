import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { walletAlive, type Wallet } from './wallet';

/** An asleep extension: the first isAuthenticated never answers, the next one does after 50 ms. */
const asleep = () => {
  let n = 0;
  return { name: 'mock', publicKey: '02' + '11'.repeat(32), client: { isAuthenticated: () => (n++ === 0 ? new Promise(() => undefined) : new Promise((r) => setTimeout(() => r({ authenticated: true }), 50))) } } as unknown as Wallet;
};

test('LOCK & LOAD press -> wallet prompt: the liveness check no longer waits 15 s on an asleep wallet', async () => {
  const t0 = performance.now();
  assert.equal(await walletAlive(asleep(), 4_000), true);
  const ms = performance.now() - t0;
  console.log(`[lock&load] asleep-wallet check: ${Math.round(ms)} ms (was ~15,850 ms with the old 15 s attempt)`);
  assert.ok(ms < 5_500, `${ms}`);
  const src = readFileSync(new URL('./useBlaster.ts', import.meta.url), 'utf8');
  assert.match(src, /const ALIVE_MS = 4_000/);
  assert.match(src, /warmWallet/); // warmed ahead of the press (useCabinet)
  assert.match(readFileSync(new URL('../components/coinop/useCabinet.ts', import.meta.url), 'utf8'), /warmWallet\(\)/);
});

test('TERRORNODE memory: one shared preview context, force-lost on release; no per-card WebGL renderers', () => {
  const prev = readFileSync(new URL('./previewRenderer.ts', import.meta.url), 'utf8');
  assert.match(prev, /forceContextLoss\(\)/);
  for (const f of ['../components/gallery/GunPreview.tsx', '../components/gallery/Girls3D.tsx']) {
    const s = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(s, /new THREE\.WebGLRenderer/, f);
    assert.match(s, /addPreview/, f);
  }
  // squad bodies: the rigged Tripo girls, loaded once per girl and cloned; never the chibi
  const sb = readFileSync(new URL('./galleryGame/squadBodies.ts', import.meta.url), 'utf8');
  assert.match(sb, /\/terrornode\/squad\//);
  assert.doesNotMatch(sb, /chibi/);
  assert.match(sb, /cloneSkinned/);
});
