#!/bin/bash
# Neovim IDE Companion Installation Script
#
# This script automates the setup of the Gemini Neovim extension.
# It performs the following steps:
# 1. Installs necessary npm dependencies.
# 2. Builds the project (transpiles TypeScript to JavaScript).
# 3. Identifies the Neovim data directory (respecting XDG_DATA_HOME).
# 4. Installs the 'dist' and 'lua' directories into the Neovim data path.
# 5. Provides configuration snippets for manual installation or lazy.nvim.
set -e

echo "Building Neovim IDE Companion..."
npm install
npm run build

echo "Installing to Neovim data directory..."
NVIM_DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/nvim"
TARGET_DIR="$NVIM_DATA_DIR/gemini-nvim"

mkdir -p "$TARGET_DIR"
cp -r dist "$TARGET_DIR/"
cp -r lua "$TARGET_DIR/"

echo "Installation complete!"
echo ""
echo "Add to your Neovim config (~/.config/nvim/init.lua):"
echo "  require('gemini').setup()"
echo ""
echo "Or for lazy.nvim:"
echo "  {"
echo "    dir = \"$TARGET_DIR\","
echo "    config = function()"
echo "      require('gemini').setup()"
echo "    end,"
echo "  }"
