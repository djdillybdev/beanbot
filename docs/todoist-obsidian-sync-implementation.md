# Todoist to Obsidian Sync Implementation

## Summary

The Obsidian sync lives inside `beanbot` as a separate sidecar process. It reuses the existing Bun, TypeScript, SQLite, Drizzle, Todoist OAuth, and logging foundation, while keeping Discord bot behavior independent.

The current implementation covers Milestone 3:

- Todoist task state imports through the Todoist `/sync` endpoint for incremental updates
- normalized sync state stored in SQLite
- one task note exported to a stable Todoist-ID Markdown filename inside the configured tasks folder
- deterministic YAML frontmatter and atomic note writes
- note index and sync event tracking for later reconciliation work
- local note edits are detected before export and marked `pending_push` instead of being overwritten
- supported pending changes are pushed back to Todoist and normalized back into exported notes
- new untracked notes in the tasks folder are created in Todoist and brought under sync management
- deleting a tracked note locally deletes it in Todoist and tombstones it in SQLite
- remote Todoist completion and uncompletion are synced back into tracked Obsidian notes

## Public Interfaces

### Environment

- `OBSIDIAN_VAULT_PATH`: absolute or relative path to the target vault
- `OBSIDIAN_TASKS_PATH`: folder inside the vault where task notes should be written
- `OBSIDIAN_SYNC_POLL_INTERVAL_SECONDS`: poll interval for the sync sidecar

### Runtime

- `bun run sync:obsidian`: starts the Obsidian sync sidecar

### Note Contract

Each Todoist task exports to:

- `<OBSIDIAN_TASKS_PATH>/<todoist-id>.md`

Frontmatter fields:

- `todoist_id`
- `title`
- `aliases`
- `completed`
- `priority_api`
- `project`
- `effort`
- `labels`
- `due_date`
- `due_datetime`
- `recurring`
- `parent_id`
- `order_index`
- `todoist_project_id`
- `todoist_project_name`
- `section_id`
- `section_name`
- `todoist_url`
- `created_at`
- `updated_at`
- `last_synced_at`
- `sync_status`
- `source_of_last_change`
- `content_hash`

The note body is preserved during export and remains local-only.

## Implementation Notes

- `obsidian_task` is the canonical local sync table for exported task state.
- the Obsidian sync subsystem now uses Todoist `/sync` incremental tokens instead of active-task REST polling for inbound task state.
- `obsidian_task_label` stores non-project Todoist labels.
- `effort` is derived from the first Todoist label matching `quick`, `easy`, `flow`, or `personal`.
- `project` is derived from the first Todoist label matching `proj:<slug>`.
- `labels` excludes the `proj:<slug>` label and reserved `effort` labels to avoid duplication in Obsidian.
- `obsidian_note_index` tracks the last exported file hash and path.
- filenames are engine-owned stable identities; `title` is the editable task name.
- local note renames are repaired back to the canonical Todoist-ID path on export.
- `obsidian_sync_event` logs sync successes and failures for debugging.
- tracked-note disappearance becomes `pending_delete`, then a Todoist delete, then a tombstoned local DB row.
- remote `checked=true` tasks are stored as completed local tasks rather than disappearing from the export model.
- changed note frontmatter is parsed for `title`, `completed`, `priority_api`, `project`, `effort`, `labels`, `due_date`, and `due_datetime`.
- local edits are stored in SQLite as `pending_push`, then pushed to Todoist on the next sync pass.
- `project` is written back by generating a Todoist label in `proj:<slug>` format and merging it with the other labels.
- `effort` is written back as exactly one Todoist label in `quick`, `easy`, `flow`, or `personal`.
- untracked local notes with no `todoist_id` are treated as create candidates when they have valid task frontmatter.
- conflicts and parse/push/delete failures set `sync_status` away from `synced` and are emitted to the logger as warn/error events.

## Test Plan

- run `bun run typecheck`
- run `bun test`
- run `bun run sync:obsidian` with a connected Todoist account and configured vault path
- verify task notes appear in the configured `OBSIDIAN_TASKS_PATH`
- verify note filenames use Todoist IDs rather than task titles
- verify rerunning the sync does not rewrite unchanged notes
- verify editing note body text survives the next export pass
- verify editing a writable frontmatter field marks the task as `pending_push` and leaves the note untouched on the next sync
- verify the following sync pass pushes the change to Todoist and returns the note to `sync_status: "synced"`
- verify manually renaming a note file does not crash sync and is repaired back to the canonical ID path
- verify creating a new note with valid task frontmatter creates a Todoist task and rewrites the note to the returned ID filename
- verify deleting a tracked note deletes the Todoist task, removes the note index, and leaves a deleted tombstone in SQLite
- verify parse/push/delete failures produce both sync events and warn/error logger output
- verify completing a task in Todoist updates the exported note to `completed: true`
- verify uncompleting a task in Todoist updates the exported note back to `completed: false`
