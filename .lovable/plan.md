## Ziel
Alle 17 Landing-Page-Themes werden konsistent geprüft und die gefundenen Lücken geschlossen — Bewerbungsformular, Trust/Legal-Block, DSGVO-Hinweis, Buchungsflow.

## Aktueller Zustand (per Grep über `template.html`)

| Theme | Formular-Anker `#bewerbung-form` | Legal/Contact-Block | Datenschutz-Hinweis |
|---|---|---|---|
| theme-10 | ❌ fehlt | ❌ fehlt | (nur Text) |
| theme-azb-replica | ✅ | ✅ | ✅ |
| theme-career-atlas | ✅ | ✅ | ✅ |
| theme-cle-beratung | ❌ CTAs zeigen auf `#kontakt`, kein Formular | ✅ | ✅ |
| theme-connect-people | ✅ | ✅ | ✅ |
| theme-device-stack | ✅ | ❌ fehlt | ❌ |
| theme-eilers-replica | ✅ | ⚠️ nur teilweise | ✅ |
| theme-for-tel | ✅ | ⚠️ nur teilweise | ✅ |
| theme-job-gleiter | ✅ | ⚠️ nur teilweise | ✅ |
| theme-mirror-site | ✅ | ✅ | ✅ |
| theme-qa-grid | ✅ | ⚠️ nur teilweise | ✅ |
| theme-quality-report | ✅ | ⚠️ nur teilweise | ✅ |
| theme-talent-hub | ✅ | ❌ fehlt | ❌ |
| theme-tester-lab | ✅ | ⚠️ nur teilweise | ✅ |
| theme-tts-beratung | ✅ | ⚠️ nur teilweise | ✅ |
| theme-tts-consultant | ✅ | ✅ | ✅ |

Zentrale Injektion (`injectTrustFooter`, `injectPrivacyBlock`) läuft im Generator — greift aber nur, wenn ein Footer/Formular vorhandene Anker liefert. Themes ohne die Anker (theme-10, theme-cle-beratung) profitieren nicht.

## Plan

### 1) Kritische Lücken schließen (Templates)
- **theme-10**: `#bewerbung-form`-Section + Footer mit `{{contact_block}}` / `{{legal_block}}` + Impressum/Datenschutz-Links ergänzen.
- **theme-cle-beratung**: Sektion `#bewerbung-form` unter `#kontakt` einfügen (CTA-Buttons weiter auf `#kontakt`, das dann Formular trägt).
- **theme-device-stack** & **theme-talent-hub**: Footer um `{{contact_block}}`, `{{legal_block}}`, Impressum-/Datenschutz-Links erweitern.

### 2) Legal-Vollständigkeit (theme-eilers-replica, theme-for-tel, theme-job-gleiter, theme-qa-grid, theme-quality-report, theme-tester-lab, theme-tts-beratung)
- Footer prüfen und, wo nur Impressum-Link steht, `{{contact_block}}` und `{{legal_block}}` zusätzlich einbauen (2-spaltiges Layout wie bei theme-connect-people).

### 3) End-to-End-Verifikation je Theme
Für jedes Theme via `scripts/build-theme-assets.mjs` bauen und im Browser (Playwright) prüfen:
- Formular sichtbar, Absenden liefert Erfolgs-Screen.
- Booking-Button erscheint bei `booking_mode=internal`, Inline-Kalender lädt (28-Tage-Grid), Termin buchbar.
- DSGVO-Checkbox sichtbar & pflichtig.
- Footer enthält Firmenname, Anschrift, Impressum-/Datenschutz-Link.

Ergebnis als Tabelle (Theme × Check) zurückliefern; nur Fixes committen, keine Design-Änderungen ohne Rückfrage.

### 4) Deploy-Hinweis
Nach Merge: `bash scripts/deploy.sh` (Frontend) + im Admin „Themes-Resync" pro Tenant, damit die generierten ZIPs die neuen Templates enthalten.

## Nicht Teil dieses Plans
- Weitere Optik-/Redesign-Arbeit (Sprint 2/3 aus vorherigem Plan: Social-Proof-Widgets, Kununu, Font-Diversifizierung).
- Änderungen am Buchungs-Backend — läuft bereits nach dem letzten Fix.

Bitte bestätigen, dann setze ich Schritt 1–3 in Build-Mode um.