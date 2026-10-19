---
name: home-assistant
description: Interact with a Home Assistant OS instance over SSH — run the `ha` CLI, read entity states and recorder history, inspect app (add-on) logs, and diagnose or edit automations, AppDaemon apps and YAML config. Use when the user mentions Home Assistant, HA, hass, automations, AppDaemon, add-ons, entities, presence/person tracking, or smart-home lights and sensors.
---

# home-assistant

## First step: load the user's setup

Read `~/.config/home-assistant/SETUP.md`. It is private (never commit it) and holds the SSH target (`ssh: user@host`), hardware, apps, integrations, people/presence, AppDaemon apps, key entity IDs and known issues.

If it doesn't exist, ask for the host and SSH user, then offer to create it with the same sections. Update it whenever you learn something durable (entity renamed, device replaced, issue fixed).

## Access

- Connect with `ssh -o BatchMode=yes <target>`. The SSH user lands in the SSH app's container, not the host OS.
- The `ha` CLI and `$SUPERVISOR_TOKEN` only work in a **login shell**: wrap in `bash -lc "…"`. One-shot commands and `sudo` give `unauthorized: missing or invalid API token`.
- `/config` (a symlink — use `/config/` with `find`) and `/addon_configs` are root-owned: edit with `sudo -n`.
- The remote may use busybox tools; `grep --exclude-dir` is silently ignored there.

## Helper script

`scripts/ha.sh` (next to this file) reads the target from `$HA_SSH` or `SETUP.md`:

```bash
H=~/.claude/skills/home-assistant/scripts/ha.sh
$H cli core info                     # any `ha` CLI command (apps, os, backups, …)
$H state person.someone              # current state + attributes (REST API, jq)
$H history light.x sensor.y 2        # state changes over N days (default 3), recorder read-only
$H logs <app_slug> 'regex'           # app logs, filtered
$H grep 'light\.hall'                # search config; skips secrets, .storage, DBs, logs
$H run 'ls /addon_configs'           # anything else, in a login shell
```

`history` reports entities with no recorded state at all — the quickest way to spot a dead or renamed entity.

## Diagnosing "automation stopped working"

1. **Find it**: `$H grep '<name or entity>'` — it may live in `automations.yaml`, an AppDaemon app (`/addon_configs/*appdaemon/apps/`), Node-RED (`/config/node-red/flows.json`) or a blueprint.
2. **Did it fire?** Check traces in the UI for YAML automations, or `$H logs <appdaemon_slug> <app_name>`.
3. **Trigger entity**: `$H state` / `$H history` it. For presence, check the `person.*` entity's `device_trackers` attribute — after a phone change, old trackers linger.
4. **Target entity**: `$H history <target> 7` — "never" means a dead entity (often a re-paired device with a `_2` suffix). Find the replacement by grepping other automations that control the same device.
5. Grep for *all* references to the dead ID before fixing — other automations, templates and notify services usually share the same stale device.

## Making changes

- Back up first: `sudo -n cp -p file file.bak`.
- Prefer `sed -i` / small targeted edits via `sudo -n`; show the `diff` afterwards.
- AppDaemon reloads `apps.yaml` and app modules on save — confirm in its log.
- YAML automations/scripts: after editing, `ha core check` then reload via the UI or `ha core restart` (confirm restarts with the user first).
- `/config/.storage/*` is UI-managed (people, entity registry, config entries): read only. Point the user to the UI for changes.

## Safety

- Never print, copy or commit `secrets.yaml`, `.storage/auth*`, `.storage/core.config_entries`, tokens, or `$SUPERVISOR_TOKEN`. Don't `env`/`grep` for tokens — just use `$SUPERVISOR_TOKEN` inside the remote shell.
- Open the recorder DB read-only (`file:…?mode=ro` URI); never write to it.
- Before Core/OS/app updates: confirm with the user, run `ha backups new`, and flag major version jumps.
- Keep home-specific details (IPs, names, entity IDs, alarm logic, coordinates) out of anything public — they belong in `SETUP.md`.
