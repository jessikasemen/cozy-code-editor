
## Diagnose (aus deinem cron.job_run_details Output)

Zwei konkrete Probleme, die genau erklären, warum aktuell nichts (bzw. nur zufällig 1/2) versendet wird:

**1. Doppelte Cron-Jobs**
```
send-appointment-reminders     */10 * * * *   (2×)
send-application-reminders     */30 * * * *   (2×)
auto_complete_appointments     */5 + */15     (2×)
```
Das passiert, weil `cron.schedule(name, ...)` bei jedem Deploy einen NEUEN Job anlegt, wenn `cron.unschedule(name)` fehlschlägt (z.B. weil der alte unter anderem Owner läuft). Ergebnis: 2 parallele Läufe, einer davon mit alter/kaputter Config.

**2. „Quote command returned error" im pg_net http_post**
- Beim 16:00-Lauf **succeeded** eine Instanz von `send-application-reminders`, die anderen **failed** mit demselben Fehler.
- Die Fehlermeldung kommt aus `net._encode_url_with_params_array` – das passiert wenn **URL, Header-Wert oder Body NULL / ungültig** sind.
- Ursache: Die kaputte Job-Instanz wurde mit einem SQL-Body erstellt, in dem entweder
  a) `<SUPABASE_URL>` **nicht ersetzt** wurde (also literal in der URL steht), oder
  b) der Vault-Secret `reminders_service_role_key` zu dem Zeitpunkt NULL war → `'Bearer ' || NULL = NULL` → pg_net wirft „Quote error".

Beweis dass es (a) ist: ein Duplikat succeeded gleichzeitig – Vault-Key ist also da, aber die zweite Job-Definition ist defekt.

## Lösung – 3 Schritte, alle SQL, kein Code-Deploy nötig

### Schritt 1: Alle betroffenen Duplikate hart entfernen

```sql
-- Alle Jobs mit diesen Namen komplett wegwerfen (inkl. Duplikate)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT jobid, jobname FROM cron.job
    WHERE jobname IN (
      'send-appointment-reminders',
      'send-application-reminders',
      'process-invite-resend-queue',
      'auto_complete_appointments'
    )
  LOOP
    PERFORM cron.unschedule(r.jobid);
    RAISE NOTICE 'unscheduled % (jobid=%)', r.jobname, r.jobid;
  END LOOP;
END$$;

-- Verifizieren: alle 4 müssen weg sein
SELECT jobname, count(*) FROM cron.job GROUP BY jobname ORDER BY jobname;
```

### Schritt 2: Vault-Secret + Supabase-URL prüfen (Preflight)

```sql
-- Muss non-NULL zurückgeben, sonst ist der Job garantiert defekt
SELECT length(decrypted_secret) AS key_len
FROM vault.decrypted_secrets
WHERE name = 'reminders_service_role_key';

-- Muss den Wert enthalten den du in der URL brauchst, z.B. 'api.dein-backend.de'
SELECT current_setting('app.settings.supabase_url', true);
```

Falls `key_len` NULL ist → Secret einmal frisch einspielen:
```sql
SELECT vault.create_secret('<SERVICE_ROLE_KEY_KOMPLETT>', 'reminders_service_role_key');
```

### Schritt 3: Jobs neu anlegen – **jeweils genau einmal**, mit voller URL fest eingesetzt

Ich schreibe eine neue Migration `supabase/manual-migrations/20260724000000_recreate_cron_jobs_clean.sql`, die:
- Schritt 1 ausführt (unschedule aller Duplikate),
- `send-appointment-reminders`, `send-application-reminders`, `process-invite-resend-queue`, `auto_complete_appointments` **je einmal** neu registriert,
- die `<SUPABASE_URL>`-Platzhalter mit `sed` beim Apply ersetzt (bestehende Konvention),
- am Ende `NOTIFY pgrst, 'reload schema'` schickt.

Danach ausführen:
```bash
cd /opt/apps/portal && git pull
sed "s|<SUPABASE_URL>|api.dein-backend.de|g" \
  supabase/manual-migrations/20260724000000_recreate_cron_jobs_clean.sql \
  | docker exec -i supabase-db psql -U postgres -d postgres

# Verifizieren: jeder Name genau 1× active
docker exec -i supabase-db psql -U postgres -d postgres -c \
  "SELECT jobname, count(*) FROM cron.job GROUP BY jobname ORDER BY jobname;"

# 10 Min warten, dann Ergebnisse checken
docker exec -i supabase-db psql -U postgres -d postgres -c \
  "SELECT j.jobname, r.status, r.return_message, r.start_time
   FROM cron.job_run_details r JOIN cron.job j ON j.jobid=r.jobid
   WHERE r.start_time > now()-interval '30 min'
   ORDER BY r.start_time DESC LIMIT 20;"
```

Erwartet: **nur noch `succeeded`**, keine „Quote command" Fehler mehr.

## Was danach passiert
- `send-appointment-reminders` läuft alle 10 Min → 30-Min-Interview-Einladungen gehen raus → Zähler „Interview-Einladung" > 0.
- `send-application-reminders` läuft alle 30 Min → No-Show, Keine-Buchung, Registrierung-Pending, Rebook-Reminder werden geprüft → entsprechende Zähler steigen sobald ein Bewerber die Trigger-Bedingung erfüllt.
- `process-invite-resend-queue` läuft alle 15 Min → Fast-Track-Zusagen (Herzlichen Glückwunsch / Registrierung abschließen) werden nachgezogen.

## Bitte kurz bestätigen
Soll ich in die Migration deinen echten Supabase-Host als Default reinschreiben (dann bleibt der `sed`-Schritt optional)? Wenn ja, gib mir den Host (z.B. `api.personalservice-gmbh.de`), sonst lasse ich `<SUPABASE_URL>` als Platzhalter drin.
