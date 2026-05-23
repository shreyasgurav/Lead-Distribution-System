import { EventEmitter } from "events";

// True singleton across hot reloads (dev) and per-instance in production.
// Note: serverless deployments scale horizontally, so this emitter only
// fans out events within a single Node.js process. The dashboard-stream
// route additionally polls the database for cross-instance correctness.
const globalForEmitter = globalThis as unknown as { __sseEmitter?: EventEmitter };

export const emitter: EventEmitter =
  globalForEmitter.__sseEmitter ?? new EventEmitter();

if (!globalForEmitter.__sseEmitter) {
  emitter.setMaxListeners(0); // unlimited dashboard clients in a single process
  globalForEmitter.__sseEmitter = emitter;
}

export const SSE_EVENT = "dashboard:refresh";

export function emitRefresh(payload: Record<string, unknown> = {}) {
  emitter.emit(SSE_EVENT, { type: "refresh", ts: Date.now(), ...payload });
}
