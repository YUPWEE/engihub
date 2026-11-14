// Visual meta for resource types and sources — each category gets its own icon + tone.
import {
  BookOpen,
  CirclePlay,
  Cloud,
  FileCheck2,
  FileText,
  Link2,
  NotebookPen,
  Presentation,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import type { TKey } from "./i18n";
import type { ResourceType, Source } from "./types";

export const RESOURCE_TYPES: ResourceType[] = ["slides", "notes", "textbooks", "exams", "summaries", "videos", "other"];

export const TYPE_META: Record<ResourceType, { icon: LucideIcon; label: TKey; tone: string }> = {
  slides: { icon: Presentation, label: "t_slides", tone: "text-sky-300/90 bg-sky-400/10 ring-sky-300/15" },
  notes: { icon: NotebookPen, label: "t_notes", tone: "text-teal-300/90 bg-teal-400/10 ring-teal-300/15" },
  textbooks: { icon: BookOpen, label: "t_textbooks", tone: "text-indigo-300/90 bg-indigo-400/10 ring-indigo-300/15" },
  exams: { icon: FileCheck2, label: "t_exams", tone: "text-amber-200/90 bg-amber-300/10 ring-amber-200/15" },
  summaries: { icon: ScrollText, label: "t_summaries", tone: "text-emerald-300/90 bg-emerald-400/10 ring-emerald-300/15" },
  videos: { icon: CirclePlay, label: "t_videos", tone: "text-rose-300/90 bg-rose-400/10 ring-rose-300/15" },
  other: { icon: Link2, label: "t_other", tone: "text-slate-300 bg-slate-400/10 ring-slate-300/15" },
};

export const SOURCE_META: Record<Source, { icon: LucideIcon; label: TKey }> = {
  pdf: { icon: FileText, label: "srcPdf" },
  gdrive: { icon: Cloud, label: "srcGdrive" },
  onedrive: { icon: Cloud, label: "srcOnedrive" },
  youtube: { icon: CirclePlay, label: "srcYoutube" },
  other: { icon: Link2, label: "srcOther" },
};

export function detectSource(url: string): Source {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.endsWith("drive.google.com") || host.endsWith("docs.google.com")) return "gdrive";
    if (/(onedrive\.live\.com|1drv\.ms|sharepoint\.com|onedrive\.com)$/.test(host)) return "onedrive";
    if (/(youtube\.com|youtu\.be|youtube-nocookie\.com)$/.test(host)) return "youtube";
  } catch {
    /* invalid */
  }
  return "other";
}

export function isHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.includes(".") && !/\s/.test(url);
  } catch {
    return false;
  }
}

export function isPersonalContact(url: string): boolean {
  const low = url.trim().toLowerCase();
  if (/^(tel|mailto|whatsapp|sms):/.test(low)) return true;
  try {
    const u = new URL(low);
    if (u.hostname === "wa.me" || u.hostname === "www.wa.me") return true;
    return (u.hostname === "api.whatsapp.com" || u.hostname === "web.whatsapp.com") && u.pathname.startsWith("/send");
  } catch {
    return false;
  }
}
