
## Was wir sicher wissen (aus deinem SQL-Output)

**Alle 5 Bewerber gehören zu Tenant `ad57153e-…ec375`.** Die erste Zeile nennt den Grund im Klartext:

> `tenant_emails_paused: SMTP-Verify 3x fehlgeschlagen: verify timeout 8s`

Was hier passiert ist, in einfachen Worten:

1. Vor jeder E-Mail fragt das System den SMTP-Server: "Bist du da?" mit **8 Sekunden Timeout**.
2. Bei diesem Tenant hat das **3× hintereinander länger als 8s** gedauert.
3. Ein Schutzmechanismus hat den Tenant daraufhin **automatisch pausiert** (`emails_paused=true`).
4. Ab diesem Moment werden **alle Mails dieses Tenants blockiert** — ohne echten Sendeversuch. Die 4 leeren Fehlermeldungen darunter sind genau dieselbe Ursache, nur mit anderem/mehrzeiligem Reason-Text.

Das ist **kein Mailserver-Ausfall im eigentlichen Sinn**, sondern:
- entweder war der SMTP wirklich kurz träge (Netz/Provider), 
- oder der 8s-Preflight ist einfach zu aggressiv,
- **und** es gibt keinen automatischen "Aufwach"-Mechanismus: sobald pausiert, bleibt pausiert bis manuell entpaust.

Und: die spezifische Tabellenspalte `smtp_config` gibt es nicht (die SMTP-Daten liegen direkt in `tenants.smtp_host` / `smtp_username` / …). Deshalb Query 1 der Fehler — nicht wichtig für das Problem, nur meine Query war falsch.

---

## Was ich baue

### 1) Sofortmaßnahme — Tenant entpausen + 5 Bewerbungsmails nachschicken

Ein neuer Admin-Bereich **„Fehlgeschlagene Mails"** (`/admin/email-templates` → neuer Tab):

- Liste aller `email_send_log`-Einträge mit `status='failed'` (Filter: letzte 7/30 Tage, Template, Tenant)
- Pro Zeile: Empfänger, Template, Fehler, **„Erneut senden"**-Button (single) 
- Header: **„Alle sichtbaren erneut senden"** (Batch, mit Zwischenzähler)
- Beim erneuten Senden wird zuerst geprüft, ob der Tenant noch pausiert ist — dann Warnung mit **„Tenant jetzt entpausen"**-Button
- Für die 5 konkreten Bewerber vom 19.07. bedeutet das: Tenant einmal entpausen → „Alle erneut senden" drücken → fertig.

### 2) Retry-Policy — nie wieder stille Verluste

**Neue Tabelle `email_retry_queue`** (analog zur bestehenden `invite_resend_queue`, aber für **alle** Templates, nicht nur Einladungen). Regel:

| Versuch | Warten bis | 
|---|---|
| #1 (sofort) | Der eigentliche Sendeversuch beim Bewerbungseingang |
| #2 | +5 Minuten |
| #3 | +30 Minuten |
| #4 | +2 Stunden |
| #5 | +6 Stunden |
| dann | aufgeben, Admin-Alarm |

- **Exponentielles Backoff** — kein Spam beim Empfänger, weil zwischen jedem Versuch echte Wartezeit liegt.
- **Bei Erfolg**: Row wird als `sent` markiert, keine weiteren Versuche.
- **Bei „recipient_suppressed" / „domain_not_verified" / „duplicate"**: sofort abbrechen, nicht wiederholen (kein Sinn).
- **Bei `tenant_emails_paused`**: pausieren, nicht als "failed" endgültig — sobald Tenant wieder aktiv ist, laufen die Retries automatisch weiter.
- Verarbeitet durch bestehenden `pg_cron`-Job (alle 5 min) → neue Edge Function `process-email-retry-queue`.

Damit ist ausgeschlossen, dass ein Bewerber wegen einer 8-Sekunden-Delle nie eine Mail bekommt.

### 3) SMTP-Verify entschärfen

Am `send-invitation-email`-Edge-Function-Code:
- **Timeout 8s → 15s** (real gemessene SMTP-Handshakes brauchen auf lahmen Providern > 8s)
- **Auto-Pause erst nach 5 Fails** statt 3 (aktuell 3)
- **Auto-Unpause**: wenn nach der Pause der nächste manuelle Verify erfolgreich ist, wird `emails_paused` automatisch zurückgesetzt (aktuell muss man das manuell klicken)

### 4) Tiefer E-Mail-Test (deine Kernanforderung: „Ich will sehr tief testen")

Neuer Tab **„Live-Simulation"** unter `/admin/email-templates`:

**A) Bewerber-Simulation (echt, aber mit deiner Testadresse)**
- Wähle Landing Page + optional Test-Adresse
- Klick löst einen **echten POST an `/api/public/applications`** aus mit Testdaten (Vorname „Test", deine E-Mail, `is_test_application=true`-Flag)
- Die komplette Kette läuft: Landing → Tenant-Lookup → Duplicate-Check → SMTP-Verify → application_received → Booking-Link → `notify-application`
- Report zeigt jeden Schritt einzeln (✓/✗ + Zeit)
- **Anschließend automatisches Cleanup**: die Test-Application wird aus DB gelöscht

**B) Mitarbeiter-Simulation**
- Auswahl: „Einladung akzeptieren", „Onboarding starten", „Passwort zurücksetzen", „Interview-Erinnerung"
- Erzeugt einen Test-Mitarbeiter, triggert den echten Flow, löscht ihn wieder

**C) 24-h Health-Report** (neuer Menüpunkt)
- Sendevolumen je Template + Tenant
- Fehlerquote pro Tenant (rot ab > 5%)
- Pausierte Tenants mit Grund + „Jetzt entpausen"-Button
- Suppression-Liste (Bounce/Complaint)
- Retry-Queue-Länge

Damit siehst du nicht nur, ob die Templates rendern (das war der alte Test-Button), sondern ob der komplette **produktive Trigger-Pfad** für Bewerber UND Mitarbeiter durchläuft.

---

## Reihenfolge der Umsetzung

1. `admin.email-templates.tsx` → Tab „Fehlgeschlagene Mails" + Batch-Resend-Server-Function
2. SQL-Migration `email_retry_queue` + Edge-Function `process-email-retry-queue` + pg_cron alle 5 min
3. `send-invitation-email` + Sibling-Functions: Timeout 15s, Pause-Schwelle 5, Auto-Unpause
4. Tab „Live-Simulation" mit A/B/C
5. Deploy-Skript + kurze Anleitung, was in Putty geprüft werden kann

---

## Was du danach in Putty tippst, um alles zu prüfen

```bash
docker exec -i supabase-db psql -U postgres -d postgres <<'SQL'
-- 1) Tenants mit SMTP + Pause-Status
SELECT name, smtp_host, emails_paused, emails_paused_reason
FROM tenants ORDER BY name;

-- 2) Fehlgeschlagene Mails letzte 48h
SELECT created_at, recipient_email, template_name, error_message
FROM email_send_log
WHERE status='failed' AND created_at > now() - interval '48 hours'
ORDER BY created_at DESC;

-- 3) Retry-Queue Status
SELECT status, count(*) FROM email_retry_queue GROUP BY status;
SQL
```

Ok für dich so? Sag Bescheid, dann setze ich es um.
