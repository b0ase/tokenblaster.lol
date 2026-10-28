import type { MetadataRoute } from 'next';

const SITE = 'https://www.tokenblaster.lol';
const GAMES = ['2048', 'bracer', 'bsvgun', 'bubbo-bubbo', 'city', 'doubleosatoshi', 'frogger', 'highway21', 'hopper', 'invaders', 'kweg', 'npg-arena', 'npg-cards', 'npg-runner', 'puzzling-potions', 'rally', 'snake', 'terrornode'];
const PAGES = [
  '/', '/arcade', '/arena', '/blast', '/leaderboard', '/multiplayer', '/tokens', '/updates', '/1satordnance',
  '/launch', '/launch/how', '/launch/new', '/launch/leaders', '/launch/rewards',
  '/arcade/terrornode/leaderboard', '/arcade/terrornode/team', '/arcade/terrornode/watch', '/llms.txt',
];

export default function sitemap(): MetadataRoute.Sitemap {
  return [...PAGES, ...GAMES.map((g) => `/arcade/${g}`)].map((p) => ({ url: `${SITE}${p}` }));
}
