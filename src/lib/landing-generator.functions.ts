import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import JSZip from "jszip";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getTheme } from "./landing-themes";
import { THEME_ASSETS } from "./theme-assets.generated";

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Ungültige Hex-Farbe");

// Akzeptiert "example.com", "www.example.com" oder volle URLs.
// Wird vor der URL-Validierung normalisiert (https:// prepended, trailing slash entfernt).
const normalizeUrl = (v: unknown) => {
  if (typeof v !== "string") return v;
  const trimmed = v.trim();
  if (!trimmed) return trimmed;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
};
const UrlLike = z.preprocess(normalizeUrl, z.string().url().max(500));
const OptionalUrlLike = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? "" : normalizeUrl(v)),
  z.union([z.string().url().max(500), z.literal("")]),
);

const BrandingSchema = z.object({
  firmenname: z.string().min(1).max(120),
  primary_color: HexColor,
  secondary_color: HexColor,
  whatsapp_number: z.string().max(40).default(""),
  whatsapp_enabled: z.coerce.boolean().default(false),
  email: z.string().email().max(255),
  telefon: z.string().max(40).default(""),
  telefon_2: z.string().max(40).default(""),
  strasse: z.string().max(200).default(""),
  plz: z.string().max(20).default(""),
  stadt: z.string().max(120).default(""),
  hrb: z.string().max(60).default(""),
  registergericht: z.string().max(120).default(""),
  ust_id: z.string().max(40).default(""),
  steuernummer: z.string().max(40).default(""),
  geschaeftsfuehrer: z.string().max(120).default(""),
  impressum: z.string().max(5000).default(""),
  landing_domain: z.string().min(1, "Landing-Domain ist Pflicht (für SEO/Canonical)").max(255),
  api_endpoint: UrlLike,
  portal_url: OptionalUrlLike.default(""),
  supabase_url: OptionalUrlLike.default(""),
  supabase_anon_key: z.string().max(2000).optional().or(z.literal("")).default(""),
  tenant_id: z.string().max(120).optional().or(z.literal("")).default(""),

  flow_type: z.enum(["classic", "fast"]).default("classic"),
  // Funnel-Tracking: kurzer Slug pro Landing (z.B. "kw24-fast-de").
  // Wird mit jeder Bewerbung gespeichert → Konversion pro Landing messbar.
  source_slug: z.string().max(120).default(""),
  // SEO / Browser-Tab
  seo_title: z.string().max(160).default(""),
  seo_description: z.string().max(320).default(""),
  seo_image: z.string().max(500).default(""),
});

const InputSchema = z.object({
  themeId: z.string().min(1).max(40),
  branding: BrandingSchema,
  // Logo als data-URL: "data:image/png;base64,...."
  logoDataUrl: z.string().max(15_000_000).optional().nullable(),
  faviconDataUrl: z.string().max(1_000_000).optional().nullable(),
  // Theme-Slot-Werte (Texte/Bilder/Farben aus dem UI-Theme-Editor).
  slots: z.record(z.string().min(1).max(60), z.string().max(20_000)).optional().default({}),
});

