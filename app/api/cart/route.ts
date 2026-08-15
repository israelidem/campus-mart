import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { addToCart, clearCart, getCart } from "@/lib/orders/cart-service";
import { cartItemAddSchema } from "@/validations/order";

/** The caller's cart on their own campus, priced from current products (PRD §25). */
export const GET = apiHandler(async (): Promise<NextResponse> => {
  const actor = await requireActor();
  const cart = await getCart(actor);

  return jsonOk({ cart });
});

/** Adds a product, or raises the quantity of the line that already holds it. */
export const POST = apiHandler(async (request: Request): Promise<NextResponse> => {
  const actor = await requireActor();
  const input = cartItemAddSchema.parse(await request.json());

  const cart = await addToCart(actor, input);

  return jsonOk({ cart });
});

/** Empties the cart. */
export const DELETE = apiHandler(async (): Promise<NextResponse> => {
  const actor = await requireActor();
  const cart = await clearCart(actor);

  return jsonOk({ cart });
});
