## Root Cause

Ich habe die **live ausgelieferte** `https://personalservice-gmbh.de/script.js` heruntergeladen und mit unserer aktuellen Source `src/landing-themes/_shared/form-section.js` verglichen.

Im Live-Script fehlen genau diese zwei Zeilen (Source Zeile 238–239):

```js
if(form)form.style.display='none';
if(statusEl)statusEl.style.display='none';
```

Deshalb bleibt im Modal das Formular + der grüne Status-Text „Bewerbung erfolgreich gesendet." sichtbar, obwohl der Kalender darunter korrekt eingeblendet wird. Der Fix ist im Portal-Code vorhanden, wurde aber **nicht** in die `script.js` auf den Landing-Servern übertragen.

## Warum passiert das?

- `form-section.js` wird per `?raw` in den Portal-Build eingebettet (`src/lib/landing-themes.ts`).
- Die Landing-Server erhalten `script.js` **nur** über einen manuellen **„Themes resync"** aus dem Portal.
- Entweder wurde der Resync vor dem letzten Portal-Deploy ausgeführt, oder er hat für die Landing `personalservice-gmbh.de` nicht gegriffen (z. B. Cache/Fehler stumm).

## Fix — kein Code-Change nötig

Der Code ist bereits korrekt. Es fehlt nur die Auslieferung.

1. **Portal-Frontend deployen** (falls seit dem Fix nicht mehr passiert):
   ```bash
   cd /opt/apps/portal && sudo bash scripts/deploy.sh
   ```
2. **Im Portal-Admin** auf die Landing `personalservice-gmbh.de` gehen → **„Themes resync"** klicken.
3. **Verifikation** (auf dem Server oder lokal):
   ```bash
   curl -s https://personalservice-gmbh.de/script.js | grep -c "form.style.display='none'"
   ```
   Erwartet: `2`. Aktuell: `0`.
4. Browser-Hard-Reload (Ctrl+F5) auf der Landing, Testbewerbung, prüfen dass Formular verschwindet, sobald der Kalender erscheint.

Falls Schritt 3 nach dem Resync weiter `0` liefert, ist die Landing-Server-Sync-Route der eigentliche Bug — dann schaue ich in `src/lib/landing-servers.functions.ts` und die Landing-Server-Route, ob `script.js` wirklich überschrieben oder nur mit stale Cache erneut ausgeliefert wird.
