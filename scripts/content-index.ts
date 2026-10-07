/** `pnpm content:index`: regenerate src/content/bracer.generated.ts from the pack folders. */
import fs from 'node:fs';
import path from 'node:path';
import { INDEX_FILE, renderIndex, ROOT } from './content-lib';

const file = path.join(ROOT, INDEX_FILE);
const next = renderIndex();
const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
if (prev !== next) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, next);
  console.log(`content: wrote ${INDEX_FILE}`);
}
