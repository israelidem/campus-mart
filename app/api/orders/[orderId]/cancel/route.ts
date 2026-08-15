import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { cancelOrder } from "@/lib/orders/order-service";
import { orderCancelSchema } from "@/validations/order";

/**
 * Cancels an invoice and returns its reserved stock.
 *
 * A named operation rather than a status write (Rule 4): the service re-reads
 * the order inside the transaction and refuses any cancellation once the
 * delivery fee has been paid — that case is a Phase 8 refund.
 */
export const POST = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ orderId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { orderId } = await context.params;
    const input = orderCancelSchema.parse(await request.json());

    const order = await cancelOrder(actor, orderId, input);

    return jsonOk({ order });
  },
);
