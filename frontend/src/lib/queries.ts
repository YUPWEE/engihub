// TanStack Query hooks + small helpers shared by pages.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiGet } from "./api";
import { isTKey, type Lang, type TKey } from "./i18n";
import type { AdminMe, Catalog, Course, SearchOut, SiteSettings } from "./types";

const CATALOG_KEY = "engihub_catalog_v1";
let cacheMemo: { t: number; data: Catalog } | null | undefined;

function readCatalogCache() {
  if (cacheMemo !== undefined) return cacheMemo;
  try {
    const raw = localStorage.getItem(CATALOG_KEY);
    cacheMemo = raw ? (JSON.parse(raw) as { t: number; data: Catalog }) : null;
  } catch {
    cacheMemo = null;
  }
  return cacheMemo;
}

// Full course list loaded once and cached in the browser: search runs client-side.
export function useCatalog() {
  const cached = readCatalogCache();
  return useQuery({
    queryKey: ["catalog"],
    queryFn: async () => {
      const data = await apiGet<Catalog>("/catalog");
      try {
        localStorage.setItem(CATALOG_KEY, JSON.stringify({ t: Date.now(), data }));
      } catch {
        /* storage full / private mode */
      }
      cacheMemo = { t: Date.now(), data };
      return data;
    },
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.t,
    staleTime: 60_000,
  });
}

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: () => apiGet<SiteSettings>("/settings"), staleTime: 5 * 60_000 });
}

// Meaning-based search, layered on top of the instant keyword search. Debounced; silently absent when the
// server has no AI key, hits its daily budget, or errors.
export function useAiSearch(query: string): { data?: SearchOut; loading: boolean } {
  const { data: settings } = useSettings();
  const trimmed = query.trim();
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(trimmed), 450);
    return () => clearTimeout(id);
  }, [trimmed]);
  const enabled = !!settings?.ai_search && debounced.length >= 3;
  const q = useQuery({
    queryKey: ["ai-search", debounced],
    queryFn: () => apiGet<SearchOut>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const current = enabled && debounced === trimmed;
  return {
    data: current && q.data?.ai ? q.data : undefined,
    loading: !!settings?.ai_search && trimmed.length >= 3 && (debounced !== trimmed || q.isFetching),
  };
}

export function useAdminStatus():{ admin: boolean; loading: boolean } {
  const { data, isPending } = useQuery({
    queryKey: ["admin-me"],
    queryFn: () => apiGet<AdminMe>("/admin/me"),
    staleTime: 60_000,
    retry: false,
  });
  return { admin: !!data?.admin, loading: isPending };
}

export function useAdmin(): boolean {
  return useAdminStatus().admin;
}

export function errorKey(err: unknown): TKey {
  if (err instanceof ApiError) {
    const detail = (err.body as { detail?: unknown } | null)?.detail;
    if (typeof detail === "string") {
      const k = `e_${detail}`;
      if (isTKey(k)) return k;
    }
    if (err.status === 429) return "e_rate_limited";
    if (err.status === 413) return "e_too_large";
  }
  if (err instanceof Error && isTKey(err.message)) return err.message;
  return "e_generic";
}

export const courseCode = (c: Course, lang: Lang) => (lang === "ar" ? c.code_ar : c.code_en);
export const altCode = (c: Course, lang: Lang) => (lang === "ar" ? c.code_en : c.code_ar);
export const courseName = (c: Course, lang: Lang) =>
  (lang === "ar" ? c.name_ar || c.name_en : c.name_en || c.name_ar) || "";
export const altName = (c: Course, lang: Lang) => {
  const alt = lang === "ar" ? c.name_en : c.name_ar;
  return alt && alt !== courseName(c, lang) ? alt : "";
};

export function formatDate(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

// One "helpful" vote per resource per browser — remembered locally, no identifiers sent.
const VOTES_KEY = "engihub_helpful_v1";
export function votedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(VOTES_KEY) || "[]") as string[]);
  } catch {
    return new Set();
  }
}
export function rememberVote(id: string) {
  const s = votedSet();
  s.add(id);
  try {
    localStorage.setItem(VOTES_KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}
