## Aktueller Befund

- **Reminder-Fehler:** Der Screenshot zeigt `InvalidWorkerCreation: worker boot error: failed to boot script: could not find an appropriate entrypoint`. Das ist kein SMTP-/Template-Fehler, sondern die Edge Function startet gar nicht. Der Button ruft `send-chat-reminder` auf. Im Repo existiert `supabase/functions/send-chat-reminder/index.ts`, aber live wirkt es so, als ob die Function im Backend-Container fehlt, falsch synchronisiert wurde oder der Functions-Container noch einen alten/kaputten Stand lädt.
- **Frontend-Pfad:** Für den Portal-/Frontend-Server ist laut Deploy-Script **nicht** `/dev-server` der Zielpfad, sondern standardmäßig `/opt/apps/portal`. `/dev-server` ist der Editor-/Sandbox-Pfad hier in Lovable. Auf deinem Server solltest du das Portal-Deploy über `/opt/apps/portal/scripts/deploy.sh` ausführen.
- **Landing-/Terminbuchungs-Loop:** Der Inline-Kalender lädt über die Landing-Seite `window.PORTAL_API` und baut daraus `/api/public/booking`. Der Code dafür ist vorhanden. Wenn nach Resync weiterhin die alte/loopende Oberfläche kommt, sind wahrscheinlich nicht alle drei Ebenen aktualisiert: Portal-Frontend, Backend/Functions/SQL und Landing-Renderer/Themes. Zusätzlich sehe ich eine mögliche Ursache im Buchungs-RPC: Slots dürfen mehrfach angezeigt werden, aber beim eigentlichen Insert kann noch eine Konfliktregel aus der DB aktiv sein, falls die Migration `20260722000000_booking_window_28_days.sql` nicht wirklich angewendet wurde.

## Plan

1. **Chat-Reminder live wiederherstellen**
   - Sicherstellen, dass `send-chat-reminder` wirklich auf den self-hosted Backend-Server nach `volumes/functions/send-chat-reminder/index.ts` synchronisiert wurde.
   - Danach den Edge-Functions-Container neu starten.
   - Optional: einen direkten `curl` gegen `/functions/v1/send-chat-reminder` testen, damit wir zwischen „Function bootet“ und „Versandlogik/SMTP“ unterscheiden.

2. **Buchungs-Loop gezielt prüfen**
   - Live im Browser-Netzwerk prüfen, ob beim Klick auf einen Slot `/api/public/booking?action=book` aufgerufen wird und welcher Status/Body zurückkommt.
   - Falls `slot_taken`, `500` oder kein Request erscheint, jeweils den passenden Fix setzen:
     - kein Request: Landing-JS/Resync/Cache-Problem,
     - `slot_taken`: DB-Konfliktregel oder alte Buchungsfunktion noch aktiv,
     - `500`: serverseitiger RPC-/Env-/API-Fehler.

3. **DB-Migration für Mehrfachbuchung verifizieren**
   - Prüfen, ob die Overlap-Constraint auf `interview_appointments` live wirklich entfernt ist.
   - Prüfen, ob `get_free_appointment_slots` live bereits die Version ohne Konfliktprüfung ist.
   - Falls nicht: Migration erneut über das Backend-Deploy oder manuell anwenden.

4. **Deploy-Reihenfolge klarziehen**
   - Portal/Frontend: auf Server 2 ausführen:
     ```bash
     cd /opt/apps/portal
     bash scripts/deploy.sh
     ```
   - Backend/Functions/SQL: aus deinem lokalen Repo/Clone ausführen:
     ```bash
     bash scripts/deploy-backend.sh
     ```
   - Landing-Server/Themes: danach Landing-Renderer neu starten bzw. Themes resyncen, damit `/script.js` die aktuelle Inline-Buchung wirklich ausliefert.

5. **Nachweise nach dem Fix**
   - Reminder-Button: Function bootet, liefert keinen `InvalidWorkerCreation` mehr.
   - Landing-Buchung: Slot auswählen erzeugt einen erfolgreichen `book`-Call und zeigt „Termin bestätigt“.
   - E-Mail-Flow: Nach Terminbuchung wird der Status in der Bewerbung gesetzt und die Bestätigung kann versendet werden.