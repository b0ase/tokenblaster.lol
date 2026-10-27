import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { brandCase, brandParts } from './brandCase';
import { LEVELS } from './terrornode/levels';

test('brandCase uppercases everything except nSLAVE', () => {
  assert.equal(brandCase('nSLAVE market'), 'nSLAVE MARKET');
  assert.equal(brandCase('the Nslave tower and NSLAVE hq'), 'THE nSLAVE TOWER AND nSLAVE HQ');
  assert.deepEqual(brandParts('into nSLAVE.'), ['into ', 'nSLAVE', '.']);
});

test('level names keep nSLAVE casing', () => {
  for (const l of Object.values(LEVELS) as { name: string }[]) assert.ok(!brandCase(l.name).includes('NSLAVE'), l.name);
});

// Any user-facing "NSLAVE" (all caps) in source text is wrong. Identifiers like NSLAVE_SLOGANS are fine.
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|md|json)$/.test(f) && !f.endsWith('brandCase.test.ts')) out.push(p);
  }
  return out;
}

test('no NSLAVE (capital N) in user-facing text', () => {
  const bad: string[] = [];
  for (const f of walk(join(process.cwd(), 'src'))) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/NSLAVE(?![_A-Za-z0-9])/.test(line.replace(/\bNSLAVE_\w+/g, ''))) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});
