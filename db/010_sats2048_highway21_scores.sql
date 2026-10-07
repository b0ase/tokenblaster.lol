-- Sat Stack 2048 ('sats2048') and Highway 21M ('highway21') in the per-game score plausibility table.
-- Same function as 009 (every existing row kept), plus the two games. NOT APPLIED: apply on the Hetzner
-- database before shipping (scores for these games are rejected until then). If another migration that
-- also replaces this function lands first, merge the rows; the function is replaced whole.
--   sats2048:  a very fast 2048 run earns about 300 points/s (a 16384 run is ~200k over 20+ minutes), base 3,000, min 5s.
--   highway21: distance ~100/s at top speed + 100 per overtake (a few a second at most), base 1,500, min 30s (one timer).
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
    ('sats2048',         300, 3000, 5),
    ('highway21',        250, 1500, 30)
  ) as t(game, per_sec, base, min_secs) where t.game = g;
$$;
