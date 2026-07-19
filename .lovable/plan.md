## Ausgangspunkt

Zwei Erkenntnisse aus deinem letzten Test:

1. Die SQL auf `reminder_log` war leer — **weil `application_received` gar nicht dorthin loggt.** Der Code in `src/routes/api/public/applications.ts` (Zeilen 467–512) schreibt Fehler nach **`email_send_log`** mit `template_name = 'application_received'`. Wir haben also die falsche Tabelle abgefragt.
2. Du willst zurecht mehr als nur "SMTP funktioniert" — nämlich den **kompletten Pfad** testen: Tenant-Lookup, Booking-Link-Konstruktion, `emails_paused`-Check, Preflight, Edge-Function-Call, DB-Log.

Genau das lässt sich sauber lösen, ohne den Live-Code zu verändern.

---

## Teil A — Richtige Diagnose-Query (sofort machbar, kein Code)

Auf dem Backend-Server ausführen:

```bash
docker exec -i supabase-db psql -U postgres -d postgres <<'SQL'
SELECT created_at, recipient_email, tenant_id, status, error_message, metadata
FROM email_send_log
WHERE template_name = 'application_received'
  AND status = 'failed'
  AND created_at BETWEEN '2026-07-19 09:00' AND '2026-07-19 13:00'
ORDER BY created_at DESC
LIMIT 20;
SQL
```

Die Spalten `error_message` und `metadata.reason` benennen die exakte Ursache — z.B. `confirmation_action_link_missing`, `tenant_lookup_failed`, `emails_paused`, `preflight_*` oder HTTP-Status der Edge-Function. Erst wenn wir diesen Grund kennen, mache ich einen Fix — kein Blindflug.

---

## Teil B — "Bewerbungs-Dry-Run" Button im Admin (Neubau, ca. 1 Datei)

Damit du **jederzeit ohne echten Bewerber** den kompletten Trigger-Pfad prüfen kannst, baue ich einen Button `admin.landing-generator.tsx` (bzw. neuen Reiter im E-Mail-Center) mit dem Titel **„End-to-End-Test: Bewerbungseingang"**.

**Was der Button tut** (rein serverseitig, keine echte Bewerbung landet in der DB):

1. Nimmt eine Landing-Page-Auswahl + Test-E-Mail entgegen.
2. Ruft eine neue Server-Function `dryRunApplicationReceived` (via `createServerFn`, admin-gated), die den **identischen Code-Pfad** wie `src/routes/api/public/applications.ts` durchläuft, aber mit dem Flag `dry_run = true`:
   - Tenant-Lookup über `landing_page.tenant_id` — meldet ✅ / ❌ inkl. `emails_paused`, `smtp_health_status`.
   - Booking-Modus + Link-Konstruktion (own booking / Calendly / Interview) — zeigt den **konkret berechneten** `confirmation_action_link`.
   - Preflight (`suppressed_emails`, Bounce-Status).
   - Edge-Function-Call **mit `[DRY-RUN]`-Präfix im Subject** an die Test-Adresse — nutzt genau denselben `send-invitation-email`-Aufruf.
   - Schreibt **keinen** Eintrag in `email_send_log` (nur Rückgabe an UI).
3. Rückgabe ist ein strukturierter Report:
   ```
   Tenant:              ✅ "Personalservice GmbH" (emails_paused=false, smtp=healthy)
   Booking-Modus:       internal (ownBookingUrl)
   Action-Link:         https://personalservice-gmbh.de/termin.buchen/abc123
   Preflight:           ✅ nicht suppressed
   Edge-Function:       ✅ HTTP 200, message_id=…
   SMTP-Zustellung:     ✅ (Testmail versendet an dich@example.com)
   ```
   Bei Fehler wird der exakt gleiche `reason`-String angezeigt, der auch im echten Flow im Log stünde.

**Damit gilt:** Wenn der Dry-Run grün ist, ist der echte Flow grün — inkl. Link-Konstruktion und Tenant-Auflösung, nicht nur SMTP.

---

## Teil C — Reihenfolge

1. Du führst die korrigierte SQL aus Teil A aus → schickst mir die Zeilen.
2. Ich fixe den 11:27-Grund gezielt (Ein-Datei-Change je nach Ursache).
3. Ich baue Teil B (Dry-Run-Button) — dann kannst du zukünftig selbst regressionssicher testen, ohne echte Bewerber zu brauchen.

---

## Technische Notizen

- Neue Datei: `src/lib/application-dryrun.functions.ts` mit `dryRunApplicationReceived` (admin-only via `has_role` Check + `requireSupabaseAuth`).
- Refactor **minimal**: die Booking-/Link-Logik aus `src/routes/api/public/applications.ts` (Zeilen ~515–560, ~636–684) wird in eine reine Helper-Funktion `buildApplicationReceivedContext(app, tenant, landing)` extrahiert, die beide Pfade (echt + dry-run) verwenden — kein Verhaltensdrift möglich.
- UI: neuer Tab „Dry-Run" in `src/routes/admin.email-templates.tsx` mit Landing-Dropdown, Test-E-Mail-Feld, Report-Ausgabe.
- Keine Migration nötig.
- Kein Cron, keine neue Edge-Function.
