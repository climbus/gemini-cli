local assert = require("luassert")
local stub = require("luassert.stub")

describe("gemini.diff", function()
  local diff = require("gemini.diff")
  local rpcnotify_stub
  diff.setup()

  before_each(function()
    rpcnotify_stub = stub(vim, "rpcnotify")
  end)

  after_each(function()
    rpcnotify_stub:revert()
    vim.cmd("tabonly!")
    vim.cmd("only!")
  end)

  it("opens diff view", function()
    local filename = "/tmp/test_diff.txt"
    -- Create dummy file
    local f, err = io.open(filename, "w")
    if not f then
      assert.fail("Failed to open file: " .. (err or filename))
      return
    end
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
    local f, err = io.open(filename, "w")
    if not f then
      assert.fail("Failed to open file: " .. (err or filename))
      return
    end
    f:write("original")
    f:close()

    _G.GeminiShowDiff(filename, "new")

    -- Simulate accept
    diff.accept_diff(filename)

    assert.stub(rpcnotify_stub).was_called_with(0, "gemini:diff_accepted", {
      filePath = filename,
      content = "new",
    })
  end)

  it("rejects diff", function()
    local filename = "/tmp/test_diff_reject.txt"
    local f, err = io.open(filename, "w")
    if not f then
      assert.fail("Failed to open file: " .. (err or filename))
      return
    end
    f:write("original")
    f:close()

    _G.GeminiShowDiff(filename, "new")

    -- Simulate reject
    diff.reject_diff(filename)

    assert.stub(rpcnotify_stub).was_called_with(0, "gemini:diff_rejected", {
      filePath = filename,
    })
  end)

  it("replaces current buffer with original file when showing diff", function()
    local file1 = "/tmp/file1.txt"
    local file2 = "/tmp/file2.txt"

    -- Create files
    local f1 = io.open(file1, "w")
    if f1 then
      f1:write("content of file 1")
      f1:close()
    end

    local f2 = io.open(file2, "w")
    if f2 then
      f2:write("content of file 2")
      f2:close()
    end

    -- 1. Open file1
    vim.cmd("edit " .. file1)

    -- 2. Call GeminiShowDiff for file2
    _G.GeminiShowDiff(file2, "new content for file 2")

    -- 3. Check what's in the windows
    local wins = vim.api.nvim_tabpage_list_wins(0)

    local left_win = wins[1]
    local left_buf = vim.api.nvim_win_get_buf(left_win)
    local left_name = vim.api.nvim_buf_get_name(left_buf)

    -- Verify file1 is NOT in the diff view and file2 is in the left window
    assert.is_nil(
      string.match(left_name, "file1.txt"),
      "File 1 should NOT be in the diff view"
    )
    assert.is_not_nil(
      string.match(left_name, "file2.txt"),
      "File 2 should be in the left window"
    )
  end)
end)
