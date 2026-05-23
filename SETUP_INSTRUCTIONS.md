# Setup Instructions & Technical Explanation

## Quick Setup

### 1. Clone and Install
```bash
git clone https://github.com/shreyasgurav/Lead-Distribution-System.git
cd Lead-Distribution-System
npm install
```

### 2. Database Setup
Create a free PostgreSQL database on [Neon](https://neon.tech) or [Supabase](https://supabase.com).

Copy the connection string and create `.env`:
```bash
cp .env.example .env
# Edit .env and paste your DATABASE_URL
```

### 3. Initialize Database
```bash
npm run db:push    # Creates tables
npm run db:seed    # Seeds initial data (3 services, 8 providers)
```

### 4. Run Locally
```bash
npm run dev
# Open http://localhost:3000
```

---

## Allocation Algorithm Explanation

### Business Rules
Each lead must be assigned to **exactly 3 providers** (or fewer if quotas are exhausted):

| Service   | Mandatory Providers | Round-Robin Pool    |
|-----------|---------------------|---------------------|
| Service 1 | Provider 1          | [2, 3, 4]           |
| Service 2 | Provider 5          | [6, 7, 8]           |
| Service 3 | Provider 1, 4       | [2, 3, 5, 6, 7, 8]  |

### Algorithm Steps

1. **Mandatory Phase**
   - For each mandatory provider (e.g., P1 for Service 1):
     - Check if `leadsReceived < monthlyQuota` (10)
     - If yes → assign; if no → skip silently (no error)

2. **Round-Robin Phase**
   - Calculate remaining slots: `3 - mandatoryAssigned.length`
   - Fetch the persisted `pointer` from `AllocationState` table
   - Starting from `pointer`, iterate through the pool (modulo length):
     - Skip if provider already assigned
     - Skip if `leadsReceived >= monthlyQuota`
     - If valid → assign and advance pointer: `pointer = (currentIndex + 1) % poolLength`
   - Stop when 3 total slots filled OR pool exhausted

3. **Persistence**
   - Update `AllocationState.pointer` (survives restarts)
   - Create `LeadAssignment` rows
   - Increment `Provider.leadsReceived`
   - **All inside a single Prisma transaction**

### Example Flow (Service 1)
- Lead 1 → [P1, P2, P3] (pointer advances to index 1)
- Lead 2 → [P1, P3, P4] (pointer advances to index 2)
- Lead 3 → [P1, P4, P2] (pointer wraps to index 0)
- Fair rotation: P2, P3, P4 cycle alongside always-mandatory P1

---

## Concurrency Handling

**Problem:** Two simultaneous lead submissions could corrupt the round-robin pointer or overflow quotas.

**Solution:** Three-layer defense inside a single `prisma.$transaction`:

### 1. PostgreSQL Advisory Lock (Per-Service Serialization)
```typescript
await tx.$executeRaw`SELECT pg_advisory_xact_lock(${serviceId})`
```
- Serializes all allocations for the **same service**
- Service 1 and Service 2 can run in parallel
- Service 1 leads are strictly sequential → pointer stays consistent

### 2. Row-Level Locks (Cross-Service Safety)
```typescript
SELECT id, "monthlyQuota", "leadsReceived"
FROM "Provider"
WHERE id = ANY(${candidateIds}::int[])
ORDER BY id
FOR UPDATE
```
- Locks Provider rows in **stable order** (by id)
- Prevents lost updates when P1 is mandatory for both Service 1 & 3
- Stable order eliminates deadlock risk

### 3. Database Unique Constraints
- `Lead @@unique([phone, serviceId])` → prevents duplicate customer submissions
- `LeadAssignment @@unique([leadId, providerId])` → prevents same provider twice per lead

**Result:** Under high concurrency (test with `/test-tools` → "Generate 10 Leads"), quotas never overflow and the pointer advances correctly.

---

## Webhook Idempotency

**Requirement:** Quota-reset webhook must be safe to replay (network retries, duplicate calls).

**Implementation:**
```typescript
// Client sends a UUID as idempotencyKey
await tx.webhookEvent.create({
  data: { id: idempotencyKey, type: "reset-quota" }
});
// Then reset all providers + pointers
```

- `WebhookEvent.id` is the **primary key**
- First call: inserts key → resets succeed → commits
- Replay: Postgres rejects insert (P2002 unique violation) → transaction rolls back → **no state change**
- API returns `{ alreadyProcessed: true }` with HTTP 200

**Verification:** `/test-tools` → click "Reset" twice with same key. Second call returns `alreadyProcessed: true` without mutating data.

---

## Real-Time Dashboard

**Challenge:** Serverless functions (Vercel) scale horizontally — in-memory events don't cross instances.

**Solution:** Hybrid approach in `/api/dashboard-stream` (SSE):

1. **In-Process EventEmitter**
   - Instant push when allocation happens on the same Node.js instance
   - Typical on local dev

2. **DB Polling (every 2s)**
   - Queries `max(LeadAssignment.assignedAt)`
   - Surfaces cross-instance writes within ~2 seconds
   - Critical for production serverless

3. **Client Fallback**
   - Native `EventSource` with auto-reconnect
   - Additional 8s polling timer if SSE is blocked

**Result:** Dashboard updates in real-time across all connected clients, even on horizontally-scaled deployments.

---

## Verification Checklist

After deployment, test these scenarios:

1. ✅ **Basic allocation:** Submit Service 1 lead → should assign P1 + 2 from pool
2. ✅ **Round-robin fairness:** Submit 5 Service 1 leads → P2, P3, P4 cycle predictably
3. ✅ **Quota enforcement:** Submit 11 Service 2 leads → P5 caps at 10, 11th excludes P5
4. ✅ **Duplicate guard:** Same phone + service twice → second returns HTTP 409
5. ✅ **Concurrency:** `/test-tools` → "Generate 10 Leads" → no quota overflow
6. ✅ **Idempotency:** `/test-tools` → "Reset" twice with same key → second is no-op
7. ✅ **Real-time:** Keep `/dashboard` open, submit lead in another tab → updates without reload

---

## Tech Stack Summary

- **Framework:** Next.js 14 (App Router) + TypeScript
- **Database:** PostgreSQL (Neon/Supabase)
- **ORM:** Prisma 5
- **Real-time:** Server-Sent Events + DB polling
- **Styling:** Tailwind CSS
- **Deployment:** Vercel

**Repository:** https://github.com/shreyasgurav/Lead-Distribution-System
