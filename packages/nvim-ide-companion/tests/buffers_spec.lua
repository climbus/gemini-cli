local assert = require("luassert")
local stub = require("luassert.stub")

describe("gemini.buffers", function()
  local buffers = require("gemini.buffers")

  before_each(function()
    stub(vim, "rpcnotify")
  end)

  after_each(function()
    vim.rpcnotify:revert()
  end)

  it("notifies on buffer enter", function()
    buffers.setup()

    local buf = vim.api.nvim_create_buf(true, false)
    local filename = "/tmp/test_buffer_enter.txt"
    vim.api.nvim_buf_set_name(buf, filename)
    vim.api.nvim_set_current_buf(buf)

    vim.cmd("doautocmd BufEnter")

    assert.stub(vim.rpcnotify).was_called_with(0, "gemini:buffer_enter", {
      path = filename,
      bufnr = buf,
    })
  end)

  it("notifies on cursor move", function()
     -- Clear previous autocmds to avoid duplicates if setup is called multiple times
     vim.api.nvim_clear_autocmds({ group = "GeminiIDECompanion" })
     buffers.setup()

     local buf = vim.api.nvim_create_buf(true, false)
     local filename = "/tmp/test_cursor.txt"
     vim.api.nvim_buf_set_name(buf, filename)
     vim.api.nvim_set_current_buf(buf)

     -- Ensure we are on a valid line
     vim.api.nvim_buf_set_lines(buf, 0, -1, false, {"line1", "line2"})
     vim.api.nvim_win_set_cursor(0, {2, 0})
     
     vim.cmd("doautocmd CursorMoved")

     assert.stub(vim.rpcnotify).was_called_with(0, "gemini:cursor_moved", {
       line = 2,
       col = 1,
     })
  end)

  it("notifies on buffer closed", function()
     vim.api.nvim_clear_autocmds({ group = "GeminiIDECompanion" })
     buffers.setup()

     local buf = vim.api.nvim_create_buf(true, false)
     local filename = "/tmp/test_closed.txt"
     vim.api.nvim_buf_set_name(buf, filename)
     vim.api.nvim_set_current_buf(buf)

     vim.cmd("doautocmd BufDelete")

     assert.stub(vim.rpcnotify).was_called_with(0, "gemini:buffer_closed", {
       path = filename,
     })
  end)
end)
