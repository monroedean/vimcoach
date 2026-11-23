local config = require("vimcoach.config")
local strict = require("vimcoach.strict")

return function(t)
  t.test("strict.disable restores Lua callback keymaps", function()
    local prev_mode = config.options.mode
    local cb = function() return "j" end
    vim.keymap.set("n", "j", cb, { expr = true, silent = true, desc = "custom j" })

    config.options.mode = "strict"
    strict.enable()
    strict.disable()

    local restored = vim.fn.maparg("j", "n", false, true)
    pcall(vim.keymap.del, "n", "j")
    config.options.mode = prev_mode

    t.ok(restored ~= nil and restored.callback == cb, "expected original Lua callback to be restored")
  end)
end
