
# Landing Pages seriöser & rechtskonform machen

Ziel: Die berechtigten Bewerber-Einwände (Abmahnrisiko, „wirkt fake") beheben, ohne die Themes komplett neu zu bauen. Alle Änderungen laufen zentral über `_shared/form-section.js` + den Landing-Generator (`applyPlaceholders`) und den Footer/Template-Blöcken der Themes, damit ein einziger Resync alle 17 Themes gleichzeitig aktualisiert.

---

## 1. Impressum & Datenschutz — abmahnsicher

**Neuer sichtbarer Impressum-Block in jedem Footer** (statt nur `{{impressum_url}}`-Link):

- Firma (Rechtsform), Straße + PLZ/Stadt, Geschäftsführer, HRB + Registergericht, USt-ID / Steuernummer, Telefon, E-Mail — alles aus `branding` in der DB (Felder existieren bereits: `hrb`, `registergericht`, `ust_id`, `steuernummer`, `geschaeftsfuehrer`, `strasse`, `plz`, `stadt`).
- Neuer Platzhalter `{{legal_block}}` wird im `landing-generator.functions.ts` automatisch aus diesen Feldern zusammengebaut (HTML-formatiert). Themes müssen nur `{{legal_block}}` in den Footer einsetzen.
- Zusätzlich `{{legal_inline}}` (Kurzform: „Firma XY GmbH · GF: … · HRB …") für schmale Footer.
- Datenschutz- und Impressum-Links bleiben, werden aber im Footer klar sichtbar (14 px, unterstrichen, Kontrast ≥ 4.5:1) — keine „winzige graue Zeile" mehr.

**Neue Route + Fallback für fehlende Impressum-URLs:** Wenn `impressum_url` leer ist, wird `{{impressum_url}}` auf `/impressum` gesetzt und der Generator legt eine statische `impressum.html` + `datenschutz.html` mit dem generierten Text an (nur wenn die Kunden keinen eigenen Link hinterlegen).

## 2. DSGVO-Hinweis am Bewerbungsformular

Direkt über dem Absende-Button im `_shared/form-section.js` (gilt für ALLE Themes gleichzeitig):

- Pflicht-Checkbox „Ich habe die [Datenschutzerklärung]({{datenschutz_url}}) gelesen und willige in die Verarbeitung meiner Daten zum Zweck der Bewerbung ein." — Submit ist ohne Häkchen deaktiviert.
- Kurzer Datenschutz-Absatz (aufklappbar via `<details>`): Wer erhält die Daten (`{{firmenname}}`), Zweck (Bewerbung), Speicherdauer (6 Monate nach Absage / bis Widerruf), Rechte (Auskunft, Berichtigung, Löschung, Widerruf jederzeit an `{{contact_email}}`), Rechtsgrundlage (Art. 6 Abs. 1 lit. b DSGVO).
- Link zu AGB/Widerruf wird nur eingeblendet, wenn die entsprechenden URL-Felder gepflegt sind.

## 3. Vertrauens-Elemente vor dem Formular

Neuer Shared-Block `_shared/trust-section.js` (oder Template-Erweiterung), den jedes Theme direkt vor `#bewerbung-form` einbinden kann:

- **„So geht's weiter in 3 Schritten"** (Bewerbung → Kurzes Kennenlernen → Vertragsangebot) — Icons als echte inline-SVGs, nicht Emojis.
- **Ansprechpartner-Karte** direkt am Formular: Foto (`{{contact_person_avatar}}`), Klarname (`{{contact_person_name}}`), Rolle (`{{contact_person_role}}`), Telefon + E-Mail — mit `tel:`/`mailto:`-Links. Neue Felder in `branding` + Landing-Editor.
- Fallback: wenn keine Ansprechpartner-Daten gepflegt, ganzer Block bleibt ausgeblendet (kein Fake).

## 4. Zahlen, Recruiter-Name, Stock-Bilder — Fake-Wirkung reduzieren

- **Stat-Kacheln** (`stat_1_value`, `kpi1_value`, …): Nur rendern, wenn Wert UND Quelle (`stat_1_source`) gepflegt sind. Sonst wird der ganze Stats-Block ausgeblendet — kein „500+ zufriedene Kunden" ohne Beleg.
- **Recruiter-Name**: Default `Sabine Schneider` in `landing_pages.recruiter_name` wird entfernt (Migration setzt Default auf `NULL`). Wenn leer, zeigt der Booking-Header „mit unserem Recruiting-Team" statt einem erfundenen Namen. Im Landing-Editor wird das Feld als Pflichtfeld markiert, bevor der Booking-Flow aktiviert werden kann.
- **Generische Claims** wie „Bereit für den nächsten Schritt?" werden Slot-basiert überschreibbar; der bisherige Hardcode aus `theme-tts-consultant/template.html` wandert in `{{cta_final_title}}` / `{{cta_final_body}}`.

## 5. Booking-Modal seriöser

Im Inline-Kalender (`_shared/form-section.js` → `renderBookingInline` + `renderConfirmed`):

- Header bekommt Firmenlogo (`{{logo_url}}` via `state.schedule.logo_url`, Backend liefert) und, falls vorhanden, Recruiter-Foto (`recruiter_avatar_url` — Spalte existiert bereits laut Migration `20260630100000_landing_recruiter_avatar.sql`).
- Neue Zeile „Ihre Daten werden ausschließlich zur Terminvereinbarung genutzt. Details siehe Datenschutzerklärung."
- Booking-API (`src/routes/api/public/booking.ts`) liefert `logo_url`, `recruiter_avatar_url` und `datenschutz_url` mit im `schedule`-Response.

## 6. Icons & Typografie entrümpeln

- Alle Emoji-Icons (`☰`, `✉`, `›`, `⏱`, `€`, `☺`, `✦`, `★`, `◆`, `⬢`, `●`) in den Themes durch echte inline-SVGs ersetzen (16–24 px, `currentColor`). Betroffen: `theme-connect-people`, `theme-tts-consultant`, `theme-cle-beratung`, `theme-career-atlas`.
- Der Burger-Button `☰` bekommt drei `<span>`-Striche (schon in `theme-cle-beratung` vorhanden — Pattern übernehmen).
- **Font-Diversifikation**: Nicht global umstellen, aber `theme-cle-beratung` (aktuell Plus Jakarta) und `theme-connect-people` (DM Serif + Nunito) bleiben; `theme-tts-consultant` weg von Inter-only → `Fraunces` (Display) + `Inter` (Body); `theme-career-atlas` behält Fraunces/Inter. Ziel: kein Theme mehr mit „Inter überall".

## 7. Footer-Kontaktblock groß

Im `{{legal_block}}` zusätzlich (oder in einem parallelen `{{contact_block}}`):

- Adresse in Groß (16 px, Bold-Zeile für Firmenname), Telefon als klickbarer `tel:`-Link (18 px), E-Mail als `mailto:`-Link, Öffnungszeiten (optional Slot `{{opening_hours}}`).
- Alle Themes: Footer-Grid auf mind. 3 Spalten (Kontakt, Rechtliches, Links) — `theme-connect-people` und `theme-career-atlas` haben derzeit nur einen einzeiligen Footer, wird auf das Muster aus `theme-tts-consultant` umgestellt.

---

## Technische Details

**Neue/geänderte Dateien:**

1. `src/lib/landing-generator.functions.ts` — neue Aliases `legal_block`, `legal_inline`, `contact_block`, `contact_person_*`, `stat_*_source`-Filter. Optional statische `impressum.html`/`datenschutz.html` mit generiertem Inhalt.
2. `src/landing-themes/_shared/form-section.js` — DSGVO-Checkbox + `<details>`-Kurzfassung, Trust-3-Schritte-Block, Ansprechpartner-Karte, Logo/Recruiter-Foto im Booking-Header, Datenschutz-Zeile.
3. `src/routes/api/public/booking.ts` — `schedule`-Response um `logo_url`, `recruiter_avatar_url`, `datenschutz_url`, `firmenname` erweitern; `recruiter_name` fällt bei NULL auf `null` (Frontend rendert Team-Text).
4. Alle 17 Theme-`template.html`: Footer-Block auf `{{legal_block}}` + `{{contact_block}}` umstellen, Emoji-Icons durch SVGs ersetzen, generische CTA-Texte auf Slots umziehen. Reihenfolge: erst `_shared` → dann die vier meistgenutzten Themes (`theme-tts-consultant`, `theme-cle-beratung`, `theme-career-atlas`, `theme-connect-people`), dann Rest.
5. Neue Migration `supabase/manual-migrations/20260725000000_landing_trust_fields.sql`:
   - `landing_pages`: `contact_person_name text`, `contact_person_role text`, `contact_person_phone text`, `contact_person_avatar_url text`, `opening_hours text`, `agb_url text`, `widerruf_url text`.
   - `landing_pages.recruiter_name`: `DEFAULT NULL` (statt `'Sabine Schneider'`), bestehende `'Sabine Schneider'`-Werte auf `NULL` setzen (nur wo nie geändert — via Marker-Flag oder pauschal, wird beim User bestätigt).
   - Grants + `NOTIFY pgrst`.
6. Landing-Editor UI (`src/routes/admin.landing.*`): neue Felder (Ansprechpartner-Foto/Name/Rolle/Telefon, AGB/Widerruf-URLs, Öffnungszeiten, `stat_*_source`) im Formular ergänzen.

**Nicht Teil dieses Plans** (bewusst rausgehalten, um Scope zu halten):

- Echte Kundenlogos / Google-Bewertungen / Auszeichnungen — die müssen die Tenants selbst hochladen; hier nur die Slot-Struktur (`{{trust_logo_1}}..{{trust_logo_6}}`, `{{google_rating_value}}`, `{{google_review_count}}`) im Template + Editor bereitstellen, damit sie einsetzbar sind, wenn Material da ist. Ohne gepflegte Werte bleibt der Block ausgeblendet.
- Ersatz aller Stock-Hero-Bilder — kann pro Tenant im Editor gemacht werden.

**Rollout:**

1. Migration einspielen (`deploy-backend.sh`).
2. Themes im Editor als „Neu synchronisieren" markieren → Landing-Server zieht die neuen Templates.
3. Tenants im Admin-Bereich bekommen einen roten Hinweis pro Landing, wenn Pflicht-Trust-Felder fehlen (Ansprechpartner, Impressum-Angaben).

**Aufwand:** ca. 1 größere Session — `_shared` + Generator + Booking-API + Migration in einem Rutsch, Theme-Templates parallel batch-editieren.

Soll ich so starten? Falls du zuerst nur (1)+(2) — also **Impressum-Block im Footer + DSGVO-Checkbox am Formular** — willst und den Rest in einer zweiten Runde, sag Bescheid, dann baue ich das zuerst und die Themes bleiben ansonsten unangetastet.
