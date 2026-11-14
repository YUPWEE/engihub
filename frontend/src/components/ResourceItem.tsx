import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, ExternalLink, Flag, Pencil, ThumbsUp, Trash2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { EditDialog, type FieldValues } from "@/components/EditDialog";
import { ReportDialog } from "@/components/ReportDialog";
import { apiDelete, apiPatch, apiPost } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { errorKey, formatBytes, formatDate, rememberVote, useAdmin, votedSet } from "@/lib/queries";
import { RESOURCE_TYPES, SOURCE_META, TYPE_META } from "@/lib/resourceMeta";
import type { HelpfulOut, OkOut, Resource, ResourceType, ResourceUpdate } from "@/lib/types";
import { stagger } from "@/lib/reveal";
import { cn } from "@/lib/utils";

export function ResourceItem({ r, courseId, index = 0 }: { r: Resource; courseId: string; index?: number }) {
  const { t, lang } = useI18n();
  const admin = useAdmin();
  const qc = useQueryClient();
  const [voted, setVoted] = useState(() => votedSet().has(r.id));
  const [localCount, setLocalCount] = useState<number | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const meta = TYPE_META[r.type];
  const Icon = meta.icon;
  const src = SOURCE_META[r.source];
  const SrcIcon = src.icon;
  const count = Math.max(localCount ?? 0, r.helpful);
  const broken = r.link_status === "broken" || r.reported_broken;
  const href = `/api/resources/${r.id}/open`;

  const helpful = useMutation({
    mutationFn: () => apiPost<HelpfulOut>(`/resources/${r.id}/helpful`),
    onSuccess: (res) => {
      setLocalCount(res.helpful);
      rememberVote(r.id);
      setVoted(true);
    },
    onError: (e) => toast.error(t(errorKey(e))),
  });
  const del = useMutation({
    mutationFn: () => apiDelete<OkOut>(`/admin/resources/${r.id}`),
    onSuccess: () => {
      toast.success(t("deleted"));
      qc.invalidateQueries({ queryKey: ["course", courseId] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
      qc.invalidateQueries({ queryKey: ["home"] });
    },
    onError: (e) => toast.error(t(errorKey(e))),
  });
  const save = async (v: FieldValues) => {
    const body: ResourceUpdate = {
      title: String(v.title),
      type: v.type as ResourceType,
      has_solutions: !!v.has_solutions,
      description: String(v.description),
      url: r.kind === "link" ? String(v.url) : null,
    };
    await apiPatch<Resource>(`/admin/resources/${r.id}`, body);
    await qc.invalidateQueries({ queryKey: ["course", courseId] });
  };

  return (
    <li
      className="group flex flex-col gap-3 rounded-xl border border-border bg-card/60 p-3.5 transition-[border-color,box-shadow] duration-500 ease-(--ease-quint) hover:border-primary/30 hover:shadow-[0_18px_36px_-22px_rgb(0_0_0/0.7)] sm:flex-row sm:items-center"
      data-reveal="item"
      style={stagger(index)}
      data-testid={`resource-item-${r.id}`}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl ring-1", meta.tone)}>
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium leading-snug transition-colors duration-150 hover:text-sage"
            data-testid="resource-title-link"
          >
            {r.title}
          </a>
          {r.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{r.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.7rem]">
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-foreground/80" data-testid="resource-source-badge">
              <SrcIcon className="size-3" />
              {t(src.label)}
              {r.kind === "pdf" && r.file_size > 0 && <span dir="ltr">· {formatBytes(r.file_size)}</span>}
            </span>
            {r.has_solutions && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-emerald-300" data-testid="resource-solutions-badge">
                <CheckCircle2 className="size-3" />
                {t("includesSolutions")}
              </span>
            )}
            {broken && (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-red-300" data-testid="resource-broken-badge">
                <AlertTriangle className="size-3" />
                {t("linkBroken")}
              </span>
            )}
            {admin && r.flagged && (
              <span className="rounded-full bg-amber-300/10 px-2 py-0.5 text-amber-200" data-testid="resource-flagged-badge">
                {t("flagged")}
              </span>
            )}
            <span className="text-muted-foreground">{t("addedOn", { d: formatDate(r.created_at, lang) })}</span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 ps-13 sm:ps-0">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ size: "sm" }), "rounded-full")}
          data-testid="resource-open-button"
        >
          {r.kind === "pdf" ? <Download className="size-3.5" /> : <ExternalLink className="size-3.5" />}
          {r.kind === "pdf" ? t("download") : t("open")}
        </a>
        <Button
          variant="outline"
          size="sm"
          className={cn("rounded-full", voted && "border-primary/40 text-sage")}
          disabled={voted || helpful.isPending}
          onClick={() => helpful.mutate()}
          aria-label={voted ? t("helpfulDone") : t("helpful")}
          data-testid="resource-helpful-button"
        >
          <ThumbsUp className="size-3.5" />
          <span data-testid="resource-helpful-count">{count}</span>
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setReportOpen(true)} aria-label={t("report")} data-testid="resource-report-button">
          <Flag className="size-3.5" />
        </Button>
        {admin && (
          <>
            <Button variant="ghost" size="icon-sm" onClick={() => setEditOpen(true)} aria-label={t("edit")} data-testid="resource-edit-button">
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-red-300 hover:text-red-200"
              onClick={() => window.confirm(t("confirmDelete")) && del.mutate()}
              aria-label={t("delete")}
              data-testid="resource-delete-button"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </>
        )}
      </div>
      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} targetType="resource" targetId={r.id} courseId={courseId} />
      {admin && (
        <EditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          title={t("editResource")}
          testid="edit-resource"
          initial={{ title: r.title, type: r.type, has_solutions: r.has_solutions, description: r.description, url: r.url ?? "" }}
          fields={[
            { name: "title", label: t("title") },
            { name: "type", label: t("type"), kind: "select", options: RESOURCE_TYPES.map((k) => ({ value: k, label: t(TYPE_META[k].label) })) },
            { name: "has_solutions", label: t("includesSolutions"), kind: "checkbox" },
            ...(r.kind === "link" ? [{ name: "url", label: t("url"), ltr: true }] : []),
            { name: "description", label: t("description"), kind: "textarea" as const },
          ]}
          onSave={save}
        />
      )}
    </li>
  );
}
