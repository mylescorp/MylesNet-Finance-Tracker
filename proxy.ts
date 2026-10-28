import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

const isSignInPage = createRouteMatcher(["/signin"]);
const isPublicPwaRoute = createRouteMatcher([
  "/manifest.webmanifest",
  "/sw.js",
  "/offline",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
]);
const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)", "/analytics(.*)", "/sales(.*)", "/expenses(.*)",
  "/movements(.*)", "/savings(.*)", "/loans(.*)", "/daily-report(.*)",
  "/monthly-pnl(.*)", "/partners(.*)", "/bills(.*)", "/reconcile(.*)",
  "/settings(.*)", "/issues(.*)", "/changelog(.*)",
]);

export default convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  if (isPublicPwaRoute(request)) return;
  if (isSignInPage(request) && (await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/dashboard");
  }
  if (isProtectedRoute(request) && !(await convexAuth.isAuthenticated())) {
    return nextjsMiddlewareRedirect(request, "/signin");
  }
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
