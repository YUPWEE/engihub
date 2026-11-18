import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { altCode, courseCode, courseName, resourceTitle, useAiSearch, useCatalog } from "@/lib/queries";
import { buildIndex, searchCourses } from "@/lib/search";
import type { Course } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  size?: "lg" | "md";
  branchId?: string;
  testid: string;
  onEnterNoMatch?: (q: string) => void;
  onAddCourse?: (q: string) => void;
}

interface AiOption {
  key: string;
  course: Course;
  title?: string;
}

export function useSearchIndex() {
  const { data } = useCatalog();
  return useMemo(() => buildIndex(data?.courses ?? [], data?.branches ?? []), [data]);
}

export function SearchBox({ value, onChange, placeholder, size = "md", branchId, testid, onEnterNoMatch, onAddCourse }: Props) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const index = useSearchIndex();
  const { data } = useCatalog();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchCourses(index, value, 8, branchId), [index, value, branchId]);
  const ai = useAiSearch(value);
  const aiOptions = useMemo<AiOption[]>(() => {
    const seen = new Set(results.map((c) => c.id));
    const inBranch = (c: Course) => !branchId || c.branch_id === branchId;
    const courses = (ai.data?.courses ?? []).filter((c) => !seen.has(c.id) && inBranch(c)).map((c) => ({ key: `c${c.id}`, course: c }));
    const resources = (ai.data?.resources ?? []).filter((r) => inBranch(r.course)).map((r) => ({ key: `r${r.resource.id}`, course: r.course, title: resourceTitle(r.resource, lang) }));
    return [...courses, ...resources];
  }, [ai.data, results, branchId, lang]);
  const options: AiOption[] = [...results.map((c) => ({ key: c.id, course: c })), ...aiOptions];
  const branchCode = (c: Course) => data?.branches.find((b) => b.id === c.branch_id);
  const show = open && value.trim().length > 0;

  const pick = (c: Course) => {
    setOpen(false);
    navigate(`/course/${c.id}`);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (options[active]) pick(options[active].course);
      else if (value.trim()) onEnterNoMatch?.(value);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const lg = size === "lg";
  return (
    <div className="relative" data-testid={`${testid}-wrapper`}>
      <div
        className={cn(
          "flex items-center gap-2 border border-border bg-card/90 shadow-[0_10px_40px_-20px_rgb(0_0_0/0.6)] transition-[border-color,box-shadow] duration-200 focus-within:border-primary/50 focus-within:shadow-[0_0_0_4px_rgb(107_165_151/0.12)]",
          lg ? "rounded-2xl px-4 py-2" : "rounded-xl px-3 py-1",
        )}
      >
        <Search className={cn("shrink-0 text-muted-foreground", lg ? "size-5" : "size-4")} />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKey}
          placeholder={placeholder}
          aria-label={placeholder}
          role="combobox"
          aria-expanded={show}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          className={cn(
            "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/70",
            lg ? "h-12 text-base md:text-lg" : "h-10 text-sm",
          )}
          data-testid={testid}
        />
        {lg && (
          <button
            type="button"
            onClick={() => (options[0] ? pick(options[0].course) : value.trim() && onEnterNoMatch?.(value))}
            className="hidden rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors duration-200 hover:bg-primary/90 sm:block"
            data-testid={`${testid}-submit`}
          >
            {t("search")}
          </button>
        )}
      </div>
      {show && (
        <div
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl animate-drop"
          data-testid={`${testid}-suggestions`}
        >
          {options.length === 0 && ai.loading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground" data-testid={`${testid}-ai-loading`}>
              <Sparkles className="size-4 text-sage" />
              {t("aiSearching")}
            </div>
          ) : options.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm text-muted-foreground">
              <span data-testid={`${testid}-no-results`}>{t("noSuggestions")}</span>
              {onAddCourse && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onAddCourse(value)}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-3 py-1 text-sage hover:bg-primary/10"
                  data-testid={`${testid}-add-course`}
                >
                  <Plus className="size-3.5" />
                  {t("addCourseCta")}
                </button>
              )}
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {options.map((o, i) => {
                const c = o.course;
                return (
                  <li key={o.key}>
                    {i === results.length && aiOptions.length > 0 && (
                      <div className="flex items-center gap-1.5 border-t border-border px-4 pb-1 pt-2.5 text-xs text-muted-foreground" data-testid={`${testid}-ai-heading`}>
                        <Sparkles className="size-3.5 text-sage" />
                        {t("aiSuggestions")}
                      </div>
                    )}
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(c)}
                      className={cn(
                        "flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors duration-150",
                        i === active ? "bg-accent" : "hover:bg-accent/60",
                      )}
                      data-testid={`${testid}-option-${i}`}
                    >
                      <span className="code-text min-w-[5.5rem] font-bold text-sage">{courseCode(c, lang)}</span>
                      {o.title ? (
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="block truncate">{o.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">{courseName(c, lang)}</span>
                        </span>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-sm">{courseName(c, lang)}</span>
                      )}
                      <span dir="ltr" className="hidden text-xs text-muted-foreground sm:inline">
                        {altCode(c, lang)}
                      </span>
                      <span className="sr-only">{branchCode(c)?.name_en}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
