## Ziel

1. **E-Mail Center Test-Button** — für jedes aktive Template ein "Test an mich senden" ermöglichen, inkl. Live-Vorschau.
2. **Diagnose Bewerbungsmail-Fehler** (19.07., 11:27) — herausfinden, warum `application_received` fehlgeschlagen ist.

---

## Teil 1 — E-Mail Center testen

**Aktueller Stand:** In `src/routes/admin.email-templates.tsx` existiert bereits ein Test-Send-Bereich, der aber nur 8 Templates abdeckt (`employee_signup`, `reset`, `confirm`, `completion`, `no_booking`, `recovery_ma`, `chat`, `magic_link`). Es fehlen die wichtigsten Bewerber-Templates:
- `application_received` (Bewerbungsbestätigung)
- `booking_confirmation` (Terminbestätigung mit .ics)
- `app_no_booking` (Bewerber ohne Termin)
- `app_no_show` (Bewerber nicht erschienen)
- `app_registration` (Registrierungs-Erinnerung nach Zusage)
- `recovery_ma` bzw. `recovery_mitarbeiter` (Umzug)

**Umsetzung:**

- Test-Panel in `admin.email-templates.tsx` erweitern:
  - Alle Template-Keys in ein einziges Dropdown „Template auswählen" packen (aus einem zentralen Katalog-Array), inkl. der oben fehlenden.
  - Button **„An alle aktiven Templates testen"** — schickt in Reihe je eine `[TEST]`-Mail pro Template an die eingetragene Adresse, mit Sammel-Report (✅/❌ pro Template) statt einzelner Toasts.
  - Ergebnis-Liste (Template, Status, Fehlermeldung) direkt unter dem Panel — 60s sichtbar, damit man alle Ausgänge auf einen Blick sieht.
- Passende Dummy-Platzhalter pro Template (z.B. `appointment_date`, `calendly_link`, `partner_name`) einmalig zentral definieren, damit Templates mit Bewerber-Variablen nicht als „Roh-Platzhalter" ankommen.
- Betreff jeder Test-Mail bekommt Präfix `[TEST]` (bereits vorhanden), Adressat = eingetragene Adresse + Button „Meine E-Mail übernehmen" (bereits vorhanden).

Keine neuen DB-Tabellen, keine neue Edge-Function — nur der bestehende `send-invitation-email`-Aufruf mit `templateName`.

---

## Teil 2 — Diagnose „Bewerbungsmail fehlgeschlagen · 19.07., 11:27"

**Erste Schritte** (rein lesend, kein Code):

1. `reminder_log` per SQL prüfen für Zeitraum 19.07. 11:20–11:35, `template = 'application_received'`, `status = 'failed'`.
   → Feld `error` enthält den konkreten Grund (SMTP down, `confirmation_action_link_missing`, `tenant_lookup_failed`, `preflight`-Fehler, HTTP-Statuscode der Edge-Function …).
2. Edge-Function-Logs `send-invitation-email` für denselben Zeitraum (bei Self-Hosted Supabase über `docker logs supabase-edge-functions` bzw. `supabase functions logs`).
3. Betroffene `applications`-Zeile prüfen: `email`, `tenant_id`, `portal_url`, `flow_type`, `is_test`, `landing_page_id` — damit klar ist, ob z.B. der Portal-Link oder Booking-Link fehlte (siehe Codepfad in `src/routes/api/public/applications.ts:636–684`).

**Häufige Ursachen laut Codepfad:**
- `confirmation_action_link_missing` — weder Booking-Link noch Portal-URL bekannt (Tenant hat keine `primary_domain`, Landing setzt keine).
- `tenant_lookup_failed` / `emails_paused` — Tenant deaktiviert oder SMTP pausiert.
- `send-invitation-email HTTP 5xx` — SMTP-Credentials falsch/abgelaufen, Rate-Limit.
- `mail_function_env_missing` — `SUPABASE_URL`/`SERVICE_ROLE_KEY` in TanStack-Server-Runtime fehlt.

**Fix hängt vom gefundenen Grund ab** — wird nach der SQL-Abfrage nachgezogen. Kein spekulativer Fix vorab, damit wir nicht die falsche Ursache patchen.

---

## Technische Notizen

- Datei: `src/routes/admin.email-templates.tsx` (Panel-Erweiterung um alle Templates + Sammel-Report).
- Keine Migration nötig.
- SQL für Diagnose (Beispiel, wird via Supabase-SQL-Tab ausgeführt):

```sql
select sent_at, email, tenant_id, reminder_type, status, error
from reminder_log
where reminder_type = 'application_received'
  and sent_at between '2026-07-19 09:00' and '2026-07-19 12:00'
order by sent_at desc;
```

## Reihenfolge

1. Diagnose-SQL laufen lassen → Ursache bestätigen → gezielten Fix committen.
2. Danach E-Mail-Center-Erweiterung ausrollen, damit du künftig alle Templates auf Knopfdruck durchtesten kannst.