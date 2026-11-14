import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Flag, Info, Pencil, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditDialog, type FieldValues } from "@/components/EditDialog";
import { ReportDialog } from "@/components/ReportDialog";
import { apiDelete, apiPatch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { errorKey, useAdmin } from "@/lib/queries";
import { stagger } from "@/lib/reveal";
import type { OkOut, StudySession, StudySessionUpdate } from "@/lib/types";

function SessionCard({ s, courseId, index }: { s: StudySession; courseId: string; index: number }) {
  const { t } = useI18n();
  const admin = useAdmin();
  const qc = useQueryClient();
  const [reportOpen, setReportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const del = useMutation({
    mutationFn: () => apiDelete<OkOut>(`/admin/sessions/${s.id}`),
    onSuccess: () => {
      toast.success(t("deleted"));
      qc.invalidateQueries({ queryKey: ["course", courseId] });
    },
    onError: (e) => toast.error(t(errorKey(e))),
  });
  const save = async (v: FieldValues) => {
    const body: StudySessionUpdate = {
      name: String(v.name),
      description: String(v.description),
      specialization: String(v.specialization),
      contact_url: String(v.contact_url),
    };
    await apiPatch<StudySession>(`/admin/sessions/${s.id}`, body);
    await qc.invalidateQueries({ queryKey: ["course", courseId] });
  };
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border/70 bg-background/40 p-3.5" data-reveal="item" style={stagger(index)} data-testid={`session-item-${s.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium" data-testid="session-name">{s.name}</span>
        {s.specialization && (
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[0.7rem] text-muted-foreground" data-testid="session-specialization">
            {s.specialization}
          </span>
        )}
        {admin && s.flagged && <span className="rounded-full bg-amber-300/10 px-2 py-0.5 text-[0.7rem] text-amber-200">{t("flagged")}</span>}
      </div>
      <p className="text-sm text-muted-foreground" data-testid="session-description">{s.description}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {s.contact_url && (
          <a
            href={s.contact_url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs transition-colors duration-150 hover:border-primary/40 hover:text-sage"
            data-testid="session-contact-link"
          >
            <ExternalLink className="size-3" />
            {t("contact")}
          </a>
        )}
        <Button variant="ghost" size="icon-xs" onClick={() => setReportOpen(true)} aria-label={t("report")} data-testid="session-report-button">
          <Flag className="size-3" />
        </Button>
        {admin && (
          <>
            <Button variant="ghost" size="icon-xs" onClick={() => setEditOpen(true)} aria-label={t("edit")} data-testid="session-edit-button">
              <Pencil className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-red-300"
              onClick={() => window.confirm(t("confirmDelete")) && del.mutate()}
              aria-label={t("delete")}
              data-testid="session-delete-button"
            >
              <Trash2 className="size-3" />
            </Button>
          </>
        )}
      </div>
      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} targetType="session" targetId={s.id} courseId={courseId} />
      {admin && (
        <EditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          title={t("editSession")}
          testid="edit-session"
          initial={{ name: s.name, description: s.description, specialization: s.specialization, contact_url: s.contact_url ?? "" }}
          fields={[
            { name: "name", label: t("sessionName") },
            { name: "specialization", label: t("sessionSpec") },
            { name: "contact_url", label: t("sessionContact"), ltr: true },
            { name: "description", label: t("sessionDesc"), kind: "textarea" },
          ]}
          onSave={save}
        />
      )}
    </li>
  );
}

export function StudySessions({ sessions, courseId, onAdd }: { sessions: StudySession[]; courseId: string; onAdd: () => void }) {
  const { t } = useI18n();
  return (
    <section className="mt-12 rounded-2xl border border-dashed border-border/80 p-4 md:p-5" data-testid="study-sessions-section">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Users className="size-4 text-muted-foreground" />
            {t("sessionsTitle")}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("sessionsSub")}</p>
        </div>
        <Button variant="outline" size="sm" className="rounded-full" onClick={onAdd} data-testid="add-session-button">
          <Plus className="size-3.5" />
          {t("addSession")}
        </Button>
      </div>
      <p className="mb-3 flex gap-2 text-xs leading-relaxed text-muted-foreground" data-testid="sessions-disclaimer">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        {t("sessionsDisclaimer")}
      </p>
      {sessions.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground" data-testid="sessions-empty">{t("sessionsEmpty")}</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {sessions.map((s, i) => (
            <SessionCard key={s.id} s={s} courseId={courseId} index={i} />
          ))}
        </ul>
      )}
    </section>
  );
}
