#!/bin/sh
set -eu
case "$(node --version)" in
  v24.*) ;;
  *) printf '%s\n' "Lumora MCP requires Node 24 in PATH." >&2; exit 1 ;;
esac
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
node_binary=$(command -v node)
exec env -i \
  LUMORA_MCP_API_URL="${LUMORA_MCP_API_URL:?Set the Lumora API origin}" \
  LUMORA_MCP_WORKSPACE_ID="${LUMORA_MCP_WORKSPACE_ID:?Set the workspace ID}" \
  LUMORA_MCP_TOKEN="${LUMORA_MCP_TOKEN:?Set a temporary MCP key}" \
  "$node_binary" --permission \
  --allow-fs-read="$repo/node_modules" \
  --allow-fs-read="$repo/apps/api/package.json" \
  --allow-fs-read="$repo/packages/contracts/package.json" \
  --allow-fs-read="$repo/packages/contracts/dist" \
  --allow-fs-read="$repo/apps/api/dist/interfaces/mcp" \
  "$repo/apps/api/dist/interfaces/mcp/stdio.js"