function cleanLandingDomain(d: string): string {
  return String(d ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function applyPlaceholders(
  src: string,
  branding: z.infer<typeof BrandingSchema>,
  slotValues: Record<string, string> = {},
): string {
  // Computed Aliase: address/contact_email/contact_phone aus Firmendaten ableiten,
  // damit Slot-Defaults (Impressum/Datenschutz) automatisch korrekt befüllt werden.
  const b: Record<string, unknown> = { ...branding };
  const addrParts = [b.strasse as string, [b.plz as string, b.stadt as string].filter(Boolean).join(" ")]
    .filter(Boolean).join(", ");
  // Rechts-Block (sichtbar im Footer): Firma, Adresse, GF, HRB, USt-ID, Kontakt.
  // Ersetzt die "winzigen Impressum-Links" durch einen abmahnsicheren Klartext-Block.
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));
  const legalLines: string[] = [];
  if (branding.firmenname) legalLines.push(`<strong>${esc(branding.firmenname)}</strong>`);
  if (branding.strasse) legalLines.push(esc(branding.strasse));
  const plzStadt = [branding.plz, branding.stadt].filter(Boolean).join(" ");
  if (plzStadt) legalLines.push(esc(plzStadt));
  if (branding.telefon) legalLines.push(`Telefon: <a href="tel:${esc(branding.telefon)}" style="color:inherit;">${esc(branding.telefon)}</a>`);
  if (branding.email) legalLines.push(`E-Mail: <a href="mailto:${esc(branding.email)}" style="color:inherit;">${esc(branding.email)}</a>`);
  if (branding.geschaeftsfuehrer) legalLines.push(`Geschäftsführung: ${esc(branding.geschaeftsfuehrer)}`);
  const regLine = [
    branding.registergericht ? `Registergericht ${esc(branding.registergericht)}` : "",
    branding.hrb ? `HRB ${esc(branding.hrb)}` : "",
  ].filter(Boolean).join(", ");
  if (regLine) legalLines.push(regLine);
  if (branding.ust_id) legalLines.push(`USt-IdNr.: ${esc(branding.ust_id)}`);
  else if (branding.steuernummer) legalLines.push(`Steuernummer: ${esc(branding.steuernummer)}`);
  const legalBlock = legalLines.length
    ? `<div class="lv-legal-block" style="font-size:14px;line-height:1.65;color:inherit;opacity:.9;">${legalLines.join("<br/>")}</div>`
    : "";
  const legalInlineParts = [
    branding.firmenname,
    branding.geschaeftsfuehrer ? `GF: ${branding.geschaeftsfuehrer}` : "",
    branding.hrb ? `HRB ${branding.hrb}` : "",
    branding.ust_id ? `USt-IdNr. ${branding.ust_id}` : "",
  ].filter(Boolean).map(esc).join(" · ");
  const contactBlock = (branding.firmenname || branding.telefon || branding.email)
    ? `<div class="lv-contact-block" style="font-size:15px;line-height:1.7;color:inherit;">`
      + (branding.firmenname ? `<div style="font-weight:700;font-size:16px;margin-bottom:4px;">${esc(branding.firmenname)}</div>` : "")
      + (branding.strasse ? `<div>${esc(branding.strasse)}</div>` : "")
      + (plzStadt ? `<div>${esc(plzStadt)}</div>` : "")
      + (branding.telefon ? `<div style="margin-top:8px;"><strong>Telefon:</strong> <a href="tel:${esc(branding.telefon)}" style="color:inherit;font-size:17px;font-weight:600;">${esc(branding.telefon)}</a></div>` : "")
      + (branding.email ? `<div><strong>E-Mail:</strong> <a href="mailto:${esc(branding.email)}" style="color:inherit;">${esc(branding.email)}</a></div>` : "")
      + `</div>`
    : "";

  const aliases: Record<string, string> = {
    address: addrParts,
    contact_address: addrParts,
    contact_email: (b.email as string) || "",
    contact_phone: (b.telefon as string) || "",
    sitz_stadt: (b.stadt as string) || "",
    legal_block: legalBlock,
    legal_inline: legalInlineParts,
    contact_block: contactBlock,
  };
  const merged: Record<string, unknown> = { ...aliases, ...b, ...slotValues };
  let out = src;
  // Mehrere Passes: Slot-Werte können selbst {{branding}}-Tokens enthalten.
  for (let i = 0; i < 3; i++) {
    let changed = false;
    for (const [key, value] of Object.entries(merged)) {
      const token = `{{${key}}}`;
      if (out.includes(token)) {
        out = out.split(token).join(String(value ?? ""));
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

// Entfernt leere/kaputte Meta-Tags (og:image ohne Wert, Canonical/og:url ohne Domain).
function cleanEmptyMetaTags(html: string, b: z.infer<typeof BrandingSchema>): string {
  let out = html;
  if (!b.seo_image) {
    out = out.replace(/\s*<meta[^>]*property=["']og:image["'][^>]*content=["']["'][^>]*>\s*/gi, "\n");
    out = out.replace(/\s*<meta[^>]*name=["']twitter:image["'][^>]*content=["']["'][^>]*>\s*/gi, "\n");
  }
  if (!b.landing_domain) {
    out = out.replace(/\s*<link[^>]*rel=["']canonical["'][^>]*href=["']https?:\/\/\/[^"']*["'][^>]*>\s*/gi, "\n");
    out = out.replace(/\s*<meta[^>]*property=["']og:url["'][^>]*content=["']https?:\/\/\/[^"']*["'][^>]*>\s*/gi, "\n");
  }
  return out;
}

// Injiziert window.PORTAL_API/TENANT_ID/PORTAL_URL/FLOW_TYPE in jedes generierte
// HTML — unabhängig davon, ob das Theme-Template einen <script>-Block dafür hat.
// Garantiert, dass Bewerbungen die richtige tenant_id mitsenden → Reminder/Accept-
// Mail nutzen automatisch den korrekten Tenant-SMTP.
function injectLandingConfig(html: string, b: z.infer<typeof BrandingSchema>): string {
  const escape = (s: string) => String(s ?? "").replace(/[<>"']/g, (c) => ({ "<": "\\u003c", ">": "\\u003e", '"': '\\"', "'": "\\'" }[c]!));
  const block = `<script>
window.PORTAL_API = "${escape(b.api_endpoint)}";
window.PORTAL_URL = "${escape(b.portal_url ?? "")}";
window.TENANT_ID = "${escape(b.tenant_id ?? "")}";
window.FLOW_TYPE = "${escape(b.flow_type)}";
window.SOURCE_SLUG = "${escape(b.source_slug ?? "")}";
window.WHATSAPP_NUMBER = "${escape(b.whatsapp_enabled ? (b.whatsapp_number ?? "").replace(/[^0-9]/g, "") : "")}";
window.LANDING_FIRMENNAME = "${escape(b.firmenname ?? "")}";
window.LANDING_DATENSCHUTZ_URL = "datenschutz.html";
window.LANDING_IMPRESSUM_URL = "impressum.html";
window.LANDING_CONTACT_EMAIL = "${escape(b.email ?? "")}";
window.LANDING_CONTACT_PHONE = "${escape(b.telefon ?? "")}";
</script>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, block + "</head>");
  return block + html;
}

// Injiziert einen professionellen Trust-Footer (Impressum, Kontakt, Rechtliches)
// VOR </body> in jedes Theme — überschreibt nichts, ergänzt nur. Wird
// unterdrückt, wenn das Template bereits {{legal_block}} enthält (dort hat
// das Theme die Anbieterkennzeichnung schon eingebaut).
function injectTrustFooter(html: string, b: z.infer<typeof BrandingSchema>): string {
  if (/lv-legal-block/.test(html)) return html; // schon vorhanden
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!
  ));
  const plzStadt = [b.plz, b.stadt].filter(Boolean).join(" ");
  const regLine = [
    b.registergericht ? `Registergericht ${esc(b.registergericht)}` : "",
    b.hrb ? `HRB ${esc(b.hrb)}` : "",
  ].filter(Boolean).join(", ");
  const legalItems: string[] = [];
  if (b.firmenname) legalItems.push(`<strong>${esc(b.firmenname)}</strong>`);
  if (b.strasse) legalItems.push(esc(b.strasse));
  if (plzStadt) legalItems.push(esc(plzStadt));
  if (b.geschaeftsfuehrer) legalItems.push(`Geschäftsführung: ${esc(b.geschaeftsfuehrer)}`);
  if (regLine) legalItems.push(regLine);
  if (b.ust_id) legalItems.push(`USt-IdNr.: ${esc(b.ust_id)}`);
  else if (b.steuernummer) legalItems.push(`Steuernummer: ${esc(b.steuernummer)}`);
  const contactItems: string[] = [];
  if (b.telefon) contactItems.push(`<a href="tel:${esc(b.telefon)}" style="color:inherit;text-decoration:none;font-weight:600;">${esc(b.telefon)}</a>`);
  if (b.email) contactItems.push(`<a href="mailto:${esc(b.email)}" style="color:inherit;text-decoration:none;">${esc(b.email)}</a>`);
  const addrHtml = [b.strasse, plzStadt].filter(Boolean).map(esc).join("<br/>");
  const year = new Date().getFullYear();
  const block = `
<section class="lv-trust-footer lv-legal-block" style="background:#0f172a;color:#e2e8f0;padding:56px 24px 32px;margin-top:64px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:1180px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:40px;">
    <div>
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8;margin-bottom:16px;">Kontakt</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:8px;color:#f8fafc;">${esc(b.firmenname)}</div>
      ${addrHtml ? `<div style="font-size:14px;line-height:1.7;color:#cbd5e1;margin-bottom:12px;">${addrHtml}</div>` : ""}
      ${contactItems.length ? `<div style="font-size:15px;line-height:1.9;color:#f8fafc;">${contactItems.join("<br/>")}</div>` : ""}
    </div>
    <div>
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8;margin-bottom:16px;">Anbieterkennzeichnung</div>
      <div style="font-size:13.5px;line-height:1.75;color:#cbd5e1;">${legalItems.join("<br/>")}</div>
    </div>
    <div>
      <div style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8;margin-bottom:16px;">Rechtliches</div>
      <ul style="list-style:none;padding:0;margin:0;font-size:14px;line-height:2;">
        <li><a href="impressum.html" style="color:#e2e8f0;text-decoration:none;border-bottom:1px solid rgba(226,232,240,.3);">Impressum</a></li>
        <li><a href="datenschutz.html" style="color:#e2e8f0;text-decoration:none;border-bottom:1px solid rgba(226,232,240,.3);">Datenschutzerklärung</a></li>
      </ul>
      <div style="margin-top:20px;display:flex;gap:8px;flex-wrap:wrap;">
        <span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(34,197,94,.15);color:#86efac;border-radius:6px;font-size:12px;font-weight:600;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          SSL-verschlüsselt
        </span>
        <span style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(59,130,246,.15);color:#93c5fd;border-radius:6px;font-size:12px;font-weight:600;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          DSGVO-konform
        </span>
      </div>
    </div>
  </div>
  <div style="max-width:1180px;margin:32px auto 0;padding-top:20px;border-top:1px solid rgba(226,232,240,.1);font-size:12.5px;color:#94a3b8;text-align:center;">
    © ${year} ${esc(b.firmenname)}. Alle Rechte vorbehalten.
  </div>
</section>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, block + "\n</body>");
  return html + block;
}

// Injiziert einen "So geht's weiter"-Trust-Block direkt VOR dem
// Bewerbungsformular. Baut Vertrauen genau am Conversion-Punkt.
function injectTrustStrip(html: string): string {
  if (/lv-trust-strip/.test(html)) return html;
  const block = `
<section class="lv-trust-strip" style="background:#f8fafc;padding:48px 24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:1080px;margin:0 auto;">
    <div style="text-align:center;margin-bottom:32px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#64748b;margin-bottom:8px;">So geht's weiter</div>
      <h2 style="font-size:28px;font-weight:700;color:#0f172a;margin:0;line-height:1.2;">In 3 Schritten zum Job</h2>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px;">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px 24px;text-align:center;">
        <div style="width:52px;height:52px;border-radius:14px;background:#eff6ff;color:#2563eb;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
        </div>
        <div style="font-size:12px;font-weight:700;color:#2563eb;letter-spacing:.1em;margin-bottom:6px;">SCHRITT 1</div>
        <div style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:6px;">Bewerbung absenden</div>
        <div style="font-size:14px;color:#64748b;line-height:1.6;">Formular in 2 Minuten ausfüllen — ohne Anschreiben, ohne Lebenslauf-Pflicht.</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px 24px;text-align:center;">
        <div style="width:52px;height:52px;border-radius:14px;background:#f0fdf4;color:#16a34a;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </div>
        <div style="font-size:12px;font-weight:700;color:#16a34a;letter-spacing:.1em;margin-bottom:6px;">SCHRITT 2</div>
        <div style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:6px;">Kennenlern-Termin</div>
        <div style="font-size:14px;color:#64748b;line-height:1.6;">Sie wählen selbst einen 15-Minuten-Termin, der zu Ihnen passt — telefonisch oder per Video.</div>
      </div>
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px 24px;text-align:center;">
        <div style="width:52px;height:52px;border-radius:14px;background:#fef3c7;color:#d97706;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        </div>
        <div style="font-size:12px;font-weight:700;color:#d97706;letter-spacing:.1em;margin-bottom:6px;">SCHRITT 3</div>
        <div style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:6px;">Vertragsangebot</div>
        <div style="font-size:14px;color:#64748b;line-height:1.6;">Passt alles, erhalten Sie ein schriftliches Angebot — Festanstellung, sozialversichert.</div>
      </div>
    </div>
  </div>
</section>`;
  const re = /<section[^>]*id=["']bewerbung-form["']/i;
  if (re.test(html)) return html.replace(re, (m) => block + "\n" + m);
  return html;
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { mime, bytes };
}

function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function renderImpressum(b: z.infer<typeof BrandingSchema>): string {
  const addr = [b.strasse, [b.plz, b.stadt].filter(Boolean).join(" ")].filter(Boolean).map(escapeHtml).join("<br/>");
  const rows: string[] = [];
  rows.push(`<p><strong>${escapeHtml(b.firmenname)}</strong><br/>${addr}</p>`);
  if (b.geschaeftsfuehrer) rows.push(`<p><strong>Vertreten durch:</strong><br/>${escapeHtml(b.geschaeftsfuehrer)}</p>`);
  const contact: string[] = [];
  if (b.telefon) contact.push(`Telefon: <a href="tel:${escapeHtml(b.telefon)}">${escapeHtml(b.telefon)}</a>`);
  if (b.email) contact.push(`E-Mail: <a href="mailto:${escapeHtml(b.email)}">${escapeHtml(b.email)}</a>`);
  if (contact.length) rows.push(`<h3>Kontakt</h3><p>${contact.join("<br/>")}</p>`);
  const reg: string[] = [];
  if (b.registergericht) reg.push(`Registergericht: ${escapeHtml(b.registergericht)}`);
  if (b.hrb) reg.push(`Registernummer: ${escapeHtml(b.hrb)}`);
  if (reg.length) rows.push(`<h3>Registereintrag</h3><p>${reg.join("<br/>")}</p>`);
  const tax: string[] = [];
  if (b.ust_id) tax.push(`USt-IdNr.: ${escapeHtml(b.ust_id)}`);
  if (b.steuernummer) tax.push(`Steuernummer: ${escapeHtml(b.steuernummer)}`);
  if (tax.length) rows.push(`<h3>Umsatzsteuer</h3><p>${tax.join("<br/>")}</p>`);
  if (b.impressum) rows.push(`<div>${b.impressum}</div>`);
  rows.push(`<p style="margin-top:24px;font-size:13px;opacity:.7;">Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV: ${escapeHtml(b.geschaeftsfuehrer || b.firmenname)}, ${addr.replace(/<br\/>/g, ", ")}</p>`);
  return rows.join("\n");
}

function renderDatenschutz(b: z.infer<typeof BrandingSchema>): string {
  const name = escapeHtml(b.firmenname);
  const email = escapeHtml(b.email);
  return `
    <h3>1. Verantwortlicher</h3>
    <p>Verantwortlich für die Datenverarbeitung auf dieser Website ist:<br/>
    ${name}<br/>${escapeHtml(b.strasse)}<br/>${escapeHtml([b.plz, b.stadt].filter(Boolean).join(" "))}<br/>
    E-Mail: <a href="mailto:${email}">${email}</a></p>

    <h3>2. Erhebung und Verarbeitung personenbezogener Daten</h3>
    <p>Wir verarbeiten personenbezogene Daten, die Sie uns über das Bewerbungsformular zur Verfügung stellen (z.&nbsp;B. Name, Anschrift, Geburtsdatum, Kontaktdaten), zur Durchführung des Bewerbungsverfahrens gemäß Art.&nbsp;6 Abs.&nbsp;1 lit.&nbsp;b DSGVO sowie § 26 BDSG.</p>

    <h3>3. Speicherdauer</h3>
    <p>Ihre Bewerbungsdaten werden bis zu 6 Monate nach Abschluss des Verfahrens gespeichert und anschließend gelöscht, sofern keine längere Aufbewahrungspflicht besteht oder Sie in eine längere Speicherung eingewilligt haben.</p>

    <h3>4. Empfänger</h3>
    <p>Eine Weitergabe an Dritte erfolgt nur, wenn dies zur Durchführung des Bewerbungsverfahrens erforderlich ist (z.&nbsp;B. an Partnerunternehmen im Rahmen einer Vermittlung) oder Sie eingewilligt haben.</p>

    <h3>5. Ihre Rechte</h3>
    <p>Sie haben das Recht auf Auskunft (Art.&nbsp;15 DSGVO), Berichtigung (Art.&nbsp;16 DSGVO), Löschung (Art.&nbsp;17 DSGVO), Einschränkung der Verarbeitung (Art.&nbsp;18 DSGVO), Datenübertragbarkeit (Art.&nbsp;20 DSGVO) sowie das Recht auf Widerspruch (Art.&nbsp;21 DSGVO). Anfragen richten Sie bitte an <a href="mailto:${email}">${email}</a>.</p>

    <h3>6. Beschwerderecht</h3>
    <p>Sie haben das Recht, sich bei einer Datenschutzaufsichtsbehörde über die Verarbeitung Ihrer personenbezogenen Daten zu beschweren.</p>

    <h3>7. SSL-Verschlüsselung</h3>
    <p>Diese Website nutzt aus Sicherheitsgründen eine SSL-/TLS-Verschlüsselung zur Übertragung vertraulicher Inhalte.</p>
  `;
}

function buildLegalPage(title: string, body: string, b: z.infer<typeof BrandingSchema>): string {
  const t = escapeHtml(title);
  const firm = escapeHtml(b.firmenname);
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${t} – ${firm}</title>
<meta name="robots" content="noindex,follow" />
<link rel="stylesheet" href="style.css" />
<style>
  .legal-page { max-width: 820px; margin: 0 auto; padding: 64px 24px 96px; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color:#1a1a1a; line-height:1.7; }
  .legal-page h1 { font-size: 36px; margin: 0 0 8px; }
  .legal-page h3 { font-size: 18px; margin: 28px 0 8px; }
  .legal-page p { margin: 0 0 12px; }
  .legal-page a { color: #2563eb; }
  .legal-back { display:inline-block; margin-bottom: 24px; color:#64748b; text-decoration:none; font-size:14px; }
  .legal-back:hover { color:#1a1a1a; }
  .legal-footer { max-width:820px; margin: 0 auto; padding: 24px; border-top:1px solid #e5e7eb; font-size:13px; color:#64748b; text-align:center; }
</style>
</head>
<body>
<main class="legal-page">
  <a href="index.html" class="legal-back">← Zurück zur Startseite</a>
  <h1>${t}</h1>
  ${body}
</main>
<footer class="legal-footer">
  © ${new Date().getFullYear()} ${firm} ·
  <a href="impressum.html">Impressum</a> ·
  <a href="datenschutz.html">Datenschutz</a>
</footer>
</body>
</html>`;
}

export const generateLandingZip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Admin-Check
    const { data: roleRow, error: roleErr } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Nicht autorisiert");

    const theme = getTheme(data.themeId);
    if (!theme) throw new Error(`Theme nicht gefunden: ${data.themeId}`);

    const slots = { ...(data.slots ?? {}) };
    // Domain user-freundlich säubern (https://, trailing slash entfernen)
    const cleanedBranding = { ...data.branding, landing_domain: cleanLandingDomain(data.branding.landing_domain) };

    // Impressum/Datenschutz immer als echte Unterseiten — Slots überschreiben.
    slots.impressum_url = "impressum.html";
    slots.datenschutz_url = "datenschutz.html";

    // Hochgeladenes Logo/Favicon automatisch in {{logo_image}}/{{favicon_image}}
    // spiegeln, damit Themes wie Eilers/TTS/AZB den Branding-Upload anzeigen.
    if (data.logoDataUrl && !slots.logo_image) slots.logo_image = "assets/logo.png";
    if (data.faviconDataUrl && !slots.favicon_image) slots.favicon_image = "assets/favicon.png";

    const portalBase = (cleanedBranding.portal_url || "").replace(/\/+$/, "");
    const ctaRaw = (slots.cta_url ?? "").trim();
    const isAbsolute = /^https?:\/\//i.test(ctaRaw);
    if (!isAbsolute) {
      const path = ctaRaw.startsWith("/") ? ctaRaw : "/bewerbung";
      slots.cta_url = portalBase ? `${portalBase}${path}` : "#bewerbung-form";
    }

    let html = applyPlaceholders(theme.html, cleanedBranding, slots);

    if (portalBase) {
      html = html.replace(/href=(["'])\/bewerbung(\/[^"']*)?(\?[^"']*)?(#[^"']*)?\1/gi,
        (_m, q, p = "", qs = "", h = "") => `href=${q}${portalBase}/bewerbung${p}${qs}${h}${q}`);
    }

    // Inline-Sektionen für Impressum/Datenschutz aus index.html entfernen —
    // diese leben jetzt als eigene Unterseiten.
    html = html.replace(/<section[^>]*id=["'](?:impressum|datenschutz)["'][\s\S]*?<\/section>\s*/gi, "");

    html = cleanEmptyMetaTags(html, cleanedBranding);
    html = injectTrustStrip(html);
    html = injectTrustFooter(html, cleanedBranding);
    html = injectLandingConfig(html, cleanedBranding);
    const css = applyPlaceholders(theme.css, cleanedBranding, slots);
    const js = applyPlaceholders(theme.js, cleanedBranding, slots);

    const impressumHtml = buildLegalPage("Impressum", renderImpressum(cleanedBranding), cleanedBranding);
    const datenschutzHtml = buildLegalPage("Datenschutz", renderDatenschutz(cleanedBranding), cleanedBranding);

    const zip = new JSZip();
    zip.file("index.html", html);
    zip.file("impressum.html", impressumHtml);
    zip.file("datenschutz.html", datenschutzHtml);
    zip.file("style.css", css);
    zip.file("script.js", js);
    zip.file(
      "README.txt",
      `Landing Page: ${data.branding.firmenname}\nTheme: ${theme.name}\nGeneriert: ${new Date().toISOString()}\n\n` +
        `Upload-Anleitung:\n` +
        `1. Diesen Ordner per FTP (FileZilla) ins Web-Root deines VPS kopieren\n` +
        `   (z.B. /var/www/${data.branding.landing_domain || "kunde"}/)\n` +
        `2. nginx/Apache konfigurieren, sodass index.html ausgeliefert wird\n` +
        `3. SSL-Zertifikat (Let's Encrypt) für die Domain einrichten\n\n` +
        `Bewerbungen werden an: ${data.branding.api_endpoint} gesendet.\n`,
    );

    // Theme-eigene statische Assets (Hero-Bilder, Testimonials, Partner-Logos)
    // aus src/landing-themes/<id>/assets/ in die ZIP packen.
    const themeAssets = THEME_ASSETS[data.themeId] ?? {};
    for (const [name, b64] of Object.entries(themeAssets)) {
      // Base64 → Uint8Array (Worker-kompatibel)
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      zip.folder("assets")!.file(name, bytes);
    }

    if (data.logoDataUrl) {
      const parsed = parseDataUrl(data.logoDataUrl);
      if (parsed) {
        const ext = parsed.mime.includes("svg")
          ? "svg"
          : parsed.mime.includes("jpeg") || parsed.mime.includes("jpg")
            ? "jpg"
            : parsed.mime.includes("webp")
              ? "webp"
              : "png";
        // Theme erwartet assets/logo.png — wir nehmen die richtige Endung und
        // patchen das HTML, falls anders.
        const filename = `logo.${ext}`;
        zip.folder("assets")!.file(filename, parsed.bytes);
        if (ext !== "png") {
          const finalHtml = html.split("assets/logo.png").join(`assets/${filename}`);
          zip.file("index.html", finalHtml);
        }
      }
    } else {
      // Platzhalter, damit der <img>-Tag nicht ins Leere zeigt
      zip.folder("assets")!.file(
        "logo.png",
        new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
          0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
          0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
          0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ]),
      );
    }

    // Favicon (optional) — bei Fehlen 1×1-PNG-Platzhalter, damit assets/favicon.png nicht 404 wirft
    if (data.faviconDataUrl) {
      const fav = parseDataUrl(data.faviconDataUrl);
      if (fav) {
        const ext = fav.mime.includes("svg")
          ? "svg"
          : fav.mime.includes("png")
            ? "png"
            : fav.mime.includes("ico") || fav.mime.includes("icon")
              ? "ico"
              : "png";
        zip.folder("assets")!.file(`favicon.${ext}`, fav.bytes);
      }
    } else {
      zip.folder("assets")!.file(
        "favicon.png",
        new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
          0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
          0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
          0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
          0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ]),
      );
    }

    const buffer = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    // Base64 für Transport über JSON
    let binary = "";
    for (let i = 0; i < buffer.length; i++) binary += String.fromCharCode(buffer[i]);
    const base64 = btoa(binary);

    const safeName = data.branding.firmenname.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const datum = new Date().toISOString().slice(0, 10);
    const filename = `landing-${safeName}-${theme.id}-${datum}.zip`;

    return { zipBase64: base64, filename };
  });