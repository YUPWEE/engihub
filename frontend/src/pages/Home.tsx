import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Download, GraduationCap, Layers, TrendingUp } from "lucide-react";
import { BranchCard, CourseCard, EmptyState, SectionTitle, SkeletonGrid } from "@/components/Cards";
import { SearchBox } from "@/components/SearchBox";
import { apiGet } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { courseCode, useCatalog } from "@/lib/queries";
import { TYPE_META } from "@/lib/resourceMeta";
import type { HomeStats } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function Home() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const { data: catalog } = useCatalog();
  const { data: stats } = useQuery({ queryKey: ["home"], queryFn: () => apiGet<HomeStats>("/home") });

  const counts = new Map<string, number>();
  for (const c of catalog?.courses ?? []) counts.set(c.branch_id, (counts.get(c.branch_id) ?? 0) + 1);
  const toCourses = (query: string) => navigate(`/courses?q=${encodeURIComponent(query)}`);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16">
      <section className="relative z-20 pt-12 pb-14 md:pt-20 md:pb-20" data-testid="hero-section">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-xs text-sage" data-testid="hero-badge">
          <GraduationCap className="size-3.5" />
          {t("heroBadge")}
        </span>
        <h1 className="mt-5 max-w-3xl text-4xl font-bold leading-[1.15] tracking-tight md:text-6xl" data-testid="hero-title">
          {t("heroTitle")}
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted-foreground md:text-lg" data-testid="hero-subtitle">
          {t("heroSub")}
        </p>
        <div className="mt-8 max-w-2xl">
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder={t("searchPlaceholder")}
            size="lg"
            testid="hero-search"
            onEnterNoMatch={toCourses}
            onAddCourse={(query) => navigate(`/courses?add=1&q=${encodeURIComponent(query)}`)}
          />
        </div>
      </section>

      <section className="mb-14" data-testid="branches-section">
        <SectionTitle title={t("branchesTitle")} sub={t("branchesHint")} icon={<Layers className="size-5 text-sage" />} />
        {catalog ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {catalog.branches.map((b, i) => (
              <BranchCard key={b.id} branch={b} count={counts.get(b.id) ?? 0} index={i} />
            ))}
          </div>
        ) : (
          <SkeletonGrid n={10} className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" />
        )}
      </section>

      <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <section data-testid="most-searched-section">
          <SectionTitle
            title={stats?.top_courses_fallback ? t("suggestedCourses") : t("mostSearched")}
            sub={stats?.top_courses_fallback ? undefined : t("mostSearchedSub")}
            icon={<TrendingUp className="size-5 text-sage" />}
            action={
              <Link to="/courses" className="text-sm text-sage hover:underline" data-testid="home-all-courses-link">
                {t("allCourses")}
              </Link>
            }
          />
          {stats ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {stats.top_courses.map((tc, i) => (
                <CourseCard
                  key={tc.course.id}
                  course={tc.course}
                  index={i}
                  meta={!stats.top_courses_fallback && tc.count > 0 ? <span>{t("opens", { n: tc.count })}</span> : undefined}
                />
              ))}
            </div>
          ) : (
            <SkeletonGrid n={4} className="sm:grid-cols-2" />
          )}
        </section>

        <section data-testid="most-downloaded-section">
          <SectionTitle title={t("mostDownloaded")} sub={t("mostDownloadedSub")} icon={<Download className="size-5 text-sage" />} />
          {stats && stats.top_resources.length === 0 ? (
            <EmptyState text={t("noDownloads")} testid="most-downloaded-empty" />
          ) : (
            <ul className="space-y-2">
              {(stats?.top_resources ?? []).map((rw, i) => {
                const meta = TYPE_META[rw.resource.type];
                const Icon = meta.icon;
                return (
                  <li key={rw.resource.id}>
                    <Link
                      to={`/course/${rw.course.id}`}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors duration-150 hover:border-primary/35"
                      data-testid={`top-resource-${i}`}
                    >
                      <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg ring-1", meta.tone)}>
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{rw.resource.title}</span>
                        <span className="code-text text-xs text-sage">{courseCode(rw.course, lang)}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{t("downloads", { n: rw.count })}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
