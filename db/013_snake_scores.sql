-- Token Snake (3D rebuild): combo multiplier (up to x8, x2 more under OVERDRIVE) and gold blasts raise the score
-- scale roughly 3-4x, so allow 3,000 + 400 per second of run (was 500 + 150). Same function as 012 with every row
-- kept; only the 'snake' row changes. If another migration after 012 also edits this function, merge the rows
-- (apply whichever is later on top of the other's rows) so neither overwrites the other.
-- NOT APPLIED: apply on the Hetzner database before shipping the rebuilt game (high runs are rejected until then).
create or replace function public.tokenblaster_score_limit(g text)
returns table (per_sec numeric, base numeric, min_secs numeric)
language sql immutable as $$
  select t.per_sec, t.base, t.min_secs from (values
    ('hopper',           400::numeric, 2000::numeric, 1::numeric),
    ('invaders',         300, 2000, 1),
    ('snake',            400, 3000, 1),
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
