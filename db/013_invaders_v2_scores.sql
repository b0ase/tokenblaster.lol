-- Mempool Invaders v2 ('invaders'): combo multipliers up to x8, boss waves and LIVE token-blasting runs score much
-- higher than the old single-multiplier game (a good chain is about 2,000 points a minute; a boss is 1,500 plus kills).
-- Same function as 012 (every existing row kept) with the 'invaders' row raised from (300/s, base 2,000) to
-- (800/s, base 10,000). NOT APPLIED: run it on the Hetzner database before shipping v2, or high scores past
-- 300 points a second + 2,000 are rejected as implausible.
create or replace function public.tokenblaster_score_limit(g text)
returns table (per_sec numeric, base numeric, min_secs numeric)
language sql immutable as $$
  select t.per_sec, t.base, t.min_secs from (values
    ('hopper',           400::numeric, 2000::numeric, 1::numeric),
    ('invaders',         800, 10000, 1),
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
    ('sats2048',         300, 3000, 5),
    ('highway21',        250, 1500, 30),
    ('bubbo',            200, 5000, 3),
    ('potions',          500, 5000, 20),
    ('bracer-canyon',    60, 5000, 45),
    ('bracer-spiral',    60, 5000, 45),
    ('bracer-void',      60, 5000, 45),
    ('bracer-canyon-hc', 60, 5000, 45),
    ('bracer-spiral-hc', 60, 5000, 45),
    ('bracer-void-hc',   60, 5000, 45)
  ) as t(game, per_sec, base, min_secs) where t.game = g;
$$;
