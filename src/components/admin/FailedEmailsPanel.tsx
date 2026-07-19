import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, RefreshCcw, Play, ShieldCheck, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  listFailedEmails,
  resendFailedEmail,
  unpauseTenantEmails,
  type FailedEmailRow,
} from "@/lib/failed-emails.functions";

export function FailedEmailsPanel() {
  const { toast } = useToast();
  const list = useServerFn(listFailedEmails);
  const resend = useServerFn(resendFailedEmail);
  const unpause = useServerFn(unpauseTenantEmails);

  const [rows, setRows] = useState<FailedEmailRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState<7 | 30 | 90>(7);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0, ok: 0 });

  const load = async () => {
    setLoading(true);
    try {
      const res = await list({ data: { days, limit: 200 } });
      setRows(res.rows);
    } catch (e: any) {
      toast({ title: "Laden fehlgeschlagen", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [days]);

  const pausedTenants = useMemo(() => {
    const map = new Map<string, { name: string; reason: string | null }>();
    for (const r of rows) {
      if (r.tenant_id && r.tenant_emails_paused && !map.has(r.tenant_id)) {
        map.set(r.tenant_id, { name: r.tenant_name ?? r.tenant_id, reason: r.tenant_emails_paused_reason });
      }
    }
    return Array.from(map.entries()).map(([id, v]) => ({ tenant_id: id, ...v }));
  }, [rows]);

  const handleUnpause = async (tenantId: string, name: string) => {
    try {
      await unpause({ data: { tenant_id: tenantId } });
      toast({ title: `Tenant "${name}" entpaust` });
      await load();
    } catch (e: any) {
      toast({ title: "Entpausen fehlgeschlagen", description: e?.message ?? String(e), variant: "destructive" });
    }
  };

  const handleResend = async (row: FailedEmailRow) => {
    setBusyId(row.id);
    try {
      const res = await resend({ data: { log_id: row.id } });
      if (res.ok) {
        toast({ title: "Erneut gesendet", description: row.recipient_email });
        await load();
      } else {
        toast({ title: "Versand fehlgeschlagen", description: res.reason ?? "unbekannt", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Fehler", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const handleResendAll = async () => {
    if (!confirm(`Sollen wirklich ${rows.length} fehlgeschlagene Mails erneut gesendet werden?`)) return;
    setBatchRunning(true);
    setBatchProgress({ done: 0, total: rows.length, ok: 0 });
    let ok = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const res = await resend({ data: { log_id: row.id } });
        if (res.ok) ok++;
      } catch { /* count as fail */ }
      setBatchProgress({ done: i + 1, total: rows.length, ok });
      // 500 ms Pause gegen SMTP-Rate-Limits
      await new Promise((r) => setTimeout(r, 500));
    }
    setBatchRunning(false);
    toast({
      title: `Batch abgeschlossen: ${ok}/${rows.length} erfolgreich`,
      variant: ok === rows.length ? "default" : "destructive",
    });
    await load();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold">Fehlgeschlagene Mails</h3>
          <p className="text-xs text-muted-foreground">
            Zeigt alle Mails mit Status <code>failed</code> aus den letzten {days} Tagen. Erneut senden benutzt den Tenant-SMTP wie im Live-Betrieb.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as 7 | 30 | 90)}>
            <SelectTrigger className="w-32 h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Letzte 7 Tage</SelectItem>
              <SelectItem value="30">Letzte 30 Tage</SelectItem>
              <SelectItem value="90">Letzte 90 Tage</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={load} disabled={loading || batchRunning} className="gap-1.5">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
            Neu laden
          </Button>
          <Button
            size="sm"
            onClick={handleResendAll}
            disabled={batchRunning || rows.length === 0 || pausedTenants.length > 0}
            className="gap-1.5"
            title={pausedTenants.length > 0 ? "Erst pausierte Tenants entpausen" : ""}
          >
            {batchRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {batchRunning ? `${batchProgress.done}/${batchProgress.total}` : `Alle ${rows.length} erneut senden`}
          </Button>
        </div>
      </div>

      {/* Pausierte Tenants Warning */}
      {pausedTenants.map((t) => (
        <div key={t.tenant_id} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-destructive/40 bg-destructive/5">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <div className="flex-1 text-sm">
            <div><strong>{t.name}</strong> — E-Mail-Versand ist pausiert</div>
            <div className="text-xs text-muted-foreground mt-0.5">Grund: {t.reason ?? "unbekannt"}</div>
          </div>
          <Button size="sm" variant="destructive" onClick={() => handleUnpause(t.tenant_id, t.name)} className="gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> Jetzt entpausen
          </Button>
        </div>
      ))}

      {/* Batch-Fortschritt */}
      {batchRunning && (
        <div className="text-xs text-muted-foreground">
          Fortschritt: {batchProgress.done} von {batchProgress.total} · ✅ {batchProgress.ok} erfolgreich
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Lade…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground rounded-xl border border-dashed">
          🎉 Keine fehlgeschlagenen Mails in diesem Zeitraum.
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Zeit</th>
                <th className="text-left px-3 py-2 font-medium">Tenant</th>
                <th className="text-left px-3 py-2 font-medium">Template</th>
                <th className="text-left px-3 py-2 font-medium">Empfänger</th>
                <th className="text-left px-3 py-2 font-medium">Fehler</th>
                <th className="text-right px-3 py-2 font-medium">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isPaused = r.tenant_emails_paused;
                const err = (r.error_message ?? "").trim().split("\n")[0].slice(0, 140);
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {new Date(r.created_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-3 py-2">
                      {r.tenant_name ?? <span className="text-muted-foreground">—</span>}
                      {isPaused && <Badge variant="destructive" className="ml-1.5 text-[9px]">pausiert</Badge>}
                    </td>
                    <td className="px-3 py-2"><code className="text-[10px]">{r.template_name}</code></td>
                    <td className="px-3 py-2 break-all">{r.recipient_email}</td>
                    <td className="px-3 py-2 text-destructive max-w-md truncate" title={r.error_message ?? ""}>
                      {err || "(kein Grund geloggt)"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleResend(r)}
                        disabled={busyId === r.id || batchRunning || isPaused}
                        className="h-7 gap-1"
                        title={isPaused ? "Tenant erst entpausen" : ""}
                      >
                        {busyId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                        Erneut senden
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
