# Game Expansion Roadmap

## Summary
Diese Roadmap ist die aktive Referenz fuer laufende Agenten-Sessions. Sie beschreibt die kreative Ausbau-Richtung des Spiels auf Basis des bestehenden Three.js-Topdown-Prototyps und wird Schritt fuer Schritt umgesetzt.

## 1. Welt und Stadtgefuehl
- Bezirke staerker trennen: echte Zonen statt nur Farbmarker.
- Downtown: hohe Gebaeude, enge Strassenschluchten, dichter Verkehr.
- Industrie: Hallen, Container, breite Kurven, offene Asphaltflaechen.
- Park: Grasflaechen, Wege, viele Baeume, weniger Verkehr.
- Hafenzone: Wasserflaechen, Docks, Container, Rampen und riskante Kanten.
- Mehr zerstoerbare Objekte: Schilder, Kisten, Zaeune, Laternen.
- Dynamische Events: Strassensperrung, Geldtransporter, seltene Bonus-Pickups.
- Wetter und Tageszeit: Regen soll Grip spuerbar senken, weitere Varianten folgen.

## 2. Missionen und Spielziele
- Bezirksgebundene Missionen mit klarerem thematischem Fokus.
- Mission Chains mit kleinen Eskalationsboegen.
- Bonusziele fuer sauber gefahrene, schnelle oder besonders riskante Runs.
- Groessere Spezialauftraege als Mid-Run-Hoehepunkte.

## 3. Polizei und Gegnerdruck
- Mehr Rollen fuer Polizei-Einheiten und bessere Raumkontrolle.
- Sicht- und Suchverhalten an Wetter und Bezirke koppeln.
- Taktischere Roadblocks und Bezirks-Hotspots.
- Mehr Konterplay durch Strecke, Timing und Spezial-Pickups.

## 4. Fahrzeuge und Garage
- Staerker differenzierte Fahrzeugklassen.
- Sichtbares Tuning und klarere Handling-Identitaeten.
- Mehr Garage-Fortschritt, Freischaltungen und Build-Entscheidungen.

## 5. Progression und Langzeitmotivation
- Bezirksruf, Sammlungen, Contracts und zusaetzliche Achievements.
- Mehr Gruende, bestimmte Spielstile gezielt zu meistern.

## 6. UI, Feedback und Atmosphaere
- Klarere Minimap, Event-Telegrafie und Heat-Dramatik.
- Staerkere visuelle und akustische Bezirksidentitaet.

## Stand der Umsetzung
- Welt: umgesetzt. Bezirke mit eigener Tonart, Lichtfarbe und Details (Neon, Rohre und Tanks, Baenke, Poller, Schiff), Seed-Karte, Tag/Nacht, Regen, Nebel, Gewitter.
- Missionen: umgesetzt. Ketten, Bosse, Modifier, Fail-State, Strassenrennen. Offen: weitere Modi.
- Polizei: umgesetzt. Strassennavigation, Sichtlinie, Rollen inklusive PIT und Zange, Spike-Vorwarnung. Offen: Taktiken an Bezirks-Hotspots.
- Fahrzeuge: umgesetzt. Sichtbares Tuning, Looks mit Finishes (Matt, Metallic, Candy, Perlmutt, Chrom), Liveries, Zweiton, Felgen, Neon-, Flammen- und Lichtfarbe (teils ueber Ruf freigeschaltet), Garage mit 3D-Vorschau, Handling-Charakter pro Auto, Motorklang pro Auto (v8, turbo, diesel, electric, twoStroke), Perks (Wraith -15 % Polizeisicht, Scarab Offroad-Grip, Forge längerer Nitro) und Schadensbild (Rauch, Funken).
- Progression: umgesetzt. Bezirksruf mit fuenf Stufen, 40 Graffiti-Tags, Contracts mit Fortschritt ueber Runs, Achievements.
- UI und Atmosphaere: umgesetzt. Minimap mit Formen statt nur Farben, Run-Zusammenfassung, Musik mit Heat-Ebenen und Bezirks-Tonart.

## Arbeitsweise
- Immer nur den naechsten klar abgegrenzten Schritt implementieren.
- Nach jedem Schritt Build, Test und kurzer Smoke-Check.
- Dieses Dokument bleibt die Referenz fuer weitere Ausbauwellen.
