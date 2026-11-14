import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ChevronDown, ChevronLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddResourceDialog, type AddKind } from "@/components/AddResourceDialog";
import { EmptyState } from "@/components/Cards";
import { EditDialog, type FieldValues } from "@/components/EditDialog";
import { ResourceItem } from "@/components/ResourceItem";
import { StudySessions } from "@/components/StudySessions";
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { altCode, altName, courseCode, courseName, errorKey, useAdmin, useCatalog } from "@/lib/queries";
import { RESOURCE_TYPES, TYPE_META } from "@/lib/resourceMeta";
import type { Course, CourseDetail, CourseUpdate, OkOut, Resource, ResourceType } from "@/lib/types";
import { cn } from "@/lib/utils";

const collator = new Intl.Collator(["ar", "en"], { numeric: true, sensitivity: "base" });

// Split one type group into sub-sections (e.g. Drive folders such as "النهائية"). Items without a section keep
// their order and come first; sectioned items are sorted naturally (exams newest first, everything else 1→n).
function sectionsOf(items: Resource[], type: ResourceType): [string, Resource[]][] {
  const map = new Map<string, Resource[]>();
  for (const r of items) {
    const k = r.section ?? "";
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  const dir = type === "exams" ? -1 : 1;
  for (const [k, list] of map) if (k) list.sort((a, b) => dir * collator.compare(a.title, b.title));
  return [...map.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : collator.compare(a, b)));
}

// Guard against StrictMode's double effect run counting one visit twice.
let lastOpen = { id: "", t: 0 };

