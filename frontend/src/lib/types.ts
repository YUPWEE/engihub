// Hand-written mirrors of backend/models/schemas.py — keep in sync in the same edit.

export type ResourceType = "slides" | "notes" | "textbooks" | "exams" | "summaries" | "videos" | "other";
export type Source = "pdf" | "gdrive" | "onedrive" | "youtube" | "other";
export type LinkStatus = "ok" | "broken" | "unknown";
export type ReportReason = "inappropriate" | "copyright" | "broken" | "other";
export type TargetType = "resource" | "session";

export interface OkOut {
  ok: boolean;
}

export interface SiteSettings {
  contact_url: string;
  ai_search?: boolean; // read-only: server has an AI key, so meaning-based search is offered
}

export interface BranchIn {
  code_ar: string;
  code_en: string;
  name_ar: string;
  name_en: string;
  order: number;
}

export interface Branch extends BranchIn {
  id: string;
}

export interface CourseIn {
  branch_id: string;
  number: string;
  name_ar: string;
  name_en: string;
  website: string;
}

export interface CourseUpdate {
  branch_id: string;
  number: string;
  name_ar: string;
  name_en: string;
}

export interface Course {
  id: string;
  branch_id: string;
  number: string;
  code_ar: string;
  code_en: string;
  name_ar: string;
  name_en: string;
  resource_count: number;
}

export interface Catalog {
  branches: Branch[];
  courses: Course[];
}

export interface Resource {
  id: string;
  course_id: string;
  title: string;
  type: ResourceType;
  has_solutions: boolean;
  description: string;
  section?: string; // optional sub-heading inside the type group (set by bulk import)
  kind: "pdf" | "link";
  url: string | null;
  source: Source;
  file_size: number;
  helpful: number;
  link_status: LinkStatus | null;
  reported_broken: boolean;
  flagged: boolean;
  created_at: string;
}

export interface ResourceUpdate {
  title: string;
  type: ResourceType;
  has_solutions: boolean;
  description: string;
  url: string | null;
  section?: string | null; // omitted/null = unchanged
}

export interface HelpfulOut {
  helpful: number;
}

export interface StudySessionIn {
  course_id: string;
  name: string;
  description: string;
  specialization: string;
  contact_url: string;
  website: string;
}

export interface StudySessionUpdate {
  name: string;
  description: string;
  specialization: string;
  contact_url: string;
}

export interface StudySession {
  id: string;
  course_id: string;
  name: string;
  description: string;
  specialization: string;
  contact_url: string | null;
  flagged: boolean;
  created_at: string;
}

export interface CourseDetail {
  course: Course;
  branch: Branch;
  resources: Resource[];
  sessions: StudySession[];
}

export interface ReportIn {
  target_type: TargetType;
  target_id: string;
  reason: ReportReason;
  note: string;
  website: string;
}

export interface Report {
  id: string;
  target_type: TargetType;
  target_id: string;
  reason: ReportReason;
  note: string;
  created_at: string;
}

export interface ReportOut extends Report {
  target_title: string;
  course_id: string | null;
  course_code: string;
}

export interface TopCourse {
  course: Course;
  count: number;
}

export interface ResourceWithCourse {
  resource: Resource;
  course: Course;
  count: number;
}

export interface SearchOut {
  ai: boolean;
  courses: Course[];
  resources: ResourceWithCourse[];
}

export interface AIStatus {
  enabled: boolean;
  indexed: number;
  total: number;
  text_model: string;
  embed_model: string;
  calls_used: number;
  calls_limit: number;
}

export interface HomeStats {
  top_courses: TopCourse[];
  top_courses_fallback: boolean;
  top_resources: ResourceWithCourse[];
}

export interface AdminLogin {
  password: string;
}

export interface AdminMe {
  admin: boolean;
}

export interface StorageInfo {
  used_bytes: number;
  quota_bytes: number;
}

export interface AdminCounts {
  branches: number;
  courses: number;
  resources: number;
  sessions: number;
}

export interface AdminOverview {
  reports: ReportOut[];
  broken: ResourceWithCourse[];
  storage: StorageInfo;
  counts: AdminCounts;
}

export interface ImportIn {
  csv: string;
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: string[];
}

export interface ImportResourcesResult {
  courses_created: number;
  resources_created: number;
  skipped: number;
  errors: string[];
}
