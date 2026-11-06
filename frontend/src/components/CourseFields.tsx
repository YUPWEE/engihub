import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiError, apiPost } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { errorKey, useCatalog } from "@/lib/queries";
import { normalize } from "@/lib/search";
import type { Branch, Course, CourseIn } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface NewCourse {
  branch_id: string;
  number: string;
  name_ar: string;
  name_en: string;
}

export function validateNewCourse(c: NewCourse): string | null {
  if (!c.branch_id) return "e_course_required";
  if (!/^\d{3}[A-Z]?$/.test(normalize(c.number).toUpperCase())) return "e_invalid_code";
  if (!c.name_ar.trim() && !c.name_en.trim()) return "e_name_required";
  return null;
}

export function CourseFields({ value, onChange, prefix }: { value: NewCourse; onChange: (v: NewCourse) => void; prefix: string }) {
  const { t, lang } = useI18n();
  const { data } = useCatalog();
  const branches = data?.branches ?? [];
  const label = (id: string) => {
    const b = branches.find((x) => x.id === id);
    return b ? `${lang === "ar" ? b.code_ar : b.code_en} — ${lang === "ar" ? b.name_ar : b.name_en}` : "";
  };
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label>{t("branch")}</Label>
        <Select value={value.branch_id} onValueChange={(v: string) => onChange({ ...value, branch_id: v })}>
          <SelectTrigger className="w-full" data-testid={`${prefix}-branch-select`}>
            <SelectValue>{(v) => label(v as string) || t("branch")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id} data-testid={`${prefix}-branch-option-${b.code_en.toLowerCase()}`}>
                {label(b.id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-number`}>{t("courseNumber")}</Label>
        <Input
          id={`${prefix}-number`}
          dir="ltr"
          inputMode="numeric"
          placeholder={t("courseNumberHint")}
          value={value.number}
          onChange={(e) => onChange({ ...value, number: e.target.value })}
          data-testid={`${prefix}-number-input`}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-name-ar`}>{t("nameAr")}</Label>
        <Input
          id={`${prefix}-name-ar`}
          dir="rtl"
          value={value.name_ar}
          onChange={(e) => onChange({ ...value, name_ar: e.target.value })}
          data-testid={`${prefix}-name-ar-input`}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${prefix}-name-en`}>{t("nameEn")}</Label>
        <Input
          id={`${prefix}-name-en`}
          dir="ltr"
          value={value.name_en}
          onChange={(e) => onChange({ ...value, name_en: e.target.value })}
          data-testid={`${prefix}-name-en-input`}
        />
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-2">{t("nameHint")}</p>
    </div>
  );
}

// Parses "هعم 106", "GE106", "ge-106" or just "106" (uses the selected branch) with the search normalisation.
function parseFullCode(code: string, branches: Branch[], fallbackBranch: string): { branchId: string; number: string } | null {
  const m = normalize(code).match(/^(\D*)(\d{3}[a-z]?)$/);
  if (!m) return null;
  const [, prefix, num] = m;
  if (!prefix) return fallbackBranch ? { branchId: fallbackBranch, number: num.toUpperCase() } : null;
  const b = branches.find((x) => normalize(x.code_ar) === prefix || normalize(x.code_en) === prefix);
  return b ? { branchId: b.id, number: num.toUpperCase() } : null;
}

function AddCourseForm({ initial, onDone }: { initial: NewCourse; onDone: () => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useCatalog();
  const branches = data?.branches ?? [];
  const [branchId, setBranchId] = useState(initial.branch_id);
  const [code, setCode] = useState(initial.number);
  const [nameAr, setNameAr] = useState(initial.name_ar);
  const [nameEn, setNameEn] = useState(initial.name_en);
  const [website, setWebsite] = useState("");

  const parsed = parseFullCode(code, branches, branchId);
  const duplicate = parsed
    ? data?.courses.find((c) => c.branch_id === parsed.branchId && normalize(c.number) === normalize(parsed.number))
    : undefined;

  const onCode = (v: string) => {
    setCode(v);
    const p = parseFullCode(v, branches, "");
    if (p) setBranchId(p.branchId); // a typed prefix (هعم / GE) selects its branch
  };

  const m = useMutation({
    mutationFn: async () => {
      if (!parsed) throw new Error(code.trim() ? "e_code_format" : "e_course_required");
      if (duplicate) throw new Error("e_duplicate_course");
      if (!nameAr.trim()) throw new Error("e_name_ar_required");
      const body: CourseIn = { branch_id: parsed.branchId, number: parsed.number, name_ar: nameAr, name_en: nameEn, website };
      return apiPost<Course>("/courses", body);
    },
    onSuccess: async (c) => {
      await qc.invalidateQueries({ queryKey: ["catalog"] });
      toast.success(t("added"));
      onDone();
      navigate(`/course/${c.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) qc.invalidateQueries({ queryKey: ["catalog"] }); // surfaces the existing-course link
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  const branchLabel = (id: string) => {
    const b = branches.find((x) => x.id === id);
    return b ? `${lang === "ar" ? b.code_ar : b.code_en} — ${lang === "ar" ? b.name_ar : b.name_en}` : "";
  };
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="add-course-form">
      <div className="space-y-1.5">
        <Label htmlFor="add-course-code">{t("courseCodeLabel")} *</Label>
        <Input
          id="add-course-code"
          value={code}
          onChange={(e) => onCode(e.target.value)}
          placeholder={t("courseCodeHint")}
          autoFocus
          data-testid="add-course-code-input"
        />
        <p className="text-xs text-muted-foreground">{t("courseCodeHint")}</p>
      </div>
      <div className="space-y-1.5">
        <Label>{t("branch")}</Label>
        <Select value={branchId} onValueChange={(v: string) => setBranchId(v)}>
          <SelectTrigger className="w-full" data-testid="add-course-branch-select">
            <SelectValue>{(v) => branchLabel(v as string) || t("branch")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {branches.map((b) => (
              <SelectItem key={b.id} value={b.id} data-testid={`add-course-branch-option-${b.code_en.toLowerCase()}`}>
                {branchLabel(b.id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="add-course-name-ar">{t("nameAr")} *</Label>
          <Input id="add-course-name-ar" dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} data-testid="add-course-name-ar-input" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-course-name-en">{t("nameEnOptional")}</Label>
          <Input id="add-course-name-en" dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} data-testid="add-course-name-en-input" />
        </div>
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
      {duplicate ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200/20 bg-amber-200/5 p-3 text-sm" role="alert" data-testid="add-course-duplicate">
          <span className="text-amber-100/90">{t("e_duplicate_course")}</span>
          <Link
            to={`/course/${duplicate.id}`}
            onClick={onDone}
            className="font-medium text-sage underline-offset-4 hover:underline"
            data-testid="add-course-duplicate-link"
          >
            {t("openExisting")}: <span className="code-text">{lang === "ar" ? duplicate.code_ar : duplicate.code_en}</span>
          </Link>
        </div>
      ) : (
        m.isError && (
          <p className="text-sm text-destructive" role="alert" data-testid="add-course-error">
            {t(errorKey(m.error))}
          </p>
        )
      )}
      <Button type="submit" className="w-full" disabled={m.isPending || !!duplicate} data-testid="add-course-submit">
        {m.isPending ? t("submitting") : t("addCourse")}
      </Button>
    </form>
  );
}

export function AddCourseDialog({ open, onOpenChange, initial }: { open: boolean; onOpenChange: (o: boolean) => void; initial: NewCourse }) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="add-course-dialog">
        <DialogHeader className="pe-8">
          <DialogTitle>{t("addCourse")}</DialogTitle>
          <DialogDescription>{t("modalSub")}</DialogDescription>
        </DialogHeader>
        <AddCourseForm initial={initial} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

// Standalone "Course not found? Add it" trigger — dashed muted-teal secondary button.
export function AddCourseButton({ onClick, className, testid }: { onClick: () => void; className?: string; testid: string }) {
  const { t } = useI18n();
  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      onClick={onClick}
      className={cn(
        "rounded-full border-dashed border-primary/55 bg-transparent text-sage transition-[background-color,border-color] duration-150 hover:border-primary hover:bg-primary/10 hover:text-sage",
        className,
      )}
      data-testid={testid}
    >
      <Plus className="size-4" />
      {t("notListed")}
    </Button>
  );
}
