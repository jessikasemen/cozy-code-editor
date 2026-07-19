## Ziel

Einmalig verifizieren, dass die 9 wichtigsten Mail-Flows die richtigen Empfänger triggern. Kein neuer Code, kein Deploy, kein Dashboard — du führst 3 SQL-Blöcke per Putty aus und schickst mir den Output. Ich sage dir dann pro Flow: ✅ läuft / ⚠ genau dieser Bewerber wird übersprungen, weil ….

## Was ich prüfe

| Flow | Prüfung |
|---|---|
| Bewerbung eingegangen | Letzte 24h: Anzahl Bewerbungen vs. Anzahl `application_received`-Mails in `email_send_log` |
| Kein Termin gebucht (24h + 72h) | Kandidaten in der Pipeline JETZT (Bewerbung >24h/>72h alt, kein `scheduled_at`, keine Reminder-Mail versendet) |
| Terminbestätigung | Letzte 24h: Bookings vs. `booking_confirmation`-Log-Einträge |
| Erinnerung 24h vor Termin | Termine in den nächsten 24h ohne bereits versendeten Reminder |
| No-Show Nachfass | Termine >24h zurück, Status ≠ completed, ohne `no_show_24h`-Mail |
| Interview-Einladung | Bewerber mit `interview_ready`-Status ohne `interview_invite_30min`-Mail |
| Registrierung offen (24h + 72h) | Zusage erteilt, Invite-Token existiert, kein Profil registriert, kein `registration_pending`-Reminder |
| Rebook nach Absage | Cancelled Bookings ohne `rebook_after_cancel`-Mail |
| Willkommen (nach KYC) | KYC-verifizierte Mitarbeiter der letzten 7 Tage ohne `invitation`-Mail |

Zusätzlich: warum die 3 Cron-Jobs `process-invite-resend-queue`, `send-application-reminders`, `send-appointment-reminders` in den letzten 24h failed sind (`return_message` aus `cron.job_run_details`).

## Ablauf

1. Ich schicke dir 3 SQL-Blöcke, die du per Putty auf dem `backendserver` ausführst:
   - **Block A** — Pipeline-Kandidaten pro Trigger (JETZT: „welche Bewerber würden in den nächsten Stunden welche Mail bekommen")
   - **Block B** — Send-Bilanz letzte 24h (Trigger-Ereignis vs. tatsächlich versendete Mail, pro Flow)
   - **Block C** — Cron-Fehler-Details (`return_message` der failed Runs)
2. Du schickst mir die drei Outputs.
3. Ich schicke dir einen kompakten Report:
   - Pro Flow: ✅ korrekt gerouted / ⚠ Diskrepanz mit Namen der betroffenen Bewerber
   - Ursache der Cron-Fehler + Einschätzung ob harmlos oder Bug
   - Klare Aussage: „Ja, alles läuft" oder „Diese X Bewerber müssen manuell nachversorgt werden"

## Was NICHT gemacht wird

- Kein neuer Code
- Kein Deploy
- Kein neues Admin-Panel
- Keine Änderung am SMTP-Handling (25/Tag-Tenants bleiben wie sie sind)
- Keine Migration

## Warum das reicht

Der Code-Pfad ist bereits verifiziert (Migrationen durch, Tenants nicht pausiert, `application_reminder_log` zeigt frische `sent`-Einträge für alle Reminder-Kinds). Was fehlt, ist der Live-Abgleich „ist mein Tenant X gerade in einem State, wo ein Bewerber Y triggern würde". Genau das leistet der SQL-Report — einmalig, ohne Nebenwirkung.
