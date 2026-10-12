/** Playable NPG characters: the chibi doll plus the Tripo girls and Erobots on its rig (public/npg/cards/<slug>.glb). */
export const NPG_GIRLS: { slug: string; name: string; team: 'NPG' | 'Erobot' }[] = [
  { slug: 'doll', name: 'Chibi (original)', team: 'NPG' },
  { slug: 'phi-phi', name: 'Phi-Phi', team: 'Erobot' },
  { slug: 'hikaru', name: 'Hikaru', team: 'Erobot' },
  { slug: 'joy', name: 'Joy', team: 'Erobot' },
  { slug: 'yamarashii', name: 'Yamarashii', team: 'Erobot' },
  { slug: 'miyuki', name: 'Miyuki', team: 'Erobot' },
  { slug: 'payne', name: 'Payne', team: 'Erobot' },
  { slug: 'peggy', name: 'Peggy', team: 'Erobot' },
  { slug: 'scarlet', name: 'Scarlet', team: 'Erobot' },
  { slug: 'matoko', name: 'Matoko', team: 'Erobot' },
  { slug: 'ayumi', name: 'Ayumi', team: 'NPG' },
  { slug: 'kimiko', name: 'Kimiko', team: 'NPG' },
  { slug: 'kazuyo', name: 'Kazuyo', team: 'NPG' },
  { slug: 'nao', name: 'Nao', team: 'NPG' },
  { slug: 'aika', name: 'Aika', team: 'NPG' },
  { slug: 'doctor', name: 'Doctor', team: 'NPG' },
  { slug: 'bot', name: 'Bot', team: 'Erobot' },
  { slug: 'tech', name: 'Tech', team: 'Erobot' },
  { slug: 'graf-bot', name: 'Graf-Bot', team: 'Erobot' },
  { slug: 'frog-bot', name: 'Frog-Bot', team: 'Erobot' },
  { slug: 'stripey-bot', name: 'Stripey-Bot', team: 'Erobot' },
];
export const GIRL_KEY = 'tokenblaster:npg-girl';
export const girlUrl = (slug: string) => (slug === 'doll' ? '/arena/models/npg/stack/chibi_base.glb' : `/npg/cards/${slug}.glb`);
