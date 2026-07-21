// Deno Edge Function: send-signup-confirmation
//
// Flow:
//   1. Admin-create user with email_confirm=false (kein GoTrue-Mail-Versand, da SMTP fake)
//   2. generateLink({type:'signup'}) → Confirmation-URL OHNE Mailversand
//   3. Tenant-SMTP aus DB laden
//   4. Branded HTML-Mail via nodemailer über Tenant-SMTP senden
//   5. email_logs schreiben
//   Bei SMTP-Fehler: User rollback via admin.deleteUser
//
// Env (auf Supabase-Server gesetzt):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Deploy:
//   supabase functions deploy send-signup-confirmation --no-verify-jwt
//
// Server (.env): GOTRUE_MAILER_AUTOCONFIRM=false  → docker compose up -d auth

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import nodemailer from "https://esm.sh/nodemailer@6.9.14";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  email: string;
  password: string;
  tenant_id: string;
  full_name?: string;
  redirect_to?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, password, tenant_id, full_name, redirect_to } = (await req.json()) as Payload;

    if (!email || !password || !tenant_id) {
      return json({ error: "Missing required fields: email, password, tenant_id" }, 400);
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // 1. Tenant + SMTP laden
    const { data: tenant, error: tErr } = await supabaseAdmin
      .from("tenants")
      .select("id, name, domain, logo_url, primary_color, sender_email, sender_name, reply_to_email, smtp_host, smtp_port, smtp_username, smtp_password, is_active, emails_paused, emails_paused_reason")
      .eq("id", tenant_id)
      .maybeSingle();

    if (tErr || !tenant) return json({ error: "Tenant nicht gefunden" }, 404);
    if (tenant.is_active === false) {
      return json({ error: "Tenant ist deaktiviert — kein E-Mail-Versand." }, 503);
    }
    if (!tenant.smtp_host || !tenant.smtp_port || !tenant.smtp_username || !tenant.smtp_password) {
      return json({ error: "Tenant hat keine vollständige SMTP-Konfiguration" }, 400);
    }
    if (tenant.emails_paused) {
      return json({ error: `E-Mail-Versand für diesen Mandanten ist pausiert${tenant.emails_paused_reason ? `: ${tenant.emails_paused_reason}` : ""}. Bitte Admin kontaktieren.` }, 503);
    }

    // Bounce-Suppression: bekanntermaßen tote Adressen nicht erneut anschreiben.
    try {
      const [{ data: prof }, { data: app }, { data: sup }, { data: rf }] = await Promise.all([
        supabaseAdmin.from("profiles").select("email_status").ilike("email", email).neq("email_status", "active").limit(1).maybeSingle(),
        supabaseAdmin.from("applications").select("email_status").ilike("email", email).neq("email_status", "active").limit(1).maybeSingle(),
        supabaseAdmin.from("suppressed_emails").select("reason").ilike("email", email).limit(1).maybeSingle(),
        supabaseAdmin.from("email_recipient_failures").select("last_error").ilike("recipient_email", email).not("suppressed_at", "is", null).limit(1).maybeSingle(),
      ]);
      if (sup || rf) {
        return json({ error: "Diese E-Mail-Adresse ist gesperrt. Eine Registrierung ist nicht möglich." }, 403);
      }
      if (prof || app) {
        return json({ error: "Diese E-Mail-Adresse wurde gesperrt (Bounce/Complaint). Bitte korrigieren oder Sperre im Admin aufheben." }, 400);
      }
    } catch (e) {
      console.warn("suppression-check failed (continuing):", e);
    }



    // 2. User anlegen + Confirmation-Link in EINEM Call.
    //    generateLink({type:'signup'}) erstellt den User automatisch und liefert den Link
    //    zurück OHNE Mailversand durch GoTrue.
    const redirectTo = redirect_to ?? `https://${tenant.domain}/auth/confirmed`;
    let { data: linkData, error: lErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "signup",
      email,
      password,
      options: { data: { full_name: full_name ?? "", tenant_id }, redirectTo },
    });

    // Fallback: User existiert bereits. Wenn er NICHT bestätigt ist → neuen Link
    // erzeugen und resenden. Wenn bestätigt → echter Fehler.
    if (lErr || !linkData?.properties?.action_link || !linkData?.user) {
      const msg = (lErr?.message ?? "").toLowerCase();
      const looksLikeExists = msg.includes("already") || msg.includes("registered") || msg.includes("exists");
      if (looksLikeExists) {
        const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const existing = list?.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
        if (existing?.email_confirmed_at) {
          return json({ error: "Diese E-Mail-Adresse ist bereits registriert und bestätigt. Bitte melde dich an." }, 409);
        }
        const retry = await supabaseAdmin.auth.admin.generateLink({
          type: "signup",
          email,
          options: { data: { full_name: full_name ?? "", tenant_id }, redirectTo },
        });
        if (retry.error || !retry.data?.properties?.action_link || !retry.data?.user) {
          return json({ error: retry.error?.message ?? "Confirmation-Link konnte nicht erzeugt werden" }, 400);
        }
        linkData = retry.data;
      } else {
        return json({ error: lErr?.message ?? "Confirmation-Link konnte nicht generiert werden" }, 400);
      }
    }
    const userId = linkData!.user!.id;
    // WICHTIG: Wir verwenden NICHT properties.action_link (der wird von Mail-Scannern
    // wie Gmail beim Prefetch konsumiert → otp_expired). Stattdessen bauen wir einen
    // Link auf unsere eigene /auth/confirmed-Seite mit token_hash. Die Seite ruft
    // verifyOtp() erst beim echten User-Klick im Browser auf.
    const tokenHash = (linkData!.properties as any)?.hashed_token;
    if (!tokenHash) {
      return json({ error: "hashed_token fehlt in generateLink response" }, 500);
    }
    const confirmBase = redirect_to ?? `https://${tenant.domain}/auth/confirmed`;
    const actionLink = `${confirmBase}?token_hash=${encodeURIComponent(tokenHash)}&type=signup`;

    try {

      // 4. Mail rendern (Corporate Minimalist Wrapper)
      const senderName = tenant.sender_name ?? tenant.name;
      const senderEmail = tenant.sender_email ?? tenant.smtp_username;
      const { renderEmail } = await import("../_shared/email-wrapper.ts");
      const { html } = renderEmail({
        subject: `Willkommen${full_name ? `, ${escapeHtml(full_name.split(" ")[0])}` : ""}!`,
        body: `Bitte bestätige deine E-Mail-Adresse, um deinen Account bei <strong>${escapeHtml(tenant.name)}</strong> zu aktivieren.\n\n{{cta:E-Mail bestätigen|${actionLink}}}\n\nFalls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:\n<a href="${actionLink}" style="color:${tenant.primary_color ?? "#2563eb"};word-break:break-all">${actionLink}</a>`,
        tenant,
        recipient: email,
      });

      // 5. SMTP senden — vorher verify() (Auto-Pause bei wiederholtem Fail)
      const transporter = nodemailer.createTransport({
        host: tenant.smtp_host,
        port: tenant.smtp_port,
        secure: tenant.smtp_port === 465,
        auth: { user: tenant.smtp_username, pass: tenant.smtp_password },
      });

      const verifyRes = await verifyOrPause(supabaseAdmin, tenant, transporter);
      if (!verifyRes.ok) {
        throw new Error(`SMTP-Verify fehlgeschlagen: ${verifyRes.reason}${verifyRes.paused ? " — Mandant wurde automatisch pausiert." : ""}`);
      }

      await transporter.sendMail({
        from: `"${senderName}" <${senderEmail}>`,
        to: email,
        replyTo: tenant.reply_to_email ?? senderEmail,
        subject: `Bestätige deine E-Mail-Adresse – ${tenant.name}`,
        html,
      });

      // 6. Log
      await supabaseAdmin.from("email_logs").insert({
        tenant_id,
        recipient: email,
        subject: `Bestätige deine E-Mail-Adresse – ${tenant.name}`,
        status: "sent",
        template: "signup_confirmation",
      }).then(() => {}, () => {}); // ignore log errors
      await supabaseAdmin.from("email_send_log").insert({
        tenant_id,
        template_name: "signup_confirmation",
        recipient_email: email,
        status: "sent",
        rendered_subject: `Bestätige deine E-Mail-Adresse – ${tenant.name}`,
        rendered_html: html,
        sender_email: senderEmail,
        metadata: { user_id: userId, source: "send-signup-confirmation" },
      }).then(() => {}, () => {}); // ignore log errors

      return json({ success: true, user_id: userId }, 200);
    } catch (sendErr: any) {
      // Rollback: User wieder löschen, damit er es nochmal versuchen kann
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => {});
      console.error("SMTP send failed:", sendErr);
      await supabaseAdmin.from("email_send_log").insert({
        tenant_id,
        template_name: "signup_confirmation",
        recipient_email: email,
        status: "failed",
        error_message: `Mail-Versand fehlgeschlagen: ${sendErr?.message ?? sendErr}`,
        rendered_subject: `Bestätige deine E-Mail-Adresse – ${tenant.name}`,
        rendered_html: null,
        sender_email: tenant.sender_email ?? tenant.smtp_username,
        metadata: { user_id: userId, source: "send-signup-confirmation" },
      }).then(() => {}, () => {}); // ignore log errors
      return json({ error: `Mail-Versand fehlgeschlagen: ${sendErr?.message ?? sendErr}` }, 500);
    }
  } catch (err: any) {
    console.error(err);
    return json({ error: err?.message ?? "Unknown error" }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// SMTP-Verify mit Smart-Pause: erst nach 3 aufeinander folgenden Fails wird
// der Tenant via tenants.emails_paused = true automatisch pausiert. Erfolg
// setzt den Counter zurück. Siehe migration 20260608110000_tenant_smtp_health.sql.
async function verifyOrPause(admin: any, tenant: any, transporter: any): Promise<{ ok: boolean; reason?: string; paused?: boolean }> {
  try {
    await Promise.race([
      transporter.verify(),
      new Promise((_r, rej) => setTimeout(() => rej(new Error("verify timeout 15s")), 15000)),
    ]);
    await admin.from("tenant_smtp_health").upsert({
      tenant_id: tenant.id, consecutive_fails: 0,
      last_verify_at: new Date().toISOString(), last_verify_ok: true, updated_at: new Date().toISOString(),
    });
    return { ok: true };
  } catch (e: any) {
    const reason = String(e?.message ?? e);
    const { data: h } = await admin.from("tenant_smtp_health").select("consecutive_fails").eq("tenant_id", tenant.id).maybeSingle();
    const fails = (h?.consecutive_fails ?? 0) + 1;
    await admin.from("tenant_smtp_health").upsert({
      tenant_id: tenant.id, consecutive_fails: fails,
      last_fail_at: new Date().toISOString(), last_fail_error: reason,
      last_verify_at: new Date().toISOString(), last_verify_ok: false, updated_at: new Date().toISOString(),
    });
    let paused = false;
    if (false && fails >= 5 && !tenant.emails_paused) {
      await admin.from("tenants").update({
        emails_paused: true,
        emails_paused_at: new Date().toISOString(),
        emails_paused_reason: `SMTP-Verify ${fails}x fehlgeschlagen: ${reason}`,
        emails_paused_by: "auto:smtp_verify",
      }).eq("id", tenant.id);
      await admin.from("activity_log").insert({
        action: "emails_auto_pausiert", entity_type: "tenant", entity_id: tenant.id,
        comment: `SMTP-Versand auto-pausiert nach ${fails} Verify-Fails: ${reason}`,
      }).then(() => {}, () => {});
      paused = true;
    }
    return { ok: false, reason, paused };
  }
}

