## Ziel

Nie wieder blockiert ein einzelner SMTP-Hänger alle Bewerber eines Tenants. Stattdessen wird nur die **konkrete Empfänger-Adresse** gesperrt, nach der wirklich 3× hintereinander die Zustellung fehlgeschlagen ist.

## Was du dir gespart hast — und warum

Der geplante Tab „Fehlgeschlagene Mails" wird **nicht gebaut**. Begründung, damit du es nachvollziehen kannst:

- Nutzen wäre nur gewesen: failed rows aus `email_send_log` sehen + „erneut senden"-Button. Die Info bekommst du auch über den bestehenden Bewerber-Screen (die Warnung „⚠ Bewerbungsmail fehlgeschlagen" die du im Screenshot hattest) und über die Live-Simulation.
- Der eigentliche Grund, warum wir den Tab wollten (5 Bewerber wegen Tenant-Pause blockiert), fällt weg — sobald es keine Tenant-Pause mehr gibt, ist ein Batch-Resend-UI überflüssig.
- Für die 5 offenen Bewerber vom 19.07. baue ich stattdessen ein **einmaliges Nachzieh-Skript** (siehe Schritt 4).

Falls du in Zukunft doch mal einen Überblick über fehlgeschlagene Sendungen willst, ergänzen wir das in der Live-Simulation — kein eigener Tab nötig.

## Änderungen

### 1) Tenant-Pause komplett entfernen

In allen 5 Edge Functions (`send-invitation-email`, `send-reminders`, `send-signup-confirmation`, `send-password-reset`, `resend-signup-confirmation`):

- Die Logik „nach N fehlgeschlagenen SMTP-Verifys `tenants.emails_paused = true` setzen" wird gelöscht.
- SMTP-Verify-Timeout bleibt auf den kürzlich erhöhten 15s.
- Der Preflight-Check in `src/routes/api/public/applications.ts:649` und an ähnlichen Stellen liest `emails_paused` nicht mehr — das Feld wird ignoriert.
- `tenants.emails_paused` bleibt als Spalte bestehen (falls du in Not mal manuell einen Tenant komplett stumm schalten willst), wird aber automatisch nie mehr gesetzt.
- Die auto-collected `tenant_smtp_health`-Zähler bleiben nur noch für Reporting, ohne Auto-Aktion.

### 2) Neue Sperr-Logik: 3 Fails pro Empfänger → dauerhaft blockieren

Neue Migration + Logik in `send-invitation-email` (und den 4 Schwester-Functions):

**Zähler pro Empfänger**
Neue Tabelle `email_recipient_failures`:
- `recipient_email` (unique)
- `tenant_id`
- `consecutive_failures` (int)
- `last_failed_at`, `last_error`
- `suppressed_at` (nullable — gesetzt sobald 3 erreicht)

**Vor jedem Send:**
Ist die Adresse in `email_recipient_failures.suppressed_at IS NOT NULL` → sofort abbrechen, in `email_send_log.status='skipped'` mit Grund `recipient_suppressed_after_3_fails`.

**Nach jedem Send:**
- Erfolg → `consecutive_failures = 0` (Zähler wird zurückgesetzt, damit ein einmaliger Ausrutscher nicht ewig nachwirkt)
- Fehler → `consecutive_failures += 1`; ab 3 wird `suppressed_at = now()` gesetzt

Ergebnis: 10 Bewerber mit unterschiedlichen Adressen bekommen ihre Mail auch dann, wenn Bewerber Nr. 4 eine tote Adresse hat.

### 3) UI: Adress-Sperren im Admin sichtbar & aufhebbar

Damit du kontrollieren kannst, wer gesperrt wurde und ggf. entsperren:

- Neuer kleiner Abschnitt **im bestehenden E-Mail-Center-Tab „Live-Simulation"** (kein neuer Tab): Liste der gesperrten Adressen mit Zeitpunkt, letztem Fehler, Anzahl Fails, Tenant + Button „Sperre aufheben".
- Server-Function `listSuppressedRecipients` und `unsuppressRecipient`.

### 4) Einmaliges Nachzieh-Skript für die 5 Bewerber vom 19.07.

Nach dem Umbau baue ich eine einmalige Admin-Aktion (nicht dauerhaft im UI):

- Findet alle `email_send_log` mit `status='failed'` und `error_message LIKE '%tenant_emails_paused%'` der letzten 14 Tage
- Setzt `tenants.emails_paused = false` für alle betroffenen Tenants
- Löst pro betroffener Application ein erneutes `application_received` aus
- Zeigt Ergebnis-Report

Du klickst einmal drauf, die 5 Bewerber bekommen ihre Mail, Aktion ist erledigt.

## Reihenfolge

1. Migration: `email_recipient_failures` Tabelle + Grants + RLS
2. Edge Functions: Pause-Logik raus, Empfänger-Zähler-Logik rein
3. `src/routes/api/public/applications.ts`: `emails_paused`-Check entfernen
4. Admin-UI: „Gesperrte Adressen" Abschnitt in Live-Simulation
5. Einmal-Nachzieh-Aktion + ausführen
6. `src/lib/failed-emails.functions.ts` und `src/components/admin/FailedEmailsPanel.tsx` (bereits erstellt in vorherigem Zug) werden **gelöscht** — nicht mehr benötigt
7. Deploy Backend + Frontend, kurze Putty-Prüfung

## Was du danach in Putty prüfen kannst

```bash
docker exec -i supabase-db psql -U postgres -d postgres <<'SQL'
-- Sind alle Tenants aktiv?
SELECT name, emails_paused FROM tenants WHERE emails_paused = true;
-- (sollte 0 Zeilen liefern)

-- Wer ist als Empfänger gesperrt?
SELECT recipient_email, consecutive_failures, last_error, suppressed_at
FROM email_recipient_failures WHERE suppressed_at IS NOT NULL;

-- Fehler in den letzten 24h
SELECT template_name, count(*), max(created_at)
FROM email_send_log WHERE status='failed' AND created_at > now() - interval '24 hours'
GROUP BY template_name;
SQL
```

Ok so? Sag „go" und ich setze um.