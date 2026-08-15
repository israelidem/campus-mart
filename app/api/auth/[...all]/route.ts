import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth";

/** Better Auth mounts all of its endpoints under /api/auth/*. */
export const { GET, POST } = toNextJsHandler(auth);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
