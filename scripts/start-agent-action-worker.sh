#!/bin/sh
set -eu
case "$(node --version)" in
  v24.*) ;;
  *) printf '%s\n' "The approved-action worker requires Node 24 in PATH." >&2; exit 1 ;;
esac
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
node_binary=$(command -v node)
exec env -i \
  AGENT_ACTIONS_DATABASE_URL="${AGENT_ACTIONS_DATABASE_URL:?Set the worker database connection}" \
  "$node_binary" --permission \
  --allow-fs-read="$repo/node_modules" \
  --allow-fs-read="$repo/apps/api/package.json" \
  --allow-fs-read="$repo/apps/api/dist" \
  --allow-fs-read="$repo/packages/contracts/package.json" \
  --allow-fs-read="$repo/packages/contracts/dist" \
  "$repo/apps/api/dist/interfaces/cli/agent-action-worker.js" "$@"
