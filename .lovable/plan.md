## Ziel

Nach Bewerbung soll **„Jetzt Termin buchen"** kommen (eigenes Buchungssystem statt Calendly / statt direktem KI-Interview). Nach der Terminwahl soll die **Event-Beschreibung** (mit Portal-/Interview-Link) auf der Bestätigungsseite sichtbar sein.

## Root Cause

In `src/routes/api/public/applications.ts` ist die Redirect-Priorität heute:

```text
useInterview  →  ownBookingUrl (internes Buchungssystem)  →  broker  →  fast  →  Calendly
```

Auf `personalservice-gmbh.de` hat die Landing `interview_mode = chat/voice/both`, dadurch gewinnt **useInterview** und der Bewerber landet direkt auf `/interview/:id` mit dem Button „Bewerbungsgespräch starten →". Der Buchungs-Kalender (`booking_mode='internal'` + aktiver `availability_schedule`) wird nie erreicht, obwohl Slots angelegt sind.

Zusätzlich zeigt `termin.buchen.$token.tsx` die `event_description` bisher nur **vor** der Buchung. Nach der Buchung sieht der Bewerber nur Datum/Uhrzeit — der Portal-/Interview-Link aus der Beschreibung fehlt.

## Änderungen

### 1) Priorität umdrehen — `src/routes/api/public/applications.ts`

Wenn die Landing ein aktives internes Buchungssystem hat, geht **Buchung vor Interview**:

```text
ownBookingUrl  →  useInterview  →  broker  →  fast  →  Calendly
```

Konkret: den `if (useInterview) … else if (ownBookingUrl)` Block tauschen zu `if (ownBookingUrl) … else if (useInterview)`. `ownBookingUrl` wird bereits vor dem Redirect-Block ermittelt und ist nur gesetzt, wenn tatsächlich ein aktiver internal-Kalender existiert — es entstehen also keine Regressions für Landings ohne Buchungssystem.

Der bestehende `ctaMeta`-Regex `/\/buchen\//` in `src/landing-themes/_shared/form-section.js` matcht den neuen Redirect automatisch und zeigt den Button **„Jetzt Termin auswählen →"** (Label lässt sich bei Bedarf auf „Jetzt Termin buchen" ändern, falls gewünscht).

### 2) Event-Beschreibung auf Bestätigungsseite — `src/routes/termin.buchen.$token.tsx`

Die `BookingConfirmed`-Komponente bekommt eine neue Prop `eventDescription?: string`. Wenn gesetzt, wird sie direkt unter Datum/Uhrzeit als Info-Box gerendert (gleiche Optik wie oben vor der Buchung: `rounded-md border bg-muted/40 p-4 text-sm whitespace-pre-wrap`). Damit sieht der Bewerber unmittelbar nach der Buchung den Portal-/Interview-Link, den der Admin in `landing_pages.event_description` gepflegt hat.

Der Wert kommt aus `s.event_description`, das bereits über `get_schedule_for_application` geladen wird — keine DB-Änderung, keine neue Migration.

## Nicht Teil dieses Fixes

- Keine Änderung an Templates, E-Mail-Versand, Redaktion der Beschreibung.
- Keine Änderung am Buchungs-Ablauf selbst (Kalender-UI, Slot-Auswahl, Cancel-Flow bleiben identisch).
- Interview-Landings ohne aktiven internen Kalender bleiben unverändert (dort greift weiterhin `useInterview`).