# beanbot

Discord bot for personal task and calendar management.

## Current foundation

This repo now contains the foundation plus current Phase 5 work:

- Bun + TypeScript runtime
- `discord.js` bot with guild-scoped slash command registration
- Express server with `GET /health`
- Todoist OAuth + read integration
- Google Calendar OAuth + read integration
- Drizzle + SQLite migrations for local config and OAuth token storage
- Automated daily `#today` digest posting at 8:00 AM local time
- Live `#today` status message that is edited throughout the day and kept as daily channel history
- Live `#week` and `#month` status messages with rolling period history
- Live `#habits` status message for daily habit tracking
- Live `#upcoming` message for rolling next-14-days tasks
- Automated `#reminders` delivery for overdue tasks, timed tasks due soon, and upcoming one-off events
- `#inbox` quick capture into Todoist via Quick Add
- Structured runtime logging to local console and optional Discord `#logs`
- `/ping`, `/help`, `/today`, `/week`, `/month`, task commands, and event commands

## Prerequisites

- Bun `>= 1.1.0`
- A Discord application and bot token
- A private Discord guild for command registration
- Discord Message Content intent enabled for the bot so `#inbox` capture can read message text

## Environment

Copy `.env.example` to `.env` and fill in:

- `DISCORD_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_GUILD_ID`
- `DATABASE_URL`
- `BOT_TIMEZONE`
- `INBOX_CHANNEL_ID`
- `TODAY_CHANNEL_ID`
- `WEEK_CHANNEL_ID`
- `MONTH_CHANNEL_ID`
- `HABITS_CHANNEL_ID`
- `UPCOMING_CHANNEL_ID`
- `REMINDERS_CHANNEL_ID`
- `LOGS_CHANNEL_ID` (optional, for Discord runtime logs)
- `LOG_LEVEL` (`debug`, `info`, `warn`, or `error`; default `info`)
- `DISCORD_LOG_LEVEL` (`debug`, `info`, `warn`, or `error`; default `warn`)
- `OAUTH_STATE_SECRET` for OAuth flows
- `HOST`
- `PORT`
- `PUBLIC_BASE_URL`
- `TODOIST_CLIENT_ID`
- `TODOIST_CLIENT_SECRET`
- `TODOIST_REDIRECT_URI`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_DEFAULT_CALENDAR_ID`

## Commands

```bash
bun install
bun run db:migrate
bun run register:commands
bun run dev
```

`bun run dev` also applies migrations and registers guild commands at startup before logging the bot in.

## Current command surface

- `/ping` returns a basic health response
- `/help` shows the current command list, provider connect links, and intended channel layout
- `/today` shows overdue Todoist tasks, tasks due today, and today’s Google Calendar events
- `/week` shows overdue work plus the next 7 days of tasks and events
- `/month` shows overdue work plus the next 31 days of tasks and events
- `/habits` shows today’s habit tasks, completed habits, and streaks
- `/task add` creates a Todoist task with explicit structured fields
- `/task done` completes a recently seen task by exact title
- `/event add` opens a guided Google Calendar event creation flow
- `/event edit` opens a guided editor for a recent one-off Google Calendar event
- `/event delete` deletes a recent one-off Google Calendar event

## Inbox capture

`INBOX_CHANNEL_ID` is the default capture surface:

- every non-bot message in `#inbox` is sent to Todoist quick add as a new task
- successful captures get a checkmark reaction
- the bot replies only when capture fails

## Logging

Beanbot now supports separate runtime log thresholds for console and Discord:

- `LOG_LEVEL` controls what is written in the local bot process
- `DISCORD_LOG_LEVEL` controls what is mirrored into `#logs`
- `LOGS_CHANNEL_ID` enables the Discord log sink
- `debug` includes action-lifecycle detail for commands, inbox capture, schedulers, and reminders
- `info` is the recommended production console default
- Discord logs are sanitized summaries, so raw inbox text and secret values are not posted there

## Daily digest

The bot now keeps one live status message per local day in the configured `TODAY_CHANNEL_ID` channel:

- created or refreshed on startup
- refreshed every day at 8:00 AM in `BOT_TIMEZONE`
- polled every 5 minutes to catch external Todoist changes
- updated immediately after bot-driven task and event changes
- pinned for the current day, with older daily status messages left in channel history

The bot also keeps one live current-period message in `WEEK_CHANNEL_ID` and `MONTH_CHANNEL_ID`:

- `#week` tracks the current Monday-Sunday week and includes completed tasks for the week
- `#month` tracks the current calendar month as an active planning view
- both are created on startup, refreshed every 5 minutes, and updated immediately after bot-driven task and event changes

The bot also keeps one live daily habit message in `HABITS_CHANNEL_ID`:

- tasks labeled `habit` are excluded from `/today`, `/week`, `/month`, and `#upcoming`
- `#habits` shows overdue habits, habits left today, completed habits today, and streak counts from local bot-observed history
- the message is created on startup, refreshed every 5 minutes, and updated immediately after bot-driven task changes

The bot also keeps one rolling message in `UPCOMING_CHANNEL_ID`:

- task-only view for the next 14 days
- grouped by day
- no message history; the same message is edited in place
- refreshed every 5 minutes and immediately after bot-driven task changes

## Reminders

The bot now scans every minute and posts reminders into `REMINDERS_CHANNEL_ID`:

- overdue tasks once per local day at 9:00 AM after they become overdue
- timed Todoist tasks 1 hour before the due time
- one-off Google Calendar events 30 minutes before the start time

## OAuth connect endpoints

After the bot is running locally, open these in your browser:

- Todoist: `/auth/todoist/start`
- Google Calendar: `/auth/google/start`

If Google Calendar was already connected before phase 3, reconnect it so the bot receives write scope for event mutations.
