import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-8 text-white shadow-lg">
        <h1 className="text-3xl font-semibold tracking-tight">
          Prowider Mini Lead Distribution System
        </h1>
        <p className="mt-3 max-w-2xl text-blue-100">
          A simplified lead generation platform. Customers submit service
          requests; the backend deterministically allocates each lead to
          exactly three providers using mandatory rules plus a fair
          round-robin pool, with monthly quota enforcement and
          concurrency-safe transactions.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/request-service"
            className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
          >
            Submit a Lead →
          </Link>
          <Link
            href="/dashboard"
            className="rounded-md border border-white/40 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20"
          >
            Open Provider Dashboard
          </Link>
          <Link
            href="/test-tools"
            className="rounded-md border border-white/40 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20"
          >
            Test Tools
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="card p-5">
          <h2 className="font-semibold">Mandatory + Round-Robin</h2>
          <p className="mt-2 text-sm text-slate-600">
            Service 1 → P1 always. Service 2 → P5 always. Service 3 → P1 & P4
            always. Remaining slots filled fairly from a persisted pointer.
          </p>
        </div>
        <div className="card p-5">
          <h2 className="font-semibold">Concurrency Safe</h2>
          <p className="mt-2 text-sm text-slate-600">
            Per-service <code>pg_advisory_xact_lock</code> + row-level{" "}
            <code>SELECT … FOR UPDATE</code> on Provider rows inside one
            Prisma transaction.
          </p>
        </div>
        <div className="card p-5">
          <h2 className="font-semibold">Idempotent Webhooks</h2>
          <p className="mt-2 text-sm text-slate-600">
            Quota-reset webhook stores each idempotency key as a primary key;
            replays return 200 without mutating state.
          </p>
        </div>
      </section>
    </div>
  );
}
