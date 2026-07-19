## Ziel

Der End-to-End Test im E-Mail-Center soll **alle Trigger-Flows** durchspielen (nicht nur `application_received`). Grüner Report = echter Flow funktioniert.

## Was du am Ende hast

Im Tab **„End-to-End Test"** unter `/admin/email-templates`:

- **Dropdown „Flow wählen"** mit allen 13 Flows, gruppiert:
  - **Bewerber:** Bewerbung eingegangen · Terminbestätigung · Erinnerung 24h vor Termin · No-Show · Kein Termin gebucht · Interview-Einladung
  - **Mitarbeiter:** Registrierungs-Link · Willkommen (nach KYC) · Passwort-Reset · Signup-Bestätigung
  - **System:** Chat-Erinnerung · Booking-Confirmation · Landing-Page-Bewerberformular
- Landing Page + Test-E-Mail wie bisher (Landing nur wo relevant)
- **„Alle Flows testen"**-Button → spielt der Reihe nach alle 13 durch, Report mit ✅/❌ pro Flow

## Wie ein einzelner Dry-Run läuft (Beispiel „Erinnerung 24h")

1. Landing/Tenant/Empfänger ermitteln
2. Prüfen: SMTP aktiv, `emails_paused`, Suppression
3. Template-Daten bauen (Terminzeit, Booking-Link, Recruiter-Name)
4. Edge Function `send-appointment-reminders` mit **einer** Test-Zeile + `[DRY-RUN]`-Präfix im Subject aufrufen
5. Antwort der Function 1:1 in den Report schreiben

**Nie:** neue DB-Zeilen, keine `email_send_log`-Fehler, keine echten Bewerber/Mitarbeiter angefasst.

## Report-Format

Pro Flow eine aufklappbare Zeile:
```
✅ Bewerbung eingegangen     · 342ms · Mail zugestellt
✅ Terminbestätigung          · 289ms
❌ Erinnerung 24h             · tenant_emails_paused
✅ No-Show                    · 401ms
...
```
Rote Zeilen zeigen `reason`-Code (z.B. `smtp_not_configured`, `recipient_suppressed`, `template_render_failed`, `edge_function_500`) — genau die Codes, die auch im echten Flow geloggt würden.

## Umsetzung (technisch)

**1 neue Datei:** `src/lib/all-flows-dryrun.functions.ts` mit einer Server-Function pro Flow (`dryRunBookingConfirmation`, `dryRunAppointmentReminder24h`, `dryRunNoShow`, `dryRunAppNoBooking`, `dryRunInterviewInvite`, `dryRunEmployeeRegistration`, `dryRunEmployeeWelcome`, `dryRunPasswordReset`, `dryRunSignupConfirmation`, `dryRunChatReminder`). Jede spiegelt die Trigger-Logik der zuständigen Edge Function / des Cron-Jobs.

**Bestehende Datei erweitert:** `src/lib/application-dryrun.functions.ts` bekommt einen Orchestrator `dryRunAllFlows(landing_page_id, test_email)`, der die einzelnen Funktionen sequenziell aufruft und den kombinierten Report zurückgibt.

**UI:** `src/routes/admin.email-templates.tsx` — der `DryRunPanel` bekommt:
- Select mit den 13 Flows + „Alle testen"
- Report-Liste mit Aufklapp-Details (Request/Response der Edge Function)

**Keine Änderung** an: echten Edge Functions, DB-Schema, Bewerbungsflow, Mailtemplates.

## Was Dry-Run **nicht** ersetzt

- Echte Bounces (nur wenn Testadresse nicht deine ist)
- Ratelimit-Probleme bei Massenversand
- Zeitzonenprobleme beim tatsächlichen Cron-Trigger (die Zeit-Berechnung wird aber getestet)
