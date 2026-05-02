#!/bin/sh
set -e

REPO="zigbang-smarthome/eac-cli"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64)  ARCH="x64" ;;
  aarch64) ARCH="arm64" ;;
esac

case "$OS-$ARCH" in
  darwin-arm64|darwin-x64|linux-x64|linux-arm64) ;;
  *) echo "Unsupported platform: $OS-$ARCH"; exit 1 ;;
esac

VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | cut -d'"' -f4)
URL="https://github.com/$REPO/releases/download/$VERSION/eac-$OS-$ARCH.tar.gz"

echo "Installing eac $VERSION..."
curl -fsSL "$URL" | tar xz -C "$INSTALL_DIR"
chmod +x "$INSTALL_DIR/eac"
echo "standalone" > "$INSTALL_DIR/.eac-install-method"
echo "Installed to $INSTALL_DIR/eac"
