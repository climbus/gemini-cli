-- Buffer tracking and autocmds

local M = {}

local function get_channel()
  local server = require('gemini.server')
  return server.get_channel_id()
end

local function safe_notify(channel, event, data)
  if not channel then
    return false
  end

  local ok = pcall(vim.rpcnotify, channel, event, data)
  return ok
end

local function notify_buffer_enter()
  local channel = get_channel()
  if not channel then return end

  local bufnr = vim.api.nvim_get_current_buf()
  local path = vim.api.nvim_buf_get_name(bufnr)

  -- Only track real files
  if path == '' or not vim.startswith(path, '/') then
    return
  end

  safe_notify(channel, 'gemini:buffer_enter', {
    path = path,
    bufnr = bufnr,
  })
end

local function notify_cursor_moved()
  local channel = get_channel()
  if not channel then return end

  local bufnr = vim.api.nvim_get_current_buf()
  local path = vim.api.nvim_buf_get_name(bufnr)

  if path == '' or not vim.startswith(path, '/') then
    return
  end

  local pos = vim.api.nvim_win_get_cursor(0)
  safe_notify(channel, 'gemini:cursor_moved', {
    line = pos[1],       -- Already 1-based
    col = pos[2] + 1,    -- Convert from 0-based to 1-based
  })
end

local function notify_visual_changed()
  local channel = get_channel()
  if not channel then return end

  local mode = vim.fn.mode()
  if mode ~= 'v' and mode ~= 'V' and mode ~= '\22' then  -- \22 is <C-V>
    return
  end

  -- Get visual selection
  local start_pos = vim.fn.getpos("'<")
  local end_pos = vim.fn.getpos("'>")

  local start_line = start_pos[2]
  local end_line = end_pos[2]

  local lines = vim.api.nvim_buf_get_lines(0, start_line - 1, end_line, false)
  local selectedText = table.concat(lines, '\n')

  safe_notify(channel, 'gemini:visual_changed', {
    selectedText = selectedText,
  })
end

local function notify_buffer_closed(bufnr)
  local channel = get_channel()
  if not channel then return end

  local path = vim.api.nvim_buf_get_name(bufnr)

  if path == '' or not vim.startswith(path, '/') then
    return
  end

  safe_notify(channel, 'gemini:buffer_closed', {
    path = path,
  })
end

function M.setup()
  local group = vim.api.nvim_create_augroup('GeminiIDECompanion', { clear = true })

  -- Notify about currently open buffers after a short delay
  -- This ensures the Node.js server has time to start and subscribe
  vim.defer_fn(function()
    local channel = get_channel()
    if not channel then return end

    local current_bufs = vim.api.nvim_list_bufs()
    for _, bufnr in ipairs(current_bufs) do
      if vim.api.nvim_buf_is_loaded(bufnr) then
        local path = vim.api.nvim_buf_get_name(bufnr)
        if path ~= '' and vim.startswith(path, '/') then
          safe_notify(channel, 'gemini:buffer_enter', {
            path = path,
            bufnr = bufnr,
          })
        end
      end
    end

    -- Notify about current cursor position
    notify_cursor_moved()
  end, 500)  -- 500ms delay

  vim.api.nvim_create_autocmd('BufEnter', {
    group = group,
    callback = notify_buffer_enter,
  })

  vim.api.nvim_create_autocmd('CursorMoved', {
    group = group,
    callback = notify_cursor_moved,
  })

  vim.api.nvim_create_autocmd('CursorMovedI', {
    group = group,
    callback = notify_cursor_moved,
  })

  -- Visual mode selection tracking is tricky - use timer
  local visual_timer = vim.loop.new_timer()
  visual_timer:start(500, 500, vim.schedule_wrap(function()
    if vim.fn.mode():match('[vV\22]') then
      notify_visual_changed()
    end
  end))

  vim.api.nvim_create_autocmd('BufDelete', {
    group = group,
    callback = function(args)
      notify_buffer_closed(args.buf)
    end,
  })
end

return M
