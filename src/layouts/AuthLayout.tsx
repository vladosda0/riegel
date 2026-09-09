import { Outlet } from "react-router-dom";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { SITE_NAME, useDocumentHead } from "@/lib/blog/seo";

export default function AuthLayout() {
  const { t } = useTranslation();

  // Every /auth/* route is noindex. A login form has no business in search results
  // on its own, and it is also where BlogAdminGuard sends guests away from
  // /blog/admin — including case variants like /blog/ADMIN that robots.txt cannot
  // express. The admin pages set their own noindex, but a guest never keeps it:
  // the guard redirects, they unmount, and useDocumentHead's cleanup removes the
  // tag. Since a crawler is always a guest, this layout is where the tag has to
  // live to be seen by one.
  //
  // This layout is the first PERSISTENT caller of the hook; the others are leaf
  // pages. So do not add useDocumentHead to an /auth/* child page: on the first
  // child route change its effect clears this tag (seo.ts, the robots else-branch),
  // and this effect never re-runs to restore it. No test catches that today.
  useDocumentHead({ title: SITE_NAME, robots: "noindex, nofollow" });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-sp-2">
      <div className="w-full max-w-md">
        <div className="mb-sp-4 flex justify-center">
          <Link to="/" aria-label={t("nav.appName")}>
            <img src="/logo.svg" alt={t("nav.appName")} className="h-12 w-auto" />
          </Link>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
