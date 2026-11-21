if vim.g.loaded_vimcoach then
  return
end
vim.g.loaded_vimcoach = true

require("vimcoach.commands").register()

local function auto_setup()
  vim.schedule(function()
    local vimcoach = require("vimcoach")
    if not vimcoach._is_setup() then
      vimcoach.setup()
    end
  end)
end

if vim.v.vim_did_enter == 1 then
  auto_setup()
else
  vim.api.nvim_create_autocmd("VimEnter", {
    once = true,
    callback = auto_setup,
  })
end
