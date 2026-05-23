"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Assignment {
  leadId: number;
  serviceName: string;
  customerName: string;
  city: string;
  assignedAt: string;
}

interface Provider {
  id: number;
  name: string;
  monthlyQuota: number;
  leadsReceived: number;
  remainingQuota: number;
  assignments: Assignment[];
}

export default function DashboardPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const esRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/providers", { cache: "no-store" });
      const data = await res.json();
      setProviders(data.providers ?? []);
      setLastUpdate(new Date());
    } catch (err) {
      console.error("Failed to load providers:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    const connect = () => {
      const es = new EventSource("/api/dashboard-stream");
      esRef.current = es;

      es.addEventListener("ready", () => setConnected(true));
      es.addEventListener("refresh", () => {
        refresh();
      });
      es.onerror = () => {
        setConnected(false);
        // EventSource auto-reconnects; no manual close needed
      };
    };
    connect();

    // Polling safety net (in case SSE is fully blocked by a proxy).
    const poll = setInterval(refresh, 8000);

    return () => {
      esRef.current?.close();
      esRef.current = null;
      clearInterval(poll);
    };
  }, [refresh]);

  const totalAssigned = providers.reduce((s, p) => s + p.leadsReceived, 0);
  const totalCapacity = providers.reduce((s, p) => s + p.monthlyQuota, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Provider Dashboard</h1>
          <p className="text-sm text-slate-600">
            Live view of all 8 providers and their currently assigned leads.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span
            className={
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 " +
              (connected
                ? "bg-green-100 text-green-700"
                : "bg-amber-100 text-amber-800")
            }
          >
            <span
              className={
                "h-2 w-2 rounded-full " +
                (connected ? "bg-green-500" : "bg-amber-500")
              }
            />
            {connected ? "Live (SSE)" : "Reconnecting…"}
          </span>
          {lastUpdate && (
            <span>Last update: {lastUpdate.toLocaleTimeString()}</span>
          )}
          <button onClick={refresh} className="btn-secondary !py-1 !px-2">
            Refresh
          </button>
        </div>
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-4 p-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Total Allocation
          </p>
          <p className="text-lg font-semibold">
            {totalAssigned}{" "}
            <span className="text-sm font-normal text-slate-500">
              of {totalCapacity} monthly slots used
            </span>
          </p>
        </div>
        <div className="text-xs text-slate-500">
          Allocation rules: Service 1 → P1 always · Service 2 → P5 always ·
          Service 3 → P1 & P4 always · remaining slots filled fairly from a
          persisted round-robin pool.
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading providers…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {providers.map((p) => {
            const pct = Math.min(
              100,
              Math.round((p.leadsReceived / p.monthlyQuota) * 100)
            );
            const exhausted = p.remainingQuota === 0;
            return (
              <div key={p.id} className="card flex flex-col p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-semibold">{p.name}</h2>
                    <p className="text-xs text-slate-500">ID: {p.id}</p>
                  </div>
                  <div
                    className={
                      "rounded-md px-2 py-0.5 text-xs font-medium " +
                      (exhausted
                        ? "bg-red-100 text-red-700"
                        : "bg-blue-100 text-blue-700")
                    }
                  >
                    {p.leadsReceived}/{p.monthlyQuota}
                  </div>
                </div>

                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={
                      "h-full transition-all " +
                      (exhausted ? "bg-red-500" : "bg-blue-600")
                    }
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Remaining: <span className="font-medium">{p.remainingQuota}</span>
                </p>

                <div className="mt-4">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                    Recent Leads
                  </p>
                  {p.assignments.length === 0 ? (
                    <p className="text-xs text-slate-400">No leads yet.</p>
                  ) : (
                    <ul className="max-h-56 space-y-1.5 overflow-auto pr-1 text-xs">
                      {p.assignments.slice(0, 10).map((a) => (
                        <li
                          key={`${a.leadId}-${p.id}`}
                          className="rounded-md border border-slate-100 bg-slate-50 p-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-slate-800">
                              {a.customerName}
                            </span>
                            <span className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200">
                              {a.serviceName}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-500">
                            <span>{a.city}</span>
                            <span>{new Date(a.assignedAt).toLocaleString()}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
