import { NextResponse } from "next/server";

import { apiHandler, jsonOk } from "@/lib/api/handler";
import { requireActor } from "@/lib/auth/session";
import { reportStudentUnavailable } from "@/lib/delivery/delivery-service";
import { deliveryUnavailableSchema } from "@/validations/delivery";

/**
 * Report that the student never came for the package (PRD §44).
 *
 * Only accepted once the waiting period the server started on arrival has run
 * out; the goods then go back to the vendor and the stock is restored.
 */
export const POST = apiHandler(
  async (
    request: Request,
    context: { params: Promise<{ deliveryId: string }> },
  ): Promise<NextResponse> => {
    const actor = await requireActor();
    const { deliveryId } = await context.params;
    const input = deliveryUnavailableSchema.parse(await request.json());

    const delivery = await reportStudentUnavailable(actor, deliveryId, input);

    return jsonOk({ delivery });
  },
);
