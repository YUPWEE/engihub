import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Download, Link2Off, Pencil, Plus, RefreshCw, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/Cards";
import { EditDialog, type FieldValues } from "@/components/EditDialog";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n, type TKey } from "@/lib/i18n";
import { courseCode, errorKey, formatBytes, formatDate, useAdminStatus, useCatalog, useSettings } from "@/lib/queries";
import type { AdminOverview, Branch, BranchIn, ImportIn, ImportResult, OkOut, SiteSettings } from "@/lib/types";
import { cn } from "@/lib/utils";

function Stat({ label, value, testid }: { label: string; value: string | number; testid: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4" data-testid={testid}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function SettingsCard({ initial }: { initial: string }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [url, setUrl] = useState(initial);
  const save = useMutation({
    mutationFn: () => apiPut<SiteSettings>("/admin/settings", { contact_url: url.trim() } satisfies SiteSettings),
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s);
      toast.success(t("saved"));
    },
    onError: (e) => toast.error(t(errorKey(e))),
  });
  return (
    <form
      className="rounded-2xl border border-border bg-card p-5 md:col-span-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      data-testid="admin-settings-card"
    >
      <h3 className="font-semibold">{t("siteSettings")}</h3>
      <Label htmlFor="contact-url" className="mt-3 block text-sm">{t("contactUrlLabel")}</Label>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
        <Input id="contact-url" dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} className="flex-1" data-testid="admin-contact-url-input" />
        <Button type="submit" size="sm" className="h-9" disabled={save.isPending || !url.trim()} data-testid="admin-contact-url-save">
          {t("save")}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{t("contactUrlHint")}</p>
    </form>
  );
}

