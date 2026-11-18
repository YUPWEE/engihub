from lib.db import db
from models.schemas import Branch, new_id

BRANCHES = [
    ("سلم", "SALM", "مقررات عامة", "General Courses"),
    ("هعم", "GE", "هندسة عامة", "General Engineering"),
    ("كهر", "EE", "الهندسة الكهربائية", "Electrical Engineering"),
    ("ريض", "MATH", "الرياضيات", "Mathematics"),
    ("همد", "CE", "الهندسة المدنية", "Civil Engineering"),
    ("عمر", "ARCH", "العمارة وعلوم البناء", "Architecture & Building Sciences"),
    ("صنع", "IE", "الهندسة الصناعية", "Industrial Engineering"),
    ("فيز", "PHYS", "الفيزياء", "Physics"),
    ("همك", "ME", "الهندسة الميكانيكية", "Mechanical Engineering"),
    ("هكم", "ChE", "الهندسة الكيميائية", "Chemical Engineering"),
]

COURSES = [
    ("ريض", "106", "حساب التكامل", "Integral Calculus"),
    ("ريض", "203", "حساب التفاضل والتكامل المتقدم", "Advanced Calculus"),
    ("ريض", "204", "المعادلات التفاضلية", "Differential Equations"),
    ("هعم", "202", "ديناميكا", "Dynamics"),
    ("هعم", "211", "برمجة الحاسوب بلغة ++C", "Computer Programming in C++"),
    ("همك", "254", "علم المواد", "Materials Science"),
]


async def seed_if_empty() -> None:
    if await db.branches.count_documents({}) > 0:
        return
    by_code: dict[str, str] = {}
    for i, (code_ar, code_en, name_ar, name_en) in enumerate(BRANCHES):
        b = Branch(code_ar=code_ar, code_en=code_en, name_ar=name_ar, name_en=name_en, order=i)
        await db.branches.insert_one(b.model_dump())
        by_code[code_ar] = b.id
    for code_ar, number, name_ar, name_en in COURSES:
        await db.courses.insert_one(
            {"id": new_id(), "branch_id": by_code[code_ar], "number": number, "name_ar": name_ar, "name_en": name_en}
        )
