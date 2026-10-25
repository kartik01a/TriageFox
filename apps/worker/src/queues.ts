export const QUEUES = {
  /** Wiring checks and operational jobs. Pipeline queues (thread.evaluate, ticket.deliver, ...) arrive in Phase 3+. */
  system: "system",
} as const;

export const JOBS = { ping: "ping" } as const;
