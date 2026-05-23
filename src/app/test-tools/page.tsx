"use client";

import { useEffect, useState } from "react";

function uuid() {
  // RFC4122-ish v4 using crypto when available
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default function TestToolsPage() {
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [resetState, setResetState] = useState<{
    loading: boolean;
    result?: unknown;
    error?: string;
  }>({ loading: false });
  const [genState, setGenState] = useState<{
    loading: boolean;
    result?: unknown;
    error?: string;
  }>({ loading: false });
  const [count, setCount] = useState(10);

  useEffect(() => {
    setIdempotencyKey(uuid());
  }, []);

  async function onReset() {
    setResetState({ loading: true });
    try {
      const res = await fetch("/api/webhook/reset-quota", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey, type: "reset-quota" }),
      });
      const data = await res.json();
      setResetState({ loading: false, result: data });
    } catch (err) {
      setResetState({
        loading: false,
        error: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  async function onGenerate() {
    setGenState({ loading: true });
    try {
      const res = await fetch("/api/test/generate-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count }),
      });
      const data = await res.json();
      setGenState({ loading: false, result: data });
    } catch (err) {
      setGenState({
        loading: false,
        error: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Test Tools Panel</h1>
        <p className="mt-1 text-sm text-slate-600">
          Internal utilities for verifying webhook idempotency and allocation
          concurrency. <strong>This panel is for testing only. Quota can
          only be reset via webhook.</strong>
        </p>
      </header>

      <section className="card p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Reset Provider Quota</h2>
            <p className="mt-1 text-sm text-slate-600">
              Calls <code>POST /api/webhook/reset-quota</code> with a client
              idempotency key. Re-sending the same key returns{" "}
              <code>alreadyProcessed: true</code> without mutating any data.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <label className="label">Idempotency Key (UUID)</label>
            <input
              className="input font-mono text-xs"
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
            />
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIdempotencyKey(uuid())}
            >
              New Key
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={onReset}
              disabled={resetState.loading || !idempotencyKey}
            >
              {resetState.loading ? "Resetting…" : "Reset All Quotas"}
            </button>
          </div>
        </div>

        {resetState.error && (
          <p className="mt-3 text-sm text-red-600">{resetState.error}</p>
        )}
        {resetState.result !== undefined && (
          <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
            {JSON.stringify(resetState.result, null, 2)}
          </pre>
        )}

        <p className="mt-2 text-xs text-slate-500">
          Tip: click <em>Reset</em> twice in a row with the same key — the
          second call should report <code>alreadyProcessed: true</code>.
        </p>
      </section>

      <section className="card p-6">
        <h2 className="text-lg font-semibold">Concurrency Test</h2>
        <p className="mt-1 text-sm text-slate-600">
          Fires N lead submissions in parallel through{" "}
          <code>POST /api/test/generate-leads</code>. Use this to verify that
          allocations stay consistent under load — quotas should never
          overflow, no duplicate provider per lead, and the round-robin
          pointer should advance fairly.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Count</label>
            <input
              type="number"
              min={1}
              max={50}
              className="input w-24"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={onGenerate}
            disabled={genState.loading}
          >
            {genState.loading ? "Generating…" : `Generate ${count} Leads`}
          </button>
        </div>

        {genState.error && (
          <p className="mt-3 text-sm text-red-600">{genState.error}</p>
        )}
        {genState.result !== undefined && (
          <pre className="mt-3 max-h-72 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">
            {JSON.stringify(genState.result, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}
