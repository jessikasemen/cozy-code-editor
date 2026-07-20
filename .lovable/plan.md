## Problem

`git pull` auf dem Server bricht ab:

```
error: Your local changes to the following files would be overwritten by merge:
        src/routeTree.gen.ts
Aborting
```

`src/routeTree.gen.ts` wird vom TanStack Router Vite-Plugin bei jedem Dev/Build automatisch neu generiert. Auf dem Server hat ein vorheriger Build die Datei lokal verändert → Git verweigert das Update.

Die Datei ist auto-generiert, darf **nie manuell editiert** werden und wird beim nächsten Build sowieso vom Plugin überschrieben. Lokale Änderungen daran sind irrelevant und können bedenkenlos verworfen werden.

## Lösung (nur Server-Kommandos, kein Code-Change nötig)

Auf dem Frontend-Server (`/opt/apps/portal`) ausführen:

```bash
cd /opt/apps/portal
git checkout -- src/routeTree.gen.ts   # lokale Änderungen verwerfen
git pull                                # zieht jetzt sauber
bash scripts/deploy-backend.sh          # Backend
sudo bash scripts/deploy.sh             # Frontend
```

Damit sind die zuletzt committeten Änderungen live:
- Chat-Reminder auch ohne ungelesene Nachrichten
- Manuelle Sperre einer E-Mail-Adresse im Panel *Gesperrte Empfänger*
- `send-signup-confirmation` prüft beide Suppression-Tabellen

## Damit das nicht wieder passiert (optional, 1 Code-Änderung)

`src/routeTree.gen.ts` in `.gitignore` aufnehmen, damit lokale Regenerierungen auf dem Server nie mehr mit `git pull` kollidieren. Die Datei bleibt im Repo (für den initialen Checkout), aber Änderungen daran werden ignoriert.

Sag mir, ob ich diesen `.gitignore`-Fix jetzt mit einbauen soll oder ob dir das reine Server-Kommando reicht.
