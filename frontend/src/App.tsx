import { Link, Route, Routes } from "react-router-dom";
import Layout from "@/components/Layout";
import { EmptyState } from "@/components/Cards";
import { I18nProvider, useI18n } from "@/lib/i18n";
import Admin from "@/pages/Admin";
import AllCourses from "@/pages/AllCourses";
import BranchPage from "@/pages/BranchPage";
import CoursePage from "@/pages/CoursePage";
import Home from "@/pages/Home";

function NotFound() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-3xl px-4 py-20">
      <EmptyState text={t("notFound")} testid="not-found" action={<Link to="/" className="text-sage">{t("backHome")}</Link>} />
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/courses" element={<AllCourses />} />
          <Route path="/branch/:id" element={<BranchPage />} />
          <Route path="/course/:id" element={<CoursePage />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </I18nProvider>
  );
}
