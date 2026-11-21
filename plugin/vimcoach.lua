if vim.g.loaded_vimcoach then
  return
end
vim.g.loaded_vimcoach = true

require("vimcoach.commands").register()
