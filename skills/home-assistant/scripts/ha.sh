#!/usr/bin/env bash
# Helper for working with a Home Assistant OS host over SSH.
#
# Target comes from $HA_SSH, or the "ssh:" line in ~/.config/home-assistant/SETUP.md.
#
# Usage:
#   ha.sh cli <args...>                 Run the `ha` CLI (in a login shell, so it has its token)
#   ha.sh state <entity_id>             Current state + attributes via the Core REST API
#   ha.sh history <entity_id...> [days] State changes from the recorder DB (read-only), default 3 days
#   ha.sh logs <app_slug> [regex]       App logs, optionally filtered
#   ha.sh grep <regex>                  Search config files, skipping secrets, auth storage and DBs
#   ha.sh run <command>                 Run an arbitrary command in a remote login shell
set -euo pipefail

setup_file="$HOME/.config/home-assistant/SETUP.md"
target="${HA_SSH:-}"
if [[ -z "$target" && -f "$setup_file" ]]; then
  target=$(sed -nE 's/^[-* ]*`?ssh:`?[[:space:]]*`?([^`[:space:]]+)`?.*/\1/p' "$setup_file" | head -1)
fi
if [[ -z "$target" ]]; then
  echo "No target: set HA_SSH=user@host or add an 'ssh: user@host' line to $setup_file" >&2
  exit 1
fi

# ssh joins its args into one string for the remote shell, so quote each one
remote() {
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$target" "$(printf '%q ' "$@")"
}

cmd="${1:-}"
shift || true

case "$cmd" in
  cli)
    remote bash -l -s -- "$@" <<'EOF'
ha "$@"
EOF
    ;;
  state)
    [[ $# -eq 1 ]] || { echo "usage: ha.sh state <entity_id>" >&2; exit 1; }
    remote bash -l -s -- "$1" <<'EOF'
curl -sf -H "Authorization: Bearer $SUPERVISOR_TOKEN" "http://supervisor/core/api/states/$1" | jq . \
  || echo "Entity $1 not found (or API unreachable)" >&2
EOF
    ;;
  history)
    [[ $# -ge 1 ]] || { echo "usage: ha.sh history <entity_id...> [days]" >&2; exit 1; }
    days=3
    if [[ "${!#}" =~ ^[0-9]+$ ]]; then
      days="${!#}"
      set -- "${@:1:$#-1}"
    fi
    remote python3 - "$days" "$@" <<'EOF'
import sqlite3, sys
days, ids = sys.argv[1], sys.argv[2:]
db = sqlite3.connect("file:/config/home-assistant_v2.db?mode=ro", uri=True)
marks = ",".join("?" * len(ids))
rows = db.execute(
    f"""select m.entity_id, s.state, datetime(s.last_updated_ts, 'unixepoch', 'localtime')
        from states s join states_meta m on s.metadata_id = m.metadata_id
        where m.entity_id in ({marks}) and s.last_updated_ts > strftime('%s', 'now', ?)
        order by s.last_updated_ts""",
    (*ids, f"-{days} days"),
)
prev, seen = {}, set()
for entity, state, ts in rows:
    seen.add(entity)
    if prev.get(entity) != state:
        print(ts, entity, state)
        prev[entity] = state
for entity in ids:
    if entity in seen:
        continue
    last = db.execute(
        """select s.state, datetime(s.last_updated_ts, 'unixepoch', 'localtime')
           from states s join states_meta m on s.metadata_id = m.metadata_id
           where m.entity_id = ? order by s.last_updated_ts desc limit 1""",
        (entity,),
    ).fetchone()
    print(f"{entity}: no changes in {days} days; last recorded: {last or 'never (entity may be dead or renamed)'}")
EOF
    ;;
  logs)
    [[ $# -ge 1 ]] || { echo "usage: ha.sh logs <app_slug> [regex]" >&2; exit 1; }
    remote bash -l -s -- "$1" "${2:-.}" <<'EOF'
{ ha apps logs "$1" 2>/dev/null || ha addons logs "$1"; } | grep -E -- "$2"
EOF
    ;;
  grep)
    [[ $# -eq 1 ]] || { echo "usage: ha.sh grep <regex>" >&2; exit 1; }
    remote bash -s -- "$1" <<'EOF'
# The remote grep may be busybox, which ignores --exclude-dir, so prune with find.
# .storage is skipped entirely: config entries there can hold integration credentials.
find /config/ /addon_configs/ \
  \( -name .storage -o -name node_modules -o -name .git -o -name deps -o -name __pycache__ \) -prune -o \
  -type f ! -name 'secrets.yaml' ! -name '*.db*' ! -name '*.log*' ! -name '*.pem' ! -name '*.key' -print0 2>/dev/null \
  | xargs -0 grep -InE -- "$1" 2>/dev/null \
  | cut -c1-300
EOF
    ;;
  run)
    [[ $# -ge 1 ]] || { echo "usage: ha.sh run <command>" >&2; exit 1; }
    remote bash -l -s <<<"$*"
    ;;
  *)
    sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
