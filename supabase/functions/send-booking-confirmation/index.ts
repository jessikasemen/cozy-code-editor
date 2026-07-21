// Deno Edge Function: send-booking-confirmation
// Scannt frisch gebuchte interview_appointments (created_at > now()-15min) und
// sendet Bewerber-Bestätigungsmail (professioneller Wrapper: Logo, Preheader,
// Spam-Hinweis, Recruiter-Karte, ICS-Anhang + Plain-Text-Alternative).
// Idempotent via application_reminder_log kind='booking_confirmation'.
//
// Trigger: pg_cron alle 2 Min (siehe Migration 20260717000000_...).
// Auth: x-cron-secret Header/?key=<CRON_SECRET> oder Service-Role via Authorization/apikey.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "https://esm.sh/nodemailer@6.9.14";
import { renderEmail } from "../_shared/email-wrapper.ts";
import { resolveSender } from "../_shared/sender-resolver.ts";
import { pickLandingLogo, resolveEmailLogo, type LogoResolution } from "../_shared/email-logo.ts";

const FUNCTION_VERSION = "2026-07-18-booking-confirmation-v3-lookback72h";
const REMINDER_KIND = "booking_confirmation";
const LOOKBACK_MIN = 4320; // 72h – überbrückt längere Cron-Ausfälle; Idempotenz via reminder_log

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_SUBJECT = "Termin bestätigt: {{appointment_date}}, {{appointment_time}} Uhr";
const DEFAULT_PREHEADER = "Ihr Bewerbungsgespräch am {{appointment_date}} um {{appointment_time}} Uhr – alle Infos + Kalendereintrag im Anhang.";
const DEFAULT_BODY = `Hallo {{first_name}},

vielen Dank – Ihr Termin für das Bewerbungsgespräch bei {{tenant_name}} ist fest reserviert:

Datum: {{appointment_date}}
Uhrzeit: {{appointment_time}} Uhr
Dauer: ca. {{duration_minutes}} Minuten

Sie finden den Termin als Kalendereintrag (.ics) im Anhang – einfach öffnen und in Outlook, Google oder Apple-Kalender speichern.

30 Minuten vor Beginn schicken wir Ihnen zusätzlich den direkten Link zum Gespräch, damit Sie ihn nicht extra suchen müssen.

Sollten Sie den Termin verschieben oder absagen müssen, tun Sie das jederzeit hier:

{{cta:{{button_label}}|{{cancel_url}}}}

Wir freuen uns auf das Gespräch!

Herzliche Grüße
{{recruiter_name}}`;
const DEFAULT_BUTTON = "Termin verwalten";

