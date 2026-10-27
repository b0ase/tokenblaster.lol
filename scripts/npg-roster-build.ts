/**
 * One-off asset build for the TERRORNODE character select (owner's own NPG IP, Ninja Punk Girls Ltd).
 * Reads the NPG repo's art READ ONLY (never its env files), writes small webp portraits + weapon thumbs to
 * public/npg/ and the index to src/lib/npg/npgIndex.json. Re-run: NPG_REPO=/path tsx scripts/npg-roster-build.ts
 * Needs ImageMagick (`magick`) on PATH.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.env.NPG_REPO ?? '/Volumes/2026/Projects/ninja-punk-girls-com';
const A = join(REPO, 'public/assets');
const OUT = join(process.cwd(), 'public/npg');
const STATS = ['strength', 'speed', 'skill', 'stamina', 'stealth', 'style'] as const;
type Meta = { folder_number: string; asset_number: string; item_name: string; character: string | null; team: string | null; rarity: string; stats: Record<string, number> };
const read = (dir: string) =>
  readdirSync(join(A, dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, png: f.replace(/\.json$/, '.png'), m: JSON.parse(readFileSync(join(A, dir, f), 'utf8')) as Meta }));

// back → front (higher folder numbers sit behind)
const LOOK = ['24-Rear-Hair', '23-Rear-Horns', '22-Back', '21-Body', '20-Arms', '19-Underwear', '18-Face', '17-Shorts', '16-Bra', '15-Collar', '14-Jewellery', '13-Boots', '12-Top', '11-Mask', '10-Hair', '09-Horns'];
const ROSTER = ['Aika', 'Ayumi', 'Kimiko', 'Nao', 'Kazuyo'];
const statsOf = (m: Meta) => Object.fromEntries(STATS.map((s) => [s, Number(m.stats?.[s] ?? 0)]));

mkdirSync(join(OUT, 'girls'), { recursive: true });
mkdirSync(join(OUT, 'weapons'), { recursive: true });

const weapons: unknown[] = [];
const seen = new Set<string>();
for (const [dir, hand] of [['07-Right-Weapon', 'right'], ['08-Left-Weapon', 'left']] as const) {
  for (const { png, m } of read(dir)) {
    if (!m.item_name || m.item_name === 'x') continue;
    const id = `${m.folder_number}_${m.asset_number}`;
    if (seen.has(id)) continue; // a few assets carry two JSON variants: the first wins
    seen.add(id);
    execFileSync('magick', [join(A, dir, png), '-trim', '+repage', '-resize', '112x112>', '-quality', '62', '-define', 'webp:alpha-quality=60', join(OUT, 'weapons', `${id}.webp`)]);
    const owner = m.character && m.character !== 'Universal' && m.character !== 'Erobot' ? m.character : null;
    weapons.push({ id, hand, name: m.item_name.replace(/-/g, ' '), rarity: m.rarity, owner, team: m.team ?? null, stats: statsOf(m) });
  }
}

const girls: unknown[] = [];
for (const name of ROSTER) {
  const parts: { layer: string; id: string; stats: Record<string, number> }[] = [];
  const files: string[] = [];
  for (const dir of LOOK) {
    const hit = read(dir).find((x) => x.m.character === name);
    if (!hit) continue;
    parts.push({ layer: dir, id: `${hit.m.folder_number}_${hit.m.asset_number}`, stats: statsOf(hit.m) });
    files.push(join(A, dir, hit.png));
  }
  const id = name.toLowerCase();
  const [first, ...rest] = files;
  execFileSync('magick', [first, ...rest.flatMap((f) => [f, '-composite']), '-trim', '+repage', '-resize', 'x300>', '-quality', '68', join(OUT, 'girls', `${id}.webp`)]);
  girls.push({ id, name, parts });
}
mkdirSync(join(process.cwd(), 'src/lib/npg'), { recursive: true });
writeFileSync(join(process.cwd(), 'src/lib/npg/npgIndex.json'), JSON.stringify({ girls, weapons }) + '\n');
console.log(`${girls.length} girls, ${weapons.length} weapons`);
