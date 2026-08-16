#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_URL="https://github.com/dlpwaters/meditations.git"
INSTALL_DIR="${MEDITATIONS_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/meditations}"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"

for command_name in git node npm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Meditations requires %s. Install it and run this command again.\n' "$command_name" >&2
    exit 1
  fi
done

if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" pull --ff-only
elif [[ -e "$INSTALL_DIR" ]]; then
  printf 'Install location already exists and is not a Git repository: %s\n' "$INSTALL_DIR" >&2
  exit 1
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPOSITORY_URL" "$INSTALL_DIR"
fi

npm ci --omit=dev --prefix "$INSTALL_DIR"
mkdir -p "$BIN_DIR"
ln -sfn "$INSTALL_DIR/bin/meditations" "$BIN_DIR/meditations"

printf '\nMeditations installed at %s\n' "$INSTALL_DIR"
printf 'Run it with: meditations\n'
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  printf 'Add %s to PATH if the command is not found.\n' "$BIN_DIR"
fi
