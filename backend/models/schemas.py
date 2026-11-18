import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field

ResourceType = Literal["slides", "notes", "textbooks", "exams", "summaries", "videos", "other"]
Source = Literal["pdf", "gdrive", "onedrive", "youtube", "other"]
LinkStatus = Literal["ok", "broken", "unknown"]
ReportReason = Literal["inappropriate", "copyright", "broken", "other"]
TargetType = Literal["resource", "session"]


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class OkOut(BaseModel):
    ok: bool = True


class SiteSettings(BaseModel):
    contact_url: str


class PublicSettings(SiteSettings):
    ai_search: bool = False


class BranchIn(BaseModel):
    code_ar: str = Field(min_length=1, max_length=12)
    code_en: str = Field(min_length=1, max_length=12)
    name_ar: str = Field(min_length=1, max_length=120)
    name_en: str = Field(min_length=1, max_length=120)
    order: int = 0


class Branch(BranchIn):
    id: str = Field(default_factory=new_id)


class CourseIn(BaseModel):
    branch_id: str
    number: str = Field(min_length=1, max_length=12)
    name_ar: str = Field(default="", max_length=160)
    name_en: str = Field(default="", max_length=160)
    website: str = ""


class CourseUpdate(BaseModel):
    branch_id: str
    number: str = Field(min_length=1, max_length=12)
    name_ar: str = Field(default="", max_length=160)
    name_en: str = Field(default="", max_length=160)


class Course(BaseModel):
    id: str
    branch_id: str
    number: str
    code_ar: str
    code_en: str
    name_ar: str
    name_en: str
    resource_count: int = 0


class Catalog(BaseModel):
    branches: list[Branch]
    courses: list[Course]


class Resource(BaseModel):
    id: str = Field(default_factory=new_id)
    course_id: str
    title: str
    type: ResourceType
    has_solutions: bool = False
    description: str = ""
    section: str = ""
    title_en: str = ""
    section_en: str = ""
    kind: Literal["pdf", "link"]
    url: Optional[str] = None
    source: Source
    file_size: int = 0
    helpful: int = 0
    link_status: Optional[LinkStatus] = None
    reported_broken: bool = False
    flagged: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class ResourceUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    type: ResourceType
    has_solutions: bool = False
    description: str = Field(default="", max_length=500)
    url: Optional[str] = None
    section: Optional[str] = Field(default=None, max_length=120)
    title_en: Optional[str] = Field(default=None, max_length=200)


class HelpfulOut(BaseModel):
    helpful: int


class StudySessionIn(BaseModel):
    course_id: str
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=500)
    specialization: str = Field(default="", max_length=120)
    contact_url: str = Field(default="", max_length=500)
    website: str = ""


class StudySessionUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=500)
    specialization: str = Field(default="", max_length=120)
    contact_url: str = Field(default="", max_length=500)


class StudySession(BaseModel):
    id: str = Field(default_factory=new_id)
    course_id: str
    name: str
    description: str
    specialization: str = ""
    contact_url: Optional[str] = None
    flagged: bool = False
    created_at: datetime = Field(default_factory=utcnow)


class CourseDetail(BaseModel):
    course: Course
    branch: Branch
    resources: list[Resource]
    sessions: list[StudySession]


class ReportIn(BaseModel):
    target_type: TargetType
    target_id: str
    reason: ReportReason
    note: str = Field(default="", max_length=500)
    website: str = ""


class Report(BaseModel):
    id: str = Field(default_factory=new_id)
    target_type: TargetType
    target_id: str
    reason: ReportReason
    note: str = ""
    created_at: datetime = Field(default_factory=utcnow)


class ReportOut(Report):
    target_title: str
    course_id: Optional[str] = None
    course_code: str = ""


class TopCourse(BaseModel):
    course: Course
    count: int


class ResourceWithCourse(BaseModel):
    resource: Resource
    course: Course
    count: int = 0


class SearchOut(BaseModel):
    ai: bool
    courses: list[Course] = []
    resources: list[ResourceWithCourse] = []


class HomeStats(BaseModel):
    top_courses: list[TopCourse]
    top_courses_fallback: bool
    top_resources: list[ResourceWithCourse]


class AdminLogin(BaseModel):
    password: str = Field(min_length=1, max_length=200)


class AdminMe(BaseModel):
    admin: bool


class StorageInfo(BaseModel):
    used_bytes: int
    quota_bytes: int


class AdminCounts(BaseModel):
    branches: int
    courses: int
    resources: int
    sessions: int


class AdminOverview(BaseModel):
    reports: list[ReportOut]
    broken: list[ResourceWithCourse]
    storage: StorageInfo
    counts: AdminCounts


class AIStatus(BaseModel):
    enabled: bool
    indexed: int
    total: int
    text_model: str
    embed_model: str
    calls_used: int
    calls_limit: int
    syncing: bool = False
    last_error: str = ""


class ImportIn(BaseModel):
    csv: str = Field(max_length=2_000_000)


class ImportResult(BaseModel):
    created: int
    skipped: int
    errors: list[str]


class ImportResourcesResult(BaseModel):
    courses_created: int
    resources_created: int
    skipped: int
    errors: list[str]
