# STORMFALL — a 3D Battle Royale in your browser

A complete, single-page 3D battle royale built with **Three.js** (WebGL). Up to 60
players — you against a lobby of AI bots — fight on a procedurally generated island
while a storm closes in. Last one standing wins.

No build step, no backend, no game engine. Just open it in a browser.

## Run it

ES modules must be served over HTTP (opening `index.html` via `file://` is blocked by
the browser). From this folder, start any static server:

```bash
python3 -m http.server 8099
# then open http://localhost:8099/index.html
```

or

```bash
npx serve .
```

Three.js is loaded from a CDN via an import map, so you need an internet connection the
first time (the browser will cache it).

## Controls

| Input | Action |
|------|--------|
| `W A S D` | Move |
| Mouse | Aim |
| `LMB` | Fire |
| `RMB` | Aim down sights / scope |
| `Shift` | Sprint (uses stamina) |
| `Space` | Jump / vault over low ledges |
| `C` / `Ctrl` | Crouch (tap while sprinting to slide) |
| `G` | Throw a frag grenade |
| `Tab` | Toggle backpack / inventory |
| `V` | Toggle first / third-person camera |
| `1 2 3` | Switch weapon slot |
| `R` | Reload |
| `F` | Pick up nearby loot |
| `H` | Use a medkit (channel heal) |
| `Esc` | Pause |

## Features

- **Real movement:** gravity, acceleration, jumping with coyote-time and jump buffering,
  auto step-up over low ledges, a **vault** (`Space` at a low wall), **crouch-slide**
  (`C` while sprinting), crouching, sprint with stamina and FOV push, fall damage, and a
  parachute deploy-drop at the start of each match. Optional **third-person** camera (`V`)
  with spring-arm wall collision.
- **Ballistics & gunplay:** 8 weapons (pistol, Vector SMG, UMP45, M416, shotgun, SLR DMR,
  KAR98K sniper, M249 LMG) with distinct damage, fire rate, spread, recoil, magazine sizes
  and ammo types. Hitscan shots with visible tracers and simulated bullet drop, muzzle
  flash, impact sparks, bullet-hole decals, blood, decals, and headshot multipliers.
  Recoil kicks your aim with a per-weapon climb and horizontal drift pattern; ADS
  narrows FOV and — on scoped weapons — overlays a scope. Incoming fire punches your aim.
- **Throwables:** arc-physics frag grenades with bounce, falloff explosion damage and
  line-of-sight checks against players and bots.
- **Attachments:** extended magazines (more rounds per mag) and compensators (less recoil)
  are lootable and shown in the backpack.
- **Loot system:** weapons, ammo, armor, medkits, grenades and attachments spawn inside
  buildings and across the map as grounded pickups with floating labels. Weapons shine a
  **rarity-colored light pillar** (gray → blue → purple → gold by power tier) so good loot
  reads at a distance.
- **AI opponents (up to 59):** a state machine (`rotate` / `loot` / `engage` / `push` /
  `cover`) that roams, **loots and upgrades its weapon**, detects enemies with line-of-sight,
  strafes to maintain ideal engagement range, throws the occasional grenade, fires in
  bursts, reloads, **takes cover and heals when hurt**, flees the storm, and reacts with a
  skill-scaled reaction time and aim error that shrinks the longer it tracks you. Deaths
  play a **real physics ragdoll**. They fight each other too, so the lobby thins out.
- **WASM physics (Rapier):** a rigid-body world is built to match the level, and deaths
  spawn true **ragdolls** (jointed limbs that topple and settle), grenades fire a shockwave
  that tosses bodies and debris, and explosions scatter **dynamic chunks**. Loaded lazily
  from a CDN; if it's unavailable the game falls back to the scripted collapse.
- **Atmosphere:** image-based lighting plus a warm directional sun with soft shadows and
  ACES tone mapping. Every match rolls a **day or dusk** lighting mood (sky, sun, haze and
  exposure all shift). World-scale procedural textures — weathered plaster, ribbed shipping
  containers, roof tiles, brushed metal, burlap sandbags — plus a procedural sky with
  drifting clouds and a sun disc, exponential haze, three lakes, detailed wrecked cars,
  crate/container/car/sandbag cover, windowed buildings and roads.
- **The storm:** a multi-phase shrinking safe zone with a visible purple wall, a
  next-zone marker, escalating damage per phase, and distance-based storm audio.
- **Real animated soldiers:** both your third-person body and every bot use a **skinned,
  skeletal soldier** (Mixamo rig) with real idle/walk/run clips driven by an animation mixer.
  While engaged they **raise the weapon into a shouldered aiming pose** (two-bone IK on the
  arms, blended over the animation) and the held weapon follows the right hand and stays
  aimed forward. Bots spawn with varied uniform tints so the lobby doesn't look cloned.
  If the model can't load, the game falls back to a fully procedural
  articulated humanoid rig (head, helmet, vest with mag pouches, shoulder/knee pads,
  backpack) with animated walk/run/idle/aim/death poses. First-person weapon bob/sway, ADS
  transitions, reload animations and recoil kick.
- **HUD:** health/armor/stamina bars, live ammo + weapon name, medkit/grenade counts,
  a Tab backpack panel, scope overlay, a top **compass bar**, floating **damage numbers**,
  kill feed, alive counter, zone timer, rotating minimap with next-zone ring and radar
  contacts, directional damage indicators, hit markers, a cinematic vignette, and pickup
  toasts.
- **Procedural audio:** every sound (gunshots per weapon class, explosions, throws,
  impacts, footsteps, reload clicks, hit markers, pickups, kills, storm rumble) is
  synthesized with the Web Audio API — no audio files.
- **Menu / meta:** deploy screen with Solo/Duo/Squad mode cards, how-to-play, settings
  (audio, shadows, bot count), pause, win/lose screen with kills, damage, survival time and
  placement, and instant rematch.

## Project layout

```
index.html         # shell + HUD markup + import map
css/style.css      # all HUD / menu styling
js/main.js         # bootstrap, menus, match lifecycle
js/game.js         # engine wiring, main loop, raycasts, match rules
js/world.js        # procedural island: terrain, buildings, warehouses, trees, colliders
js/character.js    # articulated humanoid rig (shared by player body + bots)
js/physics.js      # WASM (Rapier) ragdolls, debris, explosion impulses
js/player.js       # first/third-person controller, weapons, movement, throwables
js/bots.js         # AI opponents (loot/cover/engage) + animation
js/weapons.js      # weapon stats + first-person models
js/throwables.js   # frag grenades: physics, bounce, explosion damage
js/loot.js         # loot spawning, labels, pickup
js/zone.js         # shrinking storm state machine + visuals
js/effects.js      # tracers, impacts, decals, blood, smoke, dust, explosions (pooled)
js/audio.js        # procedural Web Audio engine
js/hud.js          # DOM HUD updates + minimap renderer
js/utils.js        # math helpers
```

## Notes

- Runs best on a desktop GPU. Lower the **Bots** slider if you have an integrated GPU;
  shadows cost the most, so turn them off for maximum frame rate.
- Everything is client-side and offline-capable once cached; there is no multiplayer
  server (the "players" are bots).
