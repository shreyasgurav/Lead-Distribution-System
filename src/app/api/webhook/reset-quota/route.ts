import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { emitRefresh } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ResetBody {
  idempotencyKey?: string;
  type?: string;
}

/**
 * Quota-reset webhook.
 *
 * Idempotency guarantee:
 *   The client must send a unique `idempotencyKey` (UUID). We INSERT it into
 *   WebhookEvent inside the same transaction that performs the resets.
 *   The table's primary key on `id` means a duplicate key triggers Prisma's
 *   P2002 — we catch that, treat the call as a replay, and return 200 with
 *   `alreadyProcessed: true` WITHOUT mutating any data.
 *
 * Net effect: replaying the same webhook N times has the same observable
 * outcome as calling it once.
 */
export async function POST(req: NextRequest) {
  let body: ResetBody;
  try {
    body = (await req.json()) as ResetBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const idempotencyKey = body.idempotencyKey?.toString().trim();
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: "idempotencyKey is required" },
      { status: 400 }
    );
  }

  try {
    const summary = await prisma.$transaction(async (tx) => {
      // Insert idempotency record first — if this throws P2002 the rest of
      // the transaction is rolled back, so we cannot double-reset.
      await tx.webhookEvent.create({
        data: { id: idempotencyKey, type: body.type ?? "reset-quota" },
      });

      const providers = await tx.provider.updateMany({
        data: { leadsReceived: 0, monthlyQuota: 10 },
      });

      const states = await tx.allocationState.updateMany({
        data: { pointer: 0 },
      });

      return {
        providersReset: providers.count,
        allocationStatesReset: states.count,
      };
    });

    // Notify dashboards.
    emitRefresh({ type: "quota-reset", ...summary });

    return NextResponse.json({
      success: true,
      alreadyProcessed: false,
      ...summary,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({
        success: true,
        alreadyProcessed: true,
        message: "Webhook event already processed; no changes applied.",
      });
    }
    console.error("[POST /api/webhook/reset-quota] failed:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
