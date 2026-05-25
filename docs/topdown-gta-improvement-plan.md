# Topdown GTA Improvement Plan

## Aktive Agenten-Referenz
- Laufender Detailplan fuer den inhaltlichen Ausbau: `docs/game-expansion-roadmap.md`
- Umsetzung erfolgt ab jetzt Schritt fuer Schritt entlang dieses Dokuments, beginnend mit Welt und Stadtgefuehl.

## Summary
Das Projekt ist aktuell ein spielbarer Three.js-Prototyp in einer einzelnen HTML-Datei. Ziel dieses Dokuments ist es, die technische Stabilisierung, die Modularisierung und den spaeteren Feature-Ausbau in eine klare Umsetzungsreihenfolge zu bringen.

Die Umsetzung erfolgt in drei Wellen:
- Phase 1: technische Stabilisierung und Bugfixes
- Phase 2: Strukturierung in HTML, CSS und JavaScript-Module
- Phase 3: Vorbereitung und erste Umsetzung neuer Gameplay-Systeme

## Aktueller Stand
- Ein fahrbares Player-Car mit Topdown-Kamera, Nitro, Drift und Fahrzeugwechsel
- Prozedural erzeugte Stadt mit Gebaeuden, Strassen, Baeumen, Props, POIs und Lichtern
- Polizei-Verfolgung ueber Wanted-Level, Suche/Chase-Status und Roadblocks
- Verkehr, Pickups, Score-System, Combo-Multiplikator, Health/Nitro-Bar und Game-Over-Statistiken
- Missionsloop mit Pickup-, Liefer-, Expressrouten- und Escape-Missionen
- Garage-Upgrades fuer Motor, Panzerung, Nitro und Grip
- DOM-HUD mit Minimap, Zielmarker, Touch-Steuerung, Pause und persistentem Bestscore

## Umgesetzte Erweiterungen am 2026-05-24
- AudioDirector fuer Motor, Sirene, Crash-, Pickup- und Upgrade-Feedback
- Polizei-Kollisions-Cooldown gegen sofortiges Health-Melting
- Expressroute-Missionen mit POI-Checkpoints und Minimap-Zielring
- Roadblocks ab hohem Heat inklusive Kollision, Damage und visuellen Partikeln
- Upgrade-Oekonomie ueber die Garage mit Cash-Kosten und Laufzeitboni
- Combo-Scoring fuer Pickups, Missionsboni, Drifts und knappe Polizei-Manoever
- Robustere Gebaeude-Kollisionskorrektur, wenn ein Objekt exakt im Inneren landet
- Vite-Konfiguration mit separatem Three.js-Chunk

## Umgesetzte Erweiterungen am 2026-05-25
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

## Weitere Erweiterungen am 2026-05-25
- Persistent gespeicherte Achievements mit Cash-Boni und Lifetime-Statistiken
- Run-Contracts als wechselnde Bonusziele mit eigener HUD- und Menueanzeige
- EMP-Pickup zum kurzzeitigen Unterdruecken von Polizei, Spikes und Helikopterdruck
- High-Heat-Helikopter mit Suchlichtdruck bei Heat 5
- Garage zeigt Achievements zusaetzlich zu Fuhrpark und Upgrades
- Logic-Smoke-Test prueft nun auch Contracts, Achievements und EMP-Konfiguration

## Weitere Erweiterungen am 2026-05-26
- Bezirksgebundene Missionsketten mit rotierenden 3er-Boegen fuer Downtown, Industrie, Park und Hafenzone
- Missionen haben jetzt thematische Bonusziele wie Tempo, saubere Fahrt, Shortcut-Nutzung, hohes Heat-Finish oder garagefreien Abschluss
- Bezirks-Pickup-Missionen markieren ihre Zielzone und seed-en passende Pickups im relevanten Stadtteil
- Missions-HUD zeigt Bonusziel, Fortschritt und klarere Auftragstitel direkt im Run
- Hot-Drop-Abgaben erlauben jetzt Risk-Reward-Entscheidungen: direkt kassieren oder weiterziehen fuer hoeheren Multiplikator bei steigendem Heat
- Boss-Auftraege tauchen alle paar Runs als Sondermissionen auf: gepanzerter Transporter, Helikopterjagd und Hafenblockade

