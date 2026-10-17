// TOKENBLASTER.LOL block banner for the CLI: red letters with a dark drop shadow on black.
const G: Record<string, string[]> = {
  T: ['█████', '  █  ', '  █  ', '  █  ', '  █  '],
  O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
  K: ['█   █', '█  █ ', '███  ', '█  █ ', '█   █'],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
  N: ['█   █', '██  █', '█ █ █', '█  ██', '█   █'],
  B: ['████ ', '█   █', '████ ', '█   █', '████ '],
  L: ['█    ', '█    ', '█    ', '█    ', '█████'],
  A: [' ███ ', '█   █', '█████', '█   █', '█   █'],
  S: [' ████', '█    ', ' ███ ', '    █', '████ '],
  R: ['████ ', '█   █', '████ ', '█  █ ', '█   █'],
  '.': ['  ', '  ', '  ', '  ', '██'],
};

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const RED = '\x1b[38;5;196m', DARK = '\x1b[38;5;52m', DIM = '\x1b[38;5;240m', BG = '\x1b[48;5;16m', RESET = '\x1b[0m';
export const red = (s: string) => (color ? `${RED}${s}${RESET}` : s);
export const dim = (s: string) => (color ? `${DIM}${s}${RESET}` : s);

function rows(text: string): string[] {
  const out = ['', '', '', '', ''];
  for (const ch of text) for (let r = 0; r < 5; r++) out[r] += (G[ch] ?? ['   ', '   ', '   ', '   ', '   '])[r] + ' ';
  return out;
}

/** Big block text with a one-cell drop shadow (shadow drawn where the letter isn't, offset down-right). */
function shadowed(text: string): string[] {
  const r = rows(text);
  const w = r[0].length + 1;
  const grid = [...r.map((l) => l.padEnd(w)), ' '.repeat(w)];
  return grid.map((line, y) =>
    [...line]
      .map((c, x) => {
        if (c === '█') return color ? `${RED}█` : '█';
        const s = y > 0 && x > 0 && grid[y - 1][x - 1] === '█';
        return s ? (color ? `${DARK}▓` : '░') : ' ';
      })
      .join(''),
  );
}

export function banner(subtitle = 'chain blaster · BSV'): void {
  const narrow = (process.stdout.columns || 120) < 96;
  const lines = narrow ? [...shadowed('TOKEN'), ...shadowed('BLASTER.LOL')] : shadowed('TOKENBLASTER.LOL');
  const width = Math.max(...lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').length)) + 4;
  const pad = (l: string) => {
    const vis = l.replace(/\x1b\[[0-9;]*m/g, '').length;
    return (color ? BG : '') + '  ' + l + ' '.repeat(Math.max(0, width - vis - 2)) + (color ? RESET : '');
  };
  const blank = (color ? BG : '') + ' '.repeat(width) + (color ? RESET : '');
  console.log([blank, ...lines.map(pad), blank].join('\n'));
  console.log(red('  ▶ ') + dim(subtitle) + '\n');
}
