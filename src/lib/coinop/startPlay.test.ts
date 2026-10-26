import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { _resetStartPlay, startPlay } from './startPlay';

beforeEach(() => _resetStartPlay());

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

test('a timeout cancels the pending play payment: an aborted pay never charges, and START works again after', async () => {
  let sawAbort = false;
  let credited = '';
  const pay = (signal: AbortSignal) =>
    new Promise<string>((_, no) => signal.addEventListener('abort', () => ((sawAbort = true), no(new Error('START_ABORTED')))));
  await assert.rejects(startPlay({ pay, open: () => undefined, credit: (t) => (credited = t), mark: () => undefined, timeoutMs: 20 }), /did not answer/);
  assert.equal(sawAbort, true);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(credited, '');
  assert.equal(await startPlay({ pay: async () => 'tx2', open: () => undefined, mark: () => undefined }), 'tx2');
});

test('a play payment that lands after the timeout is credited, and START never charges again meanwhile', async () => {
  let release!: (v: string) => void;
  let pays = 0;
  const credited: string[] = [];
  const pay = () => (pays++, new Promise<string>((r) => (release = r)));
  const d = { pay, open: () => undefined, credit: (t: string) => void credited.push(t), mark: () => undefined, timeoutMs: 20 };
  await assert.rejects(startPlay(d), /did not answer/);
  await assert.rejects(startPlay(d), /still finishing/);
  assert.equal(pays, 1, 'no second payment while the first may still land');
  release('late-tx');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(credited, ['late-tx']);
  assert.equal(await startPlay({ ...d, pay: async () => 'tx3' }), 'tx3');
});
