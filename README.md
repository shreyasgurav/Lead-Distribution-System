# Prowider — Mini Lead Distribution System

A full-stack Next.js application that simulates a simplified Prowider-style
lead generation and distribution platform. Customers submit service
enquiries; the system deterministically assigns each lead to exactly 3
providers using mandatory rules plus a fair round-robin pool, enforces a
monthly quota per provider, exposes a real-time dashboard, and supports an
idempotent webhook for quota resets.

---

## Tech Stack

- **Framework:** Next.js 14 (App Router) + TypeScript
- **Database:** PostgreSQL (Neon / Supabase / local)
- **ORM:** Prisma 5
- **Real-time:** Server-Sent Events (with DB polling fallback)
- **Styling:** Tailwind CSS
- **Deployment:** Vercel

---

## Pages

| Route               | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| `/`                 | Landing page                                                        |
| `/request-service`  | Customer lead submission form                                       |
| `/dashboard`        | Provider dashboard with real-time updates (SSE + poll)              |
| `/test-tools`       | Webhook idempotency test + concurrency stress test                  |

## API

| Method | Path                              | Purpose                                              |
| ------ | --------------------------------- | ---------------------------------------------------- |
| POST   | `/api/leads`                      | Create a lead and assign it to providers             |
| GET    | `/api/providers`                  | All providers with quota usage + recent assignments  |
| GET    | `/api/dashboard-stream`           | SSE stream that pushes dashboard refresh events      |
| POST   | `/api/webhook/reset-quota`        | **Idempotent** quota-reset webhook                   |
| POST   | `/api/test/generate-leads`        | Concurrency stress test (parallel lead submissions)  |

---

## Setup

### 1. Prerequisites

