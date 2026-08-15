import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { checkout, listStudentOrders } from "@/lib/orders/order-service";
import { checkoutSchema } from "@/validations/order";

/** The caller's own orders, newest first (PRD §26). */
export const GET = apiHandler(async (): Promise<NextResponse> => {
  const actor = await requireActor();
  const orders = await listStudentOrders(actor);

  return jsonOk({ orders });
});

/**
 * Places the cart as one invoice.
 *
 * The body carries only a destination, a note and a phone number: every amount
 * on the resulting invoice is computed server-side (Rule 1).
 */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const input = checkoutSchema.parse(await request.json());

  const order = await checkout(actor, input);

  return jsonOk({ order }, { status: 201 });
});
