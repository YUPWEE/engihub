import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Inbox } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { altCode, courseCode, courseName } from "@/lib/queries";
import type { Branch, Course } from "@/lib/types";
import { cn } from "@/lib/utils";

export function BranchCard({ branch, count, index }: { branch: Branch; count: number; index: number }) {
  const { t, lang } = useI18n();
  const main = lang === "ar" ? branch.name_ar : branch.name_en;
  const alt = lang === "ar" ? branch.name_en : branch.name_ar;
  return (
    <Link
      to={`/branch/${branch.id}`}
      className="group relative flex flex-col items-center gap-1 rounded-2xl border border-border bg-card px-3 py-4 text-center animate-rise transition-[transform,border-color,background-color] duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-card/70"
      style={{ animationDelay: `${index * 30}ms` }}
      data-testid={`branch-card-${branch.code_en.toLowerCase()}`}
    >
      <span className="text-xl font-bold text-sage">{lang === "ar" ? branch.code_ar : branch.code_en}</span>
      <span className="text-[0.7rem] tracking-wide text-muted-foreground" dir="ltr">
        {lang === "ar" ? branch.code_en : branch.code_ar}
      </span>
      <span className="mt-1 text-sm font-medium leading-snug">{main}</span>
      <span className="text-xs text-muted-foreground leading-snug">{alt}</span>
      <span className="mt-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-[0.7rem] text-muted-foreground" data-testid="branch-card-count">
        {t("coursesCount", { n: count })}
      </span>
    </Link>
  );
}

export function CourseCard({ course, meta, index = 0 }: { course: Course; meta?: ReactNode; index?: number }) {
  const { t, lang } = useI18n();
  return (
    <Link
      to={`/course/${course.id}`}
      className="group flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 animate-rise transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary/35"
      style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
      data-testid={`course-card-${course.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="code-text text-xl font-bold text-sage">{courseCode(course, lang)}</div>
          <div className="text-[0.7rem] text-muted-foreground" dir="ltr">
            {altCode(course, lang)}
          </div>
        </div>
        <ArrowUpRight className="size-4 text-muted-foreground transition-transform duration-200 group-hover:-translate-y-0.5 rtl:-scale-x-100" />
      </div>
      <div className="text-sm font-medium leading-snug">{courseName(course, lang)}</div>
      <div className="mt-auto flex items-center gap-2 text-xs text-muted-foreground">
        <span className="rounded-full bg-secondary px-2 py-0.5">{t("resourcesCount", { n: course.resource_count })}</span>
        {meta}
      </div>
    </Link>
  );
}

export function SectionTitle({ title, sub, icon, action }: { title: string; sub?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold md:text-2xl">
          {icon}
          {title}
        </h2>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ text, action, className, testid }: { text: string; action?: ReactNode; className?: string; testid?: string }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground",
        className,
      )}
      data-testid={testid}
    >
      <Inbox className="size-6 opacity-60" />
      <p>{text}</p>
      {action}
    </div>
  );
}

export function SkeletonGrid({ n = 6, className }: { n?: number; className?: string }) {
  return (
    <div className={cn("grid gap-3", className)}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="h-28 animate-pulse rounded-2xl bg-card/70" />
      ))}
    </div>
  );
}
