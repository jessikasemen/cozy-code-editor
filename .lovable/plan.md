## Situation

Der Server `host-190-97-167-124` (auf dem du gerade eingeloggt bist) ist der **Frontend-Server**:
- Enthält nur `/root/mb-portal-frontend/` (statisches `dist/` + nginx-Config)
- Kein Docker, kein Supabase → hier kann `deploy-backend.sh` nicht laufen

Das Backend (Supabase self-hosted, Edge Functions, Migrations) liegt auf dem **Backend-Server** — das ist der, wo dein Putty-Prompt `root@backendserver` erscheint. Genau dort müssen die neuen Migrations (`email_recipient_failures`, Tenant-Unpause) und die aktualisierten Edge Functions (`send-invitation-email` mit Recipient-Suppression, erhöhtes SMTP-Timeout) deployt werden — nur dann verschwinden die aktuellen Fehler (Tenant bleibt pausiert, Tabelle fehlt, Cron-Jobs failen).

## Vorgehen

### Schritt 1 — Auf den Backend-Server wechseln
Öffne die Putty-Session zu dem Server, wo `root@backendserver` steht. Dort liegt das Repo mit `scripts/deploy-backend.sh`, `supabase/migrations/` und `supabase/functions/`.

### Schritt 2 — Repo-Pfad auf dem Backend-Server finden
Falls du den Pfad nicht sicher weißt:
```bash
find / -maxdepth 5 -name "deploy-backend.sh" 2>/dev/null
```
Erwartet: irgendwas wie `/root/cozy-code-editor/scripts/deploy-backend.sh` oder `/opt/apps/backend/scripts/deploy-backend.sh`.

### Schritt 3 — Aktuellen Code ziehen + deployen
```bash
cd <PFAD-AUS-SCHRITT-2>
git pull
bash scripts/deploy-backend.sh
```

Das Skript:
1. Wendet die neue Migration `20260726000000_recipient_failure_suppression.sql` an → legt `email_recipient_failures` an + hebt den `auto:smtp_verify`-Pause auf.
2. Deployed die aktualisierten Edge Functions (15 s Timeout, Recipient-Suppression statt Tenant-Pause).
3. Räumt Cron-Jobs auf.

### Schritt 4 — Verifikation nach Deploy
Auf dem Backend-Server, im Postgres-Container:
```bash
docker exec -i supabase-db psql -U postgres -d postgres <<'SQL'
SELECT id, name, emails_paused, emails_paused_reason FROM tenants WHERE emails_paused = true;
SELECT to_regclass('public.email_recipient_failures') AS suppression_table;
SELECT jobname, status, return_message
  FROM cron.job_run_details
  WHERE start_time > now() - interval '1 hour'
  ORDER BY start_time DESC LIMIT 20;
SQL
```

Erwartet: 0 pausierte Tenants, Tabelle existiert, Cron-Jobs `status = succeeded`.

### Schritt 5 — Optional: Frontend nachziehen
Falls das Admin-UI (Panel „Gesperrte Empfänger", End-to-End-Dry-Run) auf dem Frontend-Server auch aktualisiert werden soll, **hier** auf `host-190-97-167-124`:
```bash
cd /root/mb-portal-frontend
# Frontend-Deploy nach eurem üblichen Prozess (git pull + build + nginx reload)
```
Für das Fixen der Mail-Fehler ist das aber **nicht** nötig — die Ursache liegt komplett im Backend.

## Was ich von dir brauche

Wechsle in die `root@backendserver`-Session und schick mir den Output von:
```bash
find / -maxdepth 5 -name "deploy-backend.sh" 2>/dev/null
```

Dann kann ich dir den exakten `cd`-Befehl für Schritt 3 geben.
