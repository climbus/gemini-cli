local assert = require("luassert")

describe("gemini", function()
  it("can be required", function()
    local gemini = require("gemini")
    assert.truthy(gemini)
  end)

  it("can be configured", function()
    local gemini = require("gemini")
    -- Mock dependencies to avoid side effects during setup
    package.loaded['gemini.server'] = { start = function() end, stop = function() end }
    package.loaded['gemini.buffers'] = { setup = function() end }
    package.loaded['gemini.diff'] = { setup = function() end }

    gemini.setup({
      debug = true,
      auto_start = false
    })

    assert.is_true(gemini.config.debug)
    assert.is_false(gemini.config.auto_start)
  end)
end)
