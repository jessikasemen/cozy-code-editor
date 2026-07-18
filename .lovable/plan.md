
# Landing Pages: Nächste Ausbaustufe für Seriosität & Optik

Über die bereits umgesetzten Basics (Impressum-Footer, DSGVO-Checkbox, 3-Schritte-Trust-Strip) hinaus — hier meine priorisierte Ideenliste, sortiert nach Wirkung pro Aufwand.

---

## A. Sofort sichtbare Vertrauens-Booster (hoher Impact)

1. **Recruiter-/Ansprechpartner-Karte am Formular**
   Foto (rund, 96 px), Klarname, Rolle, Telefon (tel:-Link), „Antwortet meist innerhalb 2 h" — direkt links neben dem Formular. Fallback: Team-Foto der Firma. Nichts baut so schnell Vertrauen auf wie ein echtes Gesicht am Conversion-Punkt.

2. **Social-Proof-Leiste über dem Formular**
   Google-Sterne-Widget (⭐ 4.8 · 127 Bewertungen), Kununu-Score, „Seit 2015 am Markt", „850+ vermittelte Fachkräfte". Nur mit gepflegten Werten rendern (kein Fake).

3. **Echte Testimonial-Sektion mit Foto + Vollname + Position**
   Statt Stock-Zitate: 3 Karten mit Mitarbeiter-Foto, „Marco S., Elektroniker seit 2023", O-Ton in 2–3 Sätzen, Standort. Optional Video-Testimonial (60 s, autoplay muted).

4. **Zertifikate-/Siegel-Leiste im Footer**
   AZAV, DIN EN ISO 9001, „Great Place to Work", IHK-Mitgliedschaft, Kununu-„Top Company 2026". Als monochrome SVGs, 40 px hoch, ausgegraut bis Hover. Slot-basiert im Editor pflegbar.

5. **Kundenlogos / Einsatzbetriebe-Karussell**
   „Unsere Bewerber arbeiten bei:" + 6–10 Logos in Graustufen. Baut sofort Substanz auf, auch wenn's nur regionale Betriebe sind.

## B. Optik / Craftsmanship (mittlerer Aufwand, hohe Wirkung)

6. **Emoji-Icons überall durch Inline-SVG-Icon-Set ersetzen**
   Ein einheitliches Lucide-Set (24 px, `currentColor`, stroke 1.75) in allen 17 Themes. Betrifft Nav-Burger, Kontakt-Icons, Chevrons, Trust-Badges, Feature-Bullets. Wirkt sofort 2× hochwertiger.

7. **Font-Diversifikation pro Theme**
   Aktuell zu viel „Inter überall". Vorschlag:
   - Corporate/Personalservice → `Fraunces` (Display) + `Inter` (Body)
   - Handwerk/Industrie → `Space Grotesk` + `IBM Plex Sans`
   - Pflege/Sozial → `Instrument Serif` + `Work Sans`
   - Tech/QA → `JetBrains Mono` (Akzent) + `Manrope`
   Pro Theme fest verdrahtet, keine Slots — Konsistenz vor Wahlmöglichkeit.

8. **Hero-Bilder: Overlay-Gradient + Rahmen-Kachel**
   Aktuelle Stock-Hero-Bilder wirken flach. Standard-Behandlung: 12-px-Rundung, dezenter Schlagschatten (`0 20px 60px -20px rgba(0,0,0,.25)`), leichter Farbgradient-Overlay in der Primärfarbe (5 % Opacity), optional dekorative Blob-Shape dahinter. Zentral in CSS, betrifft alle Themes.

