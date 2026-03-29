# beanbot

Discord bot for personal task and calendar management.

## Current foundation

This repo now contains the foundation plus the Phase 1 read-only surface:

- Bun + TypeScript runtime
- `discord.js` bot with guild-scoped slash command registration
- Express server with `GET /health`
- Todoist OAuth + read integration
- Google Calendar OAuth + read integration
- Drizzle + SQLite migrations for local config and OAuth token storage
- Automated daily `#today` digest posting at 8:00 AM local time
- Automated `#reminders` delivery for overdue tasks, timed tasks due soon, and upcoming one-off events
- `/ping`, `/help`, `/today`, `/week`, `/month`, `/task add`, and `/task done` slash commands

## Prerequisites

- Bun `>= 1.1.0`
- A Discord application and bot token
- A private Discord guild for command registration

## Environment

Copy `.env.example` to `.env` and fill in:

- `DISCORD_TOKEN`
- `DISCORD_APPLICATION_ID`
- `DISCORD_GUILD_ID`
- `DATABASE_URL`
- `BOT_TIMEZONE`
- `TODAY_CHANNEL_ID`
- `REMINDERS_CHANNEL_ID`
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
- `/task add` creates a Todoist task via quick add
- `/task done` completes a recently seen task by exact title
- `/event add` opens a guided Google Calendar event creation flow
- `/event edit` opens a guided editor for a recent one-off Google Calendar event
- `/event delete` deletes a recent one-off Google Calendar event

## Daily digest

The bot now posts the `/today` digest into the configured `TODAY_CHANNEL_ID` channel:

- once on bot startup for testing
- every day at 8:00 AM in `BOT_TIMEZONE`

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
