import { AppShell } from "@/components/shell/app-shell";

/**
 * Every signed-in area of the app renders inside one shell.
 *
 * The route group exists so that the auth screens and the offline page stay
 * outside it: a sign-in form should not offer navigation into an app you are not
 * in yet, and the offline page is precached before anyone has an account, so it
 * must not depend on a session lookup to render.
 */
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
