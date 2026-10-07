/** `pnpm content:check`: validate every content pack (schema, licence, files, sizes, no URLs, track builds). */
import { checkAll } from './content-lib';

const { errors, summary } = checkAll();
for (const s of summary) console.log(`  ok  ${s}`);
if (errors.length) {
  console.error(`\ncontent:check found ${errors.length} problem${errors.length === 1 ? '' : 's'}:`);
  for (const e of errors) console.error(`  x  ${e}`);
  console.error('\nSee CONTRIBUTING.md for the pack format and limits.');
  process.exit(1);
}
console.log(`\ncontent:check passed (${summary.length} packs).`);
