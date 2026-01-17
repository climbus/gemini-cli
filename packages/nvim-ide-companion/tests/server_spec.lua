local assert = require("luassert")
local stub = require("luassert.stub")

describe("gemini.server", function()
  local server = require("gemini.server")

  before_each(function()
    stub(vim.fn, "jobstart").returns(123)
    stub(vim.fn, "jobstop")
    stub(vim.fn, "filereadable").returns(1)
    stub(vim.fn, "serverstart").returns("/tmp/nvim.sock")
    -- Reset state
    server.job_id = nil 
  end)

  after_each(function()
    if server.job_id then server.stop() end
    vim.fn.jobstart:revert()
    vim.fn.jobstop:revert()
    vim.fn.filereadable:revert()
    vim.fn.serverstart:revert()
  end)

  it("starts the server", function()
    server.start({ debug = true })
    assert.stub(vim.fn.jobstart).was_called()
    assert.equals(123, server.job_id)
  end)

  it("stops the server", function()
    server.start({ debug = false })
    server.stop()
    assert.stub(vim.fn.jobstop).was_called_with(123)
    assert.is_nil(server.job_id)
  end)

  it("does not start if already running", function()
    server.start({ debug = false })
    server.start({ debug = false })
    -- Should only be called once
    assert.stub(vim.fn.jobstart).was_called(1)
  end)
end)
