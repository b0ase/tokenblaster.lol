-- Coin Pop (Bubbo Bubbo, game id 'bubbo') and Token Potions (Puzzling Potions, id 'potions') in the per-game
-- score plausibility table. Same function as 009 (every existing row kept) plus the two games.
-- Both are PixiJS open games run in an iframe; the page posts the score. The limits are generous GUESSES
-- (the games' scoring scales were not measured): allow base + per_sec * seconds of play.
--   bubbo:   at most ~200 points a second on top of 5,000, min 3s
--   potions: a 60s Normal-mode round, 5,000 + 500 per second, min 20s
-- NOT APPLIED. Apply on the Hetzner database before shipping the games (scores for them are rejected until then),
-- and tighten the numbers after a few real runs.
create or replace function public.tokenblaster_score_limit(g text)
returns table (per_sec numeric, base numeric, min_secs numeric)
language sql immutable as $$
  select t.per_sec, t.base, t.min_secs from (values
    ('hopper',           400::numeric, 2000::numeric, 1::numeric),
    ('invaders',         300, 2000, 1),
    ('snake',            150, 500, 1),
    ('kweg',             400, 2000, 1),
    ('frogger',          0.5, 3, 2),
    ('doubleo-facility', 3, 10, 10),
    ('doubleo-tower',    3, 10, 10),
    ('doubleo-vault',    3, 10, 10),
    ('doubleo-farm',     3, 10, 10),
    ('doubleo-yacht',    3, 10, 10),
    ('npg',              300, 6000, 5),
    ('npgcards',         0.05, 1, 20),
    ('rally-forest',     60, 5000, 30),
    ('rally-desert',     60, 5000, 30),
    ('rally-snow',       60, 5000, 30),
    ('bubbo',            200, 5000, 3),
    ('potions',          500, 5000, 20)
  ) as t(game, per_sec, base, min_secs) where t.game = g;
$$;
