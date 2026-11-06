import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiPost } from "@/lib/api";
import { useI18n, type TKey } from "@/lib/i18n";
import { errorKey } from "@/lib/queries";
import type { OkOut, ReportIn, ReportReason, TargetType } from "@/lib/types";
import { cn } from "@/lib/utils";

const REASONS: ReportReason[] = ["inappropriate", "copyright", "broken", "other"];

function ReportForm({ targetType, targetId, courseId, onDone }: { targetType: TargetType; targetId: string; courseId: string; onDone: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [reason, setReason] = useState<ReportReason>("inappropriate");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState("");
  const m = useMutation({
    mutationFn: (body: ReportIn) => apiPost<OkOut>("/reports", body),
    onSuccess: () => {
      toast.success(t("reportSent"));
      qc.invalidateQueries({ queryKey: ["course", courseId] });
      onDone();
    },
  });
  const reasons = targetType === "session" ? REASONS.filter((r) => r !== "broken") : REASONS;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate({ target_type: targetType, target_id: targetId, reason, note, website });
  };
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="report-form">
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{t("reason")}</legend>
        {reasons.map((r) => (
          <label
            key={r}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors duration-150",
              reason === r ? "border-primary/50 bg-primary/8" : "border-border hover:bg-accent/50",
            )}
          >
            <input
              type="radio"
              name="reason"
              value={r}
              checked={reason === r}
              onChange={() => setReason(r)}
              className="accent-[#6ba597]"
              data-testid={`report-reason-${r}`}
            />
            {t(`r_${r}` as TKey)}
          </label>
        ))}
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor="report-note">{t("reportNote")}</Label>
        <Textarea id="report-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} data-testid="report-note-input" />
      </div>
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
      />
      {m.isError && (
        <p className="text-sm text-destructive" role="alert" data-testid="report-error">
          {t(errorKey(m.error))}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={m.isPending} data-testid="report-submit-button">
        {t("send")}
      </Button>
    </form>
  );
}

export function ReportDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  targetType: TargetType;
  targetId: string;
  courseId: string;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="report-dialog">
        <DialogHeader className="pe-8">
          <DialogTitle>{t("reportTitle")}</DialogTitle>
          <DialogDescription>{t("reportSub")}</DialogDescription>
        </DialogHeader>
        <ReportForm
          targetType={props.targetType}
          targetId={props.targetId}
          courseId={props.courseId}
          onDone={() => props.onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
