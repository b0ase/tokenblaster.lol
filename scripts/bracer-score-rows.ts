/**
 * `pnpm content:score-rows`: print the score-limit SQL rows a maintainer must add to
 * public.tokenblaster_score_limit (see db/015_bsvgun_range_scores.sql) for bRacer tracks that have none yet.
 * Prints only; it never touches a database. Board ids are bracer-<slug> and bracer-<slug>-hc.
 */
import fs from 'node:fs';
import path from 'node:path';
import { listPacks, ROOT } from './content-lib';

const sql = fs
  .readdirSync(path.join(ROOT, 'db'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(path.join(ROOT, 'db', f), 'utf8'))
  .join('\n');
const missing = listPacks()
  .tracks.flatMap((s) => [`bracer-${s}`, `bracer-${s}-hc`])
  .filter((g) => !sql.includes(`'${g}'`));
if (!missing.length) {
  console.log('Every bRacer track already has score-limit rows in db/.');
} else {
  console.log('-- Add these rows inside the VALUES list of public.tokenblaster_score_limit (copy the latest');
  console.log('-- db/0NN_*.sql that redefines it into a new numbered migration, append the rows, apply on Hetzner).');
  console.log('-- Same limits as the launch circuits: 60 points/sec, 5000 base, 45 s minimum race.');
  for (const g of missing) console.log(`    (${`'${g}',`.padEnd(30)} 60, 5000, 45),`);
}
