import type { NextRequest } from "next/server";
import { emitter, SSE_EVENT } from "@/lib/sse";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow long-running stream on Vercel (Hobby: up to 60s, then client auto-reconnects).
export const maxDuration = 60;

/**
 * Server-Sent Events stream for the dashboard.
 *
 * Cross-instance correctness: in serverless deployments different lead
 * submissions may land on different Node.js processes, so a pure in-memory
 * EventEmitter is not enough. We combine TWO signals:
 *   1. In-process emitter — instant push for same-instance writes.
 *   2. DB poll every 2s on max(LeadAssignment.assignedAt) — guarantees that
 *      cross-instance writes are surfaced within ~2 seconds.
 *
 * The client (`EventSource`) auto-reconnects when the function times out.
 */
export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  let lastSeenAssignedAt: number | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      // Initial hello so EventSource fires `onopen`.
      safeEnqueue(`event: ready\ndata: {"ok":true}\n\n`);

      // (1) In-process listener.
      const onRefresh = (payload: unknown) => {
        safeEnqueue(`event: refresh\ndata: ${JSON.stringify(payload)}\n\n`);
      };
      emitter.on(SSE_EVENT, onRefresh);

      // (2) DB poll fallback (cross-instance).
      const pollInterval = setInterval(async () => {
        try {
          const latest = await prisma.leadAssignment.findFirst({
            orderBy: { assignedAt: "desc" },
            select: { assignedAt: true },
          });
          const ts = latest?.assignedAt.getTime() ?? 0;
          if (lastSeenAssignedAt === null) {
            lastSeenAssignedAt = ts;
          } else if (ts > lastSeenAssignedAt) {
            lastSeenAssignedAt = ts;
            safeEnqueue(
              `event: refresh\ndata: ${JSON.stringify({ type: "db-poll", ts })}\n\n`
            );
          }
        } catch (err) {
          console.error("[dashboard-stream] poll error:", err);
        }
      }, 2000);

      // Keep-alive ping so proxies don't close the connection.
      const pingInterval = setInterval(() => {
        safeEnqueue(`: ping ${Date.now()}\n\n`);
      }, 15000);

      const cleanup = () => {
        closed = true;
        clearInterval(pollInterval);
        clearInterval(pingInterval);
        emitter.off(SSE_EVENT, onRefresh);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
