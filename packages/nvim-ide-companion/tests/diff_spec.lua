local assert = require("luassert")
local stub = require("luassert.stub")

describe("gemini.diff", function()
  local diff = require("gemini.diff")
  diff.setup()

  before_each(function()
    stub(vim, "rpcnotify")
  end)

  after_each(function()
    vim.rpcnotify:revert()
    vim.cmd("tabonly!") -- Close all other windows
  end)

  it("opens diff view", function()
    local filename = "/tmp/test_diff.txt"
    -- Create dummy file
    local f = io.open(filename, "w")
    f:write("original content")
    f:close()

    _G.GeminiShowDiff(filename, "new content")

    -- Check for windows
    local wins = vim.api.nvim_tabpage_list_wins(0)
    assert.is_true(#wins >= 2, "Should have at least 2 windows")

    -- Check scratch buffer content
    local found = false
    for _, win in ipairs(wins) do
      local buf = vim.api.nvim_win_get_buf(win)
      local name = vim.api.nvim_buf_get_name(buf)
      if name:match("gemini%-diff://") then
        local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
        if lines[1] == "new content" then
          found = true
        end
      end
    end
    assert.is_true(found, "Scratch buffer with new content not found")
  end)

  it("accepts diff", function()
     local filename = "/tmp/test_diff_accept.txt"
     local f = io.open(filename, "w")
     f:write("original")
     f:close()

     _G.GeminiShowDiff(filename, "new")
     
     -- Simulate accept
     diff.accept_diff(filename)

     assert.stub(vim.rpcnotify).was_called_with(0, "gemini:diff_accepted", {
       filePath = filename,
       content = "new"
     })
  end)

  it("rejects diff", function()
     local filename = "/tmp/test_diff_reject.txt"
     local f = io.open(filename, "w")
     f:write("original")
     f:close()

     _G.GeminiShowDiff(filename, "new")
     
     -- Simulate reject
     diff.reject_diff(filename)

     assert.stub(vim.rpcnotify).was_called_with(0, "gemini:diff_rejected", {
       filePath = filename,
     })
  end)
end)
