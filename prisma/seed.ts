/**
 * Idempotent seed: re-running will NOT duplicate data.
 *
 * Inserts:
 *  - 3 services
 *  - 8 providers (monthlyQuota=10, leadsReceived=0)
 *  - 3 AllocationState rows (one per service) with the mandated round-robin pools
 *
 * Pools (round-robin candidates, mandatory providers are excluded from pool):
 *   Service 1 → mandatory [1], pool [2, 3, 4]
 *   Service 2 → mandatory [5], pool [6, 7, 8]
 *   Service 3 → mandatory [1, 4], pool [2, 3, 5, 6, 7, 8]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Services
  const services = [
    { id: 1, name: "Service 1" },
    { id: 2, name: "Service 2" },
    { id: 3, name: "Service 3" },
  ];
  for (const s of services) {
    await prisma.service.upsert({
      where: { id: s.id },
      update: { name: s.name },
      create: { id: s.id, name: s.name },
    });
  }

  // Providers
  for (let i = 1; i <= 8; i++) {
    await prisma.provider.upsert({
      where: { id: i },
      update: { name: `Provider ${i}` },
      create: {
        id: i,
        name: `Provider ${i}`,
        monthlyQuota: 10,
        leadsReceived: 0,
      },
    });
  }

  // AllocationState
  const pools: Record<number, number[]> = {
    1: [2, 3, 4],
    2: [6, 7, 8],
    3: [2, 3, 5, 6, 7, 8],
  };
  for (const [sid, pool] of Object.entries(pools)) {
    const serviceId = Number(sid);
    await prisma.allocationState.upsert({
      where: { serviceId },
      update: { pool },
      create: { serviceId, pool, pointer: 0 },
    });
  }

  // Keep Postgres sequences aligned with hard-coded IDs (so future
  // autoincrement inserts do not collide).
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"Service"', 'id'), (SELECT COALESCE(MAX(id), 1) FROM "Service"))`
  );
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"Provider"', 'id'), (SELECT COALESCE(MAX(id), 1) FROM "Provider"))`
  );

  console.log("Seed completed: 3 services, 8 providers, 3 allocation states.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
