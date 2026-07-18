## Ziel
Kritischer End-to-End-Test: Für jeden Bewerber-Status prüfen, ob die richtige E-Mail an den richtigen Empfänger rausgeht — sowohl **Trigger-Seite** (App-Code / Cron) als auch **Delivery-Seite** (SMTP, Logs).

## Test-Matrix (Status → Template → Trigger → Empfänger)

| # | Status / Event | Template | Trigger | Empfänger |
|---|---|---|---|---|
| 1 | Bewerbung eingegangen (Vermittlung) | `bewerbung_magic_link` | `POST /api/public/applications` | Bewerber |
| 2 | Termin gebucht | `booking_confirmation` | Booking-API + `send-booking-confirmation` | Bewerber |
| 3 | 30 Min vor Interview | `interview_invite_30min` | Cron `send-reminders-hourly` | Bewerber |
| 4 | Kein Termin nach 7 Tagen | `no_booking_7d` | Cron `send-application-reminders` | Bewerber |
| 5 | No-Show Interview | `no_show_interview` | Cron `auto_complete_appointments` | Bewerber |
| 6 | Bewerber angenommen / Glückwunsch | `congrats_hired` | Portal-Aktion (Recruiter Button) | Bewerber |
| 7 | Registrierung abschließen | `signup_complete_reminder` | Cron `process-invite-resend-queue` | Bewerber |
| 8 | E-Mail bestätigen | `signup_confirmation` | Auth-Event → `send-signup-confirmation` | Bewerber |
| 9 | Onboarding | `onboarding_welcome` | Nach Registrierung | Mitarbeiter |
| 10 | Chat-Reminder (manuell) | `chat_reminder` | Admin-Button in `/admin/chat` | Bewerber |

## Vorgehen (3 Phasen)

### Phase 1 — Read-Only Audit (SQL, keine Änderungen)
Für jeden der 10 Punkte prüfen:
- **Trigger existiert?** (Cron-Job aktiv / Code-Pfad vorhanden)
- **Template im Code registriert?** (`template_name` matched)
- **Letzter erfolgreicher Send** in den letzten 30 Tagen?
- **Recipient-Mapping korrekt?** (Bewerber vs. Recruiter vs. Admin)
- **Fehler-Rate?** (Ratio `failed` / `sent` in `email_send_log`)

Ergebnis: Tabelle mit ✅/⚠️/❌ pro Zeile.

### Phase 2 — Recipient-Mapping-Check (Code-Audit)
Für jede Edge-Function / jeden Trigger prüfen, ob der `to`-Parameter tatsächlich der erwartete Empfänger ist:
- `send-reminders` → `candidate.email` (nicht `recruiter.email`)
- `send-booking-confirmation` → `appointment.candidate_id → candidate.email`
- `send-appointment-reminders` → gleicher Weg
- Kein Cross-Tenant-Leak (Bewerber A bekommt keine Mail von Tenant B)

### Phase 3 — Live-Test-Vorschlag (optional, nur wenn du willst)
Ein synthetischer Bewerber durchläuft alle Status, wir beobachten Logs. Alternativ: bestehende echte Bewerbungen der letzten 24h forensisch nachverfolgen (welche Mails hätten kommen sollen, welche kamen tatsächlich).

## Was ich brauche
Sag mir, welche Phase(n) du willst:
- **A) Nur Phase 1** (schneller SQL-Audit, ~10 Min) — empfohlen als Start
- **B) Phase 1 + 2** (SQL + Code-Review, gründlich)
- **C) Alles inkl. Live-Test** (Phase 3 dauert länger, braucht Test-Bewerber)

Und: soll ich Fixes gleich mit einbauen, wenn ich Lücken finde (z. B. falsches Template-Label, fehlender Cron), oder erst nur reporten?

## Technische Details
- SQL läuft gegen Backend (`docker exec supabase-db psql`)
- Code-Audit: `send-reminders`, `send-booking-confirmation`, `send-signup-confirmation`, `send-appointment-reminders`, `process-invite-resend-queue`, `auto_complete_past_appointments`
- Output: Markdown-Tabelle mit Status pro Template + konkrete Fix-Vorschläge bei ⚠️/❌
