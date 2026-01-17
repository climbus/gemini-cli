-- Gemini IDE Companion for Neovim
-- Main plugin entry point

local M = {}

M.config = {
  debug = false,
  auto_start = true,
}

function M.setup(opts)
  opts = opts or {}
  M.config = vim.tbl_deep_extend('force', M.config, opts)

  -- Ensure server stops on Neovim exit
  vim.api.nvim_create_autocmd('VimLeavePre', {
    callback = function()
      M.stop()
    end,
  })

  if M.config.auto_start then
    M.start()
  end

  -- Register commands
  vim.api.nvim_create_user_command('GeminiStart', M.start, {})
  vim.api.nvim_create_user_command('GeminiStop', M.stop, {})
  vim.api.nvim_create_user_command('GeminiStatus', M.status, {})
end

function M.start()
  require('gemini.server').start(M.config)
  require('gemini.buffers').setup()
  require('gemini.diff').setup()
end

function M.stop()
  require('gemini.server').stop()
end

function M.status()
  require('gemini.server').status()
end

return M
