# Street Heat: Verbesserungsplan und Stand

## Aktive Referenzen
- Architektur und Modulaufteilung: `docs/architecture.md`
- Inhaltlicher Ausbau (Welt, Missionen, Polizei, Progression): `docs/game-expansion-roadmap.md`
- Bedienung und Entwicklung: `README.md`

## Stand
Das Projekt ist ein modulares Three.js-Spiel (Vite, ES Modules) mit vier Bezirken, Polizei-KI auf Straßengraph, Missionen, Garage, Ruf, Audio, Controller-Unterstützung und Spielstand-Migration. Der Verbesserungsplan lief in neun Phasen, jede mit eigenem Commit auf `develop`.

| Phase | Inhalt | Stand |
| --- | --- | --- |
| 0 | Provoke/Clean-Escape prüfen, Fehler beheben | erledigt |
| 1 | Fundament: Pools, Dispose, gedrosseltes Speichern, Lichter ohne PointLights, Spatial Grid, Debug-Zähler | erledigt |
| 2 | Grafik: Composer mit Bloom, Himmel, Env-Map, Instancing, Seed-Karte, Tag/Nacht, nasse Straßen, Fahrzeuge, Effekte | erledigt, ohne Gebäude-Merge und eigenen Wasser-Shader |
| 3 | Fahrgefühl: Physikmodul, Untergründe, Sub-Steps, Trail-Braking, Kamera-Modi | erledigt, `resolveCollisions` nur teilweise ausgelagert |
| 4 | Gameplay: Straßennavigation, Sichtlinie, Missionsdaten, Modifier, Fail-State, Rennen, Ruf, Tags | erledigt, ohne Ökonomie-Playtest |
| 5 | UI/UX: Einstellungen, Pause, Onboarding, Mobile, Barrierefreiheit | erledigt |
| 6 | Audio: Mix mit Limiter, Motor, Sirenen, Effekte, Musik | erledigt |
| 7 | Controller, Rebinding, Tastatur-Rampe | erledigt |
| 8 | Code-Qualität, Tests, Doku, Save v3 | erledigt, `systems.js` ist weitgehend zerlegt (Kamera, Wetter, Tags, Rennen, Verkehr, Polizei, Missionen, Spieler ausgelagert) |

## Bewusst offen
- `systems.js` (rund 1.850 Zeilen) enthält noch Pickups, Welt-Events, Roadblocks und Gefahren, Helikopter, Props, Garage und Speichern. Weitere Auslagerungen sind optional und lohnen sich erst, wenn dort Neues entsteht.
- Gebäudekörper werden nicht per `mergeGeometries` zusammengeführt (jedes Gebäude hat ein eigenes Material).
- Preise und Run-Auszahlung (`src/economy.js`) beruhen auf Annahmen und sind nicht durchgespielt.
- Messungen der Bildrate gehören auf die Zielhardware; das Browser-Pane der Entwicklung rendert in Software.
- Das Onboarding-Flag liegt in den Einstellungen statt im Profil.

## Historie (bis 2026-05)
### Umgesetzte Erweiterungen am 2026-05-24
- AudioDirector fuer Motor, Sirene, Crash-, Pickup- und Upgrade-Feedback
- Polizei-Kollisions-Cooldown gegen sofortiges Health-Melting
- Expressroute-Missionen mit POI-Checkpoints und Minimap-Zielring
- Roadblocks ab hohem Heat inklusive Kollision, Damage und visuellen Partikeln
- Upgrade-Oekonomie ueber die Garage mit Cash-Kosten und Laufzeitboni
- Combo-Scoring fuer Pickups, Missionsboni, Drifts und knappe Polizei-Manoever
- Robustere Gebaeude-Kollisionskorrektur, wenn ein Objekt exakt im Inneren landet
- Vite-Konfiguration mit separatem Three.js-Chunk

