import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { emitRefresh } from "./sse";

/**
 * Mandatory providers per service.
 *   Service 1 → Provider 1 must always be assigned (if quota available)
 *   Service 2 → Provider 5 must always be assigned (if quota available)
 *   Service 3 → Provider 1 AND Provider 4 must always be assigned (if quota available)
 *
 * Pools (round-robin candidates, disjoint from mandatory):
 *   Service 1 → [2, 3, 4]
 *   Service 2 → [6, 7, 8]
 *   Service 3 → [2, 3, 5, 6, 7, 8]
 *
 * Pool is stored in DB (AllocationState.pool); mandatory mapping lives in
 * code (business rule, not data).
 */
export const MANDATORY_BY_SERVICE: Record<number, number[]> = {
  1: [1],
  2: [5],
  3: [1, 4],
};

export const TOTAL_SLOTS = 3;

export interface AssignmentResult {
  leadId: number;
  serviceId: number;
  assignedProviderIds: number[];
  skippedMandatory: number[];
  pointerBefore: number;
  pointerAfter: number;
}

/**
 * Deterministic, concurrency-safe lead → provider allocation.
 *
 * Algorithm
 * ---------
 * 1. Open a transaction.
 * 2. Acquire `pg_advisory_xact_lock(serviceId)` — guarantees that
 *    allocations for the SAME service are fully serialized. This is what
 *    keeps the round-robin pointer consistent under high concurrency.
 * 3. SELECT ... FOR UPDATE on every candidate Provider row (mandatory +
 *    pool). ORDER BY id ensures a stable lock order so two transactions
 *    that touch the same provider (e.g. Provider 1 is mandatory for both
 *    Service 1 and Service 3) cannot deadlock.
 * 4. Mandatory phase: include each mandatory provider iff
 *    leadsReceived < monthlyQuota. If full, record as skipped (no fail).
 * 5. Round-robin phase: starting from the persisted `pointer`, walk the
 *    pool (modulo length) skipping providers that are already assigned or
 *    out of quota, until 3 slots are filled or the pool is exhausted.
 * 6. Persist new pointer + LeadAssignment rows + increment leadsReceived
 *    inside the same transaction.
 * 7. After commit, fire an in-process SSE refresh.
 */
export async function assignLeadToProviders(
  leadId: number,
  serviceId: number
): Promise<AssignmentResult> {
  const mandatory = MANDATORY_BY_SERVICE[serviceId] ?? [];

  const result = await prisma.$transaction(
    async (tx) => {
      // (2) Serialize allocations for this service.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${serviceId})`;

      const state = await tx.allocationState.findUnique({
        where: { serviceId },
      });
      if (!state) {
        throw new Error(`AllocationState missing for service ${serviceId}`);
      }

      const pool: number[] = Array.isArray(state.pool)
        ? (state.pool as unknown as number[])
        : [];
      const pointerBefore = state.pointer;

      const candidateIds = Array.from(new Set([...mandatory, ...pool])).sort(
        (a, b) => a - b
      );

      if (candidateIds.length === 0) {
        return {
          leadId,
          serviceId,
          assignedProviderIds: [],
          skippedMandatory: [...mandatory],
          pointerBefore,
          pointerAfter: pointerBefore,
        };
      }

      // (3) Row-level locks on all candidates, stable order → no deadlock.
      const lockedRows = await tx.$queryRaw<
        { id: number; monthlyQuota: number; leadsReceived: number }[]
      >`SELECT id, "monthlyQuota", "leadsReceived"
        FROM "Provider"
        WHERE id = ANY(${candidateIds}::int[])
        ORDER BY id
        FOR UPDATE`;

      const quotaMap = new Map<number, { quota: number; received: number }>();
      for (const row of lockedRows) {
        quotaMap.set(row.id, {
          quota: row.monthlyQuota,
          received: row.leadsReceived,
        });
      }

      const assigned: number[] = [];
      const skippedMandatory: number[] = [];

      // (4) Mandatory phase.
      for (const pid of mandatory) {
        const q = quotaMap.get(pid);
        if (q && q.received < q.quota) {
          assigned.push(pid);
          q.received += 1; // local bookkeeping in case of dupes
        } else {
          skippedMandatory.push(pid);
        }
      }

      // (5) Round-robin phase.
      let pointerAfter = pointerBefore;
      if (pool.length > 0) {
        for (
          let visited = 0;
          visited < pool.length && assigned.length < TOTAL_SLOTS;
          visited++
        ) {
          const idx = (pointerBefore + visited) % pool.length;
          const pid = pool[idx];
          if (assigned.includes(pid)) continue;
          const q = quotaMap.get(pid);
          if (!q) continue;
          if (q.received >= q.quota) continue;
          assigned.push(pid);
          q.received += 1;
          pointerAfter = (idx + 1) % pool.length;
        }
      }

      // (6) Persist pointer + assignments + quota increments.
      if (pointerAfter !== pointerBefore) {
        await tx.allocationState.update({
          where: { serviceId },
          data: { pointer: pointerAfter },
        });
      }

      for (const pid of assigned) {
        await tx.leadAssignment.create({
          data: { leadId, providerId: pid },
        });
        await tx.provider.update({
          where: { id: pid },
          data: { leadsReceived: { increment: 1 } },
        });
      }

      return {
        leadId,
        serviceId,
        assignedProviderIds: assigned,
        skippedMandatory,
        pointerBefore,
        pointerAfter,
      };
    },
    {
      timeout: 15_000,
      maxWait: 15_000,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    }
  );

  // (7) In-process notification for dashboards connected to this instance.
  emitRefresh({
    leadId: result.leadId,
    serviceId: result.serviceId,
    assigned: result.assignedProviderIds,
  });

  return result;
}
