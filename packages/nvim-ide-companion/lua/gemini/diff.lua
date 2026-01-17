-- Diff UI management

local M = {}

local active_diffs = {}

local function create_scratch_buffer(filePath, newContent)
  local scratch_buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_set_option_value("buftype", "nofile", { buf = scratch_buf })
  vim.api.nvim_set_option_value("bufhidden", "wipe", { buf = scratch_buf })
  vim.api.nvim_buf_set_name(scratch_buf, "gemini-diff://" .. filePath)

  local lines = vim.split(newContent, "\n", { plain = true })
  vim.api.nvim_buf_set_lines(scratch_buf, 0, -1, false, lines)
  return scratch_buf
end

local function prepare_original_buffer(filePath)
  if vim.fn.filereadable(filePath) == 1 then
    local buftype = vim.api.nvim_get_option_value("buftype", { buf = 0 })
    if buftype ~= "" then
      vim.cmd("vsplit " .. vim.fn.fnameescape(filePath))
    else
      vim.cmd("edit " .. vim.fn.fnameescape(filePath))
    end
    return vim.api.nvim_get_current_buf()
  else
    local original_buf = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_buf_set_name(original_buf, filePath)
    return original_buf
  end
end

local function create_diff_window(scratch_buf)
  vim.cmd("vsplit")
  local scratch_win = vim.api.nvim_get_current_win()
  vim.api.nvim_win_set_buf(scratch_win, scratch_buf)

  vim.cmd("wincmd p")
  local original_win = vim.api.nvim_get_current_win()

  vim.api.nvim_win_call(original_win, function()
    vim.cmd("diffthis")
  end)
  vim.api.nvim_win_call(scratch_win, function()
    vim.cmd("diffthis")
  end)

  return original_win, scratch_win
end

local function setup_diff_keymaps(scratch_buf, filePath)
  local opts = { buffer = scratch_buf, noremap = true, silent = true }
  vim.keymap.set("n", "<leader>ga", function()
    M.accept_diff(filePath)
  end, vim.tbl_extend("force", opts, { desc = "Gemini: Accept diff" }))

  vim.keymap.set("n", "<leader>gr", function()
    M.reject_diff(filePath)
  end, vim.tbl_extend("force", opts, { desc = "Gemini: Reject diff" }))
end

local function cleanup_diff_entry(diff, filePath)
  -- Close windows
  if vim.api.nvim_win_is_valid(diff.scratch_win) then
    vim.api.nvim_win_close(diff.scratch_win, true)
  end

  -- Clean up
  active_diffs[filePath] = nil
end

local function get_scratch_content(bufnr)
  local lines = vim.api.nvim_buf_get_lines(bufnr, 0, -1, false)
  return table.concat(lines, "\n")
end

function _G.GeminiShowDiff(filePath, newContent)
  if active_diffs[filePath] then
    print("Diff already open for: " .. filePath)
    return
  end

  local scratch_buf = create_scratch_buffer(filePath, newContent)
  local original_buf = prepare_original_buffer(filePath)
  local original_win, scratch_win = create_diff_window(scratch_buf)

  active_diffs[filePath] = {
    original_bufnr = original_buf,
    scratch_bufnr = scratch_buf,
    original_win = original_win,
    scratch_win = scratch_win,
  }

  setup_diff_keymaps(scratch_buf, filePath)

  print("Diff view opened. <leader>ga to accept, <leader>gr to reject")
end

function _G.GeminiCloseDiff(filePath)
  local diff = active_diffs[filePath]
  if not diff then
    return nil
  end

  local content = get_scratch_content(diff.scratch_bufnr)

  cleanup_diff_entry(diff, filePath)

  return content
end

function M.accept_diff(filePath)
  local diff = active_diffs[filePath]
  if not diff then
    return
  end

  local content = get_scratch_content(diff.scratch_bufnr)

  -- Notify TypeScript server
  vim.rpcnotify(0, "gemini:diff_accepted", {
    filePath = filePath,
    content = content,
  })

  -- Close diff
  M.close_diff(filePath)
end

function M.reject_diff(filePath)
  -- Notify TypeScript server
  vim.rpcnotify(0, "gemini:diff_rejected", {
    filePath = filePath,
  })

  -- Close diff
  M.close_diff(filePath)
end

function M.close_diff(filePath)
  local diff = active_diffs[filePath]
  if not diff then
    return
  end

  -- Disable diff mode
  if vim.api.nvim_win_is_valid(diff.original_win) then
    vim.api.nvim_win_call(diff.original_win, function()
      vim.cmd("diffoff")
    end)
  end

  if vim.api.nvim_win_is_valid(diff.scratch_win) then
    vim.api.nvim_win_call(diff.scratch_win, function()
      vim.cmd("diffoff")
    end)
    vim.api.nvim_win_close(diff.scratch_win, true)
  end

  active_diffs[filePath] = nil

  -- Reload original file
  vim.cmd("edit " .. vim.fn.fnameescape(filePath))
end

function M.setup()
  -- Create commands
  vim.api.nvim_create_user_command("GeminiDiffAccept", function()
    local bufname = vim.api.nvim_buf_get_name(0)
    local filePath = bufname:match("gemini%-diff://(.+)")
    if filePath then
      M.accept_diff(filePath)
    else
      print("Not in a Gemini diff buffer")
    end
  end, {})

  vim.api.nvim_create_user_command("GeminiDiffReject", function()
    local bufname = vim.api.nvim_buf_get_name(0)
    local filePath = bufname:match("gemini%-diff://(.+)")
    if filePath then
      M.reject_diff(filePath)
    else
      print("Not in a Gemini diff buffer")
    end
  end, {})
end

return M
