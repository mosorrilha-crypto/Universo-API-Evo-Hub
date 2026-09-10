#!/bin/bash
# Instala o CLI agent-browser (npm i -g agent-browser + agent-browser install)
# nas sessões remotas do Claude Code — o binário/Chrome não fica versionado no
# repo (ver .agents/skills/agent-browser/SKILL.md), então precisa ser
# reinstalado a cada container novo. Só roda remoto; sessões locais (desktop)
# não são tocadas.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if ! command -v agent-browser >/dev/null 2>&1; then
  npm install -g agent-browser
fi

agent-browser install
