import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { format, addDays, startOfDay, isSameDay, startOfWeek } from "date-fns";
import { de } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, CalendarCheck, Clock } from "lucide-react";
import {
  getScheduleForApplicant,
  getAvailableSlots,
  bookAppointment,
} from "@/lib/appointments.functions";
import { useToast } from "@/hooks/use-toast";

export const Route = createFileRoute("/termin/buchen/$token")({
  validateSearch: (s: Record<string, unknown>) => ({
    rebook: s.rebook === "1" || s.rebook === 1 || s.rebook === true,
  }),
  head: () => ({
    meta: [
      { title: "Termin für Bewerbungsgespräch wählen" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BookingPage,
});

const DAYS_PER_VIEW = 28;

function BookingPage() {
  const { token } = Route.useParams();
  const { rebook } = Route.useSearch();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const scheduleFn = useServerFn(getScheduleForApplicant);
  const slotsFn = useServerFn(getAvailableSlots);
  const bookFn = useServerFn(bookAppointment);

  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(startOfDay(new Date()), { weekStartsOn: 1 }),
  );
  const [confirmed, setConfirmed] = useState<{
    starts_at: string;
    ends_at: string;
    cancel_token: string;
  } | null>(null);

  const info = useQuery({
    queryKey: ["schedule-for-applicant", token],
    queryFn: () => scheduleFn({ data: { token } }),
  });

  // Wenn bereits ein aktiver Termin existiert UND nicht explizit umbuchen:
  // → sanft auf die Termin-Verwaltung umleiten.
  useEffect(() => {
    if (rebook) return;
    if (confirmed) return;
    const d = info.data as any;
    const existing = d && d.existing_appointment;
    if (existing?.cancel_token) {
      navigate({ to: "/termin/$token", params: { token: existing.cancel_token }, replace: true });
    }
  }, [info.data, rebook, confirmed, navigate]);

  const fromDate = format(weekStart, "yyyy-MM-dd");
  const toDate = format(addDays(weekStart, DAYS_PER_VIEW - 1), "yyyy-MM-dd");

  const scheduleId = info.data && "ok" in info.data && info.data.ok ? info.data.schedule_id : null;

  const slotsQ = useQuery({
    queryKey: ["slots", scheduleId, fromDate, toDate],
    enabled: !!scheduleId,
    queryFn: () => slotsFn({ data: { schedule_id: scheduleId!, from_date: fromDate, to_date: toDate } }),
  });

  const days = useMemo(
    () => Array.from({ length: DAYS_PER_VIEW }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const weeks = useMemo(() => {
    const out: Date[][] = [];
    for (let i = 0; i < DAYS_PER_VIEW; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [days]);

  const slotsByDay = useMemo(() => {
    const map = new Map<string, { start: string; end: string }[]>();
    (slotsQ.data?.slots ?? []).forEach(s => {
      const key = format(new Date(s.start), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    });
    return map;
  }, [slotsQ.data]);

  const bookMutation = useMutation({
    mutationFn: async (starts_at: string) => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return bookFn({ data: { token, starts_at, applicant_timezone: tz } });
    },
    onSuccess: (res) => {
      if (!("ok" in res) || !res.ok) {
        const msg = res && "error" in res && res.error === "slot_taken"
          ? "Dieser Termin wurde gerade eben von jemand anderem gebucht. Bitte wählen Sie einen anderen."
          : res && "error" in res && res.error === "already_scheduled"
          ? "Sie haben bereits einen aktiven Termin. Bitte sagen Sie diesen zuerst ab."
          : "Buchung fehlgeschlagen. Bitte versuchen Sie es erneut.";
        toast({ title: "Nicht möglich", description: msg, variant: "destructive" });
        qc.invalidateQueries({ queryKey: ["slots"] });
        return;
      }
      setConfirmed({ starts_at: res.starts_at, ends_at: res.ends_at, cancel_token: res.cancel_token });
      try { window.parent?.postMessage({ type: "booking_completed", starts_at: res.starts_at, ends_at: res.ends_at }, "*"); } catch {}
    },
    onError: (e: any) => {
      toast({ title: "Fehler", description: e?.message ?? "Unbekannter Fehler", variant: "destructive" });
    },
  });

  if (info.isLoading) {
    return <CenterLoader />;
  }

  if (!info.data || !("ok" in info.data) || !info.data.ok) {
    const errCode = info.data && "error" in info.data ? info.data.error : "not_found";
    return (
      <CenterCard title={errCode === "no_schedule" ? "Buchung derzeit nicht möglich" : "Link ungültig"}>
        {errCode === "no_schedule"
          ? "Für diese Stelle ist der Terminkalender aktuell nicht konfiguriert. Bitte kontaktieren Sie uns direkt."
          : "Dieser Buchungslink ist ungültig oder abgelaufen. Bitte prüfen Sie die E-Mail oder fordern Sie einen neuen Link an."}
      </CenterCard>
    );
  }

  const s = info.data;

  if (confirmed) {
    return (
      <BookingConfirmed
        starts_at={confirmed.starts_at}
        ends_at={confirmed.ends_at}
        cancel_token={confirmed.cancel_token}
        tenantName={s.tenant_name ?? "das Unternehmen"}
        recruiterName={s.recruiter_name ?? "Ihr Ansprechpartner"}
        applicantEmail={s.applicant_email ?? undefined}
        applicantFirstName={s.applicant_first_name ?? undefined}
        eventDescription={s.event_description ?? undefined}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 py-10 px-4">
      <div className="max-w-4xl mx-auto">
        {rebook && (
          <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <strong className="block mb-1">Neuen Termin wählen</strong>
            Ihr bisheriger Termin wird beim Bestätigen automatisch storniert.
          </div>
        )}
        <Card className="border-0 shadow-lg">
          <CardHeader className="border-b bg-muted/30">
            <CardTitle className="text-xl">
              Hallo{s.applicant_first_name ? ` ${s.applicant_first_name}` : ""}, wählen Sie Ihren Termin
            </CardTitle>
            <CardDescription>
              Bewerbungsgespräch mit {s.recruiter_name ?? "unserer Recruiterin"}
              {s.tenant_name ? ` · ${s.tenant_name}` : ""} · {s.slot_duration_minutes} Minuten
              <br />
              <span className="text-xs text-muted-foreground">
                Zeitzone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 sm:p-7">
            {s.event_description && (
              <div className="mb-6 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm whitespace-pre-wrap leading-relaxed">
                {s.event_description}
              </div>
            )}
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-foreground">
                Freie Termine – nächste 4 Wochen
              </div>
              <div className="text-xs text-muted-foreground">
                {format(weekStart, "d. MMM", { locale: de })} –{" "}
                {format(addDays(weekStart, DAYS_PER_VIEW - 1), "d. MMM yyyy", { locale: de })}
              </div>
            </div>

            {slotsQ.isLoading ? (
              <div className="py-16 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-6">
                {weeks.map((weekDays, wi) => (
                  <div key={wi}>
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      KW {format(weekDays[0], "w", { locale: de })} · {format(weekDays[0], "d. MMM", { locale: de })} – {format(weekDays[6], "d. MMM", { locale: de })}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
                      {weekDays.map(day => {
                        const key = format(day, "yyyy-MM-dd");
                        const slots = slotsByDay.get(key) ?? [];
                        const isToday = isSameDay(day, new Date());
                        return (
                          <div key={key} className="rounded-lg border border-border bg-card overflow-hidden">
                            <div className={`px-2 py-1.5 text-center border-b ${
                              isToday ? "bg-primary/10 text-primary" : "bg-muted/40 text-foreground"
                            }`}>
                              <div className="text-[11px] uppercase tracking-wide font-medium">
                                {format(day, "EEE", { locale: de })}
                              </div>
                              <div className="text-sm font-semibold">
                                {format(day, "d.M.")}
                              </div>
                            </div>
                            <div className="p-1.5 space-y-1 min-h-[64px]">
                              {slots.length === 0 ? (
                                <div className="text-[11px] text-center text-muted-foreground py-4">
                                  keine
                                </div>
                              ) : (
                                slots.map(slot => (
                                  <button
                                    key={slot.start}
                                    onClick={() => bookMutation.mutate(slot.start)}
                                    disabled={bookMutation.isPending}
                                    className="w-full text-xs font-medium py-1.5 rounded-md border border-border text-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50"
                                  >
                                    {format(new Date(slot.start), "HH:mm")}
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center mt-6">
          Sie erhalten nach der Buchung eine Bestätigung per E-Mail – inklusive Kalendereintrag.
        </p>
      </div>
    </div>
  );
}

function BookingConfirmed(props: {
  starts_at: string;
  ends_at: string;
  cancel_token: string;
  tenantName: string;
  recruiterName: string;
  applicantEmail?: string;
  applicantFirstName?: string;
  eventDescription?: string;
}) {

  const start = new Date(props.starts_at);
  const end = new Date(props.ends_at);
  const cancelUrl = typeof window !== "undefined"
    ? `${window.location.origin}/termin/${props.cancel_token}`
    : `/termin/${props.cancel_token}`;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 py-10 px-4">
      <div className="max-w-lg mx-auto">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <CalendarCheck className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>Termin bestätigt</CardTitle>
            <CardDescription>
              Wir freuen uns auf das Gespräch mit Ihnen.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border p-4 bg-muted/40 text-center">
              <div className="text-sm text-muted-foreground">
                {format(start, "EEEE, d. MMMM yyyy", { locale: de })}
              </div>
              <div className="text-2xl font-semibold mt-1">
                {format(start, "HH:mm")} – {format(end, "HH:mm")} Uhr
              </div>
            </div>

            <p className="text-sm text-muted-foreground text-center">
              Sie erhalten in Kürze eine Bestätigung per E-Mail –
              inklusive Kalendereintrag zum 1-Tap-Speichern in Outlook,
              Google oder Apple.
            </p>

            {props.eventDescription && (
              <div className="rounded-md border border-border bg-muted/40 p-4 text-sm whitespace-pre-wrap leading-relaxed">
                {props.eventDescription}
              </div>
            )}


            <div className="text-center text-sm">
              <a href={cancelUrl} className="text-primary hover:underline">
                Termin absagen oder verschieben
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CenterLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function CenterCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="max-w-md w-full">
        <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">{children}</CardContent>
      </Card>
    </div>
  );
}
