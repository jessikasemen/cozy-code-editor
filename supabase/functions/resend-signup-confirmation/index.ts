// Deno Edge Function: resend-signup-confirmation
//
// Schickt einem bereits angelegten, aber noch NICHT bestätigten User eine neue
// Confirmation-Mail über die Tenant-SMTP. Wenn der User schon bestätigt ist
// → 200 mit {already_confirmed:true}. Wenn der User nicht existiert → 404.
//
// Deploy:
//   supabase functions deploy resend-signup-confirmation --no-verify-jwt

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
  tenant_id: string;
  redirect_to?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { email, tenant_id, redirect_to } = (await req.json()) as Payload;
    if (!email || !tenant_id) return json({ error: "Missing required fields: email, tenant_id" }, 400);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Tenant + SMTP laden
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
      return json({ error: `E-Mail-Versand für diesen Mandanten ist pausiert${tenant.emails_paused_reason ? `: ${tenant.emails_paused_reason}` : ""}.` }, 503);
    }

    // User per E-Mail finden. WICHTIG: Niemals unterscheiden, ob die Adresse
    // existiert / bestätigt / unbekannt ist — sonst wird das ein Account-Enumeration-Oracle.
    // In allen Fällen identische 200-Response.
    const GENERIC_OK = json({ success: true }, 200);

    const { data: list, error: lErr } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (lErr) { console.error("listUsers failed:", lErr); return GENERIC_OK; }
    const user = list.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
    if (!user) return GENERIC_OK;
    if (user.email_confirmed_at) return GENERIC_OK;

    // Frischen Confirmation-Link erzeugen (ohne Passwort → existierender User)
    const redirectTo = redirect_to ?? `https://${tenant.domain}/auth/confirmed`;
    const { data: linkData, error: gErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "signup",
      email,
      options: { redirectTo },
    });
    if (gErr || !linkData?.properties) {
      return json({ error: gErr?.message ?? "Confirmation-Link konnte nicht generiert werden" }, 400);
    }
    // Token-Hash statt action_link (Gmail-Prefetch-Schutz, siehe send-signup-confirmation)
    const tokenHash = (linkData.properties as any)?.hashed_token;
    if (!tokenHash) return json({ error: "hashed_token fehlt" }, 500);
    const actionLink = `${redirectTo}?token_hash=${encodeURIComponent(tokenHash)}&type=signup`;

    const senderName = tenant.sender_name ?? tenant.name;
    const senderEmail = tenant.sender_email ?? tenant.smtp_username;
    const { renderEmail } = await import("../_shared/email-wrapper.ts");
    const { html, subject: renderedSubject } = renderEmail({
      subject: `Neue Bestätigungs-E-Mail – ${tenant.name}`,
      body: `Du hast eine neue Bestätigungs-E-Mail angefordert. Klicke auf den Button, um deinen Account bei <strong>${escapeHtml(tenant.name)}</strong> zu aktivieren.\n\n{{cta:E-Mail bestätigen|${actionLink}}}\n\nFalls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:\n<a href="${actionLink}" style="color:${tenant.primary_color ?? "#2563eb"};word-break:break-all">${actionLink}</a>`,
      tenant,
      recipient: email,
    });

    const transporter = nodemailer.createTransport({
      host: tenant.smtp_host,
      port: tenant.smtp_port,
      secure: tenant.smtp_port === 465,
      auth: { user: tenant.smtp_username, pass: tenant.smtp_password },
    });

    const verifyRes = await verifyOrPause(supabaseAdmin, tenant, transporter);
    if (!verifyRes.ok) {
      return json({ success: true }, 200); // generic OK, kein Enumeration-Hint
    }

    await transporter.sendMail({
      from: `"${senderName}" <${senderEmail}>`,
      to: email,
      replyTo: tenant.reply_to_email ?? senderEmail,
      subject: `Neue Bestätigungs-E-Mail – ${tenant.name}`,
      html,
    });

    await supabaseAdmin.from("email_logs").insert({
      tenant_id,
      recipient: email,
      subject: `Neue Bestätigungs-E-Mail – ${tenant.name}`,
      status: "sent",
      template: "signup_confirmation_resend",
    }).then(() => {}, () => {});

    return json({ success: true }, 200);
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
// der Tenant auto-pausiert. Siehe migration 20260608110000_tenant_smtp_health.sql.
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
