"use client";

import { useState } from "react";

const SERVICES = [
  { id: 1, label: "Service 1" },
  { id: 2, label: "Service 2" },
  { id: 3, label: "Service 3" },
];

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; leadId: number; assigned: number[] }
  | { kind: "error"; message: string };

export default function RequestServicePage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [serviceId, setServiceId] = useState<number>(1);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "submitting" });
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, city, serviceId, description }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({
          kind: "error",
          message: data?.error ?? "Submission failed",
        });
        return;
      }
      setStatus({
        kind: "success",
        leadId: data.leadId,
        assigned: data.assignedProviderIds ?? [],
      });
      setName("");
      setPhone("");
      setCity("");
      setDescription("");
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">Request a Service</h1>
      <p className="mt-1 text-sm text-slate-600">
        Submit your enquiry — we&apos;ll route it to the right providers
        instantly.
      </p>

      <form onSubmit={onSubmit} className="card mt-6 space-y-4 p-6">
        <div>
          <label className="label">Full Name</label>
          <input
            className="input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Aarav Sharma"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">Phone Number</label>
            <input
              className="input"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="9876543210"
              pattern="[0-9]{7,15}"
              title="Digits only, 7–15 characters"
            />
          </div>
          <div>
            <label className="label">City</label>
            <input
              className="input"
              required
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Mumbai"
            />
          </div>
        </div>

        <div>
          <label className="label">Service Type</label>
          <select
            className="input"
            value={serviceId}
            onChange={(e) => setServiceId(Number(e.target.value))}
          >
            {SERVICES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">Description</label>
          <textarea
            className="input min-h-[110px]"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Briefly describe what you need…"
          />
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            type="submit"
            className="btn-primary"
            disabled={status.kind === "submitting"}
          >
            {status.kind === "submitting" ? "Submitting…" : "Submit Request"}
          </button>
          {status.kind === "success" && (
            <p className="text-sm font-medium text-green-700">
              ✓ Submitted (Lead #{status.leadId}). Assigned to providers:{" "}
              {status.assigned.length
                ? status.assigned.join(", ")
                : "none (all at quota)"}
              .
            </p>
          )}
          {status.kind === "error" && (
            <p className="text-sm font-medium text-red-600">{status.message}</p>
          )}
        </div>
      </form>

      <p className="mt-4 text-xs text-slate-500">
        Note: duplicate submissions (same phone + service) are rejected at the
        database level.
      </p>
    </div>
  );
}
