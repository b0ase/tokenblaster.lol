-- Add Ninja Punk Girls: Erobot Uprising ('npg') to the per-game score plausibility table.
-- Same function as 002, plus the 'npg' row. Points: coins 10, Erobots 50, tokens 100, boss hits 25,
-- bosses 1000, stage clear 500 + up to 900 time bonus + 100/heart (×3 stages).
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
    ('npg',              300, 6000, 5)
  ) as t(game, per_sec, base, min_secs) where t.game = g;
$$;
