
## Ziel

Verifizieren, dass alle 10 genannten E-Mail-Flows nach dem letzten Umbau (Recipient-Suppression statt Tenant-Pause, 15s SMTP-Timeout, Cron-Cleanup, `bewerbung_magic_link`-Template) tatsächlich rausgehen — nicht nur SMTP-technisch, sondern inklusive Trigger-Pfad (Tenant-Auflösung, Link-Bau, Template-Rendering, Suppression-Gate).

## Vorgehen

Ich mache das in zwei Ebenen, weil "funktioniert alles" zwei Dinge bedeuten kann: **kommt die Mail an?** (SMTP + Rendering) und **wird sie überhaupt korrekt ausgelöst?** (Trigger, Tenant, Link).

### Ebene 1 — Live-Test aus dem Admin (du klickst, ich werte aus)

Im E-Mail-Center gibt es bereits zwei Werkzeuge, die genau das prüfen. Ich brauche von dir nur einen Klick pro Flow:

1. **Dry-Run "Alle Flows"** unter `/admin/email-templates` → Tab **End-to-End Test** → Landing Page + Testadresse wählen → **Alle testen**.
   Das ruft je Flow den echten Edge-Function-Pfad auf (mit `[DRY-RUN]`-Präfix), simuliert Tenant-Auflösung, Link-Bau, Suppression-Check, SMTP-Verify und Send. 11 Zeilen mit grün/rot + Fehlergrund.
2. Falls eine Zeile rot ist: ich lese die konkrete Fehlermeldung + Edge-Function-Log und benenne die Ursache pro Flow.

Damit sind 9 der 10 Flows abgedeckt:

| Dein Wortlaut                        | Interner Flow-Key             |
| ------------------------------------ | ----------------------------- |
| E-Mail bestätigen                    | `signup_confirmation`         |
| Registrierung abschließen            | `app_registration`            |
| Keine Buchung (7 Tage)               | `app_no_booking`              |
| Chat-Reminder                        | `chat_reminder`               |
| Vermittlung: Kein Termin             | `app_no_booking` (Broker)     |
| Vermittlung: No-Show                 | `app_no_show`                 |
| Vermittlung: Registrierung offen     | `app_registration` (Broker)   |
| Vermittlung: Interview-Einladung     | `ai_acceptance_invitation`    |
| Terminbestätigung                    | `booking_confirmation`        |

**Domain-Wechsel** ist im Dry-Run-Katalog nicht enthalten — siehe Ebene 2.

### Ebene 2 — Backend-Checks für die Flows, die kein Dry-Run abdeckt

Für **Domain-Wechsel** und für die Live-Statistik der letzten 24h fahre ich per Putty drei kurze Reads gegen die DB (nichts wird geändert):

- Zählen `email_send_log` nach `template_name` + `status` letzte 24h → Ist irgendwo `failed` überproportional?
- `SELECT * FROM tenants WHERE emails_paused = true` → muss nach dem Umbau 0 sein.
- `SELECT * FROM email_recipient_failures WHERE suppressed_at IS NOT NULL` → wer ist adressbasiert gesperrt?
- `SELECT * FROM email_send_log WHERE template_name = 'domain_change' ORDER BY created_at DESC LIMIT 5` → hat der letzte Domain-Wechsel eine Mail rausgeschickt?
- pg_cron-Jobs: läuft `send-application-reminders` (für Kein-Termin/No-Show) und `send-reminders-hourly` (24h vor Termin) fehlerfrei?

### Ebene 3 — Cron-getriggerte Flows verifizieren

`app_no_booking` (24h/72h/7d) und `app_no_show` (24h nach Termin) und `booking_confirmation` (nach echter Buchung) werden nicht vom Bewerber ausgelöst, sondern vom Cron bzw. vom Buchungs-Endpoint. Für die prüfe ich:

- `cron.job_run_details` letzte 24h für `send-application-reminders` und `send-appointment-reminders` — alle grün?
- Gibt es Kandidaten? (`SELECT count(*) FROM applications WHERE status = 'applied' AND scheduled_at IS NULL AND created_at < now() - interval '24 hours'`)
- Wenn Kandidaten existieren aber `application_reminder_log` leer ist → Cron feuert, aber Query findet nichts. Dann Code-Review der Reminder-Function.

## Was du machst

1. Öffne `/admin/email-templates` → Tab **End-to-End Test** → wähle eine Landing Page (idealerweise Vermittlung mit eigenem Buchungssystem, damit auch `booking_confirmation` sinnvoll läuft) und eine Testadresse, die du im Postfach hast → **Alle testen**.
2. Screenshot der Ergebnis-Tabelle an mich.
3. Gib mir dein OK für die 5 read-only Putty-Checks (Ebene 2+3) — ich liefere den fertigen `docker exec`-Block.

## Was ich danach liefere

Ein Ampel-Bericht pro Flow:

```
E-Mail bestätigen                 ✅  200ms
Registrierung abschließen         ✅  180ms
Keine Buchung (7 Tage)            ⚠   Cron OK, aber 0 Kandidaten in letzten 7 Tagen — nicht getestet
Domain-Wechsel                    ✅  letzter Versand 18.07. 14:22, status=sent
Chat-Reminder                     ✅
Vermittlung: Kein Termin          ✅
Vermittlung: No-Show              ✅
Vermittlung: Registrierung offen  ✅
Vermittlung: Interview-Einladung  ✅
Terminbestätigung                 ✅
```

Bei rot/gelb: konkrete Ursache + Fix-Vorschlag als eigener Plan.

Sag „go" — dann geht Runde 1 (dein Klick im Admin) los und ich bereite parallel die Putty-Kommandos vor.
