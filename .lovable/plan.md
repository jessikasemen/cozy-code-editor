## Plan

1. **Logo-Ausgabe zuverlässig machen**
   - Die Mail-Templates nutzen bereits den neuen Corporate-Minimalist-Wrapper und beide relevanten Functions wurden laut Deployment-Log deployed.
   - Ich passe die Logo-Erkennung so an, dass neben `https://...` auch typische öffentliche Storage-/Asset-Pfade sauber zu vollwertigen Mail-URLs aufgelöst werden.
   - Falls ein Logo nicht öffentlich erreichbar ist, soll nicht einfach still die Wortmarke erscheinen, sondern im E-Mail-Log nachvollziehbar werden, warum kein Bild verwendet wurde.

2. **Logo-Quelle vereinheitlichen**
   - Für Bewerbungsbestätigung und Terminbestätigung wird dieselbe Reihenfolge verwendet:
     1. Tenant-Logo
     2. Fast-Track-Landing-Logo
     3. Ziel-Landing-Logo
     4. Quell-/Vermittlungs-Landing-Logo
   - Relative Landing-Assets werden gegen die jeweilige Landing-Domain absolut gemacht.
   - Broker-/Vermittlungsflows bekommen weiterhin die richtige Fast-Track-Portal-Domain für Termin-/Portal-Links.

3. **E-Mails seriöser machen**
   - In der Terminbestätigung sind noch Kalender-/Uhr-Emojis im Standardtext vorhanden. Ich entferne diese aus dem Standardbody.
   - Den Header belasse ich schlicht: Logo oder saubere Wortmarke, keine defekten Bild-Icons.

4. **Debug-Information für den nächsten Test ergänzen**
   - Beim Versand wird in `email_send_log.metadata` gespeichert, welche Logo-URL tatsächlich verwendet wurde und aus welcher Quelle sie kam.
   - So kann nach einem Test eindeutig geprüft werden, ob die Datenbank kein Logo liefert, die URL falsch ist oder der Mail-Client das Bild blockiert.

5. **Verifikation**
   - Nach Umsetzung prüfen wir per Code, dass beide Mail-Flows den gleichen Logo-Resolver verwenden.
   - Danach reicht ein Backend-Deploy und ein Testversand; anschließend kann man im E-Mail-Log die verwendete Logo-URL kontrollieren.