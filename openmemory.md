# OpenMemory — Prowider Mini Lead Distribution System

Living project index. Update as the codebase evolves.

## Overview
Full-stack Next.js 14 (App Router) + TypeScript + Prisma 5 + PostgreSQL
implementation of a simplified Prowider lead-distribution platform built
for the Book My Packers Full Stack Internship assessment. Customers
submit service enquiries; the backend deterministically assigns each
lead to up to 3 providers using mandatory rules + a round-robin pool,
enforces a 10-lead monthly quota per provider, exposes a real-time SSE
dashboard, and offers an idempotent quota-reset webhook.

## Architecture
- **Frontend:** Next.js App Router pages under `src/app/` (TSX + Tailwind).
- **Backend:** Next.js Route Handlers under `src/app/api/`.
- **DB layer:** Prisma 5 with PostgreSQL; client singleton in `src/lib/db.ts`.
- **Real-time:** SSE endpoint at `/api/dashboard-stream` combining an
  in-process `EventEmitter` (`src/lib/sse.ts`) with a 2 s DB poll for
  cross-instance correctness on serverless.
- **Concurrency:** `pg_advisory_xact_lock(serviceId)` plus
  `SELECT … FOR UPDATE` on Provider rows, all inside a single
  `prisma.$transaction` in `src/lib/allocation.ts`.
- **Idempotency:** Webhook keys stored as PK of `WebhookEvent`; replays
  trigger Prisma P2002 → returned as `alreadyProcessed: true`.

## User Defined Namespaces
- [Leave blank - user populates]

## Components
- `src/lib/db.ts` — Prisma client singleton (re-used across HMR + serverless).
- `src/lib/sse.ts` — `EventEmitter` singleton + `emitRefresh()` helper.
- `src/lib/allocation.ts` — `assignLeadToProviders(leadId, serviceId)`
  (mandatory + round-robin, transactional + locked).
- `src/components/Navbar.tsx` — App navigation.
- `src/app/api/leads/route.ts` — POST: create + assign lead.
- `src/app/api/providers/route.ts` — GET: providers + assignments.
- `src/app/api/dashboard-stream/route.ts` — SSE stream.
- `src/app/api/webhook/reset-quota/route.ts` — Idempotent quota reset.
- `src/app/api/test/generate-leads/route.ts` — Parallel lead generator.
- `src/app/request-service/page.tsx` — Customer lead form.
- `src/app/dashboard/page.tsx` — Real-time dashboard (EventSource + poll fallback).
- `src/app/test-tools/page.tsx` — Webhook & concurrency test panel.

## Patterns
- **Idempotent seed:** `prisma/seed.ts` uses `upsert` everywhere; safe to
  re-run.
- **Mandatory-by-service mapping** is code (`MANDATORY_BY_SERVICE` in
  `allocation.ts`); pool + pointer are DB (`AllocationState`).
- **Round-robin pointer** is advanced only on successful picks and
  persisted inside the same transaction as the assignments → fair under
  concurrency and durable across restarts.
- **DB unique constraints** back business rules: `Lead@@unique([phone,
  serviceId])` (dedupe customer submissions) and `LeadAssignment@@unique
  ([leadId, providerId])` (no duplicate assignment).
- **SSE + polling combo** prevents missed updates across serverless
  instances; client uses native `EventSource` auto-reconnect.

## Environment
- `DATABASE_URL` — PostgreSQL connection string (Neon/Supabase/local).
- Scripts: `npm run dev`, `db:push`, `db:seed`, `build`, `start`.