- Node.js ≥ 18.18
- A PostgreSQL database (Neon free tier is fine: <https://neon.tech>)

### 2. Install

```bash
git clone <repo-url>
cd 2048
npm install
```

### 3. Configure environment

Copy `.env.example` to `.env` and set your connection string:

```bash
cp .env.example .env
# edit .env and set DATABASE_URL
```

### 4. Initialize the database

```bash
npm run db:push    # creates tables from prisma/schema.prisma
npm run db:seed    # inserts 3 services, 8 providers, 3 allocation states
```

The seed is **idempotent** — re-running it will not duplicate data.

### 5. Run locally

```bash
npm run dev
# open http://localhost:3000
```

### 6. Build / production

```bash
npm run build
npm start
```

---

## Deployment (Vercel)

1. Push the repo to GitHub.
2. Import it in <https://vercel.com>.
3. Set `DATABASE_URL` in the project's Environment Variables.
4. Deploy. Vercel runs `npm run build`, which also runs `prisma generate`.
5. From your local machine (or any one-off Vercel CLI session), run the
   migration + seed against the production database:

   ```bash
   DATABASE_URL="<prod url>" npm run db:push
   DATABASE_URL="<prod url>" npm run db:seed
   ```

6. Visit your deployed URL. All three pages should load and work.

---

## How it works

### Allocation algorithm

Mandatory mapping (business rule, in `src/lib/allocation.ts`):

| Service   | Mandatory providers | Round-robin pool        |
| --------- | ------------------- | ----------------------- |
| Service 1 | `[1]`               | `[2, 3, 4]`             |
| Service 2 | `[5]`               | `[6, 7, 8]`             |
| Service 3 | `[1, 4]`            | `[2, 3, 5, 6, 7, 8]`    |

Every lead must end up with **at most 3** providers:

1. **Mandatory phase.** For each mandatory provider, include them iff
   `leadsReceived < monthlyQuota`. If their quota is exhausted, skip them
   silently (do not fail).
2. **Round-robin phase.** Starting from the persisted `pointer` for that
   service in `AllocationState`, walk the pool modulo length, skipping any
   provider that is already assigned or out of quota, until 3 slots are
   filled or the pool is exhausted. The pointer is advanced past the last
   successful pick and persisted back to the DB so fairness survives
   restarts and works across serverless instances.
3. **Persist.** Inside the same transaction, write the `LeadAssignment`
   rows and increment `Provider.leadsReceived`.

Result: deterministic, replayable, and never gives a single lead the same
provider twice.

### Concurrency handling

Two simultaneous lead submissions could otherwise corrupt the round-robin
pointer or overflow a provider's quota. We defend with **three layered
guarantees**:

1. **Postgres advisory lock per service.** Every allocation begins with
   `SELECT pg_advisory_xact_lock(serviceId)` inside a `prisma.$transaction`.
   This serializes all allocations for the same service, so the
   pointer-read → pointer-write is atomic.
2. **Row-level locks on Provider rows.** Inside the same transaction we
   issue `SELECT … FOR UPDATE` on the candidate provider rows, ordered by
   `id`. This prevents lost updates when the same provider is touched by
   two services in parallel (e.g. Provider 1 is mandatory for Service 1
   *and* Service 3). The stable lock order eliminates deadlock risk.
3. **DB-level unique constraints.** `(phone, serviceId)` on `Lead` and
   `(leadId, providerId)` on `LeadAssignment` mean even if anything else
   slips through, the database rejects duplicates.

The `/api/test/generate-leads` route fires N submissions through
`Promise.all` and is a direct stress test for this.

### Webhook idempotency

`/api/webhook/reset-quota` accepts a client-supplied `idempotencyKey`
(UUID) and inserts it as the primary key of a `WebhookEvent` row inside
the same transaction that resets every provider's `leadsReceived` to 0
and every `AllocationState.pointer` to 0.

If the same key is replayed, Postgres rejects the insert with `P2002`
(unique violation), the transaction is rolled back, and the API returns
HTTP 200 with `{ alreadyProcessed: true }` *without mutating any data*.

Net effect: replaying the webhook N times has the exact same observable
outcome as calling it once. You can verify this in `/test-tools` — click
"Reset" twice with the same key.

### Real-time dashboard

`/api/dashboard-stream` is a Server-Sent Events endpoint that combines:

- An in-process `EventEmitter` (instant push when allocations happen on
  the same Node.js instance — typical on dev/local).
- A DB poll every 2 s on `max(LeadAssignment.assignedAt)` that surfaces
  cross-instance writes within ~2 s, which matters on horizontally-scaled
  serverless platforms like Vercel.
- A keep-alive ping every 15 s.

The browser uses native `EventSource`, which auto-reconnects when the
serverless function reaches its `maxDuration` (60 s). A defensive 8-second
polling timer on the client provides a hard fallback if SSE is fully
blocked by a corporate proxy.

---

## Manual verification checklist

After setup, walk through these to confirm everything works:

1. **Lead allocation.** Submit a lead for Service 1 via
   `/request-service`. The response should include
   `assignedProviderIds` of length 3 starting with Provider 1.
2. **Round-robin fairness.** Submit several Service 1 leads in a row;
   the round-robin pool `[2, 3, 4]` should cycle predictably alongside
   the always-mandatory Provider 1.
3. **Quota enforcement.** Submit 11 leads for Service 2 (e.g. via the
   test panel). Provider 5 caps at 10 — the 11th lead should *exclude*
   Provider 5 and fill the slot from the pool.
4. **Duplicate guard.** Submit two leads with the same phone + service.
   The second returns HTTP 409.
5. **Concurrency.** Click "Generate 10 Leads" on `/test-tools` — every
   provider's `leadsReceived` should be exactly the number of
   assignments they received, with no over-allocation.
6. **Idempotent webhook.** Click "Reset" twice with the same key. The
   first returns `alreadyProcessed: false`, the second returns
   `alreadyProcessed: true` with no state change.
7. **Real-time.** Keep `/dashboard` open in one tab and submit leads in
   another — the dashboard should update within a couple seconds
   without a page reload.

---

## Project structure

```
prisma/
  schema.prisma            Prisma data model
  seed.ts                  Idempotent seed (services, providers, allocation state)
src/
  app/
    layout.tsx             Root layout (Navbar + global styles)
    page.tsx               Landing
    request-service/       Customer lead form
    dashboard/             Real-time provider dashboard
    test-tools/            Webhook + concurrency test panel
    api/
      leads/               POST → create + assign lead
      providers/           GET  → providers with assignments + quota
      dashboard-stream/    GET  → SSE
      webhook/reset-quota/ POST → idempotent quota reset
      test/generate-leads/ POST → parallel lead generator
  components/
    Navbar.tsx
  lib/
    db.ts                  Prisma singleton
    sse.ts                 Global EventEmitter singleton
    allocation.ts          Core allocation algorithm (transactional + locked)
```

---

## Notes / Trade-offs

- No authentication is implemented — the assignment explicitly excludes
  it. Both the dashboard and test panel are public.
- The mandatory mapping is encoded in code (`MANDATORY_BY_SERVICE`)
  rather than the DB. Pool/pointer state *is* in the DB so the
  round-robin survives restarts.
- The SSE route's `maxDuration` is 60 s to fit Vercel Hobby. The browser
  reconnects automatically.
- Quota window: "monthly" is interpreted as "until the reset webhook
  fires." There is no calendar-month cron; that is delegated to whoever
  calls the webhook.
