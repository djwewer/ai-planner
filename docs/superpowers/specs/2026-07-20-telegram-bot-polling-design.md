# AI Planner — Plan 6.1: Telegram Bot — Switch to Polling — Design

_Date: 2026-07-20_

## Overview

Plan 6 shipped the Telegram bot using webhook delivery (`POST /telegram/webhook`), per the original design. In production, Telegram's servers could never actually reach that endpoint — `getWebhookInfo` consistently reported `"last_error_message":"Connection timed out"`, while general external traffic to the same IP/port succeeded fine and outbound calls from the backend to Telegram's API worked without issue. Extensive troubleshooting (`ufw`, the Hostinger panel firewall, Traefik's own config, IPv4/IPv6 reachability) found nothing misconfigured on our side — the block appears to sit in Hostinger's network edge, outside anything configurable from the app, OS firewall, or the shared Traefik instance.

This plan replaces webhook delivery with **long-polling**: the backend itself repeatedly calls Telegram's `getUpdates` endpoint, an outbound connection that's already proven to work (every other Telegram API call this app makes — `sendMessage`, `setWebhook`, etc. — is also outbound and succeeds). This sidesteps the inbound-connectivity problem entirely rather than depending on a Hostinger support ticket of unknown timeline.

## Scope

**In scope:**
- Remove `POST /telegram/webhook` and its secret-token verification entirely.
- Add a background polling loop (a dedicated thread, started at app startup alongside the existing APScheduler) that calls `getUpdates`, dispatching each update to the same `/start`-linking and Approve/Reject handling logic already built in Plan 6 — unchanged business logic, only the delivery mechanism changes.
- Remove `TELEGRAM_WEBHOOK_SECRET` (config, `.env.example`, test defaults) — no longer meaningful, since polling is an outbound connection authenticated by the bot token already embedded in every Telegram API call; there's no inbound request to verify.
- Update the two existing tests that exercised the webhook route to call the (relocated) handler logic directly instead.

**Explicitly out of scope:**
- Any change to the linking flow's user-facing behavior, the notification content, the Approve/Reject UX, or the scheduler jobs — none of that changes.
- Persisting the polling `offset` to the database across restarts (see Error Handling below for why this is fine).

## Architecture

**`app/telegram/client.py` gains `get_updates(offset, timeout, allowed_updates) -> list[dict]`** — a thin wrapper around Telegram's `getUpdates`, matching the existing style of the other three functions in this file.

**New `app/telegram/handlers.py`** — the `_handle_start`/`_handle_callback_query` logic currently living in `router.py` moves here unchanged (renamed to public names), plus a new `handle_update(update: dict, db: Session) -> None` that inspects the update shape and dispatches — this is exactly what the old `webhook()` route's body did, just without any FastAPI/HTTP-specific parts (no secret-token check, no `{"ok": True}` response).

**New `app/telegram/polling.py`** — a background daemon thread running an infinite loop: call `get_updates(offset, timeout=30, allowed_updates=["message", "callback_query"])`, process each returned update through `handle_update` (each with its own short-lived `SessionLocal()`, same pattern the scheduler jobs already use), advance `offset` to `last_update_id + 1`. On a fetch failure, log and wait 5 seconds before retrying, so a transient error doesn't spin in a tight loop. `start()`/`stop()` functions wire into `main.py`'s existing `lifespan` context manager, alongside the APScheduler's own start/shutdown.

**`app/telegram/router.py` shrinks to just `GET /telegram/connect`** — unrelated to delivery mechanism, stays exactly as-is.

## Error Handling

- **Offset not persisted across restarts** — tracked only in the polling thread's local variable. On a process restart, the loop starts with `offset=None`, meaning Telegram will redeliver any updates it still has queued (including ones already processed before an unclean shutdown). This is safe because every handler here is already idempotent: `handle_start` re-processing an already-`used` link code just replies with the invalid-code message again (harmless); `handle_callback_query` re-processing an already-resolved task just re-renders its current state (the exact idempotency behavior Plan 6 already built for duplicate button taps). No persistence needed to stay correct — matches this project's established preference for the simplest mechanism that's actually safe, over defensive infrastructure for a failure mode that doesn't cause real damage.
- **`get_updates` call fails** (network blip, Telegram API hiccup) — caught, logged, thread waits 5 seconds and retries. Never crashes the polling thread or the app.
- **Telegram requires `deleteWebhook` before `getUpdates` will return anything** — the two delivery mechanisms are mutually exclusive on Telegram's side; a bot with an active webhook URL registered will not receive updates via polling. This must be done once during deployment (Task 2).

## Testing

Per the same reduced-testing preference as every other plan in this project: no new dedicated test-writing task. The two existing tests (`test_telegram_link.py`, `test_telegram_approve.py`) that posted to `/telegram/webhook` are updated in place to call `handlers.handle_update(...)` directly — this is a required part of making the refactor itself correct (those tests would otherwise fail outright once the route is removed), not additional test-writing. No automated test can verify real long-polling behavior against Telegram's actual servers — manual QA (Task 2) confirms it end-to-end in production.
