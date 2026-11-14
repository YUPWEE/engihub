import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Check, Info, Link2, Plus, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CourseFields, validateNewCourse, type NewCourse } from "@/components/CourseFields";
import { useSearchIndex } from "@/components/SearchBox";
import { apiPost, apiUpload } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { courseCode, courseName, errorKey, formatBytes, useCatalog } from "@/lib/queries";
import { RESOURCE_TYPES, SOURCE_META, TYPE_META, detectSource, isHttpsUrl, isPersonalContact } from "@/lib/resourceMeta";
import { parseCode, searchCourses } from "@/lib/search";
import type { Course, Resource, ResourceType } from "@/lib/types";
import { cn } from "@/lib/utils";

export type AddKind = ResourceType;
const MAX_PDF = 15 * 1024 * 1024;

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  courseId?: string;
  branchId?: string;
  initialType?: AddKind;
}

function AddForm({ courseId: initialCourseId, branchId, initialType, onDone }: Omit<Props, "open" | "onOpenChange"> & { onDone: () => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: catalog } = useCatalog();
  const index = useSearchIndex();

  const [courseId, setCourseId] = useState(initialCourseId ?? "");
  const [courseQuery, setCourseQuery] = useState("");
  const [newCourse, setNewCourse] = useState(false);
  const [nc, setNc] = useState<NewCourse>({ branch_id: branchId ?? "", number: "", name_ar: "", name_en: "" });

  const [type, setType] = useState<AddKind>(initialType ?? "slides");
  const [title, setTitle] = useState("");
  const [hasSolutions, setHasSolutions] = useState(false);
  const [mode, setMode] = useState<"pdf" | "link">("link");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");

  const selected = catalog?.courses.find((c) => c.id === courseId);
  const matches = useMemo(
    () => (courseQuery.trim() ? searchCourses(index, courseQuery, 6, branchId) : []),
    [index, courseQuery, branchId],
  );

  const m = useMutation({
    mutationFn: async () => {
      if (!courseId && !newCourse) throw new Error("e_course_required");
      if (newCourse) {
        const err = validateNewCourse(nc);
        if (err) throw new Error(err);
      }
      if (!title.trim()) throw new Error("e_title_required");
      if (mode === "pdf") {
        if (!file) throw new Error("e_file_required");
        if (file.size > MAX_PDF) throw new Error("e_too_large");
        if (!(file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) throw new Error("e_not_pdf");
      } else {
        if (isPersonalContact(url)) throw new Error("e_contact_link_not_allowed");
        if (!isHttpsUrl(url.trim())) throw new Error("e_invalid_url");
      }

      let cid = courseId;
      if (!cid) {
        const created = await apiPost<Course>("/courses", { ...nc, website });
        cid = created.id;
        setCourseId(cid); // a retry after a later failure must not re-create the course
        setNewCourse(false);
      }

      const fd = new FormData();
      fd.append("course_id", cid);
      fd.append("title", title);
      fd.append("type", type);
      fd.append("kind", mode);
      fd.append("has_solutions", String(type === "exams" && hasSolutions));
      fd.append("description", description);
      fd.append("website", website);
      if (mode === "pdf" && file) fd.append("file", file);
      else fd.append("url", url.trim());
      await apiUpload<Resource>("/resources", fd);
      return cid;
    },
    onSuccess: async (cid) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["catalog"] }),
        qc.invalidateQueries({ queryKey: ["course", cid] }),
        qc.invalidateQueries({ queryKey: ["home"] }),
      ]);
      toast.success(t("added"));
      onDone();
      navigate(`/course/${cid}`);
    },
    onError: (e) => toast.error(t(errorKey(e))),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };

  const startNewCourse = () => {
    const parsed = parseCode(courseQuery, catalog?.branches ?? []);
    setNc({ branch_id: parsed.branchId || branchId || "", number: parsed.number, name_ar: "", name_en: "" });
    setNewCourse(true);
  };

  const source = url ? detectSource(url) : null;
  const SourceIcon = source ? SOURCE_META[source].icon : null;

  return (
    <form onSubmit={submit} className="space-y-5" data-testid="add-resource-form">
      {/* course */}
      <section className="space-y-2">
        <Label>{t("course")}</Label>
        {selected ? (
          <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5" data-testid="add-resource-selected-course">
            <span className="code-text font-bold text-sage">{courseCode(selected, lang)}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{courseName(selected, lang)}</span>
            <Button type="button" variant="ghost" size="xs" onClick={() => setCourseId("")} data-testid="add-resource-change-course">
              {t("change")}
            </Button>
          </div>
        ) : newCourse ? (
          <div className="space-y-3 rounded-xl border border-border bg-card/60 p-3">
            <CourseFields value={nc} onChange={setNc} prefix="add-resource-new-course" />
            <p className="flex items-center gap-1.5 text-xs text-sage">
              <Info className="size-3.5" />
              {t("newCourseNote")}
            </p>
            <Button type="button" variant="link" size="xs" className="px-0" onClick={() => setNewCourse(false)} data-testid="add-resource-cancel-new-course">
              {t("cancelNew")}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={courseQuery}
                onChange={(e) => setCourseQuery(e.target.value)}
                placeholder={t("courseSearch")}
                className="ps-9"
                data-testid="add-resource-course-search"
              />
            </div>
            {matches.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {matches.map((c, i) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setCourseId(c.id)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-sm transition-colors duration-150 hover:bg-accent"
                      data-testid={`add-resource-course-option-${i}`}
                    >
                      <span className="code-text min-w-[5rem] font-semibold text-sage">{courseCode(c, lang)}</span>
                      <span className="truncate">{courseName(c, lang)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={startNewCourse} data-testid="add-resource-new-course-button">
              <Plus className="size-3.5" />
              {t("notListed")}
            </Button>
          </div>
        )}
      </section>

      {/* type */}
      <section className="space-y-2">
        <Label>{t("type")}</Label>
        <div className="flex flex-wrap gap-2">
          {RESOURCE_TYPES.map((k) => {
            const meta = TYPE_META[k];
            const Icon = meta.icon;
            const on = type === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setType(k)}
                aria-pressed={on}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-[background-color,border-color,color] duration-150",
                  on ? "border-primary/60 bg-primary/12 text-sage" : "border-border text-muted-foreground hover:border-primary/30 hover:text-foreground",
                )}
                data-testid={`add-resource-type-${k}`}
              >
                <Icon className="size-3.5" />
                {t(meta.label)}
              </button>
            );
          })}
        </div>
      </section>

        <section className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="r-title">{t("title")}</Label>
            <Input id="r-title" value={title} maxLength={200} placeholder={t("titlePh")} onChange={(e) => setTitle(e.target.value)} data-testid="resource-title-input" />
          </div>
          {type === "exams" && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={hasSolutions} onCheckedChange={(c) => setHasSolutions(!!c)} data-testid="resource-has-solutions-checkbox" />
              {t("includesSolutions")}
            </label>
          )}
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary/60 p-1">
            {(["pdf", "link"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setMode(k)}
                aria-pressed={mode === k}
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm transition-colors duration-150",
                  mode === k ? "bg-card text-sage shadow-sm ring-1 ring-primary/30" : "text-muted-foreground hover:text-foreground",
                )}
                data-testid={`resource-mode-${k}`}
              >
                {k === "pdf" ? <Upload className="size-4" /> : <Link2 className="size-4" />}
                {k === "pdf" ? t("uploadPdf") : t("externalLink")}
              </button>
            ))}
          </div>
          {mode === "pdf" ? (
            <label
              className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed border-border px-4 py-6 text-center transition-colors duration-150 hover:border-primary/40 hover:bg-primary/5"
              data-testid="resource-file-dropzone"
            >
              {file ? <Check className="size-5 text-sage" /> : <Upload className="size-5 text-sage" />}
              <span className="text-sm font-medium">{file ? file.name : t("choosePdf")}</span>
              <span className="text-xs text-muted-foreground">{file ? formatBytes(file.size) : t("pdfHint")}</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                data-testid="resource-file-input"
              />
            </label>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="r-url">{t("url")}</Label>
              <Input id="r-url" dir="ltr" placeholder="https://drive.google.com/…" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="resource-url-input" />
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {SourceIcon && source && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-foreground/80" data-testid="resource-detected-source">
                    <SourceIcon className="size-3" />
                    {t(SOURCE_META[source].label)}
                  </span>
                )}
                {t("urlHint")}
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="r-desc">{t("description")}</Label>
            <Textarea id="r-desc" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} data-testid="resource-description-input" />
          </div>
          <p className="flex gap-2 rounded-xl border border-amber-200/15 bg-amber-200/5 p-3 text-xs leading-relaxed text-amber-100/80" data-testid="resource-rights-notice">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            {t("rightsNotice")}
          </p>
        </section>

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
        <p className="text-sm text-destructive" role="alert" data-testid="add-resource-error">
          {t(errorKey(m.error))}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full rounded-xl" disabled={m.isPending} data-testid="add-resource-submit">
        {m.isPending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

export function AddResourceDialog({ open, onOpenChange, ...rest }: Props) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl" data-testid="add-resource-dialog">
        <DialogHeader className="pe-8">
          <DialogTitle className="text-lg">{t("modalTitle")}</DialogTitle>
          <DialogDescription>{t("modalSub")}</DialogDescription>
        </DialogHeader>
        <AddForm {...rest} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
