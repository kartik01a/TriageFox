# Adding a Connector

Every source and destination implements a shared interface in `packages/connectors/types.ts`. The pipeline never knows which tool it's talking to.

## Interfaces

```ts
interface SourceConnector {
  provider: string;
  verifyCredentials(conn): Promise<void>;
  registerWebhook(conn, url): Promise<{ webhookId: string; secret: string }>;
  verifySignature(req, secret): boolean;
  parseEvent(payload): NormalizedEvent;          // { eventId, topic, sourceType, sourceId, occurredAt }
  fetchThread(conn, sourceId): Promise<Thread>;  // messages[], attachments[], customer, url
  fetchAttachment(conn, ref): Promise<ReadableStream>;
}

interface DestinationConnector {
  provider: string;
  verifyCredentials(conn): Promise<void>;
  listTargets(conn): Promise<Target[]>;          // boards/lists, projects/issue types…
  ensureSetup(conn, config): Promise<Config>;    // create labels, validate required fields
  createTicket(conn, issue, config): Promise<ExternalRef>;
  updateTicket(conn, ref, patch): Promise<void>;
  addComment(conn, ref, markdown): Promise<void>;
  uploadAttachment(conn, ref, stream, meta): Promise<void>;
  getTicketState(conn, ref): Promise<{ exists: boolean; closed: boolean; updatedAt: string }>;
}
```

## Checklist for a new connector

1. Folder `packages/connectors/<provider>/` with client, mapping, and the interface implementation.
2. Auth method decided (API key / OAuth) — add an ADR if it introduces a new pattern.
3. Wizard step for its config (targets, mappings).
4. Rate-limit settings for its queue.
5. Error mapping: 401 → revoked, 404 → broken, 429 → retry-after, 4xx validation → activity log.
6. Recorded-HTTP fixtures + passes the **shared connector test suite**.
7. Sandbox account added to the nightly integration run.
8. Docs: `docs/integrations/<provider>.md`.

## Candidates (see [roadmap.md](../roadmap.md))
- Destinations: Linear, GitHub Issues, ClickUp, Asana, Notion, GitLab, Monday, Azure DevOps, Shortcut
- Sources: Intercom, Crisp, Canny, Zendesk, email inbox, Slack channel, Typeform / Google Forms
- Notifications: Slack, Discord
