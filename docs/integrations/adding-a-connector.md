# Adding a Connector

Every source and destination implements a shared interface in `packages/connectors/types.ts`. The pipeline never knows which tool it's talking to, so we can keep adding integrations one at a time ([roadmap.md](../roadmap.md#integrations-roadmap)).

## Interfaces

```ts
interface SourceConnector {
  provider: string;
  verifyConnection(conn): Promise<void>;
  verifySignature(req, secret): boolean;
  parseEvent(payload): NormalizedEvent;          // { dedupeKey, topic, sourceId, accountRef, occurredAt }
  fetchThread(conn, sourceId): Promise<Thread>;  // messages[], attachments[], customer, url, state
  listRecentThreads?(conn, since): Promise<ThreadRef[]>;  // for reconcile jobs
  fetchAttachment(conn, ref): Promise<ReadableStream>;
  registerWebhook?(conn, url): Promise<{ webhookId: string; secret: string }>;  // when the tool needs one per account
}

interface DestinationConnector {
  provider: string;
  verifyCredentials(conn): Promise<void>;
  listTargets(conn): Promise<Target[]>;          // boards/lists, projects/issue types…
  ensureSetup(conn, config): Promise<Config>;    // create labels, check required fields
  createTicket(conn, issue, config): Promise<ExternalRef>;
  updateTicket(conn, ref, patch): Promise<void>;
  addComment(conn, ref, markdown): Promise<void>;
  uploadAttachment(conn, ref, stream, meta): Promise<void>;
  getTicketState(conn, ref): Promise<{ exists: boolean; closed: boolean; updatedAt: string }>;
}
```

## Checklist for a new connector

1. Folder `packages/connectors/<provider>/` with the client, field mapping and the interface implementation.
2. Choose the auth method (plugin install / OAuth / API key). Add an ADR if it's a new pattern.
3. A setup-wizard step for its config (targets, mappings).
4. Rate-limit settings for its queue.
5. Error mapping: 401 → revoked, 404 → broken, 429 → wait for retry-after, 4xx validation errors → activity log.
6. A dedupe key and, if the tool can drop events, a reconcile job.
7. Recorded HTTP fixtures, and it passes the **shared connector test suite**.
8. A free sandbox account added to the nightly integration run.
9. Self-host setup steps (which developer app or key the self-hoster must create).
10. Docs: `docs/integrations/<provider>.md`, plus a roadmap status update.
