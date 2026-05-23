import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assignLeadToProviders } from "@/lib/allocation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CITIES = ["Mumbai", "Delhi", "Bengaluru", "Pune", "Hyderabad", "Chennai", "Kolkata", "Jaipur"];
const FIRST = ["Aarav", "Vihaan", "Ishaan", "Diya", "Ananya", "Riya", "Kabir", "Aanya", "Arjun", "Meera"];
const LAST = ["Sharma", "Verma", "Patel", "Gupta", "Reddy", "Iyer", "Khan", "Singh", "Das", "Joshi"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface GenerateBody {
  count?: number;
}

/**
 * Generate N leads in parallel and assign them. Default 10.
 *
 * This route is the primary concurrency-stress test: it submits all leads
 * simultaneously via Promise.all, which forces the allocation transactions
 * to contend on the same per-service advisory locks.
 */
export async function POST(req: NextRequest) {
  let body: GenerateBody = {};
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    // empty body is OK
  }
  const count = Math.min(Math.max(Number(body.count ?? 10), 1), 50);

  const stamp = Date.now();
  const tasks = Array.from({ length: count }, (_, i) => {
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const phone = `9${stamp}${String(i).padStart(2, "0")}`.slice(0, 12);
    const city = pick(CITIES);
    const serviceId = ((i % 3) + 1) as 1 | 2 | 3;
    const description = `Auto-generated lead #${i + 1}`;

    return (async () => {
      try {
        const lead = await prisma.lead.create({
          data: { name, phone, city, serviceId, description },
        });
        const result = await assignLeadToProviders(lead.id, serviceId);
        return {
          leadId: lead.id,
          serviceId,
          assigned: result.assignedProviderIds,
          skippedMandatory: result.skippedMandatory,
        };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          return { error: "duplicate", phone, serviceId };
        }
        const message = e instanceof Error ? e.message : "unknown";
        return { error: message };
      }
    })();
  });

  const results = await Promise.all(tasks);

  const successes = results.filter((r) => !("error" in r));
  return NextResponse.json({
    requested: count,
    created: successes.length,
    failed: results.length - successes.length,
    results,
  });
}
