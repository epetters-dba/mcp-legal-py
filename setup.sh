#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INDEX_JS="$DIR/src/index.js"

echo "==> Instalando dependencias..."
(cd "$DIR" && npm install)

if [[ "$OSTYPE" == "darwin"* ]]; then
  CONFIG_DIR="$HOME/Library/Application Support/Claude"
else
  CONFIG_DIR="$HOME/.config/Claude"
fi
CONFIG_FILE="$CONFIG_DIR/claude_desktop_config.json"

mkdir -p "$CONFIG_DIR"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "{\"mcpServers\": {}}" > "$CONFIG_FILE"
fi

echo "==> Registrando mcp-legal-py en $CONFIG_FILE"
node -e "
const fs = require('fs');
const path = '$CONFIG_FILE';
const config = JSON.parse(fs.readFileSync(path, 'utf8'));
config.mcpServers = config.mcpServers || {};
config.mcpServers['mcp-legal-py'] = { command: 'node', args: ['$INDEX_JS'] };
fs.writeFileSync(path, JSON.stringify(config, null, 2));
"

echo "==> Listo. Reiniciá Claude Desktop por completo (salir desde la bandeja del sistema, no solo cerrar la ventana)."