export default function Admin() {
  const { t, lang } = useI18n();
  const { admin, loading: adminLoading } = useAdminStatus();
  const qc = useQueryClient();
  const { data: catalog } = useCatalog();
  const { data: settings } = useSettings();
  const { data } = useQuery({ queryKey: ["admin-overview"], queryFn: () => apiGet<AdminOverview>("/admin/overview"), enabled: admin });
  const [branchEdit, setBranchEdit] = useState<{ open: boolean; b?: Branch }>({ open: false });
  const [importRes, setImportRes] = useState<ImportResult | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-overview"] });
    qc.invalidateQueries({ queryKey: ["catalog"] });
  };
  const onErr = (e: unknown) => toast.error(t(errorKey(e)));
  const clearOne = useMutation({ mutationFn: (rid: string) => apiDelete<OkOut>(`/admin/reports/${rid}`), onSuccess: refresh, onError: onErr });
  const clearAll = useMutation({ mutationFn: () => apiDelete<OkOut>("/admin/reports"), onSuccess: refresh, onError: onErr });
  const delRes = useMutation({
    mutationFn: (rid: string) => apiDelete<OkOut>(`/admin/resources/${rid}`),
    onSuccess: () => { toast.success(t("deleted")); refresh(); },
    onError: onErr,
  });
  const checkLinks = useMutation({
    mutationFn: () => apiPost<OkOut>("/admin/check-links"),
    onSuccess: () => toast.success(t("linkCheckStarted")),
    onError: onErr,
  });
  const delBranch = useMutation({
    mutationFn: (bid: string) => apiDelete<OkOut>(`/admin/branches/${bid}`),
    onSuccess: () => { toast.success(t("deleted")); refresh(); },
    onError: onErr,
  });
  const importCsv = useMutation({
    mutationFn: (csv: string) => apiPost<ImportResult>("/admin/import-courses", { csv } satisfies ImportIn),
    onSuccess: (r) => { setImportRes(r); toast.success(t("importDone", { c: r.created, s: r.skipped })); refresh(); },
    onError: onErr,
  });

  if (adminLoading) return <div className="mx-auto max-w-3xl px-4 py-20" aria-busy="true" />;
  if (!admin)
    return (
      <div className="mx-auto max-w-3xl px-4 py-20">
        <EmptyState text={t("adminOnly")} testid="admin-only-notice" />
      </div>
    );

  const saveBranch = async (v: FieldValues) => {
    const body: BranchIn = {
      code_ar: String(v.code_ar), code_en: String(v.code_en), name_ar: String(v.name_ar), name_en: String(v.name_en),
      order: Number(v.order) || 0,
    };
    if (branchEdit.b) await apiPatch<Branch>(`/admin/branches/${branchEdit.b.id}`, body);
    else await apiPost<Branch>("/admin/branches", body);
    refresh();
  };
  const courseCounts = new Map<string, number>();
  for (const c of catalog?.courses ?? []) courseCounts.set(c.branch_id, (courseCounts.get(c.branch_id) ?? 0) + 1);
  const st = data?.storage;
  const pct = st ? Math.min(100, (st.used_bytes / Math.max(st.quota_bytes, 1)) * 100) : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="flex items-center gap-2 text-3xl font-bold" data-testid="admin-title">
        <ShieldCheck className="size-7 text-sage" />
        {t("dashboard")}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("adminWelcome")}</p>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("statBranches")} value={data?.counts.branches ?? "–"} testid="admin-stat-branches" />
        <Stat label={t("statCourses")} value={data?.counts.courses ?? "–"} testid="admin-stat-courses" />
        <Stat label={t("statResources")} value={data?.counts.resources ?? "–"} testid="admin-stat-resources" />
        <Stat label={t("statSessions")} value={data?.counts.sessions ?? "–"} testid="admin-stat-sessions" />
        <div className="col-span-2 rounded-2xl border border-border bg-card p-4 md:col-span-1" data-testid="admin-storage">
          <div className="text-xs text-muted-foreground">{t("storage")}</div>
          <div className="mt-1 text-sm font-semibold">
            {st ? t("storageOf", { used: formatBytes(st.used_bytes), quota: formatBytes(st.quota_bytes) }) : "–"}
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div className={cn("h-full rounded-full", pct > 90 ? "bg-red-400" : "bg-primary")} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      <Tabs defaultValue="reports" className="mt-8">
        <TabsList className="flex-wrap">
          <TabsTrigger value="reports" data-testid="admin-tab-reports">{t("reportsTab")} ({data?.reports.length ?? 0})</TabsTrigger>
          <TabsTrigger value="broken" data-testid="admin-tab-broken">{t("brokenTab")} ({data?.broken.length ?? 0})</TabsTrigger>
          <TabsTrigger value="branches" data-testid="admin-tab-branches">{t("branchesTab")}</TabsTrigger>
          <TabsTrigger value="data" data-testid="admin-tab-data">{t("dataTab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="reports" className="mt-4">
          {data && data.reports.length > 0 && (
            <div className="mb-3 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => window.confirm(t("confirmDelete")) && clearAll.mutate()} data-testid="admin-clear-all-reports">
                {t("clearAll")}
              </Button>
            </div>
          )}
          {!data || data.reports.length === 0 ? (
            <EmptyState text={t("noReports")} testid="admin-no-reports" />
          ) : (
            <ul className="space-y-2">
              {data.reports.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3" data-testid={`admin-report-${r.id}`}>
                  <span className="rounded-full bg-amber-300/10 px-2 py-0.5 text-xs text-amber-200">{t(`r_${r.reason}` as TKey)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.target_title}</span>
                    <span className="text-xs text-muted-foreground">
                      {r.course_code} · {formatDate(r.created_at, lang)} {r.note && `· ${r.note}`}
                    </span>
                  </span>
                  {r.course_id && (
                    <Link to={`/course/${r.course_id}`} className={buttonVariants({ variant: "ghost", size: "sm" })} data-testid="admin-report-goto">
                      {t("goToItem")}
                    </Link>
                  )}
                  <Button variant="outline" size="sm" onClick={() => clearOne.mutate(r.id)} data-testid="admin-report-clear">
                    <X className="size-3.5" />
                    {t("clearReport")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="broken" className="mt-4">
          <div className="mb-3 flex justify-end">
            <Button variant="outline" size="sm" onClick={() => checkLinks.mutate()} disabled={checkLinks.isPending} data-testid="admin-check-links">
              <RefreshCw className="size-3.5" />
              {t("checkLinksNow")}
            </Button>
          </div>
          {!data || data.broken.length === 0 ? (
            <EmptyState text={t("noBroken")} testid="admin-no-broken" />
          ) : (
            <ul className="space-y-2">
              {data.broken.map(({ resource: r, course }) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3" data-testid={`admin-broken-${r.id}`}>
                  <Link2Off className="size-4 text-red-300" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.title}</span>
                    <span className="block truncate text-xs text-muted-foreground" dir="ltr">{courseCode(course, lang)} · {r.url}</span>
                  </span>
                  <Link to={`/course/${course.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })} data-testid="admin-broken-goto">
                    {t("goToItem")}
                  </Link>
                  <Button variant="outline" size="sm" className="text-red-300" onClick={() => window.confirm(t("confirmDelete")) && delRes.mutate(r.id)} data-testid="admin-broken-delete">
                    <Trash2 className="size-3.5" />
                    {t("delete")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="branches" className="mt-4">
          <div className="mb-3 flex justify-end">
            <Button size="sm" onClick={() => setBranchEdit({ open: true })} data-testid="admin-add-branch">
              <Plus className="size-3.5" />
              {t("addBranch")}
            </Button>
          </div>
          <ul className="grid gap-2 md:grid-cols-2">
            {(catalog?.branches ?? []).map((b) => (
              <li key={b.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3" data-testid={`admin-branch-${b.code_en.toLowerCase()}`}>
                <span className="w-24 shrink-0 font-bold text-sage">{b.code_ar} <span className="text-xs text-muted-foreground" dir="ltr">{b.code_en}</span></span>
                <span className="min-w-0 flex-1 truncate text-sm">{lang === "ar" ? b.name_ar : b.name_en}</span>
                <span className="text-xs text-muted-foreground">{t("coursesCount", { n: courseCounts.get(b.id) ?? 0 })}</span>
                <Button variant="ghost" size="icon-sm" onClick={() => setBranchEdit({ open: true, b })} aria-label={t("edit")} data-testid="admin-branch-edit">
                  <Pencil className="size-3.5" />
                </Button>
                <Button variant="ghost" size="icon-sm" className="text-red-300" onClick={() => window.confirm(t("confirmDelete")) && delBranch.mutate(b.id)} aria-label={t("delete")} data-testid="admin-branch-delete">
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="data" className="mt-4 grid gap-4 md:grid-cols-2">
          {settings && <SettingsCard key={settings.contact_url} initial={settings.contact_url} />}
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="font-semibold">{t("importCsv")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t("importHint")}</p>
            <label className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4 cursor-pointer")} data-testid="admin-import-label">
              <Upload className="size-3.5" />
              {t("chooseCsv")}
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) importCsv.mutate(await f.text());
                  e.target.value = "";
                }}
                data-testid="admin-import-input"
              />
            </label>
            {importRes && (
              <div className="mt-3 text-xs text-muted-foreground" data-testid="admin-import-result">
                {t("importDone", { c: importRes.created, s: importRes.skipped })}
                {importRes.errors.length > 0 && (
                  <ul className="mt-1 list-disc ps-4 text-red-300" dir="ltr">
                    {importRes.errors.slice(0, 10).map((er) => <li key={er}>{er}</li>)}
                  </ul>
                )}
              </div>
            )}
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <h3 className="font-semibold">{t("exportJson")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t("exportHint")}</p>
            <a href="/api/admin/export" download className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4")} data-testid="admin-export-link">
              <Download className="size-3.5" />
              {t("exportJson")}
            </a>
          </div>
        </TabsContent>
      </Tabs>

      <EditDialog
        key={branchEdit.b?.id ?? "new"}
        open={branchEdit.open}
        onOpenChange={(o) => setBranchEdit((s) => ({ ...s, open: o }))}
        title={branchEdit.b ? t("editBranch") : t("addBranch")}
        testid="edit-branch"
        initial={{
          code_ar: branchEdit.b?.code_ar ?? "", code_en: branchEdit.b?.code_en ?? "",
          name_ar: branchEdit.b?.name_ar ?? "", name_en: branchEdit.b?.name_en ?? "",
          order: String(branchEdit.b?.order ?? 0),
        }}
        fields={[
          { name: "code_ar", label: t("codeAr") },
          { name: "code_en", label: t("codeEn"), ltr: true },
          { name: "name_ar", label: t("branchNameAr") },
          { name: "name_en", label: t("branchNameEn"), ltr: true },
          { name: "order", label: t("order"), kind: "number", ltr: true },
        ]}
        onSave={saveBranch}
      />
    </div>
  );
}
