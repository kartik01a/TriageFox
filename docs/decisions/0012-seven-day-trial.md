# 0012 — The free trial is 7 days
- **Status:** Accepted
- **Date:** 2026-10-31

## Context
The launch plan agreed a 14-day, no-card trial with a 50-conversation cap. The owner asked to shorten it to 7 days: a short trial reaches the decision sooner, keeps the free AI spend per sign-up lower, and the dry run plus a real first ticket show the value within the first day.

## Decision
- The default trial length is **7 days**. The conversation cap (50), "no card" and "unlimited with your own key" stay as they were.
- It is a setting (`platform_settings.trial.days`), so it can be changed in the admin area without a deploy. Only the built-in fallback and the launch seed changed.
- Public text (pricing page, landing page, emails) reads the number from the setting instead of repeating it.

## Alternatives considered
- **Keep 14 days:** more time to see follow-ups and duplicates happen, but longer free use and slower conversion.
- **Make it shorter than 7:** too little time for a customer to get a real conversation through the system.

## Consequences
- Existing trials keep the length they started with; only new workspaces get 7 days.
- The trial-ending notice (3 days before the end) now arrives on day 4.
- Docs and tests that mentioned 14 days were updated.
