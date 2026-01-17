# Gemini CLI Neovim IDE Companion

Neovim integration for [Gemini CLI](https://github.com/google/gemini-cli),
enabling AI-assisted development with context awareness and diff previews
directly in your editor.

## Features

- **Context Awareness**: Automatically tracks open files, cursor position, and
  visual selections
- **Diff Previews**: Review AI-suggested changes in a side-by-side diff view
  before applying
- **Seamless Integration**: Works with Gemini CLI's `--ide-mode` for enhanced AI
  assistance
- **Lightweight**: Minimal overhead, runs as a background Node.js process

## Requirements

- Neovim >= 0.9.0
- Node.js >= 20
- Gemini CLI installed and configured

## Installation

### Using lazy.nvim

```lua
{
  dir = "/path/to/gemini-cli/packages/nvim-ide-companion",
  config = function()
    require('gemini').setup({
      debug = false,        -- Enable debug logging
      auto_start = true,    -- Start server automatically
    })
  end,
}
```

### Manual Installation

1. **Build the package:**

   ```bash
   cd packages/nvim-ide-companion
   npm install
   npm run build
   ```

2. **Install to Neovim:**

   ```bash
   ./install.sh
   ```

3. **Configure Neovim** (`~/.config/nvim/init.lua`):

   ```lua
   require('gemini').setup({
     debug = false,
     auto_start = true,
   })

   -- Set NVIM environment variable for terminal buffers (required for CLI detection)
   vim.api.nvim_create_autocmd('TermOpen', {
     callback = function()
       vim.env.NVIM = '1'
     end,
   })
   ```

4. **Configure your shell** to source environment variables: Add to your
   `~/.bashrc` or `~/.zshrc`:
   ```bash
   # Source Gemini CLI IDE environment if available
   if [ -n "$NVIM" ]; then
     NVIM_PID=$(pgrep -P $PPID nvim | head -n 1)
     if [ -n "$NVIM_PID" ]; then
       ENV_SCRIPT="$HOME/.local/share/nvim/site/pack/*/start/gemini-nvim/env-${NVIM_PID}.sh"
       if [ -f "$ENV_SCRIPT" ]; then
         source "$ENV_SCRIPT"
       fi
       # Also check tmp directory
       ENV_SCRIPT="/tmp/gemini/ide/nvim-env-${NVIM_PID}.sh"
       if [ -f "$ENV_SCRIPT" ]; then
         source "$ENV_SCRIPT"
       fi
     fi
   fi
   ```

## Usage

### Starting the Server

The server starts automatically when Neovim launches (if `auto_start = true`).
You can also control it manually:

```vim
:GeminiStart    " Start the IDE companion server
:GeminiStop     " Stop the server
:GeminiStatus   " Check server status
```

### Using with Gemini CLI

Once the server is running, Gemini CLI will automatically detect and connect to
it:

```bash
cd /path/to/your/project
gemini "add a new function to handle user authentication"
```

Gemini CLI will:

1. See which files you have open in Neovim
2. Know your current cursor position and selection
3. Show diffs in Neovim for any file modifications
4. Wait for you to accept or reject changes

### Reviewing Diffs

When Gemini CLI proposes changes to a file, a diff view opens automatically:

- **Left side**: Original file
- **Right side**: Proposed changes (highlighted)

**Keybindings:**

- `<leader>ga` - Accept the diff and apply changes
- `<leader>gr` - Reject the diff and discard changes

You can also use commands:

```vim
:GeminiDiffAccept
:GeminiDiffReject
```

## Configuration

```lua
require('gemini').setup({
  debug = false,          -- Show debug logs in Neovim
  auto_start = true,      -- Start server on Neovim startup
  keymaps = {
    diff_accept = '<leader>ga',   -- Accept diff changes
    diff_reject = '<leader>gr',   -- Reject diff changes
  },
})
```

## How It Works

1. **Server Process**: When Neovim starts, it launches a Node.js server that
   connects back to Neovim via RPC.

2. **Context Tracking**: The Lua plugin monitors buffer changes, cursor
   movement, and visual selections, sending updates to the Node.js server.

3. **MCP Integration**: The Node.js server exposes an MCP (Model Context
   Protocol) interface that Gemini CLI connects to.

4. **Diff Management**: When Gemini CLI requests file modifications, the server
   calls back to Neovim to show diffs via Lua functions.

## Troubleshooting

### Server Not Starting

Check that the built files exist:

```bash
ls ~/.local/share/nvim/gemini-nvim/dist/index.js
```

If missing, rebuild:

```bash
cd packages/nvim-ide-companion
npm run build
./install.sh
```

### Gemini CLI Not Detecting Neovim

1. Check server status: `:GeminiStatus`
2. Verify discovery file exists: `ls ~/.gemini/ide/gemini-ide-server-*`
3. Enable debug mode and check logs:
   ```lua
   require('gemini').setup({ debug = true })
   ```

### Diffs Not Appearing

1. Ensure you're running Gemini CLI with changes that modify files
2. Check for errors in Neovim: `:messages`
3. Verify RPC notifications are working: enable debug mode

## Development

### Building from Source

```bash
# Install dependencies
npm install

# Build (watch mode for development)
npm run watch

# Type checking
npm run typecheck

# Linting
npm run lint
```

### Project Structure

```
nvim-ide-companion/
├── src/
│   ├── index.ts              # Entry point
│   ├── ide-server.ts         # HTTP/MCP server
│   ├── context-manager.ts    # Buffer/cursor tracking
│   ├── diff-manager.ts       # Diff integration
│   └── utils/
│       └── logger.ts         # Logging utility
├── plugin/nvim/lua/gemini/
│   ├── init.lua              # Plugin entry point
│   ├── server.lua            # Server lifecycle
│   ├── buffers.lua           # Buffer tracking autocmds
│   ├── diff.lua              # Diff UI management
│   └── config.lua            # Configuration
└── dist/                     # Built JavaScript (generated)
```

## License

Apache 2.0 - See LICENSE file for details.

## Contributing

This is part of the Gemini CLI project. See the main
[CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

## Related

- [Gemini CLI](https://github.com/google/gemini-cli)
- [VS Code IDE Companion](../vscode-ide-companion)
- [MCP Specification](https://modelcontextprotocol.io/)
