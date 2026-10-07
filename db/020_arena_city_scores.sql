-- Score boards for Arena ('arena': kills in one life) and Satoshi City ('city': score for a visit), so every cabinet in the
-- hall of fame has a champion. NOT APPLIED. This is db/018's function with two rows added: if the live function has moved on
-- since (another board added), re-copy THAT function and add only the two rows marked NEW. Scores for 'arena' / 'city' are
-- rejected until this is applied. The LIVE verification tags are SCORE_GAMES['arena'].tag = 'arena' and ['city'].tag = 'city'.
--
-- Arena: score = kills in a single life, secs = length of that life (3 kills a second + 10 is generous for a minigun).
-- City:  score = points from stolen cars, deliveries and rush checkpoints; secs = time since entering the city.
create or replace function public.tokenblaster_score_limit(g text)
 RETURNS TABLE(per_sec numeric, base numeric, min_secs numeric)
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select t.per_sec, t.base, t.min_secs from (values
    ('hopper',           400::numeric, 2000::numeric, 1::numeric),
    ('invaders',         800, 10000, 1),
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
    ('bracer-void-hc',   60, 5000, 45),
    ('bsvgun-range',     800, 8000, 60),
    ('bracer-mempool-loop',    60, 5000, 45),
    ('bracer-mempool-loop-hc', 60, 5000, 45),
    ('bsvgun-versus',   800, 8000, 60),
    -- NEW
    ('arena',            3, 10, 10),
    -- NEW
    ('city',             120, 3000, 30)
  ) as t(game, per_sec, base, min_secs) where t.game = g;
$function$;
