## Ziel

Nach dem Absenden der Bewerbung soll die Terminauswahl **direkt auf der Landing-Page** (`personalservice-gmbh.de`) stattfinden, statt den Bewerber auf `portal.personalservice-gmbh.de` weiterzuleiten. Die eigentliche Buchungs-Logik (Server-Funktionen, DB, E-Mails, Beschreibung nach Buchung) bleibt unverändert — nur die Hülle wird auf die Landing-Page verlegt.

## Ansatz (minimal-invasiv)

Die bestehende Portal-Route `/termin/buchen/$token` (Kalender + Buchen + Beschreibung nach Buchung) wird als **iFrame-Overlay** auf der Landing-Page geöffnet — statt per Vollnavigation.

Damit:
- Bewerber bleibt visuell auf der Landing-Page
- Keine doppelte UI, keine parallele Kalender-Logik
- Server-Funktionen, Slots, `bookAppointment`, E-Mail, Beschreibung nach Buchung: **unverändert**
- Nach erfolgreichem Buchen zeigt die iframe-Seite (wie heute) die Event-Beschreibung mit dem Link zum Portal-Interview

## Änderungen

### 1. `src/landing-themes/_shared/form-section.js` — CTA öffnet Overlay statt Redirect
- Im `meta.label = 'Jetzt Termin auswählen …'`-Zweig: Button wird zu `<button>` mit Overlay-Handler statt `<a href>`.
- Overlay = fixiertes Modal (rgba-Backdrop) mit iframe auf `redirectUrl` (`https://portal.…/termin/buchen/<token>`), Höhe ~ 90vh, max-width 720px, Schließen-Button.
- Fallback-Link darunter: "Falls das Fenster nicht lädt, hier öffnen →" (öffnet Original-URL in neuem Tab). Sichert den Fall ab, in dem der User den Screenshot beschreibt (Landung auf `/`), z. B. wenn eine ältere Portal-Version die Route noch nicht kennt.
- `postMessage`-Listener: wenn die iframe-Seite `{ type: 'booking_completed' }` sendet, Overlay bleibt offen (der Bewerber liest die Beschreibung), aber ein optionaler „Schließen"-Text erscheint. (Nicht auto-close, damit der Portal-Link in der Beschreibung geklickt werden kann.)

### 2. `src/routes/termin.buchen.$token.tsx` — iframe-fähig + Bestätigung posten
- Nach erfolgreicher Buchung (`onSuccess` von `bookMutation`) zusätzlich `window.parent?.postMessage({ type: 'booking_completed' }, '*')`.
- Kein Layout-Zwang: die Seite rendert bereits self-contained und funktioniert im iframe.
- Keine Änderung an Slot-Logik / Buchungs-Server-Funktion / Beschreibung.

### 3. `src/routes/__root.tsx` (falls nötig) — X-Frame-Options
- Sicherstellen, dass `/termin/buchen/*` nicht per `X-Frame-Options: DENY` blockiert wird. Falls global gesetzt: für diese Route weglassen oder `frame-ancestors` in CSP auf die Landing-Domain(s) whitelisten.
- Nur anpassen, wenn ein Header tatsächlich gesetzt ist (prüfe ich beim Umsetzen).

## Was NICHT geändert wird

- `applications.ts` (Redirect-URL-Logik, Booking-Mode-Erkennung, E-Mail)
- Kalender/Slot-Server-Funktionen (`getScheduleForApplicant`, `getAvailableSlots`, `bookAppointment`)
- Portal-Route `/termin/buchen/$token` (bleibt eigenständig aufrufbar — E-Mail-Link funktioniert weiterhin)
- Datenbankschema, RLS, Termin-Beschreibungslogik

## Offene Frage zum Screenshot-Bug

Du berichtest, der Klick landet aktuell auf `https://portal.personalservice-gmbh.de/` (Root) statt `/termin/buchen/<token>`. Nach der Overlay-Umstellung ist das visuell egal, aber falls die Route selbst 404't, würde der iframe auch leer bleiben. Kannst du mir kurz bestätigen, ob `https://portal.personalservice-gmbh.de/termin/buchen/<irgendein-token>` direkt aufgerufen die Kalenderseite zeigt? Falls nein, ist das Portal-Deploy noch nicht aktuell und wir müssen zuerst redeployen (`bash scripts/deploy.sh`), bevor das Overlay Sinn ergibt.