function cleanHost(domain: unknown): string {
  return String(domain ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

function portalHost(domain: unknown): string {
  const clean = cleanHost(domain).replace(/^portal\./, "");
  return clean ? `portal.${clean}` : "";
}

function resolveBookingLogo(tenant: TenantRow, sourceLanding: any, targetLanding: any, fastTrackLanding: any): LogoResolution {
  return resolveEmailLogo([
    { source: "tenant.logo_url", url: tenant.logo_url, domain: tenant.primary_domain || tenant.domain },
    { source: "fasttrack_landing.logo", url: pickLandingLogo(fastTrackLanding), domain: fastTrackLanding?.domain },
    { source: "target_landing.logo", url: pickLandingLogo(targetLanding), domain: targetLanding?.domain },
    { source: "source_landing.logo", url: pickLandingLogo(sourceLanding), domain: sourceLanding?.domain },
  ]);
}

interface TenantRow {
  id: string; name: string; domain: string | null; primary_domain: string | null;
  logo_url: string | null; primary_color: string | null;
  sender_email: string | null; sender_name: string | null; reply_to_email: string | null;
  smtp_host: string | null; smtp_port: number | null; smtp_username: string | null; smtp_password: string | null;
  email_signature: string | null; emails_paused: boolean | null;
  booking_confirmation_subject: string | null; booking_confirmation_body: string | null; booking_confirmation_button: string | null;
}

function hasValidSmtp(t: any): boolean {
  return !!(t?.smtp_host && t?.smtp_port && t?.smtp_username && t?.smtp_password && t?.sender_email);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

async function authorize(req: Request) {
  const secret = Deno.env.get("CRON_SECRET");
  const url = new URL(req.url);
  const provided = (req.headers.get("x-cron-secret") ?? url.searchParams.get("key") ?? "").trim();
  if (secret?.trim() && provided && provided === secret.trim()) return true;

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const apiKey = (req.headers.get("apikey") ?? req.headers.get("x-api-key") ?? "").trim();

  return !!(serviceRoleKey && (bearer === serviceRoleKey || apiKey === serviceRoleKey));
}

function pad(n: number) { return n.toString().padStart(2, "0"); }
function icsDate(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
function icsEscape(s: string): string {
  return s.replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");
}
function buildIcs(opts: { uid: string; title: string; description: string; start: Date; end: Date; url: string; organizerName: string; organizerEmail: string; attendeeEmail: string; }): string {
  const lines = [
    "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//MB Portal//Bewerbung//DE","CALSCALE:GREGORIAN","METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${opts.uid}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(opts.start)}`,
    `DTEND:${icsDate(opts.end)}`,
    `SUMMARY:${icsEscape(opts.title)}`,
    `DESCRIPTION:${icsEscape(opts.description)}`,
    `URL:${opts.url}`,
    `ORGANIZER;CN=${icsEscape(opts.organizerName)}:mailto:${opts.organizerEmail}`,
    `ATTENDEE;RSVP=TRUE:mailto:${opts.attendeeEmail}`,
    "STATUS:CONFIRMED","TRANSP:OPAQUE",
    "END:VEVENT","END:VCALENDAR",
  ];
  return lines.join("\r\n");
}

async function logEmailSend(
  admin: any,
  tenant: TenantRow,
  appt: any,
  app: any,
  subject: string,
  html: string | null,
  status: "sent" | "failed",
  error?: string,
  extraMetadata?: Record<string, unknown>,
) {
  try {
    await admin.from("email_send_log").insert({
      message_id: `${REMINDER_KIND}-${appt.id}`,
      tenant_id: tenant.id,
      template_name: REMINDER_KIND,
      recipient_email: app.email,
      status,
      error_message: error ?? null,
      rendered_subject: subject,
      rendered_html: html,
      sender_email: tenant.sender_email ?? tenant.smtp_username,
      metadata: { appointment_id: appt.id, application_id: app.id, source: "send-booking-confirmation", sender_kind: "broker_booking_confirmation", resolved_tenant_id: tenant.id, ...(extraMetadata ?? {}) },
    });
  } catch (e) {
    console.warn("email_send_log insert skipped:", e);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!(await authorize(req))) return json({ error: "Unauthorized", version: FUNCTION_VERSION }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } });

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body?.dry_run === true;

    const since = new Date(Date.now() - LOOKBACK_MIN * 60_000).toISOString();

    const { data: appts, error: aErr } = await admin.from("interview_appointments")
      .select("id, application_id, tenant_id, starts_at, ends_at, cancel_token, status, created_at")
      .eq("status", "scheduled")
      .gte("created_at", since)
      .limit(200);
    if (aErr) return json({ error: aErr.message, version: FUNCTION_VERSION }, 500);
    if (!appts || appts.length === 0) return json({ success: true, version: FUNCTION_VERSION, candidates: 0, sent: 0 });

    const appIds = Array.from(new Set(appts.map((a: any) => a.application_id)));
    const apptIds = appts.map((a: any) => a.id);
    const { data: sentLogs } = await admin.from("email_send_log")
      .select("metadata")
      .eq("template_name", REMINDER_KIND)
      .eq("status", "sent");
    const doneAppts = new Set(
      (sentLogs ?? [])
        .map((r: any) => r?.metadata?.appointment_id)
        .filter((id: string | null | undefined) => id && apptIds.includes(id)),
    );

    // Retry-Cap: pro Appointment max. 3 Fails in email_send_log → dann skippen.
    const { data: failLogs } = await admin.from("email_send_log")
      .select("metadata")
      .eq("template_name", REMINDER_KIND)
      .eq("status", "failed");
    const failCount = new Map<string, number>();
    for (const r of (failLogs ?? [])) {
      const aid = (r as any).metadata?.appointment_id;
      if (aid && apptIds.includes(aid)) failCount.set(aid, (failCount.get(aid) ?? 0) + 1);
    }
    const capped = new Set(
      Array.from(failCount.entries()).filter(([, n]) => n >= 3).map(([id]) => id),
    );

    const todo = appts.filter((a: any) => !doneAppts.has(a.id) && !capped.has(a.id));
    if (todo.length === 0) return json({ success: true, version: FUNCTION_VERSION, candidates: appts.length, sent: 0, skipped_already_sent: doneAppts.size, skipped_retry_cap: capped.size });

    const { data: apps } = await admin.from("applications")
      .select("id, email, first_name, last_name, full_name, tenant_id, target_landing_id, source_landing_id")
      .in("id", todo.map((t: any) => t.application_id));
    const appMap = new Map<string, any>((apps ?? []).map((a: any) => [a.id, a]));

    const lps = Array.from(new Set([
      ...todo.map((a: any) => appMap.get(a.application_id)?.target_landing_id).filter(Boolean),
      ...todo.map((a: any) => appMap.get(a.application_id)?.source_landing_id).filter(Boolean),
    ]));
    const { data: lpList } = lps.length
      ? await admin.from("landing_pages").select("id, domain, logo_url, branding, slots, intermediate_logo_url, recruiter_name, recruiter_avatar_url, linked_fasttrack_landing_id, flow_type").in("id", lps)
      : { data: [] as any[] };
    const lpMap = new Map<string, any>((lpList ?? []).map((l: any) => [l.id, l]));

    // Verlinkte Fast-Track-Landings nachziehen (Broker-Flow zeigt via linked_fasttrack_landing_id auf die Fast-Track-Landing).
    const extraIds = Array.from(new Set(
      Array.from(lpMap.values()).map((l: any) => l.linked_fasttrack_landing_id).filter(Boolean) as string[],
    )).filter((id) => !lpMap.has(id));
    if (extraIds.length) {
      const { data: extraLps } = await admin.from("landing_pages")
        .select("id, domain, logo_url, branding, slots, intermediate_logo_url, recruiter_name, recruiter_avatar_url, linked_fasttrack_landing_id, flow_type").in("id", extraIds);
      for (const l of (extraLps ?? []) as any[]) lpMap.set(l.id, l);
    }

    let sent = 0, skipped = 0, failed = 0;
    const results: any[] = [];

    for (const appt of todo as any[]) {
      const app = appMap.get(appt.application_id);
      if (!app?.email) { skipped++; results.push({ id: appt.id, reason: "no_email" }); continue; }
      const resolved = await resolveSender(admin, app.id, "broker_booking_confirmation");
      const tenant = resolved.tenant as TenantRow | null;
      if (!tenant) {
        skipped++; results.push({ id: appt.id, reason: resolved.reason || "routing_failed", sender_kind: resolved.kind });
        await admin.from("application_reminder_log").upsert({
          application_id: app.id, tenant_id: app.tenant_id ?? appt.tenant_id ?? null, reminder_kind: REMINDER_KIND,
          recipient_email: app.email, status: "skipped", error: `routing_${resolved.reason || "failed"}`,
        }, { onConflict: "application_id,reminder_kind" });
        continue;
      }
      if (!hasValidSmtp(tenant)) { skipped++; results.push({ id: appt.id, reason: "no_smtp" }); continue; }

      const sourceLanding = app.source_landing_id ? lpMap.get(app.source_landing_id) : null;
      const targetLanding = app.target_landing_id ? lpMap.get(app.target_landing_id) : null;
      // Fast-Track-Landing (Portal + Interview) bevorzugt: aktuelle source.linked_fasttrack
      // vor gespeicherten target_landing_id, weil Admins die Vermittlungs-Zuordnung ändern können.
      // Broker-Landings (flow_type='broker') haben KEIN eigenes Portal — niemals als
      // Fallback nehmen, sonst zeigt der Cancel-/Rebook-Link auf die Vermittler-Domain.
      const isBrokerLp = (l: any) => l && l.flow_type === "broker";
      let fastTrackLanding = (sourceLanding?.linked_fasttrack_landing_id ? lpMap.get(sourceLanding.linked_fasttrack_landing_id) : null)
        || targetLanding
        || (isBrokerLp(sourceLanding) ? null : sourceLanding);
      if (isBrokerLp(fastTrackLanding)) fastTrackLanding = null;
      const landing = sourceLanding || targetLanding;
      // Wichtig: niemals auf Broker-/Vermittlungs-Domain zurückfallen.
      // Wenn keine Fast-Track-Landing verknüpft ist, wird die Mail geskippt,
      // statt einen falschen portal.<vermittlungs-domain>-Link zu versenden.
      const fastTrackDomain = fastTrackLanding?.domain || "";
      const fastTrackHost = portalHost(fastTrackDomain);

      if (!fastTrackHost) {
        skipped++;
        results.push({ id: appt.id, status: "skipped", reason: "missing_fasttrack_portal_domain" });
        await admin.from("application_reminder_log").upsert({
          application_id: app.id, tenant_id: tenant.id, reminder_kind: REMINDER_KIND,
          recipient_email: app.email, status: "skipped", error: "missing_fasttrack_portal_domain",
        }, { onConflict: "application_id,reminder_kind" });
        await logEmailSend(admin, tenant, appt, app, "(nicht gesendet)", null, "failed", "missing_fasttrack_portal_domain");
        continue;
      }

      const recruiterName = landing?.recruiter_name || tenant.name;
      const recruiterAvatar = landing?.recruiter_avatar_url || null;
      // Cancel-/Rebook-Link: immer auf portal.<fast-track-domain>, dort läuft das Buchungssystem.
      const cancelUrl = `https://${fastTrackHost}/termin/${appt.cancel_token}`;

      const starts = new Date(appt.starts_at);
      const ends = new Date(appt.ends_at);
      const firstName = app.first_name || (app.full_name?.split(" ")[0] ?? "");
      const duration = Math.round((ends.getTime() - starts.getTime()) / 60_000);

      const vars: Record<string, string> = {
        first_name: firstName,
        last_name: app.last_name || "",
        full_name: app.full_name || `${firstName} ${app.last_name || ""}`.trim(),
        tenant_name: tenant.name,
        recruiter_name: recruiterName,
        appointment_date: starts.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
        appointment_time: starts.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
        duration_minutes: String(duration),
        cancel_url: cancelUrl,
        // Portal-URL: Fast-Track-Portal (portal.<fast-track-domain>), dort läuft das KI-Interview.
        portal_url: fastTrackHost ? `https://${fastTrackHost}` : "",
        button_label: tenant.booking_confirmation_button || DEFAULT_BUTTON,
      };

      const logo = resolveBookingLogo(tenant, sourceLanding, targetLanding, fastTrackLanding);
      const logoMetadata = { email_logo_url: logo.url, email_logo_source: logo.source, email_logo_reason: logo.reason, email_logo_candidates: logo.candidates };

      const { html, text, subject } = renderEmail({
        subject: tenant.booking_confirmation_subject || DEFAULT_SUBJECT,
        body: tenant.booking_confirmation_body || DEFAULT_BODY,
        preheader: DEFAULT_PREHEADER,
        spamHint: true,
        tenant: { ...tenant, logo_url: logo.url },
        recruiter: { name: recruiterName, avatar_url: recruiterAvatar, role_label: "Personalabteilung" },
        vars,
      });

      const ics = buildIcs({
        uid: `${appt.id}@${fastTrackDomain || "mb-portal"}`,
        title: `Bewerbungsgespräch – ${tenant.name}`,
        description: `Bewerbungsgespräch mit ${recruiterName}. Termin verwalten: ${cancelUrl}`,
        start: starts, end: ends, url: cancelUrl,
        organizerName: recruiterName, organizerEmail: tenant.sender_email || tenant.smtp_username!,
        attendeeEmail: app.email,
      });

      if (dryRun) { sent++; results.push({ id: appt.id, status: "would_send", to: app.email }); continue; }

      try {
        const transporter = nodemailer.createTransport({
          host: tenant.smtp_host!, port: tenant.smtp_port!, secure: tenant.smtp_port === 465,
          auth: { user: tenant.smtp_username!, pass: tenant.smtp_password! },
        });
        await transporter.sendMail({
          from: `"${tenant.sender_name || tenant.name}" <${tenant.sender_email || tenant.smtp_username!}>`,
          to: app.email,
          replyTo: tenant.reply_to_email ?? tenant.sender_email ?? undefined,
          subject, html, text,
          icalEvent: { filename: "termin.ics", method: "REQUEST", content: ics },
          attachments: [{ filename: "termin.ics", content: ics, contentType: "text/calendar; charset=utf-8; method=REQUEST" }],
        });
        await admin.from("application_reminder_log").upsert({
          application_id: app.id, tenant_id: tenant.id, reminder_kind: REMINDER_KIND,
          recipient_email: app.email, status: "sent",
        }, { onConflict: "application_id,reminder_kind" });
        await logEmailSend(admin, tenant, appt, app, subject, html, "sent", undefined, logoMetadata);
        sent++; results.push({ id: appt.id, status: "sent" });
        await new Promise((r) => setTimeout(r, 3000));
      } catch (e: any) {
        failed++;
        const err = String(e?.message ?? e).slice(0, 500);
        await admin.from("application_reminder_log").upsert({
          application_id: app.id, tenant_id: tenant.id, reminder_kind: REMINDER_KIND,
          recipient_email: app.email, status: "failed", error: err,
        }, { onConflict: "application_id,reminder_kind" });
        await logEmailSend(admin, tenant, appt, app, subject, html, "failed", err, logoMetadata);
        results.push({ id: appt.id, status: "failed", error: err });
      }
    }

    return json({ success: true, version: FUNCTION_VERSION, dry_run: dryRun, candidates: appts.length, todo: todo.length, sent, skipped, failed, results: dryRun ? results : undefined });
  } catch (err: any) {
    console.error(err);
    return json({ error: err?.message ?? "Unknown error", version: FUNCTION_VERSION }, 500);
  }
});
