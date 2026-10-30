# Street Heat

Street Heat ist ein Neon-Noir-Fluchtspiel im Browser, gebaut mit Three.js und Vite. Du driftest durch eine Stadt mit vier Bezirken, entkommst einer Polizei, die Sichtlinien und Straßen ernst nimmt, sammelst Combos, schaltest Autos frei und baust deinen Ruf in jedem Bezirk auf.

## Features

- **Fahren:** Velocity-basierte Physik mit Drift, Trail-Braking, Nitro, Untergründen (Straße, Pflaster, Schotter, Dock, Gras) und zehn Autos mit eigenem Charakter (vier Klassiker, Hornet, vier Bezirks-Signaturautos freischaltbar über Ruf, das Endgame-Auto Wraith).
- **Stadt:** Vier Bezirke (Downtown, Industrial, Park, Harbor) mit eigener Tonart, Lichtfarbe und Details. Tag/Nacht-Übergang, Regen, Nebel und Gewitter mit Blitzen. Fester Seed, die Karte sieht immer gleich aus.
- **Polizei:** Verfolgung über das Straßennetz (A\*), Sichtlinie und Suchverhalten, Rollen (Tail, Flank, Ram, PIT, Zange, Blocker), Roadblocks, Spike-Strips mit Vorwarnung, EMP, Helikopter bei Heat 5.
- **Missionen:** Missionsketten pro Bezirk (deklarativ in `src/data/missions.js`), Boss-Aufträge, Modifier („Nachtfahrt“, „Keine Bremse“, „Erzwungene Verfolgung“, „Zeitangriff“) und ein echter Fail-State mit Wiederholen gegen Cash.
- **Events und Sammelobjekte:** Welt-Events, illegale Straßenrennen gegen KI-Rivalen, 40 Graffiti-Tags (10 pro Bezirk).
- **Progression:** Garage mit Autos, Upgrades (sichtbares Tuning) und Lackfarben. Bezirksruf mit fünf Stufen und Freischaltungen, Contracts, Achievements, Run-Zusammenfassung mit Score-Aufschlüsselung.
- **Audio:** Rein synthetisch: Motor mit Gängen, Sirenen (Wail, Hi-Lo, Yelp), Rotor, Effekte und eine prozedurale Synthwave-Musik, deren Ebenen mit dem Heat wachsen. Getrennte Regler für Gesamt, Musik und Effekte.
- **Eingabe:** Tastatur (frei belegbar), Gamepad (analog, Rumble, Menünavigation), Touch (virtueller Stick).

## Steuerung

| Aktion | Tastatur | Controller | Touch |
| --- | --- | --- | --- |
| Gas / Bremse, Rückwärts | W S oder ↑ ↓ | RT / LT (analog) | Stick vor / zurück |
| Lenken | A D oder ← → | Linker Stick | Stick seitlich |
| Handbremse und Drift | Leertaste | B oder LB | DR |
| Nitro | Shift | A oder RB | N2O |
| Provoke (Heat +1, mehr Punkte) | Q | Y | PRO |
| Interagieren (Garage, Abgabe) | E | X | E |
| Garage | G | L3 | – |
| Kamera nah / normal / weit | C | Back | – |
| Pause | P oder Esc | Start | – |
| Auto wechseln (freigeschaltete) | 1 bis 9, 0 | – | – |
| Neustart | R | – | – |
| Debug-Panel / Grafikstufe | F3 / F4 | – | – |

Im Controller-Menü bewegt das Steuerkreuz den Fokus, A bestätigt, B geht zurück. Alle Aktionen der linken Spalte außer Pfeilen, P, Esc, R und F-Tasten lassen sich in **Einstellungen → Tastenbelegung** ändern.

## Einstellungen

Lautstärke (Gesamt, Musik, Effekte), Grafikqualität (Niedrig, Mittel, Hoch), Kamera, Screen-Shake, reduzierte Bewegung (folgt `prefers-reduced-motion`), Ton aus, Tastenbelegung und Tutorial zurücksetzen. Sie liegen unter dem eigenen Storage-Key `street-heat-settings`.

## Entwicklung

```bash
npm install
npm run dev      # Vite-Server auf 127.0.0.1, Basis-Pfad /street-heat/
npm test         # headless Logik-Tests (kein Browser nötig)
npm run build    # Produktionsbuild nach dist/
npm run preview  # Build lokal ansehen
```

Mit `?gallery` an der Dev-URL zeigt eine Galerie alle Fahrzeugmodelle (Tag/Nacht, Draufsicht) zum Durchschauen. Im Dev-Modus gibt es `window.__street` mit `state`, `post`, `runtime`, `renderer`, `ui` und `audio` für Prüfungen in der Konsole (`runtime.debug` enthält `startRace` und `tags`). F3 zeigt FPS, Draw Calls, Dreiecke, Geometrie- und Texturzähler.

### Aufbau

Die Architektur steht in [`docs/architecture.md`](docs/architecture.md). Kurz: `main.js` verdrahtet alles, `systems.js` ist die Spiellogik (wird schrittweise in `src/systems/` zerlegt), reine Logik liegt in kleinen Modulen (`physics/`, `ai/`, `scoring.js`, `economy.js`, `progression.js`, `music.js`, `siren.js` …) und wird von `scripts/logic-smoke.mjs` ohne Browser getestet. Alle Zahlen zum Balancing stehen in `src/config.js`.

### Spielstand

Der Spielstand liegt im `localStorage` unter `neon-pursuit-profile-v2` (der Name blieb aus Kompatibilität), das Format trägt eine eigene `version` (aktuell 3). Ältere Stände werden beim Laden migriert, beschädigte fallen auf ein frisches Profil zurück.

## Tech

- Three.js (Rendering, EffectComposer mit Bloom), Vite
- Plain ES Modules, DOM-HUD, Web Audio, Gamepad API
