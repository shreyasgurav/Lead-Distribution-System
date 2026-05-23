import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assignLeadToProviders } from "@/lib/allocation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LeadBody {
  name?: string;
  phone?: string;
  city?: string;
  serviceId?: number | string;
  description?: string;
}

export async function POST(req: NextRequest) {
  let body: LeadBody;
  try {
    body = (await req.json()) as LeadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.toString().trim();
  const phone = body.phone?.toString().trim();
  const city = body.city?.toString().trim();
  const description = body.description?.toString().trim();
  const serviceId = Number(body.serviceId);

  if (!name || !phone || !city || !description || !Number.isFinite(serviceId)) {
    return NextResponse.json(
      { error: "All fields are required: name, phone, city, serviceId, description" },
      { status: 400 }
    );
  }

  if (![1, 2, 3].includes(serviceId)) {
    return NextResponse.json(
      { error: "serviceId must be 1, 2, or 3" },
      { status: 400 }
    );
  }

  try {
    const lead = await prisma.lead.create({
      data: { name, phone, city, serviceId, description },
    });

    const result = await assignLeadToProviders(lead.id, serviceId);

    return NextResponse.json(
      {
        success: true,
        leadId: lead.id,
        assignedProviderIds: result.assignedProviderIds,
        skippedMandatory: result.skippedMandatory,
      },
      { status: 201 }
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "You have already submitted a request for this service." },
        { status: 409 }
      );
    }
    console.error("[POST /api/leads] failed:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
