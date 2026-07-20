# Klare SMTP-Trennung pro E-Mail-Typ

## Ziel

Jede E-Mail-Art bekommt EINEN festen Absender-Tenant – unabhängig davon, welche `applications.tenant_id` gerade gespeichert ist. Damit ist Schluss mit „mal Fast-Track, mal Vermittlung, mal falsch".

## Routing-Matrix (Single Source of Truth)

| E-Mail | Absender-SMTP | Auslöser |
|---|---|---|
| Bewerbungsbestätigung („Kein Termin gebucht") | **Vermittlung** (source_landing.tenant) | Bewerbung ohne Termin |
| No-Booking Reminder 24h/72h | **Vermittlung** | Cron |
| No-Show Reminder | **Vermittlung** | Cron |
| Interview-Einladung (Terminlink) | **Vermittlung** | Bewerbungseingang |
| Terminbestätigung + ICS | **Vermittlung** | Buchung |
| E-Mail-Bestätigung (Double-Opt-In) | **Fast-Track** (portal-tenant) | Nach Zusage / Registrierung |
| „Registrierung abschließen" (Ausweis/Vertrag fehlt) | **Fast-Track** | Portal-Onboarding |
| „Keine Auftrags-Buchung seit 7 Tagen" | **Fast-Track** | Cron über Mitarbeiter-Tabelle |
| Chat-Reminder | **Fast-Track** | Ungelesene Chatnachricht |

## Architektur: ein zentraler Resolver

Neuer Helper `resolveSenderTenant(kind, application)` – EINE Funktion, die für jede E-Mail den richtigen Tenant liefert. Alle Sende-Funktionen (Edge + Server) rufen ausschließlich diesen Helper auf. Keine Ad-hoc-Logik mehr in einzelnen Functions.

```text
kind → tenant lookup
──────────────────────────────────────────
broker_*        → application.source_landing.tenant_id
fasttrack_*     → application.target_landing.tenant_id
                  ?? source_landing.linked_fasttrack_landing.tenant_id
                  ?? application.tenant_id (Fallback + Warn-Log)
```

Wenn kein passender Tenant existiert oder SMTP fehlt → **skip + Log**, kein Fallback auf falschen Tenant.

## Umsetzung

### Backend
1. **Neu**: `supabase/functions/_shared/sender-resolver.ts` mit `resolveSenderTenant(admin, kind, application)` und `EmailKind`-Enum.
2. **Refactor**: `send-application-reminders`, `send-booking-confirmation`, `send-invitation-email`, `send-reminders`, `send-chat-reminder`, `process-invite-resend-queue` – jede Function nutzt Resolver, nicht `application.tenant_id` direkt.
3. **Cron neu**: `send-fasttrack-no-order-reminder` (7 Tage kein gebuchter Auftrag) – Query gegen employees/orders, sendet über Fast-Track-Tenant.
4. **Migration** `20260729000000_email_routing_columns.sql`: sichere Spalten (`applications.broker_tenant_id`, `fasttrack_tenant_id`) + Backfill aus vorhandenen Landing-Beziehungen. Erleichtert Resolver ohne 3 Joins.

### Frontend / Admin
5. Neuer Tab **„E-Mail-Routing"** im E-Mail-Center: zeigt pro Bewerbung, welcher Tenant welche Mail senden würde (Dry-Run), plus Ampel für fehlende SMTP-Configs.
6. Landing-Generator: Validierungshinweis, wenn Broker-Landing kein `linked_fasttrack_landing_id` hat → sonst können Fast-Track-Mails nicht routen.

### Aufräumen
7. In allen Edge Functions: alte `tenantMap.get(appt.tenant_id)`-Zugriffe entfernen, durch Resolver-Ergebnis ersetzen.
8. `email_send_log.metadata` bekommt `sender_kind` + `resolved_tenant_id` für Nachvollziehbarkeit.

## Technische Details

- `EmailKind = 'broker_confirmation' | 'broker_no_booking' | 'broker_no_show' | 'broker_interview_invite' | 'broker_booking_confirmation' | 'fasttrack_email_verify' | 'fasttrack_registration_complete' | 'fasttrack_no_order_7d' | 'fasttrack_chat_reminder'`
- Resolver returned `{ tenant, kind, reason }` – bei `reason='missing_fasttrack_link'` wird die Mail geskippt und im Log sichtbar.
- Cron `send-fasttrack-no-order-reminder` läuft täglich 09:00; Query: aktive Mitarbeiter, kein `orders`-Eintrag in 7 Tagen, gruppiert pro Fast-Track-Tenant.

## Test-/Rollout-Plan

1. Migration + neue Function deployen (bricht nichts – Resolver mit Fallback aktiv).
2. Im E-Mail-Center „Routing"-Tab prüfen: alle produktiven Bewerbungen zeigen erwarteten Sender.
3. Testbewerbung: Vermittlungs-Landing → Bestätigung kommt von Vermittlungs-SMTP; nach manueller Zusage → Registrierungsmail von Fast-Track-SMTP.
4. Legacy-Aufräum-Migration setzt alte falsche `email_send_log`-Einträge nicht zurück (nur Doku).

## Nicht enthalten

- Kein Redesign der Templates
- Kein Umbau des Buchungsflows
- Keine Änderung an Auth-Emails (Supabase Auth Hooks bleiben wie sie sind)
