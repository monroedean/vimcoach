local M = {}

local registered = false

local SUBCOMMANDS = {
  "dashboard",
  "toggle",
  "enable",
  "disable",
  "coach",
  "strict",
  "adaptive",
  "report",
  "reset",
  "status",
  "test",
  "debug",
}

function M.register()
  if registered then
    return
  end
  registered = true

  vim.api.nvim_create_user_command("VimCoach", function(opts)
    local vimcoach = require("vimcoach")
    local arg = (opts.args or ""):gsub("^%s+", ""):gsub("%s+$", "")

    if arg == "" or arg == "dashboard" then
      vimcoach.dashboard()
    elseif arg == "toggle" then
      vimcoach.toggle()
    elseif arg == "enable" then
      vimcoach.enable()
    elseif arg == "disable" then
      vimcoach.disable()
    elseif arg == "coach" or arg == "strict" or arg == "adaptive" then
      vimcoach.set_mode(arg)
    elseif arg == "report" then
      vimcoach.report()
    elseif arg == "reset" then
      vimcoach.reset()
    elseif arg == "status" then
      local s = require("vimcoach.mastery").get_summary()
      local msg = string.format(
        "VimCoach: %s | Mode: %s | Fluency: %d%% | Good: %d | Tips: %d | Keys saveable: %d",
        s.enabled and "ON" or "OFF",
        s.mode,
        s.fluency,
        s.total_good_motions,
        s.total_hints,
        s.total_keys_saved
      )
      if vim.g.vscode then
        local ok, vscode = pcall(require, "vscode")
        if ok and vscode.notify then
          pcall(vscode.notify, msg, vim.log.levels.INFO)
          return
        end
      end
      vim.notify(msg, vim.log.levels.INFO, { title = "VimCoach" })
    elseif arg == "test" then
      require("vimcoach.ui").show_hint({
        rule_id = "textobj_quotes",
        actual = "vlllld",
        suggested = 'di"',
        keys_saved = 3,
        reason = "Test popup from VimCoach — your UI bridge is working!",
      })
    elseif arg == "debug" then
      local cfg = require("vimcoach.config")
      local ks = require("vimcoach.keystream").debug_info()
      local vs = require("vimcoach.ui.vscode").debug_info()
      local msg = string.format(
        "VimCoach debug | attached=%s enabled=%s mode=%s | keys_seen=%d dropped_typed=%d last=%s | bt=%q ft=%q disabled=%s | vscode=%s mod=%s eval=%s notify=%s bridge=%s",
        tostring(ks.attached),
        tostring(cfg.options.enabled),
        tostring(cfg.options.mode),
        ks.keys_seen,
        ks.keys_dropped_typed,
        tostring(ks.last_key_seen),
        vim.bo.buftype,
        vim.bo.filetype,
        tostring(cfg.is_buffer_disabled(0)),
        tostring(vs.vim_g_vscode),
        tostring(vs.has_vscode_module),
        tostring(vs.has_eval_async),
        tostring(vs.has_vscode_notify),
        tostring(vs.last_bridge_status)
      )
      if vim.g.vscode then
        local ok, vscode = pcall(require, "vscode")
        if ok and vscode.notify then
          pcall(vscode.notify, msg, vim.log.levels.INFO)
          return
        end
      end
      vim.notify(msg, vim.log.levels.INFO, { title = "VimCoach Debug" })
    else
      vim.notify("VimCoach: unknown subcommand '" .. arg .. "'", vim.log.levels.WARN, { title = "VimCoach" })
    end
  end, {
    nargs = "?",
    desc = "VimCoach control & Mastery Dashboard",
    complete = function(arg_lead)
      local matches = {}
      for _, sub in ipairs(SUBCOMMANDS) do
        if sub:find("^" .. vim.pesc(arg_lead)) then
          matches[#matches + 1] = sub
        end
      end
      return matches
    end,
  })

  vim.api.nvim_create_user_command("VimCoachDashboard", function()
    require("vimcoach").dashboard()
  end, { desc = "Open VimCoach Mastery Dashboard" })

  vim.api.nvim_create_user_command("VimCoachToggle", function()
    require("vimcoach").toggle()
  end, { desc = "Toggle VimCoach on/off" })

  vim.api.nvim_create_user_command("VimCoachStrict", function()
    local vimcoach = require("vimcoach")
    local cfg = require("vimcoach.config").options
    vimcoach.set_mode(cfg.mode == "strict" and "coach" or "strict")
  end, { desc = "Toggle VimCoach Strict Mode" })

  vim.api.nvim_create_user_command("VimCoachReset", function()
    require("vimcoach").reset()
  end, { desc = "Reset VimCoach mastery & habit stats" })
end

return M
