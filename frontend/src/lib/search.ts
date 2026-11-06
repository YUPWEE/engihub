// Client-side course search: normalisation + ranked prefix/fuzzy matching.
// Rank: exact code > code prefix > name prefix > contains > fuzzy.
import type { Branch, Course } from "./types";

const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

export function normalize(text: string): string {
  return text
    .replace(DIACRITICS, "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase()
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\s\-_./]+/g, "");
}

const tokenize = (s: string) => s.split(/[\s\-_/()]+/).map(normalize).filter(Boolean);

interface Entry {
  course: Course;
  codes: string[];
  names: string[];
  tokens: string[];
  branchTokens: string[];
}

export type SearchIndex = Entry[];

export function buildIndex(courses: Course[], branches: Branch[]): SearchIndex {
  const byId = new Map(branches.map((b) => [b.id, b]));
  return courses.map((c) => {
    const b = byId.get(c.branch_id);
    return {
      course: c,
      codes: [normalize(c.code_ar), normalize(c.code_en)],
      names: [normalize(c.name_ar), normalize(c.name_en)].filter(Boolean),
      tokens: [...tokenize(c.name_ar), ...tokenize(c.name_en)],
      branchTokens: b ? [...tokenize(b.name_ar), ...tokenize(b.name_en)] : [],
    };
  });
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

function score(e: Entry, q: string): number {
  let best = 0;
  for (const code of e.codes) {
    if (code === q) return 1000;
    if (code.startsWith(q)) best = Math.max(best, 800 - (code.length - q.length));
  }
  if (best) return best;
  for (const n of e.names) if (n.startsWith(q)) best = Math.max(best, 600);
  if (!best && e.tokens.some((t) => t.startsWith(q))) best = 560;
  if (best) return best;
  if (e.codes.some((c) => c.includes(q)) || e.names.some((n) => n.includes(q))) return 400;
  if (e.branchTokens.some((t) => t.startsWith(q))) return 300;
  if (q.length >= 3) {
    if (e.codes.some((c) => lev(q, c.slice(0, q.length)) <= 1)) return 200;
    if (q.length >= 4 && [...e.tokens, ...e.branchTokens].some((t) => lev(q, t.slice(0, q.length)) <= 1)) return 150;
  }
  return 0;
}

export function searchCourses(index: SearchIndex, query: string, limit = 8, branchId?: string): Course[] {
  const q = normalize(query);
  if (!q) return [];
  const hits: { c: Course; s: number; i: number }[] = [];
  index.forEach((e, i) => {
    if (branchId && e.course.branch_id !== branchId) return;
    const s = score(e, q);
    if (s > 0) hits.push({ c: e.course, s, i });
  });
  hits.sort((a, b) => b.s - a.s || a.i - b.i);
  return hits.slice(0, limit).map((h) => h.c);
}

// "ريض 106" / "math-106" → { branchId, number } for prefilling the add-course form.
export function parseCode(query: string, branches: Branch[]): { branchId: string; number: string } {
  const q = normalize(query);
  const m = q.match(/^(\D*?)(\d+[a-z]?)?$/);
  const prefix = m?.[1] ?? q;
  const number = (m?.[2] ?? "").toUpperCase();
  const b = prefix
    ? branches.find((x) => normalize(x.code_ar) === prefix || normalize(x.code_en) === prefix)
    : undefined;
  return { branchId: b?.id ?? "", number };
}
