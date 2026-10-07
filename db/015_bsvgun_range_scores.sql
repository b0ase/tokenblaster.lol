-- BSVGun RANGE board ('bsvgun-range'), added on top of the live function (every other row kept).
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
-- BSVGun Range ('bsvgun-range'): 75-second rounds on the 3D shooting range, scored by clay/duck/token kills with a
-- verification uses SCORE_GAMES['bsvgun-range'].tag. Apply on the Hetzner database before shipping the game
-- (scores for 'bsvgun-range' are rejected until then).
    ('bsvgun-range',     800, 8000, 60)
  ) as t(game, per_sec, base, min_secs) where t.game = g;
$function$


;
