import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const providers = await prisma.provider.findMany({
    orderBy: { id: "asc" },
    include: {
      assignments: {
        orderBy: { assignedAt: "desc" },
        take: 50,
        include: {
          lead: { include: { service: true } },
        },
      },
    },
  });

  const payload = providers.map((p) => ({
    id: p.id,
    name: p.name,
    monthlyQuota: p.monthlyQuota,
    leadsReceived: p.leadsReceived,
    remainingQuota: Math.max(0, p.monthlyQuota - p.leadsReceived),
    assignments: p.assignments.map((a) => ({
      leadId: a.leadId,
      serviceName: a.lead.service.name,
      customerName: a.lead.name,
      city: a.lead.city,
      assignedAt: a.assignedAt.toISOString(),
    })),
  }));

  return NextResponse.json({ providers: payload });
}
