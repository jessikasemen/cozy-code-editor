
## Was ich fixe

### 1) Bug: falsches `template_name` im E-Mail-Log (Reporting)
`supabase/functions/send-appointment-reminders/index.ts:173` loggt jede Interview-Einladung als `template_name: "bewerbung_magic_link"`. Versand ist korrekt, aber im Portal-E-Mail-Center werden 30-Min-Einladungen mit der generischen Magic-Link-Mail vermischt.

**Fix:** `template_name` → `"interview_invite_30min"`. Betrifft nur die Log-Zeile, keine Trigger-/Empfänger-Logik.

### 2) Kleines Robustheits-Fix im gleichen File
Im `catch`-Block wird `logEmailSend(..., renderedSubject, html, "failed", ...)` aufgerufen, obwohl `renderedSubject`/`html` erst kurz vorher im `try` deklariert sind. Wenn `renderTemplate`/`buildHtml` selbst mal wirft, ist `html` undefined → sekundärer Crash, echter SMTP-Fehler geht verloren.

**Fix:** `let renderedSubject = ""; let html = "";` vor den `try`-Block ziehen, damit das Failure-Log immer schreibt.

### 3) Deploy-Hinweis
Nur eine Edge-Function betroffen:
```
bash scripts/deploy-edge-function.sh send-appointment-reminders
```
Kein DB-Migration, kein Frontend-Deploy nötig.

---

## Weitere Ideen (nur wenn du willst — nicht Teil dieses Plans)

Nach dem Audit sehe ich **keinen echten Blocker mehr**. Folgende Punkte sind „nice-to-have", würde ich aber nur auf explizite Freigabe anfassen:

- **`send-appointment-reminders` Fenster:** 25–40 Min ist eng. Wenn Cron mal ausfällt oder verspätet läuft, verpasst ein Bewerber die Einladung ganz. Vorschlag: Fenster auf 20–45 Min öffnen + Idempotenz bleibt via `application_reminder_log`.
- **`emails_paused`-Sichtbarkeit:** Aktuell nur DB-Flag. Ein „E-Mails pausiert"-Badge im Portal-Tenant-Header würde Support-Fragen reduzieren.
- **Silent-Fail-Detektor:** Ein Portal-Widget „Akzeptierte Bewerber ohne Interview-Invite in 24h" — würde jeden künftigen Trigger-Bug in Minuten sichtbar machen statt Wochen.
- **End-to-End-Test:** Playwright-Skript, das eine Test-Bewerbung durchschickt und alle 3 erwarteten Mails (`application_received`, `booking_confirmation`, `interview_invite_30min`) im `email_send_log` verifiziert. Einmal geschrieben, jederzeit wiederholbar.

**Ready to test:** Ja, nach den 2 kleinen Fixes oben. Der Vermittlungs-Flow (30 Sends, 0 Errors, saubere Tenant-Isolation) ist produktionsreif. Die Punkte oben sind Hardening, kein Fix.

**Freigabe für Punkt 1+2?** Sag mir zusätzlich, ob du eines der 4 „Nice-to-have"-Themen mit reinnehmen willst.
