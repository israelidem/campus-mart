import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { getOrderForStudent } from "@/lib/orders/order-service";

/** One of the caller's own invoices. Another student's id reads as not found. */
export const GET = apiHandler(
  async (
    _request: Request,
    context: { params: Promise<{ orderId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { orderId } = await context.params;

    const order = await getOrderForStudent(actor, orderId);

    return jsonOk({ order });
  },
);
