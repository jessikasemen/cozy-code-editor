## Ziel

Vollständiger End-to-End-Audit: **Löst jedes E-Mail-Template wirklich aus, und geht es an den richtigen Empfänger?**

Aktuell wissen wir nur: Cron läuft, 30 Sends in 24h, 0 Fehler. Das beweist **nicht**, dass jeder Trigger den richtigen Bewerber/Mitarbeiter erreicht.

## Audit-Umfang

Ich prüfe pro Template systematisch **4 Dimensionen**:

| Dimension | Frage |
|---|---|
| **Trigger** | Wo im Code wird `sendTemplateEmail(...)` bzw. die Edge-Function aufgerufen? |
| **Empfänger** | Welche E-Mail-Adresse wird tatsächlich als `to` gesetzt? Aus welcher Tabelle/Spalte? |
| **Bedingung** | Welche `WHERE`-Filter/Status/Idempotenz-Log verhindern Doppelversand oder falsche Empfänger? |
| **Beweis** | Gibt es in den letzten 30 Tagen **echte Rows** in `email_send_log` / `reminder_log` / `application_reminder_log`? |

## Template-Matrix (Ist-Stand)

Aus dem bisherigen Kontext bekannt:

| Template | Trigger-Ort | Bekannter Status |
|---|---|---|
| `application_received` (Vermittlung) | `/api/public/applications` nach Insert | ✅ läuft |
| `vermittlung_no_booking_24h/72h` | Cron `send-application-reminders` | ✅ 24 Sends |
| `vermittlung_no_show_24h` | Cron `send-application-reminders` | ✅ 2 Sends |
| `vermittlung_rebook_after_cancel_*` | Cron | ✅ 2 Sends |
| `appointment_reminder_30min` | Cron `send-appointment-reminders` | 0 in 24h → nur wenn Termin fällig |
| `booking_confirmation` | Edge `send-booking-confirmation` nach Buchung | ungeprüft |
| `interview_invite` (accepted → Kalender) | Server-Fn oder Cron | ungeprüft |
| `chat_reminder` (manuell) | Admin-UI Button | ungeprüft nach Fix |
| `signup_confirmation` / `resend_signup_confirmation` | Auth-Hook + Admin-UI | ungeprüft |
| `password_reset` | Auth-Hook | ungeprüft |
| `invite_resend_queue` (Drip) | Cron `process-invite-resend-queue` | ✅ 1184 sent, 12 skipped |
| `onboarding_stage_*` / `welcome` | Nach Stage-Transition | ungeprüft |
| `no_show_interview` (Portal) | Cron / Trigger | ungeprüft |

## Was ich brauche (Code-only Prüfung, kein DB-Zugriff nötig)

Ich lese die relevanten Edge-Functions und Server-Functions und dokumentiere pro Template:

1. **Trigger-Kette** — Datei + Zeile, ab welcher `INSERT`/`UPDATE`/Cron der Send losläuft.
2. **Empfänger-Herleitung** — z. B. `applications.email` vs. `profiles.email` vs. `auth.users.email` — und ob ein Fallback existiert (Bug-Risiko: leere E-Mail → an Admin oder gar nicht).
3. **Tenant-Zuordnung** — bekommt der Bewerber die Mail vom **richtigen Tenant-SMTP** (nicht vom Fremd-Tenant)?
4. **Idempotenz** — welche `unique`-Constraint/`_log`-Tabelle verhindert Doppelmails.
5. **Placeholder-Rendering** — `{{first_name}}`, `{{booking_url}}` etc. — wird der richtige Wert eingesetzt oder droht `{{first_name}}` als Literal in der Mail?

## Verifikation im laufenden System

Zusätzlich gebe ich dir **drei fokussierte SQL-Queries** zum Backend-Copy-Paste:

```sql
-- Q1: Pro Template letzte 30 Tage — Zahl + letzter Empfänger (Beweis)
SELECT template, status, count(*), max(created_at), 
       (array_agg(recipient ORDER BY created_at DESC))[1] AS last_recipient
FROM email_send_log 
WHERE created_at > now() - interval '30 days'
GROUP BY template, status ORDER BY template, status;

-- Q2: Falsche Empfänger-Zuordnung? (Mail an anderen Tenant als Bewerbung)
SELECT esl.template, esl.recipient, esl.tenant_id AS mail_tenant,
       a.tenant_id AS app_tenant, a.email AS app_email
FROM email_send_log esl
LEFT JOIN applications a ON lower(a.email) = lower(esl.recipient)
WHERE esl.created_at > now() - interval '7 days'
  AND a.tenant_id IS NOT NULL 
  AND a.tenant_id <> esl.tenant_id
LIMIT 50;

-- Q3: Trigger-Kandidaten die NICHT gefeuert haben (Silent-Fail-Detektor)
-- z.B. accepted Bewerber ohne interview_invite Mail
SELECT a.id, a.email, a.status, a.created_at
FROM applications a
WHERE a.status = 'akzeptiert'
  AND a.created_at > now() - interval '30 days'
  AND NOT EXISTS (
    SELECT 1 FROM email_send_log e 
    WHERE lower(e.recipient) = lower(a.email) 
      AND e.template LIKE 'interview_invite%'
  )
LIMIT 20;
```

## Deliverable

Nach Freigabe des Plans liefere ich:

1. **Audit-Tabelle** (Markdown) pro Template mit Trigger-Datei:Zeile, Empfänger-Feld, Tenant-Isolation, Idempotenz-Beweis, Status **✅ / ⚠️ / ❌**.
2. **Konkrete Findings** (falls vorhanden): z. B. „`onboarding_stage_start` nutzt `profiles.email` — Bewerber ohne Profil bekommen die Mail nicht" oder „`interview_invite` sendet an `applications.email` — bei Tippfehler kein Fallback".
3. **Die 3 SQL-Queries oben** zum sofortigen Copy-Paste im Backend, um meine Code-Findings mit echten Daten zu verifizieren.
4. **Fix-Vorschläge nur** für konkret gefundene Probleme — kein Umbau des funktionierenden Systems.

## Was ich NICHT tue

- Keine Code-Änderungen im Plan-Modus.
- Keine spekulativen Refactors.
- Keinen Umbau von Templates, die laut `email_send_log` sauber feuern.

**Freigabe?** Dann starte ich mit dem Code-Audit und liefere die Matrix + SQL-Queries in der nächsten Runde.