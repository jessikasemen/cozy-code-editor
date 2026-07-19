## Ziel

Neues, 19. Landing-Theme im bestehenden Generator: eine Premium-Vermittlungs-Landing für QA-/Software-Tester zwischen Unternehmen (Auftraggeber) und Testern (Bewerber). Voll editierbar über die bestehende Slot-Mechanik, inklusive 3 schaltbaren Test-Jobs und einer interaktiven Dashboard-Vorschau. Kein neuer Admin-CRUD, keine neue Datenbank-Tabelle, keine eigene TanStack-Route — konsequent im bewährten Landing-Theme-Pattern.

## Was gebaut wird

### Neues Theme `theme-qa-platform-premium`
Verzeichnis `src/landing-themes/theme-qa-platform-premium/` mit:
- `meta.json` — Slot-Definition (~120 Slots)
- `template.html` — komplette Landing
- `style.css` — Premium Look (Dark/Light-Toggle, Glassmorphism, Grid-Hintergrund)
- `script.js` — Dark/Light-Switch, animierte Charts, Scroll-Reveals, Tab-Switch „Für Unternehmen / Für Tester"

Registrierung in `src/lib/landing-themes.ts`.

### Sektionen der Landing

1. **Sticky Header** mit Logo, Nav-Anker, Dark/Light-Toggle, „Jetzt bewerben"-CTA
2. **Hero** mit animiertem Gradient-Hintergrund, Headline, Sub-Headline, 2 CTAs („Als Tester bewerben" / „Unternehmen kontaktieren"), Vertrauens-Badges
3. **Trust-Bar** (Kunden-Logos + Zahlen: getestete Apps, aktive Tester, gefundene Bugs)
4. **Zielgruppen-Split (Tabs)** — „Für Unternehmen" ⇄ „Für Tester" mit unterschiedlichen Benefits
5. **Services** — 4 Karten mit SVG-Icons (App-Test, Web-Test, Software-QA, Usability)
6. **So funktioniert's** — 4-Schritte-Prozess (getrennt für Unternehmen/Tester per Tab)
7. **Interaktive Dashboard-Vorschau** — Mockup mit animierten Bar-/Line-Charts (reines SVG + JS, kein Recharts), Tab-Wechsel zwischen „Bug-Übersicht / Test-Sessions / Auszahlungen"
8. **Aktuelle Test-Jobs (3 Slots)** — jede Karte editierbar; wenn `job_X_active = false`, wird die Karte automatisch mit Overlay „Nicht mehr verfügbar" ausgegraut und der Apply-Button deaktiviert
9. **Testimonials** — 3 Karten mit Foto/Name/Rolle/Text/5-Sterne
10. **FAQ** — 6 ausklappbare Einträge
11. **Preise / Für Unternehmen** — 3 Pakete (Starter / Business / Enterprise) mit Feature-Liste
12. **Bewerbungsformular** — nutzt bestehendes `#bewerbung-form` + `#lov-apply-modal` Pattern (inkl. DSGVO-Checkbox via zentralem `injectPrivacyBlock`)
13. **Trust-Footer** — voller Legal-Block (`{{legal_block}}`, `{{contact_block}}`, Impressum, Datenschutz, AGB)

### Jobs — Slot-basiert (keine neue Tabelle)

Analog zu Testimonials/FAQ/Benefits. Pro Job diese Slots im Landing-Generator:
- `job_1_title`, `job_1_company`, `job_1_type` (App/Web/Software), `job_1_location` (Remote/Berlin/…), `job_1_payout` (€ pro Session), `job_1_duration` (z.B. „45 Min"), `job_1_desc`, `job_1_requirements`, `job_1_active` (true/false)
- gleiches Schema für `job_2_*` und `job_3_*`

Im Template wird jede Job-Karte gerendert; `job_X_active=false` → CSS-Klasse `job-unavailable` (grau, Sperr-Icon, Button „Zurzeit nicht verfügbar", nicht anklickbar). Kein Backend-Change nötig — pflege komplett im bestehenden Landing-Generator-UI.

### Dashboard-Mockup (interaktiv, ohne externe Libs)

- Tab-Bar mit 3 Views (Bug-Übersicht / Test-Sessions / Auszahlungen)
- SVG-Bar-Chart und SVG-Line-Chart, per JS mit `stroke-dasharray`-Animation und `requestAnimationFrame`-Zähler animiert
- Startet Animation via `IntersectionObserver` beim Scrollen
- Respektiert `prefers-reduced-motion`
- 100 % im `script.js` des Themes, kein neues npm-Package, kein Recharts (Recharts läuft in TanStack — nicht in generierten Landing-Bundles)

### Design-Sprache (an „Midnight Premium" angelehnt, neue Palette)

- Palette: Deep Navy `#050814`, Panel `#0d1428`, Accent Elektrik-Cyan `#22d3ee`, Accent 2 Violett `#a78bfa`, Text `#e6ecff`
- Optionaler `accent_color` Slot (Hex) → überschreibt Cyan-Akzent
- Typografie: Space Grotesk (Headings) × Inter (Body)
- Glassmorphism-Karten, subtile Grid-Overlays, animierte Orbs, Hover-Lift, `prefers-reduced-motion` gerespectet
- Dark-Mode ist Default; Light-Toggle im Header (Speichert in `localStorage`)

### Zentrale Injections greifen weiter

`src/lib/landing-generator.functions.ts` injiziert automatisch (bereits vorhanden): Social-Proof-Bar, Contact-Card, Benefits, Testimonials, FAQ, Cert-Bar, Trust-/Legal-Footer, DSGVO-Checkbox. Neues Theme liefert nur die Anker (`#bewerbung-form`, `<footer>`, `#lov-apply-modal`), damit `insertBeforeAnchor()` sauber greift.

## Technische Details

**Nicht Teil dieses Plans**
- Keine neue Tabelle `test_jobs`, kein Admin-CRUD (nutzt Slot-Mechanik)
- Keine neue TanStack-Route in dieser Admin-App
- Keine Änderungen an Booking-Backend, Application-Flow, Edge-Functions
- Kein Recharts / Framer Motion im Landing-Bundle (nur Vanilla-JS + SVG)

**Betroffene Dateien**
- Neu: `src/landing-themes/theme-qa-platform-premium/{meta.json,template.html,style.css,script.js}`
- Edit: `src/lib/landing-themes.ts` (Theme-Registrierung)
- Optional Edit: `src/lib/landing-generator.functions.ts` — nur falls für Jobs-Rendering ein Server-side-Loop nötig wird (wahrscheinlich reicht Client-JS im Template)

**Deploy**
1. `bash scripts/deploy.sh` (Frontend)
2. Admin → Landing Generator → Theme „QA Platform Premium" auswählen, Slots füllen, „Themes-Resync" pro Tenant
3. ZIP neu ausrollen auf Landing-Server

## Nach Bestätigung
Ich baue Theme, Slots, animiertes Dashboard-Mockup und Jobs-Karten mit Aktiv/Inaktiv-Schaltung in einem Rutsch — anschließend Build-Verifikation und ein Test-Screenshot der neuen Landing.
