## Ziel

1. Bewerber sehen **die ganzen 4 Wochen auf einen Blick** — kein Wochen-Skippen mehr.
2. Slots sind **nicht mehr blockierbar** — mehrere Bewerber (z. B. 10) können denselben Slot am 17.07. um 18:00 buchen.

## Änderungen

### 1) Buchungsfenster wieder auf 28 Tage (statt 60)

`supabase/manual-migrations/20260722000000_booking_window_28_days.sql` (neu):
- `ALTER TABLE availability_schedules ALTER COLUMN max_days_ahead SET DEFAULT 28;`
- `UPDATE availability_schedules SET max_days_ahead = 28 WHERE max_days_ahead <> 28;`

### 2) Slot-Blockierung entfernen (Multi-Buchung erlauben)

Selbe Migration:
- `ALTER TABLE interview_appointments DROP CONSTRAINT IF EXISTS interview_appointments_no_overlap;` — der GiST-EXCLUDE-Constraint verhindert aktuell parallele Buchungen im selben Zeitraum.
- `CREATE OR REPLACE FUNCTION public.get_free_appointment_slots(...)` — Konfliktprüfung `NOT EXISTS (SELECT 1 FROM interview_appointments ... && ...)` **entfernen**, damit jeder generierte Slot immer sichtbar bleibt, egal wie viele Buchungen schon existieren.
- `book_appointment_by_token`: `EXCEPTION WHEN exclusion_violation` bleibt drin (harmlos, kann jetzt nicht mehr feuern). `already_scheduled`-Check pro Application bleibt (ein Bewerber = ein Termin).

### 3) Landing-Inline-Kalender: 4 Wochen komplett anzeigen

`src/landing-themes/_shared/form-section.js`:
- `state.weekStart` → `state.rangeStart` (immer heute, 0:00).
- Wochen-Navigation (`prev`/`next`) und Label komplett entfernen.
- Slots einmalig für **28 Tage** (`from = heute`, `to = heute + 27`) laden.
- Tage-Grid: statt `grid-template-columns: repeat(7,1fr)` × 1 Reihe → `repeat(7,1fr)` × 4 Reihen (28 Buttons, chronologisch). Auf schmalen Screens `repeat(4,1fr)`/`repeat(2,1fr)` per einfachem `@media`-Inline-Fallback bzw. `auto-fill,minmax(60px,1fr)`.
- Der Rest (Tag auswählen → Zeiten unten anzeigen → buchen) bleibt.

### 4) Portal-Buchungsseite (`/termin/buchen/:token`) analog

`src/routes/termin.buchen.$token.tsx`:
- `DAYS_PER_VIEW = 28`.
- Zurück/Weiter-Buttons und Range-Header entfernen (nur noch ein statischer Titel „Freie Termine – nächste 4 Wochen").
- Grid: 4 Reihen × 7 Tage, jede Zelle wie bisher mit Zeiten drunter — oder pro Tag als Karte in einem Wrap-Grid. Bestehende Logik `slotsByDay` bleibt.

## Deployment

```bash
cd /opt/apps/portal && git pull
bash scripts/deploy-backend.sh   # neue Migration + Constraint-Drop
sudo bash scripts/deploy.sh      # neues Portal + neues script.js
```
Danach im Portal auf `personalservice-gmbh.de` **„Themes resync"**.

## Hinweise / Trade-offs

- Ohne den Overlap-Constraint kann ein Slot beliebig oft gebucht werden — genau das, was du willst. Es gibt aber danach **keine harte DB-Garantie** mehr gegen unbeabsichtigte Doppelbuchungen; falls du später doch eine Obergrenze pro Slot willst (z. B. „max. 10"), müssen wir eine `slot_capacity`-Spalte + Count-Check einführen.
- Die vorher gesetzte 60-Tage-Migration bleibt bestehen; die neue setzt aktiv auf 28 zurück (idempotent, überschreibt sauber).
