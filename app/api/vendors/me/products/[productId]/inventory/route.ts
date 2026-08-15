import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { adjustInventory, listInventoryHistory } from "@/lib/products/product-service";
import { inventoryAdjustmentSchema } from "@/validations/product";

type Context = { params: Promise<{ productId: string }> };

/** Stock movement history for one of the vendor's products (PRD §22). */
export const GET = apiHandler(
  async (_request: Request, context: Context): Promise<NextResponse> => {
    const actor = await requireActor();
    const { productId } = await context.params;

    return jsonOk({ movements: await listInventoryHistory(actor, productId) });
  },
);

/**
 * Adds or removes stock. The service applies the change with a guarded
 * conditional update, so stock can never go negative (PRD §22).
 */
export const POST = apiHandler(
  async (request: Request, context: Context): Promise<NextResponse> => {
    const actor = await requireActor();
    const { productId } = await context.params;
    const input = inventoryAdjustmentSchema.parse(await request.json());

    return jsonOk({ inventory: await adjustInventory(actor, productId, input) });
  },
);
