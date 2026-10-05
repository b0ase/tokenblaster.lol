-- Add Ninja Punk Girls: Card Battle ('npgcards') to the per-game score plausibility table.
-- Same function as 004 (keeps the 'npg' row), plus 'npgcards'. Score = AI wins in a row; a match
-- takes well over 20s, so allow 1 win per 20s of play (+1 head start), min 20s.
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
    ('npg',              300, 6000, 5),
    ('npgcards',         0.05, 1, 20)
  ) as t(game, per_sec, base, min_secs) where t.game = g;
$$;
