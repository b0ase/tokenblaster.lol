-- bRacer circuits ('bracer-canyon', 'bracer-spiral', 'bracer-void') in the per-game score plausibility table.
-- Same function as 009 (every existing row kept), plus the three circuits. A race is 3 laps (about 100s at
-- best) and tops out near 9,500 points (time + place + cells + clean + combat; a time trial doubles the time
-- part), so allow 5,000 + 60 per second of run, min 45s.
-- Apply on the Hetzner database before shipping the game (scores for these games are rejected until then).
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
    ('bracer-canyon',    60, 5000, 45),
    ('bracer-spiral',    60, 5000, 45),
    ('bracer-void',      60, 5000, 45)
  ) as t(game, per_sec, base, min_secs) where t.game = g;
$$;