9. **Section-Rhythmus mit „Eyebrow-Kicker" + dünnem Trennstrich**
   Jede Sektion bekommt oben ein kleines Kicker-Label („// Über uns", „01 · Leistungen") + einen 40-px-Strich in Primärfarbe. Das Muster nutzen `tts-consultant` und `cle-beratung` bereits — auf alle Themes ausrollen für einheitliche Editorial-Anmutung.

10. **Micro-Interactions (dezent!)**
    - Buttons: `translateY(-2px)` + Schatten-Shift on hover
    - Karten: 200-ms-Border-Farb-Übergang
    - Scroll-Reveal (fade-up, 400 ms, IntersectionObserver, einmalig)
    Zentral in `_shared/motion.js`. Kein Framer-Motion nötig, 30 Zeilen Vanilla-JS reichen. Keine Parallax-Effekte, kein Auto-Karussell — wirkt schnell billig.

## C. Content-Struktur (verhindert „leer wirkende" Landings)

11. **FAQ-Sektion mit 5–7 Fragen als Pflicht-Slot**
    „Wie lange dauert das Verfahren?", „Was kostet mich das?", „Bin ich fest angestellt?", „Kann ich mich auch ohne Lebenslauf bewerben?". Native `<details>`, kein JS. Klärt Bedenken → weniger Absprünge, gleichzeitig SEO-Long-Tail.

12. **„Was Sie erwartet"-Benefit-Grid (6 Kacheln)**
    Tarifgehalt, Urlaubs-/Weihnachtsgeld, Fahrtkostenerstattung, Übernahmegarantie, Weiterbildung, Sozialleistungen. Icon + Titel + 1 Satz. Ersetzt generische „Warum wir?"-Blöcke.

13. **Regional-/Standort-Karte**
    Eingebettete OpenStreetMap (kein Google, kein Cookie-Consent nötig) mit Firmenpin + Anschrift daneben. Signalisiert „lokal, greifbar, real".

14. **Blog-/News-Teaser (optional)**
    3 aktuelle Beiträge unten. Nur einblenden, wenn ≥ 3 gepflegt. Zeigt „diese Firma ist aktiv, nicht tot".

## D. Booking-Modal seriöser

15. **Modal-Header mit Firmenlogo + Recruiter-Foto**
    Booking-API liefert bereits `recruiter_avatar_url` (Migration vorhanden). Header wird zu: `[Logo] Termin mit [Foto] Max Mustermann · Recruiting`. Wirkt sofort persönlich statt anonym.

16. **Confirmation-Screen aufwerten**
    Nach Buchung: großer grüner Check, „Termin bestätigt", Kalender-Download-Buttons (`.ics`, Google, Outlook — als Icons), „Fügen Sie [Recruiter] zu Ihren Kontakten hinzu" (`.vcf`-Download), klare Anfahrt-/Videocall-Info aus `event_description`.

17. **Datum/Uhrzeit-Grid feiner gestalten**
    Aktuell 28-Tage-Liste wirkt tabellarisch. Umbau auf echten Monatskalender-Grid (7 Spalten), Tage mit freien Slots eingefärbt, Klick → Slot-Liste rechts daneben. Standard-Pattern à la Calendly/Cal.com.

## E. Rechtliches / Compliance (kleiner Rest)

18. **Cookie-Banner (nur wenn Tracking aktiv)**
    Aktuell wird nichts getrackt — sobald Google Analytics / Meta Pixel als Slot dazukommt, muss ein Consent-Banner rein (Klaro oder self-built, ~2 kB). Vorbereitet lassen, aktivieren wenn Tracking-Slot gepflegt.

19. **AGB-/Widerruf-Kurzseiten generieren**
    Analog zu `impressum.html` / `datenschutz.html` auch `agb.html` + `widerruf.html` optional generieren, wenn Felder gepflegt. Footer verlinkt automatisch.

20. **Accessibility-Basics**
    Kontrast-Check aller Themes (WCAG AA), `alt`-Attribute pflichtig im Editor, `:focus-visible`-Ring in Primärfarbe, `prefers-reduced-motion` respektieren. Kostet 2 Stunden, ist aber ein starkes Seriositäts-Signal (und rechtlich ab 2025 Pflicht in DE via BFSG).

## F. Editor-Verbesserungen (damit Kunden die Slots auch pflegen)

21. **Landing-Editor: „Vertrauens-Check" mit Ampel**
    Vor „Veröffentlichen" ein Checklist-Widget: Ansprechpartner-Foto ✅ · Impressum-Daten ✅ · ≥ 1 Testimonial ⚠️ · Zertifikate ❌ · Google-Bewertung ❌. Grün-gelb-rot. Landing kann veröffentlicht werden, aber der Kunde sieht, was fehlt.

22. **Vorschau-Modus mit Mobile/Tablet/Desktop-Toggle im Editor**
    Sicherstellt, dass Änderungen auf allen Größen geprüft werden bevor Deploy.

---

## Empfohlene Reihenfolge (falls du „alles" willst)

**Sprint 1 (größter Impact, 1 Runde):** #1 Ansprechpartner-Karte, #6 Emoji→SVG-Ersatz, #15 Booking-Modal-Header, #10 Micro-Interactions, #8 Hero-Behandlung.

**Sprint 2:** #2 Social-Proof-Leiste, #3 Testimonials, #11 FAQ, #4 Siegel-Leiste, #16 Confirmation-Screen.

**Sprint 3:** #7 Font-Diversifikation pro Theme, #17 Kalender-Grid, #12 Benefit-Grid, #21 Vertrauens-Check im Editor.

**Später bei Bedarf:** #13 Karte, #14 Blog-Teaser, #18 Cookie-Banner, #19 AGB/Widerruf, #20 A11y-Sweep, #22 Editor-Preview.

---

Sag mir, welche Punkte du willst — entweder „Sprint 1 komplett", oder pick einzelne Nummern. Ich bau's dann in Build-Mode um.
