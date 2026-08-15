import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { updateVendorOrderStatus } from "@/lib/orders/order-service";
import { vendorOrderStatusUpdateSchema } from "@/validations/order";

/**
 * Moves the vendor's own slice along its fulfilment states.
 *
 * The allowed transitions live in the service as a state machine; hand-over to
 * an agent and completion belong to the delivery engine (Phase 6), so they are
 * not reachable from here.
 */
export const PATCH = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ vendorOrderId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { vendorOrderId } = await context.params;
    const input = vendorOrderStatusUpdateSchema.parse(await request.json());

    const vendorOrder = await updateVendorOrderStatus(actor, vendorOrderId, input);

    return jsonOk({ vendorOrder });
  },
);
