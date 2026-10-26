import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startPlay } from './startPlay';

test('existing ammo: pays the play, opens the game and logs "playing"', async () => {
  const marks: string[] = [];
  let opened = '';
  const tx = await startPlay({ pay: async () => 'abcdef123456', open: (t) => (opened = t), mark: (s) => marks.push(s) });
  assert.equal(tx, 'abcdef123456');
  assert.equal(opened, 'abcdef123456');
  assert.equal(marks.at(-1), 'playing');
});

test('a hung play payment times out with a clear error instead of hanging forever', async () => {
  const marks: string[] = [];
  let opened = false;
  await assert.rejects(
    startPlay({ pay: () => new Promise<string>(() => undefined), open: () => (opened = true), mark: (s) => marks.push(s), timeoutMs: 30 }),
    /did not answer/,
  );
  assert.equal(opened, false);
  assert.ok(marks.some((m) => m.startsWith('start failed')));
});

test('a second press while starting does not stack another payment', async () => {
  let pays = 0;
  let release!: (v: string) => void;
  const pay = () => {
    pays++;
    return new Promise<string>((r) => (release = r));
  };
  const first = startPlay({ pay, open: () => undefined, mark: () => undefined });
  assert.equal(await startPlay({ pay, open: () => undefined, mark: () => undefined }), null);
  release('tx1');
  assert.equal(await first, 'tx1');
  assert.equal(pays, 1);
});
