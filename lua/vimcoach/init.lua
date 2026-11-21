local config = require("vimcoach.config")
local keystream = require("vimcoach.keystream")
local mastery = require("vimcoach.mastery")
local strict = require("vimcoach.strict")
local ui = require("vimcoach.ui")
local commands = require("vimcoach.commands")

local M = {}

local initialized = false

function M._is_setup()
  return initialized
end

function M.setup(opts)
  config.setup(opts)
  commands.register()
  mastery.load()

  if config.options.enabled then
    keystream.attach()
    strict.sync()
  else
    keystream.detach()
    strict.disable()
  end

  vim.schedule(function()
    ui.sync()
  end)

  initialized = true
end

function M.enable()
  if not initialized then
    M.setup({})
    return
  end
  config.options.enabled = true
  keystream.attach()
  strict.sync()
  ui.sync()
  vim.notify("VimCoach enabled (" .. config.options.mode .. " mode)", vim.log.levels.INFO, { title = "VimCoach" })
end

function M.disable()
  config.options.enabled = false
  keystream.detach()
  strict.disable()
  ui.close_toast()
  ui.sync()
  vim.notify("VimCoach paused", vim.log.levels.INFO, { title = "VimCoach" })
end

function M.toggle()
  if config.options.enabled then
    M.disable()
  else
    M.enable()
  end
end

function M.set_mode(mode)
  if mode ~= "coach" and mode ~= "strict" and mode ~= "adaptive" then
    vim.notify("VimCoach: mode must be 'coach', 'strict', or 'adaptive'", vim.log.levels.ERROR, { title = "VimCoach" })
    return
  end
  config.options.mode = mode
  if config.options.enabled then
    strict.sync()
  end
  ui.sync()
  vim.notify("VimCoach mode set to: " .. mode, vim.log.levels.INFO, { title = "VimCoach" })
end

function M.dashboard()
  mastery.load()
  ui.open_dashboard()
end

function M.report()
  M.dashboard()
end

function M.reset()
  mastery.reset()
  ui.sync()
  vim.notify("VimCoach stats reset.", vim.log.levels.INFO, { title = "VimCoach" })
end

function M.statusline()
  if not config.options.enabled then
    return ""
  end
  local icon = (config.options.ui and config.options.ui.icons and config.options.ui.icons.coach) or "󰌌 "
  local fluency = mastery.get_fluency_score()
  local mode_tag = config.options.mode == "strict" and " [STRICT]" or (config.options.mode == "adaptive" and " [ADAPT]" or "")
  return string.format("%s%d%%%s", icon, fluency, mode_tag)
end

function M.get_summary()
  return mastery.get_summary()
end

return M
