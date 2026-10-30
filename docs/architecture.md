# Architektur

Stand nach Phase 8 des Verbesserungsplans. Alles ist Vanilla-JavaScript (ES Modules), Three.js und DOM-HUD.

## Überblick

```
main.js            verdrahtet Renderer, Welt, Runtime, Input, Settings, Audio und Menüs
 ├─ render.js      EffectComposer (Bloom, Grading, Speed-Lines), Himmel, Env-Map, Schatten-Follow, Qualitätsstufen
 ├─ world.js       Karte (seeded), Instancing, Räumliches Gitter, Wasser, Tag/Nacht-Visuals der Welt
 ├─ systems.js     Spiellogik in einer Closure: createGameRuntime(...)
 │   ├─ systems/camera.js   Folgekamera, Heat-Zoom, Shake
 │   ├─ systems/weather.js  Tag/Nacht, Wetterfarben und -licht, Blitze, Dampf
 │   ├─ systems/tags.js     Graffiti-Tags
 │   └─ systems/race.js     illegales Straßenrennen
 ├─ ui.js          HUD, Menüs, Modals, Minimap (rein lesend auf dem State)
 ├─ input.js       Tastatur, Touch-Stick, Gamepad -> logische Tasten und analoge Achsen
 ├─ audio.js       Web-Audio-Mix, Motor, Effekte, Musik-Sequencer
 └─ settings.js    Einstellungen (eigener Storage-Key)
```

Das Datenmodell lebt in `state.js` (`createInitialState`), der Spielstand in `save.js`. Alle Werte zum Balancing stehen in `config.js`.

## Reine Logikmodule

Diese Module kennen weder DOM noch Three.js und laufen in `npm test` headless:

| Modul | Inhalt |
| --- | --- |
| `physics/vehicle.js` | Motor, Lenkung, Grip, Drift-Übergang, Wandreaktion, Untergründe |
| `ai/police.js` | Straßengraph, A\*, Sichtlinie, Wegpunkte |
| `data/missions.js` | deklarative Missionen, Boss-Aufträge, Modifier, `resolveMission` |
| `scoring.js` | Combo-Multiplikator und -Timer, Heat-Abklingen |
| `economy.js` | Kapazitäten (Karosserie, Nitro), Cash pro Run, Preistabelle |
| `progression.js` | Ruf-Stufen, Graffiti-Tag-Verteilung |
| `save.js` | Format-Version, Migration, Laden mit Prüfung |
| `bindings.js`, `gamepad.js` | Tasten-Mapping, Gamepad-Lesen, Rumble-Stärke |
| `music.js`, `siren.js` | Notendaten, Ebenen je Heat, Sirenen-Muster (Synthese in `audio.js`/`siren.js`) |
| `onboarding.js`, `settings.js` | Tutorial-Schritte, Einstellungen mit Validierung |
| `util/math.js` | `clamp`, `wrapAngle`, `turnToward`, Achsen-Helfer |

## Muster für ausgelagerte Systeme

Neue Teile aus `systems.js` bekommen eine Fabrik mit einem Kontextobjekt und geben ein kleines Interface zurück:

```js
const raceSystem = createRaceSystem({ state, scene, world, audio, ...helferfunktionen });
raceSystem.update(dt);
```

Helferfunktionen (`addScore`, `setStatus`, `spawnPopup` …) sind Funktionsdeklarationen in der Runtime und stehen deshalb schon vor ihrer Textstelle zur Verfügung. Nach jedem Auslagern prüft ein Test-Run, dass nichts fehlt (Import-Check per Parser, Browser-Lauf, `npm test`).

Noch in `systems.js`: Spieler-Update, Polizei, Verkehr, Missionen, Pickups, Events, Garage und Economy-Aktionen. Sie sind die nächsten Kandidaten, in dieser Reihenfolge von der Kopplung her: Verkehr, Polizei, Missionen, Spieler.

## Fixer Takt und Reihenfolge pro Frame

1. `input.update(dt)`: Tastatur-Rampe, Gamepad lesen.
2. `runtime.update(dt, input)`: Physik in festen Schritten (1/60 s), danach Partikel, Fahrzeug-Visuals, Kamera, Audio, HUD.
3. `post.render(...)`: Composer rendert die Szene.

## Spielstand und Einstellungen

- Profil: `neon-pursuit-profile-v2` (Key bleibt), Format-`version` 3. `migrateProfile` hebt ältere Stände an, `loadProfile` begrenzt Werte und wirft unbekannte Autos weg.
- Einstellungen: `street-heat-settings`. Die Grafikstufe schreibt die Render-Pipeline zusätzlich unter `street-heat-quality`.
- Speichern ist gedrosselt (höchstens alle 2 s) und passiert zusätzlich bei Game Over, Tab-Wechsel (`visibilitychange`) und `pagehide`.

## Tests

`scripts/logic-smoke.mjs` ist ein einziges Skript ohne Framework, das mit `assert` prüft: Config-Konsistenz, Speicherformat und Migration, Fahrparcours pro Auto, Polizei-Navigation, Missionsdaten, Ruf und Tags, Settings, Onboarding, Musik- und Sirenenlogik, Bindings, Gamepad, Combo und Heat-Abklingen, Economy. Grafik, Ton und Spielgefühl sind nur im Browser prüfbar.
