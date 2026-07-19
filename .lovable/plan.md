## Ziel

Ein neues Landing-Page-Theme **"Editorial Premium"** hinzufügen, das sich bewusst von den bestehenden 19 SaaS-Themes abhebt — editorial, magazinartig, hochwertig, mit großer Typografie, viel Weißraum und dezenten Animationen.

## Was gebaut wird

**Neuer Theme-Ordner:** `src/landing-themes/theme-editorial-premium/`
- `template.html` — Semantischer Aufbau mit editierbaren Slots (`data-editable`)
- `style.css` — Design-System (Tokens, Typografie, Layout, Dark/Light Mode)
- `script.js` — Scroll-Animationen (IntersectionObserver), Number-Counter, Parallax
- `meta.json` — Slot-Registry für den Landing-Generator
- Illustrationen als inline SVG im Template (Geräte, Lupe, Checklisten, abstrakte Formen)

**Neue Form-Section-Variante:** `src/landing-themes/_shared/form-section-editorial.{html,css}` — passend zum editorial Look (großzügig, serifenlastig, dezenter Akzent).

**Registrierung:** `src/lib/landing-themes.ts` erweitern (Imports + Registry-Eintrag inkl. Form-Variante).

## Design-Direktion

**Farbwelt (dezent, dezent, dezent):**
- Base: `#ffffff` / `#f7f5f0` (Sand) / `#eeece6` (Hellgrau) / `#1a1a1a` (Anthrazit) / `#000`
- Akzent: **Royal Blue** `#1e40ff` (dezent, nur für CTA + wenige Highlights)
- Nur sanfte Gradients (radial, low-opacity)

**Typografie:**
- Headlines: `Fraunces` (Serif Display, variable) — sehr groß (clamp bis 8rem), enges Tracking
- Body: `Inter Tight` / `General Sans`-Feel via `Inter` (500)
- Labels/Nummern: `JetBrains Mono` für "01 / 02 / 03" Kapitel-Nummerierung

**Layout-Moves:**
- Asymmetrische 12-col Grids, Content bricht bewusst aus
- Große Chapter-Nummern links am Rand ("01 — Warum")
- Überlappende Elemente (Bild ragt in Text hinein)
- Sehr viel Whitespace (Section-Padding 10-16rem vertikal)
- Horizontale Sektionen für Leistungen (nicht Cards)

## Sektionen (Storytelling-Flow)

1. **Hero** — Split-Layout: links große Headline "Digitale Qualität entscheidet…", rechts eine komponierte SVG-Illustration (Devices + Lupe + Check-Siegel + schwebende Kreise)
2. **Kapitel 01 — Warum Qualität entscheidet** — Editorial-Textblock + große Illustration rechts, Marginal-Note links
3. **Kapitel 02 — Prüfprozess** — Große nummerierte Schritte (01–04) mit Icons, vertikal gestapelt, jede Nummer als Display-Type
4. **Kapitel 03 — Vorher / Nachher** — Split-Screen mit animiertem Slider/Fade, "Vorher" (fehlerhaft) ↔ "Nachher" (poliert)
5. **Kapitel 04 — Leistungen** — 4 horizontale Full-Width-Bänder (Web / App / Software / Reports), jeweils mit Illustration links, Text+CTA rechts, alternierend
6. **Zahlen** — Riesige animierte Counter (25.000+ / 98% / 1.500+ / 40+), 4-spaltig, minimalistisch
7. **Tester werden** — Emotionaler Block mit Bildkomposition, Headline groß, CTA
8. **Unternehmen** — Illustrationen-Wall (Website/App/Cloud/Bug/Report als komponierte SVG)
9. **Final CTA** — Full-Bleed, Headline "Qualität ist kein Zufall…", 2 Buttons, dezente Licht-Gradients im Bg
10. **Footer** — Reduziert, viel Whitespace, klare Struktur (inkl. Impressum/DSGVO über zentrale Injection)
11. **Formular** — Editorial-Variante der Form-Section

## Animationen (dezent, hochwertig)

- **Text-Fade+Rise** on scroll (IntersectionObserver, 40px translateY, 800ms ease-out)
- **Number-Counter** — animierte Zählung ab Sichtbarkeit
- **Parallax** auf Hero-Illustration und Chapter-Bildern (transform: translateY basierend auf scrollY)
- **Mouse-Move** auf Hero — schwebende Kreise reagieren dezent (max 20px)
- **Vorher/Nachher** — Clip-Path-Reveal beim Scroll
- Keine überladenen Effekte, alles unter 800ms, cubic-bezier(0.4, 0, 0.2, 1)

## Editierbarkeit

Alle Texte, Headlines, Zahlen und CTA-Labels über `data-editable="slot-key"` im Landing-Generator editierbar (~80 Slots). Illustrationen bleiben statisch (inline SVG).

## Zentrale Injection

Kompatibel mit dem bestehenden `insertBeforeAnchor()`-System — Trust/Privacy/Impressum-Blöcke werden über die zentrale Landing-Generator-Logik automatisch injiziert. Anker (`data-inject-anchor`) sind vor Footer und CTA gesetzt.

## Technisches

- Responsive (Mobile-First, Breakpoints 640 / 1024 / 1280)
- Light + Dark Mode via `prefers-color-scheme` + CSS-Variablen
- Fonts via Google Fonts `<link>` im Template-Head (Fraunces + Inter + JetBrains Mono)
- SEO: `<title>`, `<meta description>`, OG-Tags im Template
- Barrierearm: semantisches HTML, `aria-label`, kontrastreiche Textfarben, `prefers-reduced-motion` respektiert
- Keine JS-Frameworks — vanilla, ~4-6 KB

## Nicht Teil dieses Plans

- Keine Änderungen an bestehenden Themes
- Keine neuen Datenbank-Felder (nutzt bestehende Landing-Config)
- Keine Backend-/Migration-Änderungen
