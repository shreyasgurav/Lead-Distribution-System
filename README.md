# Prowider Mini Lead Distribution System

Hey! This is my implementation of a lead distribution system for the Prowider internship assignment. 

The goal was to build a platform where customers can submit service requests, and the system automatically distributes these leads to service providers fairly. Each lead goes to exactly 3 providers, respecting mandatory assignments and monthly quotas, with everything happening in real-time.

I built this using Next.js 14, PostgreSQL, and Prisma, focusing on making sure the allocation logic is bulletproof even under high concurrency.

---

## 🛠️ Tech Stack

I chose these technologies because they're modern, scalable, and I'm comfortable working with them:

- **Next.js 14** (App Router) with TypeScript for the full-stack framework
- **PostgreSQL** for the database (using Neon's free tier for cloud hosting)
- **Prisma 5** as the ORM - makes database operations type-safe and easy
- **Server-Sent Events** for real-time updates (with a polling fallback for reliability)
- **Tailwind CSS** for styling - kept it minimal and clean
- **Vercel** for deployment

---

## 📱 What's Inside

| Route               | Description                                                         |
| ------------------- | ------------------------------------------------------------------- |
| `/`                 | Landing page                                                        |
| `/request-service`  | Customer lead submission form                                       |
| `/dashboard`        | Provider dashboard with real-time updates (SSE + poll)              |
| `/test-tools`       | Webhook idempotency test + concurrency stress test                  |

## 🔌 API Endpoints

| Method | Path                              | Purpose                                              |
| ------ | --------------------------------- | ---------------------------------------------------- |
| POST   | `/api/leads`                      | Create a lead and assign it to providers             |
| GET    | `/api/providers`                  | All providers with quota usage + recent assignments  |
| GET    | `/api/dashboard-stream`           | SSE stream that pushes dashboard refresh events      |
| POST   | `/api/webhook/reset-quota`        | **Idempotent** quota-reset webhook                   |
| POST   | `/api/test/generate-leads`        | Concurrency stress test (parallel lead submissions)  |

---

## 🚀 Getting Started

Here's how to run this project locally:

### Prerequisites
- Node.js 18 or higher
- A PostgreSQL database (I recommend Neon's free tier: https://neon.tech)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/shreyasgurav/Lead-Distribution-System.git
cd Lead-Distribution-System
npm install
```

2. **Set up your database**

Create a `.env` file in the root directory:
```bash
DATABASE_URL="your-postgresql-connection-string"
```

3. **Initialize the database**
```bash
npm run db:push    # Creates all the tables
npm run db:seed    # Adds initial data (3 services, 8 providers)
```

Don't worry about running seed multiple times - it's idempotent and won't create duplicates.

4. **Start the development server**
```bash
npm run dev
```

Open http://localhost:3000 and you're good to go!

### For Production
```bash
npm run build
npm start
```

---

## 🌐 Deploying to Vercel

Deployment is straightforward:

1. Push your code to GitHub
2. Import the repo in Vercel (https://vercel.com)
3. Add `DATABASE_URL` to your environment variables
4. Deploy! Vercel handles the build automatically
5. Run these commands locally to set up the production database:
   ```bash
   DATABASE_URL="your-production-url" npm run db:push
   DATABASE_URL="your-production-url" npm run db:seed
   ```

That's it! Your app should be live.

---

## 💡 How It Works

### The Allocation Logic

This was the most interesting part to build. Here's how leads get distributed:

**Business Rules:**

| Service   | Mandatory providers | Round-robin pool        |
| --------- | ------------------- | ----------------------- |
| Service 1 | `[1]`               | `[2, 3, 4]`             |
| Service 2 | `[5]`               | `[6, 7, 8]`             |
| Service 3 | `[1, 4]`            | `[2, 3, 5, 6, 7, 8]`    |

**The Algorithm:**

Each lead gets assigned to exactly 3 providers (or fewer if quotas are full):

1. **Mandatory Assignment:** First, I assign the mandatory providers for that service - but only if they haven't hit their monthly quota yet. If they're full, we skip them (no errors, just move on).

2. **Round-Robin Distribution:** For the remaining slots, I use a round-robin approach. There's a pointer stored in the database that remembers where we left off. Starting from that position, I walk through the pool of eligible providers, skipping anyone who's already assigned or out of quota. After each successful assignment, the pointer moves forward.

3. **Save Everything:** All the assignments and quota updates happen in a single database transaction to keep everything consistent.

The result? Fair distribution that's deterministic and never assigns the same provider twice to a lead.

### Handling Concurrent Requests

This was tricky - what happens when multiple leads come in at the exact same time? Without proper handling, we could mess up the round-robin pointer or exceed quotas.

I implemented three layers of protection:

1. **PostgreSQL Advisory Locks:** Each service gets its own lock. When processing a lead for Service 1, no other Service 1 allocation can happen simultaneously. This keeps the round-robin pointer consistent.

2. **Row-Level Locking:** I lock the provider rows we're checking (using `SELECT ... FOR UPDATE`) in a stable order. This prevents issues when the same provider is needed by multiple services at once.

3. **Database Constraints:** As a final safety net, the database itself enforces uniqueness - same phone number can't submit to the same service twice, and a provider can't be assigned to the same lead twice.

You can stress-test this yourself using the "Generate 10 Leads" button in the test tools page!

### Idempotent Webhook

The quota reset webhook is designed to be safe even if called multiple times with the same request.

Here's how it works: When you call the reset endpoint, you provide an `idempotencyKey` (a UUID). I store this key in the database as part of the same transaction that resets all the quotas. If someone tries to call the webhook again with the same key, PostgreSQL rejects it because the key already exists, and nothing gets changed.

This means you can safely retry the webhook without worrying about accidentally resetting quotas twice. Try it in the test tools - click "Reset" twice with the same key and watch the second call return `alreadyProcessed: true`.

### Real-Time Dashboard Updates

The dashboard updates automatically when new leads are assigned - no need to refresh!

I'm using Server-Sent Events (SSE) for this, with a smart fallback system:

- **In-memory events:** When a lead is assigned on the same server instance, the dashboard updates instantly
- **Database polling:** Every 2 seconds, I check for new assignments in the database. This catches updates from other server instances (important for production on Vercel)
- **Client-side polling:** As a backup, the browser also polls every 8 seconds in case SSE gets blocked

The connection auto-reconnects if it drops, so the dashboard stays live even on serverless platforms.

---

## ✅ Testing the System

Once you've got everything running, here's what you should test:

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

## 📁 Project Structure

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

## 📝 Design Decisions & Trade-offs

A few things I want to mention about the implementation:

- **No Authentication:** The assignment didn't require it, so I kept things simple. In a real production system, you'd definitely want to add auth.

- **Mandatory Mappings in Code:** I hardcoded the mandatory provider rules in `MANDATORY_BY_SERVICE` rather than making them database-driven. For a real system, you'd probably want this configurable, but for this assignment, it keeps things simpler.

- **Monthly Quotas:** I interpret "monthly" as "until the reset webhook is called" rather than implementing calendar-based resets. In production, you'd probably have a cron job calling the webhook on the 1st of each month.

- **SSE Connection Limits:** On Vercel's free tier, serverless functions timeout after 60 seconds, so the SSE connection reconnects automatically. This is totally normal and handled gracefully by the browser.

---

## 🙏 Final Notes

This was a fun challenge! I focused on making the core allocation logic robust and handling edge cases properly. The concurrency handling and idempotency were particularly interesting problems to solve.

If you have any questions about the implementation or want to discuss any of the design decisions, feel free to reach out!

**Repository:** https://github.com/shreyasgurav/Lead-Distribution-System
