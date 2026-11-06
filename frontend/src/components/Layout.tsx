import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Languages, LayoutDashboard, LogOut, QrCode, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { AddResourceDialog } from "@/components/AddResourceDialog";
import { AdminLoginDialog } from "@/components/AdminLoginDialog";
import { QrDialog } from "@/components/QrDialog";
import { apiPost } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAdmin, useSettings } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span dir="ltr" className={cn("font-bold tracking-tight", className)}>
      Engi<span className="text-sage">Hub</span>
    </span>
  );
}

function NavItems({ className, variant }: { className?: string; variant: "desktop" | "mobile" }) {
  const { t } = useI18n();
  const item = ({ isActive }: { isActive: boolean }) =>
    cn(
      "rounded-full px-3.5 py-1.5 text-sm transition-colors duration-200",
      isActive ? "bg-primary/12 text-sage" : "text-muted-foreground hover:text-foreground hover:bg-accent",
    );
  return (
    <nav className={cn("items-center gap-1", className)}>
      <NavLink to="/" end className={item} data-testid={`nav-home-link-${variant}`}>
        {t("home")}
      </NavLink>
      <NavLink to="/courses" className={item} data-testid={`nav-all-courses-link-${variant}`}>
        {t("allCourses")}
      </NavLink>
    </nav>
  );
}

function ContactButton() {
  const { t } = useI18n();
  const { data } = useSettings();
  if (!data?.contact_url) return null;
  return (
    <a
      href={data.contact_url}
      target="_blank"
      rel="noopener noreferrer"
      title={t("contactHint")}
      aria-label={`${t("contactUs")} — ${t("contactHint")}`}
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-primary/35 px-2.5 text-sm text-sage transition-[background-color,border-color] duration-150 hover:border-primary/60 hover:bg-primary/10 md:px-3"
      data-testid="header-contact-button"
    >
      <Send className="size-4 rtl:-scale-x-100" />
      <span className="hidden md:inline">{t("contactUs")}</span>
    </a>
  );
}

function Tagline({ onShare }: { onShare: () => void }) {
  const { t } = useI18n();
  return (
    <p className="mx-auto max-w-6xl px-4 pb-2 text-center text-xs leading-relaxed text-balance text-muted-foreground" data-testid="header-tagline">
      {t("taglineBefore")}
      <button
        type="button"
        onClick={onShare}
        className="text-sage/90 underline decoration-primary/40 underline-offset-4 transition-colors duration-150 hover:text-sage hover:decoration-primary"
        data-testid="header-tagline-share-link"
      >
        {t("taglineLink")}
      </button>
      {t("taglineAfter")}
    </p>
  );
}

function Header({ onShare }: { onShare: () => void }) {
  const { t, lang, setLang } = useI18n();
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto grid max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-2.5">
        <Link to="/" className="flex items-center gap-2.5 justify-self-start" data-testid="header-ksu-link">
          <img
            src="/ksu-logo.png"
            alt={t("ksu")}
            className="h-10 w-auto rounded-md md:h-11"
            data-testid="header-ksu-logo"
          />
          <span className="hidden leading-tight sm:block">
            <span className="block text-sm font-semibold" data-testid="header-ksu-name">
              {t("ksu")}
            </span>
            <span className="block text-xs text-muted-foreground">{t("college")}</span>
          </span>
        </Link>
        <Link to="/" aria-label="EngiHub" data-testid="header-wordmark">
          <Wordmark className="text-2xl md:text-[1.9rem]" />
        </Link>
        <div className="flex items-center gap-2 justify-self-end">
          <NavItems className="hidden md:flex" variant="desktop" />
          <Button
            variant="outline"
            size="sm"
            className="rounded-full border-primary/25 bg-primary/5 text-sage hover:bg-primary/10"
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            data-testid="lang-toggle-button"
          >
            <Languages className="size-4" />
            {t("langToggle")}
          </Button>
          <ContactButton />
        </div>
      </div>
      <Tagline onShare={onShare} />
      <div className="flex justify-center pb-2 md:hidden">
        <NavItems className="flex" variant="mobile" />
      </div>
    </header>
  );
}

function AdminBanner() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const exit = async () => {
    await apiPost("/admin/logout").catch(() => null);
    await qc.invalidateQueries({ queryKey: ["admin-me"] });
    toast.success(t("exitAdmin"));
    navigate("/");
  };
  return (
    <div
      className="border-b border-amber-200/15 bg-amber-200/[0.06] text-amber-100/90"
      data-testid="admin-banner"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2 text-sm">
        <ShieldCheck className="size-4" />
        <span className="font-medium">{t("adminOn")}</span>
        <div className="ms-auto flex gap-2">
          <Link
            to="/admin"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 hover:bg-amber-100/10"
            data-testid="admin-dashboard-link"
          >
            <LayoutDashboard className="size-4" />
            {t("dashboard")}
          </Link>
          <button
            type="button"
            onClick={exit}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-100/20 px-3 py-1 hover:bg-amber-100/10"
            data-testid="admin-exit-button"
          >
            <LogOut className="size-4" />
            {t("exitAdmin")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Footer({ onKey, onQr }: { onKey: () => void; onQr: () => void }) {
  const { t } = useI18n();
  return (
    <footer className="mt-20 border-t border-border/70 bg-panel/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <Wordmark className="text-xl" />
            <span className="text-xs text-muted-foreground">{t("footerPlatform")}</span>
          </div>
          <p className="text-sm text-foreground/85" data-testid="footer-designed">
            {t("footerDesigned")}
          </p>
          <p className="text-xs text-muted-foreground" data-testid="footer-privacy">
            {t("footerPrivacy")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="rounded-full" onClick={onQr} data-testid="footer-qr-button">
            <QrCode className="size-4" />
            {t("qrCode")}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full text-muted-foreground/70 hover:text-foreground"
            onClick={onKey}
            aria-label={t("adminEntry")}
            title={t("adminEntry")}
            data-testid="footer-admin-key-button"
          >
            <KeyRound className="size-4" />
          </Button>
        </div>
      </div>
    </footer>
  );
}

export default function Layout() {
  const isAdmin = useAdmin();
  const [loginOpen, setLoginOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  return (
    <div className="flex min-h-svh flex-col">
      <Header onShare={() => setShareOpen(true)} />
      {isAdmin && <AdminBanner />}
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer onKey={() => setLoginOpen(true)} onQr={() => setQrOpen(true)} />
      <AdminLoginDialog open={loginOpen} onOpenChange={setLoginOpen} />
      <QrDialog open={qrOpen} onOpenChange={setQrOpen} />
      <AddResourceDialog open={shareOpen} onOpenChange={setShareOpen} />
      <Toaster richColors position="bottom-right" />
    </div>
  );
}