## Priorisierte Problemstellen
1. Ressourcenverwaltung:
Gemeinsam genutzte Geometry- und Material-Objekte duerfen nicht beim Entfernen einzelner Instanzen disposed werden.

2. Update-Sicherheit:
`forEach()` in Kombination mit `splice()` gefaehrdet korrektes Entfernen von Polizei, Pickups und Partikeln.

3. Wartbarkeit:
HTML, CSS, Rendering, Gameplay, UI und Zustand sind aktuell in einer Datei und in globalen Variablen gebuendelt.

4. Performance:
In Hot Paths werden unnoetig viele temporaere `Vector2`- und `Vector3`-Objekte erzeugt.

5. Erweiterbarkeit:
Das Gameplay ist derzeit stark linear und bietet noch wenig Missionsstruktur, Varianz oder Langzeitmotivation.

## Ziel-Schnittstellen
- `GameState`: globaler Spielzustand, Score, Timers, Mission, Wanted, Laufstatus
- `PlayerState`: Position, Rotation, Speed, Health, Fahrzeug-Tuning
- `PoliceAgent`: Mesh, Bewegung, Rotation, State, Zielgeschwindigkeit, Stuck-Daten
- `Pickup`: Mesh, Typ, Reward-Daten, Animationsparameter
- `update(dt, state)`: gemeinsame Update-Konvention fuer Systeme
- `spawn/remove/dispose`: klare Ownership-Regeln pro Entity-Typ

## Umsetzungsphasen
### Phase 1: Stabilisierung
- Shared geometry/material handling korrigieren
- Reverse-Loops statt `forEach + splice`
- Temp-Objekte in Hot Paths reduzieren
- sichtbare Text- und Encoding-Probleme beseitigen

### Phase 2: Modularisierung
- HTML, CSS und JavaScript trennen
- JavaScript in Systeme fuer `player`, `police`, `pickups`, `particles`, `ui`, `input`, `world`, `game-state` aufteilen
- zentrale Zustandsstruktur einfuehren

### Phase 3: Feature-Ausbau vorbereiten
- Wanted-System von einer reinen Spawn-Menge auf Statuslogik erweitern
- mehrere Pickup-Typen mit unterschiedlichen Rewards einfuehren
- Missionssystem und Status-Feedback in den HUD-Loop integrieren
- Feedback durch Status-Banner und Kamera-Impact verbessern

## Test- und Abnahmekriterien
- `docs/topdown-gta-improvement-plan.md` ist die zentrale Plan-Datei im Projekt
- Pickups bleiben stabil sichtbar, auch wenn andere Pickups eingesammelt werden
- Polizei und Pickups koennen sicher innerhalb von Update-Loops entfernt werden
- Reset stellt einen sauberen Spielzustand ohne Altlasten wieder her
- HUD-Texte und Symbole haben keine offensichtlichen Encoding-Fehler mehr
- Nach der Modularisierung funktionieren Start, Input, Kamera, HUD, Spawns und Reset weiterhin
- Neue Pickup-Typen, Wanted-Status und Missionen greifen in den bestehenden Spiel-Loop ein, ohne Kollisionen oder Reset zu brechen

## Defaults und Annahmen
- Zielpfad fuer die Dokumentation ist `docs/topdown-gta-improvement-plan.md`
- Die bestehende HTML-Datei bleibt als Einstiegspunkt erhalten
- Es wird kein Build-Tool eingefuehrt; das Projekt bleibt als modulare Browser-App mit nativen ES-Modulen lauffaehig
- Prioritaet bleibt: erst Stabilitaet und Struktur, dann mehr Inhalte
