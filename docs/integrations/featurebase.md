# Featurebase (Source, planned, not MVP)

> Was the original MVP source. Replaced by Crisp on 2026-10-25 ([decisions/0006](../decisions/0006-crisp-as-mvp-source.md)), because API and webhook access appears to need a paid Featurebase plan (around $59/seat/month), which is too expensive for testing. Revisit when we can get a partner or developer workspace.

## Why it's still worth adding later
- Featurebase's native Jira, Linear and ClickUp integrations push **feedback posts**. Turning a **chat** into a ticket takes manual steps (chat → post → push).
- **Trello** is only possible through Zapier.
- Its Messenger chats are exactly the input our pipeline handles.

## Notes from research
- Auth: API key from the Featurebase dashboard.
- One webhook per connection (Featurebase allows **10 webhooks per organization** by default).
- Conversation topics: `conversation.user.created`, `conversation.user.replied`, `conversation.admin.replied`, `conversation.admin.noted`, `conversation.admin.closed`, `conversation.admin.opened`. Posts: `post.created`, comment events.
- API is versioned by date (e.g. `2026-01-01.nova`); pin the version.

## Before building
- [ ] Ask Featurebase for a free partner/developer workspace (pitch: a Trello integration they don't have).
- [ ] Confirm which plan includes API and webhooks.
- [ ] Payload shapes, event id for dedupe, conversation fetch endpoint, attachment auth.

## References
- https://docs.featurebase.app/rest-api/webhooks
- https://docs.featurebase.app/guides/webhooks/topics
- https://help.featurebase.app/articles/7224730-jira-integration
