# Late-game replayability: analysis and small-change ideas

The web build is faithful to xgalaga-hyperspace 2.1.1.0, which ramps
difficulty with **no ceiling** on several axes. By levels 45–60 the
simultaneous pressures stack past what is reliably dodgeable, which is
why games usually end around level 60.

## Why it becomes near-impossible (measured from the code)

Per `init_aliens()` (main.c) and the fire logic in `do_enter()`/`do_aliens()`:

| Lever | Formula | Level 15 | Level 45 | Level 60 |
|---|---|---|---|---|
| Simultaneous attackers | `min(30, 1 + level*2)` | 30 (capped) | 30 | 30 |
| Max enemy torps alive | `10 + level*5` (no cap) | 85 | 235 | 310 |
| Enemy torp fire rate | `1/(2*tc)` per attacker/tick, `tc = max(35, 60 - level/2 - 5*weapon)` | ~17/s (single-shot player) | ~24/s | ~26/s |
| Enemy torp speed | `4 + level/5 - |xs|` px/tick @ 60 Hz | 5.5–7 (330–420 px/s) | 11.5–13 (690–780 px/s) | 14.5–16 (**870–960 px/s**) |
Two numbers do most of the damage at level 60:

1. **Enemy torp speed reaches 960 px/s** — a torp fired from the top of
   the 582 px playfield arrives in ~0.6 s, and one fired from screen
   height arrives in ~0.3 s. Human reaction + ship turn (~0.2–0.4 s at
   90–240 px/s) is no longer enough; hits become a coin flip.
2. **Up to 310 torps alive** from 30 attackers firing ~26/s — dense
   vertical streams with no gaps to thread.

Meanwhile the *player's* firepower only shrinks: every death costs a
torp and a lemon resets you to the floor, so a level-50 player is
shooting 3–5 torps into a 26 torps/s rain. Difficulty rises in six
axes; the player's side of the equation falls.

## Idea 1 (implemented): per-15-level MINTORPS floor

Every 15 levels (the level cycle), the per-weapon minimum rises:

| Weapon | 1–15 | 16–30 | 31–45 | 46–60 | 61–75 |
|---|---|---|---|---|---|
| SINGLE | 3 | 5 | 7 | 9 | 11 |
| DOUBLE | 4 | 6 | 8 | 10 | 12 |
| TRIPLE | 6 | 9 | 12 | 15 | 15 (cap) |
| SPREAD | 5 | 7 | 9 | 11 | 13 |
| MACHINE | 3 | 5 | 7 | 9 | 11 |

(`weapon_mintorps()` in data.c; applied at game start, on death, on
lemon, and on weapon-prize pickup. `MAXTORPS` raised 10 → 15 so the
scaled floors fit.)

Difficulty still ramps through enemies; this only stops the player's
firepower from falling off a cliff as levels stack. The floor keeps
climbing (capped at `MAXTORPS`), so it stays relevant past level 75.

## Ideas 2–10 (proposed, not implemented)

Each is a one- or two-line change. Ordered roughly by impact-per-line
for the 45–90 level range.

### 2. Cap enemy torp speed
`ys = (ETORPSPEED + level/5) - ABS(xs)` appears in `do_enter()` and
`do_aliens()`. Cap the `level/5` term at `+6` (max 10 px/tick = 600 px/s):

```c
int lev = level / 5; if (lev > 6) lev = 6;
ys = (ETORPSPEED + lev) - ABS(xs);
```

The single biggest win: 960 → 600 px/s turns "unreactable" into
"hard but dodgeable". Everything else about late-game pressure can
stay. Risk: low — early levels (≤ 30) are unaffected since the cap is
out of range until level 31.

### 3. Cap `maxetorps`
`maxetorps = 10 + (level*5)` in `init_aliens()`. Cap at 40–60:

```c
if (maxetorps > 40) maxetorps = 40;
```

Reduces the bullet-hell ceiling (310 → 40 torps alive at level 60).
Pairs naturally with idea 2. Risk: low.

### 4. Soften the lemon
`PR_LEMON` in prize.c currently sets `maxtorps = floor; weapon = 0;
movespeed = MINSPEED`. At level 60 a lemon wipes a triple-9 down to
single-9. Change to a partial penalty:

```c
maxtorps -= 3;
if (maxtorps < weapon_mintorps(weapon, level))
    maxtorps = weapon_mintorps(weapon, level);
/* keep weapon and movespeed */
```

Keeps the lemon meaningful (it's still a real setback) without making
it a de-facto death sentence. Risk: low.

### 5. Per-attacker fire cooldown
Aliens currently have no minimum gap between shots (probability-gated
only). Add a per-alien cooldown, e.g. an alien fires at most once per
30 ticks (0.5 s): a new `int nextfire` field set to `counter + 30` on
fire, checked before the `random()` roll. With 30 attackers the
sustained rate caps at 60 torps/s → in practice ~10–15/s. This breaks
the synchronized "wall" feeling that pure probability produces. Risk:
low; touches the two fire sites + `struct.h`.

### 6. Slow the simultaneous-attacker ramp
`maxattacking = 1 + (level*2)` hits its 30 cap at level 15. Use
`1 + level` (cap reached at 29) or a lower cap (`min(24, ...)`). Fewer
concurrent attackers = fewer independent torp streams to dodge. Risk:
low; early levels unaffected (cap was the binding constraint anyway).

### 7. Grow the player a little each level
On level completion (the `starspeed == 1` branch in `do_aliens()`,
`init_aliens(++level)`):

```c
if (maxtorps < MAXTORPS) maxtorps++;
```

The gun improves every level, offsetting enemy growth — the classic
"the world gets harder but so do you" loop. Combined with idea 1 the
player ends level 60 with ~9–12 torps instead of fighting with 3.
Risk: low; the `MAXTORPS` cap bounds it.

### 8. Bonus ship cadence
`nextBonus` starts at 20000, then +50000 (score.c). Late-game score
rates make this rare relative to enemy lethality. Options: +40000 per
bonus instead of +50000, or +1 extra ship every third bonus. Extra
lives are pure survivability. Risk: low.

### 9. A shield to start
`STARTSHIELDS 0 → 1` (defs.h), or drop a guaranteed shield prize every
15 levels (in the level-completion branch). The shield is the main
"oh no" insurance and is currently pure RNG (1 of 10 prize types,
prizes themselves ~4% of kills). Risk: low.

### 10. Soften the metaLevel speed ramp
From level 16 the same level files replay faster: speed/steer scales
by `1 + (metaLevel - 1) * 0.5`, so level 46–60 (metaLevel 4) runs at
2.5× base speed. Halve the ramp to `0.25`: level 46–60 becomes 1.75×.
One constant, directly attacks the "levels 60–90" wall. Risk: low;
early metaLevels barely change (metaLevel 2: 1.5× → 1.25×).

## Suggested combination

For the stated goal (comfortably playable to ~level 90 without
casual play becoming easy): **1 + 2 + 3** first — together they fix
the two hard walls (torp speed, torp density) while the MINTORPS floor
keeps the player competitive. Then add **4 or 5** if the streams still
feel unfair, and **7** if the player still feels outgunned. Ideas 6, 8,
9, 10 are optional tuning on top.

None of these changes the level data or the first 15 levels' balance in
any case except where noted; each is independently revertible.
