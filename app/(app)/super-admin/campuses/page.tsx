import { redirect } from "next/navigation";

import { CampusManager, type CampusRow } from "@/components/super-admin/campus-manager";
import { getActor } from "@/lib/auth/session";
import { listCampuses } from "@/lib/campus/campus-service";

/** Super Admin campus list and creation (PRD §9, §11). */
export default async function SuperAdminCampusesPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (actor.role !== "SUPER_ADMIN") redirect("/after-sign-in");

  const campuses = await listCampuses(actor);

  const rows: CampusRow[] = campuses.map((campus) => ({
    id: campus.id,
    code: campus.code,
    name: campus.name,
    city: campus.city,
    state: campus.state,
    status: campus.status,
    counts: campus.counts,
  }));

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Campuses</h1>
        <p className="text-sm opacity-70">
          {rows.length === 1 ? "1 campus" : `${rows.length} campuses`} on the platform
        </p>
      </header>

      <CampusManager campuses={rows} />
    </section>
  );
}
