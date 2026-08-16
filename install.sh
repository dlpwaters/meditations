#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="dlpwaters/meditations"
INSTALL_DIR="${MEDITATIONS_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/meditations}"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"

for command_name in gh git node npm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Meditations requires %s. Install it and run this command again.\n' "$command_name" >&2
    exit 1
  fi
done

if ! gh auth status >/dev/null 2>&1; then
  printf 'Sign in first with: gh auth login\n' >&2
  exit 1
fi

if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" pull --ff-only
elif [[ -e "$INSTALL_DIR" ]]; then
  printf 'Install location already exists and is not a Git repository: %s\n' "$INSTALL_DIR" >&2
  exit 1
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  gh repo clone "$REPOSITORY" "$INSTALL_DIR"
fi

npm ci --omit=dev --prefix "$INSTALL_DIR"
mkdir -p "$BIN_DIR"
ln -sfn "$INSTALL_DIR/bin/meditations" "$BIN_DIR/meditations"

printf '\nMeditations installed at %s\n' "$INSTALL_DIR"
printf 'Run it with: meditations\n'
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  printf 'Add %s to PATH if the command is not found.\n' "$BIN_DIR"
fi
