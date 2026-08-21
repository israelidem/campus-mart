import { redirect } from "next/navigation";

import { CampusSettingsForm } from "@/components/admin/campus-settings-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActor } from "@/lib/auth/session";
import { getCampus } from "@/lib/campus/campus-service";

/** Campus Admin configuration for their own campus (PRD §8, §18, §29, §35, §47). */
export default async function AdminSettingsPage() {
  const actor = await getActor();
  if (!actor) redirect("/sign-in");
  if (actor.role !== "CAMPUS_ADMIN") redirect("/after-sign-in");

  if (!actor.campusId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No campus attached</CardTitle>
          <CardDescription>
            Your admin account is not linked to a campus. Ask the platform owner to assign you.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const campus = await getCampus(actor, actor.campusId);

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">Campus settings</h1>
        <p className="text-sm opacity-70">
          {campus.name} ({campus.code}) · {campus.status}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Pricing and commission changes apply to future orders. Delivery fees are recorded on
            each delivery when it is created, so past deliveries are unaffected.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <CampusSettingsForm
            initial={{
              allowStudentVendors: campus.settings.allowStudentVendors,
              requireRegistryMatch: campus.settings.requireRegistryMatch,
              deliveryBaseFeeKobo: campus.settings.deliveryBaseFeeKobo,
              deliveryPerKmKobo: campus.settings.deliveryPerKmKobo,
              deliveryMinimumFeeKobo: campus.settings.deliveryMinimumFeeKobo,
              deliveryMaximumFeeKobo: campus.settings.deliveryMaximumFeeKobo,
              commissionBps: campus.settings.commissionBps,
              pickupWindowMinutes: campus.settings.pickupWindowMinutes,
              studentWaitMinutes: campus.settings.studentWaitMinutes,
              goodsPaymentWindowMinutes: campus.settings.goodsPaymentWindowMinutes,
              announcement: campus.settings.announcement,
            }}
          />
        </CardContent>
      </Card>
    </section>
  );
}
