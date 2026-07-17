## Ziel

Terminwahl passiert **direkt auf der Landing-Page** (`personalservice-gmbh.de`). Kein iframe, keine Weiterleitung auf `portal.*`. Nach dem Absenden der Bewerbung öffnet sich im gleichen Formular-Bereich der Kalender inline.

## Warum die bisherige Lösung nicht funktioniert

- Overlay-iframe zeigt `portal.personalservice-gmbh.de/termin/buchen/<token>` → aktuell landet der Nutzer auf `/login` statt auf der Buchungsseite. Ursache: entweder Portal-Deploy hinkt hinterher **oder** ein globaler Auth-Guard fängt die Route ab.
- Selbst wenn der iframe irgendwann lädt: der Bewerber wechselt visuell die Marke (portal.*), muss Cookies akzeptieren, Ladezeit für kompletten TanStack-Bundle → schlechte UX.
- User will das erklärtermaßen nicht — Buchung soll Teil der Landing-Page sein.

## Neuer Ansatz: Public JSON-API + Vanilla-Kalender

### 1. Neue öffentliche API-Routen (Portal-App)
`src/routes/api/public/booking.$action.ts` — CORS-freigegeben (`Access-Control-Allow-Origin: *`), keine Auth. Drei Actions per Query-Param `?action=`:

- `GET schedule?token=…` → gibt `{ schedule_id, slot_duration_minutes, timezone, min_notice_hours, max_days_ahead, booking_window_days, event_description, applicant_first_name, tenant_name, recruiter_name }` zurück (dieselben Felder wie `getScheduleForApplicant`).
- `GET slots?schedule_id=…&from=YYYY-MM-DD&to=YYYY-MM-DD` → `{ slots: [{start,end}] }` (dieselben Felder wie `getAvailableSlots`).
- `POST book` mit `{ token, starts_at, applicant_timezone }` → `{ ok, appointment_id, cancel_token, starts_at, ends_at }`.

Intern rufen die Handler direkt die vorhandenen RPCs (`get_schedule_for_application`, `get_free_appointment_slots`, `book_appointment_by_token`) via `supabaseAdmin` — **keine Duplizierung der Buchungs-Logik**. E-Mail-Bestätigung, DB-Schreiben, alles unverändert.

### 2. Landing-CTA + Kalender in `src/landing-themes/_shared/form-section.js`
- CTA `Jetzt Termin auswählen →` öffnet **nicht** mehr Overlay/iframe, sondern rendert direkt im Formular-Container einen Kalender-View.
- Neue Funktion `renderBookingInline(container, token, apiBase)`:
  - lädt `schedule` → zeigt Begrüßung („Hi {vorname}, wählen Sie einen Termin für Ihr kurzes Vorgespräch mit {recruiter}") + Hinweis „Sie erhalten die Zugangsdaten für das Gespräch per E-Mail".
  - lädt `slots` für 7-Tages-Fenster → Grid: Tage links, freie Slots als Buttons.
  - Zurück/Vor-Buttons für Wochenwechsel (max_days_ahead beachten).
  - Slot-Klick → `POST book` → zeigt Bestätigungs-Panel mit formatiertem Termin + `event_description` (HTML, sanitized via `textContent`/basic-HTML-allowlist), plus „E-Mail mit Details wurde versendet".
- Kein React, kein Framework — reines DOM/CSS im vorhandenen `_shared`-Stil (Buttons nutzen bestehende CTA-Klassen).
- Locale/Format: `Intl.DateTimeFormat("de-DE", …)`, Zeitzone = `Intl.DateTimeFormat().resolvedOptions().timeZone` als `applicant_timezone`.

### 3. `PORTAL_API` als API-Base
Das bestehende `window.PORTAL_API` zeigt bereits auf `https://portal.<domain>/api/public/applications`. Für Buchung leiten wir daraus die Base ab: `PORTAL_API.replace(/\/api\/public\/.*$/, "")` + `"/api/public/booking?action=…"`. Kein neues Env, kein neues Setting.

### 4. Fallback + Fehlerpfade
- API-Fehler → Toast-artiger Fehlerhinweis + Fallback-Link „Termin per E-Mail vereinbaren: {contact_email}".
- 404 auf schedule → „Ihr Buchungslink ist ungültig oder abgelaufen. Bitte kontaktieren Sie uns."
- 409/booked-Konflikt (Slot inzwischen weg) → Slots automatisch neu laden.

### 5. Portal-Route `/termin/buchen/$token` bleibt bestehen
Weiterhin nutzbar für den E-Mail-Link („Termin verschieben") — keine Änderung. Nur der Redirect **direkt nach Bewerbung** entfällt zugunsten der Inline-Variante.

## Was NICHT geändert wird

- DB-Schema, RLS, Booking-RPCs, E-Mail-Versand, `applications.ts`, Reminder-Cron.
- Bestehende Portal-Route `/termin/buchen/$token`.
- Overlay-Code darf raus (wird durch Inline-Rendering ersetzt).

## Deploy-Reihenfolge

1. Portal deployen (neue `/api/public/booking` Route). Ohne den Schritt hat die Landing-JS niemanden zum Sprechen.
2. Landing-Server deployen (neues `form-section.js` + ggf. CSS im `_shared/`).
3. Test: personalservice-gmbh.de → Bewerbung senden → Kalender inline → Slot buchen → Bestätigung mit Beschreibung.

## Offene Frage vor Umsetzung

Soll die Beschreibung nach Buchung ausschließlich per E-Mail kommen, oder **zusätzlich** direkt inline unter dem bestätigten Termin angezeigt werden (wie du in einer früheren Nachricht angedeutet hast)?  Mein Vorschlag: **beides** — inline unter „Termin bestätigt" die `event_description` einblenden und im Hinweis „(Diese Infos haben Sie zusätzlich per E-Mail erhalten)".