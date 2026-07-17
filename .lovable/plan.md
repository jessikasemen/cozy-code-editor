## Ziel
Bei einer Bewerbung über die Vermittlungs-Landing `personalservice-gmbh.de` soll im Success-Modal nach „✅ Bewerbung eingegangen" der Button **„Jetzt Termin auswählen"** (eigenes Buchungssystem) erscheinen. Aktuell fehlt er.

## Wie der Button entsteht (Code-Fakten)

`src/routes/api/public/applications.ts` liefert im POST-Response:
- `redirect_url` → gesetzt, wenn ein **eigenes** Buchungssystem greift (`/termin/buchen/<magic_token>`)
- `broker.calendly_url` → gesetzt bei broker+Calendly-Flow

`src/landing-themes/_shared/form-section.js` zeigt den Button nur, wenn eines von beiden gefüllt ist. Fehlen beide → stiller Text ohne CTA (genau das aktuelle Symptom).

`redirect_url` fürs eigene Buchungssystem wird nur gebildet, wenn **alle** folgenden Bedingungen erfüllt sind (Zeilen 294–344 in `applications.ts`):

1. `d.is_test = false` und `flow_type ≠ 'fast'`
2. `d.portal_url` ist im Formular-POST gesetzt (`window.PORTAL_URL` in `form-section.js`)
3. Für Source-Landing **oder** verlinkte Ziel-Landing existiert eine Zeile in `availability_schedules` mit `active = true`
4. Genau diese Landing (nicht irgendeine andere) hat `booking_mode = 'internal'` — das wird per `landing_pages!inner(booking_mode).eq('landing_pages.booking_mode','internal')` gefiltert

Wichtig: Wenn der Zeitplan auf Landing A liegt, `booking_mode='internal'` aber auf Landing B, matcht nichts.

## Diagnose-Schritte (was ich als Erstes prüfe)

1. **Landing-Row lesen** (`landing_pages` where domain oder slug matcht personalservice-gmbh.de):
   - `flow_type` = `'broker'`?
   - `booking_mode` = `'internal'`?
   - `linked_fasttrack_landing_id` = ?
   - `partner_company_id` = ?
   - `id`, `slug`

2. **`availability_schedules`** where `landing_page_id IN (id, linked_fasttrack_landing_id)` UND `active = true` — mind. ein Treffer?

3. **Wenn Zeitplan auf verlinkter Landing liegt:** hat diese Landing ebenfalls `booking_mode='internal'`? (der Inner-Join filtert auf die Landing des Zeitplans, nicht auf die Source-Landing)

4. **Server-Logs** von `/api/public/applications` bei einer Testbewerbung: die `has_redirect`/`has_broker`-Log-Zeile zeigt sofort, welcher Zweig griff.

5. **Live-Formular in der Landing**: `window.PORTAL_URL` und `window.FLOW_TYPE` im DevTools-Console prüfen — falls `PORTAL_URL` leer ist, wird `ownBookingUrl` nie gebildet.

## Erwartete Root-Causes (Priorität)

- **A (wahrscheinlichste)**: `booking_mode` steht nicht auf `internal` — weder auf der Source-Landing noch auf der Landing, an der der aktive Zeitplan hängt. Fix: Landing im Landing-Generator auf „eigenes Buchungssystem" umstellen (bzw. an der Landing, wo die Verfügbarkeit angelegt ist).
- **B**: Verfügbarkeit ist zwar angelegt, aber am „falschen" Landing-Datensatz (z. B. an einer Ziel-Landing, während das Formular auf einer anderen Source-Landing läuft und `linked_fasttrack_landing_id` nicht auf die richtige zeigt). Fix: `linked_fasttrack_landing_id` setzen oder Zeitplan an der Source-Landing anlegen.
- **C**: `window.PORTAL_URL` wird von der Landing nicht ausgeliefert (Template baut es nicht ein). Fix: im generierten `template.html`/Kopf-Script sicherstellen, dass `window.PORTAL_URL` gesetzt wird.
- **D**: `flow_type` auf der Landing/im Formular ist noch `classic` statt `broker` → Broker-Zweig greift nicht.

## Ausführung (nach Approval)

1. In Build-Mode wechseln, Lovable Cloud (Supabase) prüfen; falls die DB-Tools verfügbar sind: obige 3 Diagnose-Queries fahren und Root-Cause festnageln.
2. Root-Cause beheben — je nach A/B/C/D:
   - A/B: Daten-Fix per SQL (`UPDATE landing_pages SET booking_mode='internal' WHERE …` bzw. `linked_fasttrack_landing_id` setzen). **Kein Code-Change nötig.**
   - C: Template-Generator so anpassen, dass `window.PORTAL_URL` immer eingesetzt wird (Code-Fix in `landing-generator.functions.ts` bzw. Theme-Template-Kopf).
   - D: Landing-Row auf `flow_type='broker'` setzen.
3. Verifikation: mit `stack_modern--invoke-server-function` einen Test-POST an `/api/public/applications` mit `is_test:false` und den echten Landing-Daten schicken und prüfen, dass `redirect_url` oder `broker.calendly_url` im Response steht.
4. Manuell auf personalservice-gmbh.de eine Test-Bewerbung absetzen und den Button verifizieren.

Kein UI-Fallback im Modal (per deinem Wunsch) — nur Root-Cause.
