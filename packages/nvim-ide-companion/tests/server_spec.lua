local assert = require("luassert")
local stub = require("luassert.stub")

describe("gemini.server", function()
  local server = require("gemini.server")
  local jobstart_stub, jobstop_stub, filereadable_stub, serverstart_stub

  before_each(function()
    jobstart_stub = stub(vim.fn, "jobstart").returns(123)
    jobstop_stub = stub(vim.fn, "jobstop")
    filereadable_stub = stub(vim.fn, "filereadable").returns(1)
    serverstart_stub = stub(vim.fn, "serverstart").returns("/tmp/nvim.sock")
    -- Reset state
    server.job_id = nil
  end)

  after_each(function()
    if server.job_id then
      server.stop()
    end
    jobstart_stub:revert()
    jobstop_stub:revert()
    filereadable_stub:revert()
    serverstart_stub:revert()
  end)

  it("starts the server", function()
    server.start({ debug = true })
    assert.stub(jobstart_stub).was_called()
    assert.equals(123, server.job_id)
  end)

  it("stops the server", function()
    server.start({ debug = false })
    server.stop()
    assert.stub(jobstop_stub).was_called_with(123)
    assert.is_nil(server.job_id)
  end)

  it("does not start if already running", function()
    server.start({ debug = false })
    server.start({ debug = false })
    -- Should only be called once
    assert.stub(jobstart_stub).was_called(1)
  end)
end)