### Umgesetzte Erweiterungen am 2026-05-25
- Persistentes Profil mit Bankgeld, Bestscore, freigeschalteten Autos und Upgrade-Stufen
- Hauptmenue, Garage-Drawer, Auto-Freischaltung und gezielter Upgrade-Kauf
- Neue Missionsarten: Jagdfieber mit Close-Calls und Heist Run mit Beutetransport
- Heat-Tiers mit staerkerem Risiko/Belohnungs-Multiplikator und Polizeitaktiken
- Polizei-Rollen fuer Chase, Flank und Intercept sowie schwere Einheiten bei hohem Heat
- Spike-Strips als zusaetzliche Gefahren bei hohem Heat
- Bezirke mit eigener Markierung und HUD-Anzeige
- Dynamische Welt-Events wie Cash Drop, Teilelager und Geldtransporter
- Wetterwechsel zwischen Klar, Regen und Nebel inklusive Grip- und Sicht-Effekt
- Zerstoerbare Stadt-Props mit Score-Reward
- Drift-Score, Debug-Overlay und Logic-Smoke-Test fuer Config/Save/State

### Weitere Erweiterungen am 2026-05-25
- Persistent gespeicherte Achievements mit Cash-Boni und Lifetime-Statistiken
- Run-Contracts als wechselnde Bonusziele mit eigener HUD- und Menueanzeige
- EMP-Pickup zum kurzzeitigen Unterdruecken von Polizei, Spikes und Helikopterdruck
- High-Heat-Helikopter mit Suchlichtdruck bei Heat 5
- Garage zeigt Achievements zusaetzlich zu Fuhrpark und Upgrades
- Logic-Smoke-Test prueft nun auch Contracts, Achievements und EMP-Konfiguration

### Weitere Erweiterungen am 2026-05-26
- Bezirksgebundene Missionsketten mit rotierenden 3er-Boegen fuer Downtown, Industrie, Park und Hafenzone
- Missionen haben jetzt thematische Bonusziele wie Tempo, saubere Fahrt, Shortcut-Nutzung, hohes Heat-Finish oder garagefreien Abschluss
- Bezirks-Pickup-Missionen markieren ihre Zielzone und seed-en passende Pickups im relevanten Stadtteil
- Missions-HUD zeigt Bonusziel, Fortschritt und klarere Auftragstitel direkt im Run
- Hot-Drop-Abgaben erlauben jetzt Risk-Reward-Entscheidungen: direkt kassieren oder weiterziehen fuer hoeheren Multiplikator bei steigendem Heat
- Boss-Auftraege tauchen alle paar Runs als Sondermissionen auf: gepanzerter Transporter, Helikopterjagd und Hafenblockade
- Polizeirollen sind jetzt klarer getrennt: Patrol Cruiser verfolgen direkt, SUVs rammen aggressiver, Bikes sind schnell aber fragil, Vans setzen mobile Sperren
- Scanner-Zonen in Downtown, Industrie und Hafenzone treiben Heat schneller hoch und erscheinen auf der Minimap
- Taktische Roadblocks orientieren sich an Fluchtachsen, Kreuzungen und Missionszielen statt nur zufaellig zu spawnen
- Konterplay wurde ausgebaut: Deckung in Gassen und unter Hafenkraenen drueckt Helikopterdruck, durchbrochene Zaeune stoeren die Polizei-Sichtlinie kurzzeitig

## Test- und Abnahmekriterien
- `npm test` und `npm run build` laufen ohne Fehler.
- Ein Run pro Bezirk bei Tag, Nacht und Regen, Heat 0 bis 5 mit Flucht, Mission, Boss, Rennen, Garage-Kauf, Reload (Spielstand bleibt), Mobile-Viewport.
- F3-Panel: FPS, Draw Calls und Speicherzähler bleiben über einen längeren Lauf stabil.
- Menüs sind per Tastatur, Maus, Touch und Controller bedienbar, Einstellungen bleiben nach dem Reload erhalten.
