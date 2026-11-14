import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddResourceDialog } from "@/components/AddResourceDialog";
import { CourseCard, EmptyState, SkeletonGrid } from "@/components/Cards";
import { AddCourseButton, AddCourseDialog } from "@/components/CourseFields";
import { SearchBox, useSearchIndex } from "@/components/SearchBox";
import { useI18n } from "@/lib/i18n";
import { useCatalog } from "@/lib/queries";
import { searchCourses } from "@/lib/search";

export default function BranchPage() {
  const { id = "" } = useParams();
  const { t, lang } = useI18n();
  const { data: catalog } = useCatalog();
  const index = useSearchIndex();
  const [q, setQ] = useState("");
  const [addRes, setAddRes] = useState(false);
  const [addCourse, setAddCourse] = useState(false);

  if (!catalog) return <div className="mx-auto max-w-6xl px-4 py-10"><SkeletonGrid n={6} className="sm:grid-cols-3" /></div>;
  const branch = catalog.branches.find((b) => b.id === id);
  if (!branch)
    return (
      <div className="mx-auto max-w-3xl px-4 py-20">
        <EmptyState text={t("notFound")} testid="branch-not-found" action={<Link to="/" className="text-sage">{t("backHome")}</Link>} />
      </div>
    );
  const courses = catalog.courses.filter((c) => c.branch_id === id);
  const shown = q.trim() ? searchCourses(index, q, 500, id) : courses;
  const resources = courses.reduce((n, c) => n + c.resource_count, 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <section className="glass mb-8 flex flex-wrap items-center gap-6 rounded-3xl border border-border p-6 md:p-8" data-reveal="rise" data-testid="branch-header">
        <div className="grid size-20 place-items-center rounded-2xl bg-primary/10 ring-1 ring-primary/25">
          <span className="text-2xl font-bold text-sage" data-testid="branch-code">{lang === "ar" ? branch.code_ar : branch.code_en}</span>
        </div>
        <div className="min-w-0 flex-1 sm:flex-none">
          <h1 className="text-2xl font-bold md:text-3xl" data-testid="branch-name">{lang === "ar" ? branch.name_ar : branch.name_en}</h1>
          <p className="text-sm text-muted-foreground">
            {lang === "ar" ? branch.name_en : branch.name_ar} · <span dir="ltr">{lang === "ar" ? branch.code_en : branch.code_ar}</span>
          </p>
          <div className="mt-3 flex gap-2 text-xs text-muted-foreground">
            <span className="rounded-full bg-secondary px-2.5 py-0.5" data-testid="branch-course-count">{t("coursesCount", { n: courses.length })}</span>
            <span className="rounded-full bg-secondary px-2.5 py-0.5">{t("resourcesCount", { n: resources })}</span>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-1 sm:flex-row sm:items-center sm:gap-3">
          <AddCourseButton onClick={() => setAddCourse(true)} className="order-2 w-full sm:order-1 sm:mx-auto sm:w-auto" testid="branch-add-course-button" />
          <Button size="lg" className="order-1 w-full rounded-full sm:order-2 sm:w-auto" onClick={() => setAddRes(true)} data-testid="branch-add-resource-button">
            <Plus className="size-4" />
            {t("addResource")}
          </Button>
        </div>
      </section>
      <div className="mb-6 max-w-xl">
        <SearchBox value={q} onChange={setQ} placeholder={t("searchInBranch")} branchId={id} testid="branch-search" onAddCourse={() => setAddCourse(true)} />
      </div>
      <h2 className="mb-3 text-lg font-semibold">{t("branchCourses")}</h2>
      {shown.length === 0 ? (
        <EmptyState
          text={t("noCoursesBranch")}
          testid="branch-empty"
          action={
            <Button variant="outline" className="rounded-full" onClick={() => setAddCourse(true)} data-testid="branch-empty-add-course">
              {t("addCourse")}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="branch-courses-grid">
          {shown.map((c, i) => (
            <CourseCard key={c.id} course={c} index={i} />
          ))}
        </div>
      )}
      <AddResourceDialog open={addRes} onOpenChange={setAddRes} branchId={id} />
      <AddCourseDialog open={addCourse} onOpenChange={setAddCourse} initial={{ branch_id: id, number: "", name_ar: "", name_en: "" }} />
    </div>
  );
}
