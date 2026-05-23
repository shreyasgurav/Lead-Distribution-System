import { PrismaClient } from "@prisma/client";

// Singleton Prisma client. Re-using the connection across hot reloads in dev
// and across serverless invocations in production avoids exhausting the
// Postgres connection pool.
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
