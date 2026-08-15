import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { removeCartItem, updateCartItem } from "@/lib/orders/cart-service";
import { cartItemUpdateSchema } from "@/validations/order";

/** Sets a line to an absolute quantity (never a delta, so retries are safe). */
export const PATCH = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ cartItemId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { cartItemId } = await context.params;
    const input = cartItemUpdateSchema.parse(await request.json());

    const cart = await updateCartItem(actor, cartItemId, input);

    return jsonOk({ cart });
  },
);

/** Removes a line from the cart. */
export const DELETE = apiHandler(
  async (
    _request: Request,
    context: { params: Promise<{ cartItemId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { cartItemId } = await context.params;

    const cart = await removeCartItem(actor, cartItemId);

    return jsonOk({ cart });
  },
);
