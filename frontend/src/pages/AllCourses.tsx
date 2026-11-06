import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { CourseCard, EmptyState, SkeletonGrid } from "@/components/Cards";
import { AddCourseButton, AddCourseDialog } from "@/components/CourseFields";
import { useSearchIndex } from "@/components/SearchBox";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { useCatalog } from "@/lib/queries";
import { parseCode, searchCourses } from "@/lib/search";
import { cn } from "@/lib/utils";

export default function AllCourses() {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const { data: catalog } = useCatalog();
  const index = useSearchIndex();
  const [q, setQ] = useState(params.get("q") ?? "");
  const branch = params.get("branch") ?? "";
  const [addOpen, setAddOpen] = useState(params.get("add") === "1");

  const list = useMemo(() => {
    const all = catalog?.courses ?? [];
    if (q.trim()) return searchCourses(index, q, 500, branch || undefined);
    return branch ? all.filter((c) => c.branch_id === branch) : all;
  }, [catalog, index, q, branch]);

  const setBranch = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("branch", id);
    else next.delete("branch");
    next.delete("add");
    setParams(next, { replace: true });
  };
  const parsed = parseCode(q, catalog?.branches ?? []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl" data-testid="all-courses-title">{t("allCoursesTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("allCoursesSub")}</p>
        </div>
      </div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="h-11 flex-1 rounded-xl"
          data-testid="all-courses-filter-input"
        />
        <AddCourseButton onClick={() => setAddOpen(true)} className="h-11 w-full sm:w-auto" testid="all-courses-add-course-button" />
      </div>
      <div className="mb-6 flex flex-wrap gap-2" data-testid="branch-filter">
        {[{ id: "", label: t("allBranches") }, ...(catalog?.branches ?? []).map((b) => ({ id: b.id, label: lang === "ar" ? b.code_ar : b.code_en }))].map(
          (b) => (
            <button
              key={b.id || "all"}
              type="button"
              onClick={() => setBranch(b.id)}
              aria-pressed={branch === b.id}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors duration-150",
                branch === b.id ? "border-primary/60 bg-primary/12 text-sage" : "border-border text-muted-foreground hover:text-foreground",
              )}
              data-testid={`branch-filter-${b.id || "all"}`}
            >
              {b.label}
            </button>
          ),
        )}
      </div>
      {!catalog ? (
        <SkeletonGrid n={9} className="sm:grid-cols-2 lg:grid-cols-3" />
      ) : list.length === 0 ? (
        <EmptyState
          text={t("noCourses")}
          testid="all-courses-empty"
          action={
            <Button variant="outline" className="rounded-full" onClick={() => setAddOpen(true)} data-testid="all-courses-empty-add-button">
              {t("addCourse")}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="all-courses-grid">
          {list.map((c, i) => (
            <CourseCard key={c.id} course={c} index={i} />
          ))}
        </div>
      )}
      <AddCourseDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        initial={{ branch_id: parsed.branchId || branch, number: parsed.number, name_ar: "", name_en: "" }}
      />
    </div>
  );
}
