import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles").select("role")
    .eq("user_id", ctx.userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export interface FailedEmailRow {
  id: string;
  created_at: string;
  tenant_id: string | null;
  tenant_name: string | null;
  tenant_emails_paused: boolean;
  tenant_emails_paused_reason: string | null;
  template_name: string | null;
  recipient_email: string;
  error_message: string | null;
  rendered_subject: string | null;
  metadata: Record<string, any> | null;
}

// ---------- LIST ----------
export const listFailedEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      days: z.number().int().min(1).max(90).default(7),
      tenant_id: z.string().uuid().optional().nullable(),
      template_name: z.string().max(80).optional().nullable(),
      limit: z.number().int().min(1).max(500).default(200),
    }).parse(input ?? {})
  )
  .handler(async ({ data, context }): Promise<{ rows: FailedEmailRow[] }> => {
    await assertAdmin(context);
    const sb = await getAdmin();
    const sinceIso = new Date(Date.now() - data.days * 24 * 3600 * 1000).toISOString();
    let q = sb.from("email_send_log")
      .select("id, created_at, tenant_id, template_name, recipient_email, error_message, rendered_subject, metadata")
      .eq("status", "failed")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    if (data.template_name) q = q.eq("template_name", data.template_name);
    const { data: logs, error } = await q;
    if (error) throw new Error(error.message);

    const tenantIds = Array.from(new Set((logs ?? []).map((r: any) => r.tenant_id).filter(Boolean)));
    const tenantMap = new Map<string, { name: string; paused: boolean; reason: string | null }>();
    if (tenantIds.length) {
      const { data: tenants } = await sb.from("tenants")
        .select("id, name, emails_paused, emails_paused_reason")
        .in("id", tenantIds);
      for (const t of tenants ?? []) {
        tenantMap.set(t.id, { name: t.name, paused: !!t.emails_paused, reason: t.emails_paused_reason ?? null });
      }
    }

    const rows: FailedEmailRow[] = (logs ?? []).map((r: any) => {
      const info = r.tenant_id ? tenantMap.get(r.tenant_id) : undefined;
      return {
        id: r.id,
        created_at: r.created_at,
        tenant_id: r.tenant_id ?? null,
        tenant_name: info?.name ?? null,
        tenant_emails_paused: info?.paused ?? false,
        tenant_emails_paused_reason: info?.reason ?? null,
        template_name: r.template_name ?? null,
        recipient_email: r.recipient_email,
        error_message: r.error_message ?? null,
        rendered_subject: r.rendered_subject ?? null,
        metadata: (r.metadata as Record<string, any> | null) ?? null,
      };
    });
    return { rows };
  });

// ---------- UNPAUSE ----------
export const unpauseTenantEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ tenant_id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = await getAdmin();
    const { error } = await sb.from("tenants").update({
      emails_paused: false,
      emails_paused_at: null,
      emails_paused_reason: null,
      emails_paused_by: null,
    }).eq("id", data.tenant_id);
    if (error) throw new Error(error.message);
    try {
      await sb.from("tenant_smtp_health").upsert({
        tenant_id: data.tenant_id,
        consecutive_fails: 0,
        updated_at: new Date().toISOString(),
      });
    } catch { /* non-critical */ }
    try {
      await sb.from("activity_log").insert({
        action: "emails_reaktiviert",
        entity_type: "tenant",
        entity_id: data.tenant_id,
        comment: "Manuell entpaust aus 'Fehlgeschlagene Mails'",
      });
    } catch { /* non-critical */ }
    return { ok: true };
  });

// ---------- RESEND ONE ----------
export const resendFailedEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ log_id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; reason?: string; new_log_id?: string }> => {
    await assertAdmin(context);
    const sb = await getAdmin();

    const { data: log, error: logErr } = await sb.from("email_send_log")
      .select("id, tenant_id, template_name, recipient_email, rendered_subject, metadata")
      .eq("id", data.log_id).maybeSingle();
    if (logErr) throw new Error(logErr.message);
    if (!log) return { ok: false, reason: "log_not_found" };
    if (!log.tenant_id) return { ok: false, reason: "no_tenant_id" };

    const { data: tenant, error: tErr } = await sb.from("tenants")
      .select("id, name, domain, primary_domain, emails_paused, emails_paused_reason, smtp_host, smtp_port, smtp_username, smtp_password")
      .eq("id", log.tenant_id).maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!tenant) return { ok: false, reason: "tenant_not_found" };
    if (tenant.emails_paused) return { ok: false, reason: `tenant_emails_paused: ${tenant.emails_paused_reason ?? "unbekannt"}` };
    if (!tenant.smtp_host || !tenant.smtp_username || !tenant.smtp_password) {
      return { ok: false, reason: "smtp_not_configured" };
    }

    const meta = (log.metadata ?? {}) as Record<string, any>;
    const firstName = meta.first_name ?? (meta.full_name ? String(meta.full_name).split(/\s+/)[0] : "Bewerber");
    const lastName = meta.last_name ?? (meta.full_name ? String(meta.full_name).split(/\s+/).slice(1).join(" ") : "");
    const fullName = meta.full_name ?? `${firstName} ${lastName}`.trim();
    const portalBase = (tenant.primary_domain || tenant.domain || "").replace(/\/+$/, "");
    const bookingLink = meta.booking_link || meta.calendly_link || (portalBase ? `https://${portalBase}/termin` : "");
    const actionLink = bookingLink || (portalBase ? `https://${portalBase}/` : "");

    // send-invitation-email via supabaseAdmin.functions
    const templateName = log.template_name || "application_received";
    const { data: mailData, error: mailErr } = await sb.functions.invoke("send-invitation-email", {
      body: {
        to: log.recipient_email,
        fullName,
        firstName,
        lastName,
        registrationLink: actionLink,
        tenantId: log.tenant_id,
        templateName,
        placeholders: {
          partner_name: meta.partner_name ?? "",
          calendly_link: bookingLink,
          booking_link: bookingLink,
        },
      },
    });
    if (mailErr) {
      return { ok: false, reason: mailErr.message ?? String(mailErr) };
    }
    if (mailData?.error) {
      return { ok: false, reason: String(mailData.error) };
    }

    // Update original log to 'resent'
    await sb.from("email_send_log").update({
      status: "resent",
      error_message: `Ursprünglicher Fehler: ${(log as any).error_message ?? ""} — manuell erneut gesendet ${new Date().toISOString()}`,
    }).eq("id", log.id);

    return { ok: true };
  });