export default function CoursePage() {
  const { id = "" } = useParams();
  const { t, lang } = useI18n();
  const admin = useAdmin();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: catalog } = useCatalog();
  const [add, setAdd] = useState<{ open: boolean; type?: AddKind }>({ open: false });
  const [editOpen, setEditOpen] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["course", id],
    queryFn: () => apiGet<CourseDetail>(`/courses/${id}`),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });

  useEffect(() => {
    if (!id || (lastOpen.id === id && Date.now() - lastOpen.t < 3000)) return;
    lastOpen = { id, t: Date.now() };
    apiPost<OkOut>(`/courses/${id}/open`).catch(() => undefined);
  }, [id]);

  const del = useMutation({
    mutationFn: () => apiDelete<OkOut>(`/admin/courses/${id}`),
    onSuccess: async () => {
      toast.success(t("deleted"));
      await qc.invalidateQueries({ queryKey: ["catalog"] });
      qc.invalidateQueries({ queryKey: ["home"] });
      navigate(data ? `/branch/${data.branch.id}` : "/");
    },
    onError: (e) => toast.error(t(errorKey(e))),
  });

  if (isLoading) return <div className="mx-auto max-w-5xl px-4 py-10"><div className="h-40 animate-pulse rounded-3xl bg-card" /></div>;
  if (error || !data)
    return (
      <div className="mx-auto max-w-3xl px-4 py-20">
        <EmptyState
          text={error instanceof ApiError && error.status === 404 ? t("courseNotFoundSub") : t("loadError")}
          testid="course-not-found"
          action={<Link to="/" className="text-sage" data-testid="course-not-found-home-link">{t("backHome")}</Link>}
        />
      </div>
    );

  const { course, branch, resources, sessions } = data;
  const groups = RESOURCE_TYPES.map((type) => ({ type, items: resources.filter((r) => r.type === type) })).filter((g) => g.items.length);
  const saveCourse = async (v: FieldValues) => {
    const body: CourseUpdate = { branch_id: String(v.branch_id), number: String(v.number), name_ar: String(v.name_ar), name_en: String(v.name_en) };
    await apiPatch<Course>(`/admin/courses/${id}`, body);
    await Promise.all([qc.invalidateQueries({ queryKey: ["course", id] }), qc.invalidateQueries({ queryKey: ["catalog"] })]);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <nav className="mb-4 flex items-center gap-1 text-sm text-muted-foreground" data-testid="course-breadcrumb">
        <Link to="/" className="hover:text-foreground">{t("home")}</Link>
        <ChevronLeft className="size-3.5 ltr:rotate-180" />
        <Link to={`/branch/${branch.id}`} className="hover:text-foreground" data-testid="course-branch-link">
          {lang === "ar" ? branch.name_ar : branch.name_en}
        </Link>
      </nav>
      <section className="glass relative overflow-hidden rounded-3xl border border-border p-6 md:p-8" data-reveal="rise" data-testid="course-header">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="code-text text-5xl font-bold tracking-tight text-sage md:text-6xl" data-testid="course-code">{courseCode(course, lang)}</div>
            <div className="mt-1 text-sm text-muted-foreground" dir="ltr" data-testid="course-alt-code">{altCode(course, lang)}</div>
            <h1 className="mt-4 text-2xl font-semibold md:text-3xl" data-testid="course-name">{courseName(course, lang)}</h1>
            {altName(course, lang) && <p className="mt-1 text-muted-foreground">{altName(course, lang)}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" className="rounded-full" onClick={() => setAdd({ open: true })} data-testid="course-add-resource-button">
              <Plus className="size-4" />
              {t("addResource")}
            </Button>
            {admin && (
              <>
                <Button variant="outline" size="lg" className="rounded-full" onClick={() => setEditOpen(true)} data-testid="course-edit-button">
                  <Pencil className="size-4" />
                  {t("editCourse")}
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="rounded-full text-red-300"
                  onClick={() => window.confirm(t("confirmDeleteCourse")) && del.mutate()}
                  data-testid="course-delete-button"
                >
                  <Trash2 className="size-4" />
                  {t("deleteCourse")}
                </Button>
              </>
            )}
          </div>
        </div>
        {groups.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2" data-testid="course-type-chips">
            {groups.map((g) => {
              const Icon = TYPE_META[g.type].icon;
              return (
                <a
                  key={g.type}
                  href={`#group-${g.type}`}
                  className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ring-1 transition-opacity duration-150 hover:opacity-80", TYPE_META[g.type].tone)}
                  data-testid={`course-type-chip-${g.type}`}
                >
                  <Icon className="size-3.5" />
                  {t(TYPE_META[g.type].label)} · {g.items.length}
                </a>
              );
            })}
          </div>
        )}
      </section>

      <div className="mt-10 space-y-10">
        {groups.length === 0 ? (
          <EmptyState
            text={t("emptyResources")}
            testid="course-empty-resources"
            action={
              <Button className="rounded-full" onClick={() => setAdd({ open: true })} data-testid="course-empty-add-button">
                <Plus className="size-4" />
                {t("addResource")}
              </Button>
            }
          />
        ) : (
          groups.map((g) => {
            const Icon = TYPE_META[g.type].icon;
            return (
              <section key={g.type} id={`group-${g.type}`} className="scroll-mt-24" data-testid={`resource-group-${g.type}`}>
                <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                  <Icon className="size-5 text-sage" />
                  {t(TYPE_META[g.type].label)}
                  <span className="text-sm font-normal text-muted-foreground">({g.items.length})</span>
                </h2>
                <div className="space-y-2">
                  {sectionsOf(g.items, g.type).map(([name, items]) =>
                    name ? (
                      <details key={name} open={g.items.length <= 12} className="group rounded-xl border border-border/70" data-testid="resource-section">
                        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
                          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                          <span className="min-w-0 flex-1 truncate">{name}</span>
                          <span className="text-xs font-normal text-muted-foreground">{items.length}</span>
                        </summary>
                        <ul className="space-y-2 px-2 pb-2">
                          {items.map((r, i) => (
                            <ResourceItem key={r.id} r={r} courseId={id} index={i} />
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <ul key="" className="space-y-2">
                        {items.map((r, i) => (
                          <ResourceItem key={r.id} r={r} courseId={id} index={i} />
                        ))}
                      </ul>
                    ),
                  )}
                </div>
              </section>
            );
          })
        )}
      </div>

      <StudySessions sessions={sessions} courseId={id} onAdd={() => setAdd({ open: true, type: "session" })} />

      <AddResourceDialog
        key={add.type ?? "res"}
        open={add.open}
        onOpenChange={(o) => setAdd((s) => ({ ...s, open: o }))}
        courseId={id}
        initialType={add.type}
      />
      {admin && (
        <EditDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          title={t("editCourse")}
          testid="edit-course"
          initial={{ branch_id: course.branch_id, number: course.number, name_ar: course.name_ar, name_en: course.name_en }}
          fields={[
            {
              name: "branch_id",
              label: t("branch"),
              kind: "select",
              options: (catalog?.branches ?? []).map((b) => ({ value: b.id, label: `${b.code_ar} / ${b.code_en}` })),
            },
            { name: "number", label: t("courseNumber"), ltr: true },
            { name: "name_ar", label: t("nameAr") },
            { name: "name_en", label: t("nameEn"), ltr: true },
          ]}
          onSave={saveCourse}
        />
      )}
    </div>
  );
}
