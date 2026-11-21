local config = require("vimcoach.config")
local catalog = require("vimcoach.catalog")
local float_ui = require("vimcoach.ui.float")
local dashboard = require("vimcoach.ui.dashboard")
local vscode_ui = require("vimcoach.ui.vscode")

local M = {}

function M.show_hint(hint)
  if vscode_ui.is_vscode() then
    vscode_ui.show_hint(hint)
    return
  end

  local style = config.options.ui.style or "float"
  if style == "float" then
    float_ui.show(hint)
    return
  end

  local meta = catalog.get(hint.rule_id)
  local title = meta and meta.title or "Vim Tip"
  local saved_str = (hint.keys_saved and hint.keys_saved > 0)
      and string.format(" (-%d keys)", hint.keys_saved)
    or ""
  local text = string.format(
    "[VimCoach · %s] %s → %s%s — %s",
    title,
    hint.actual or "",
    hint.suggested or "",
    saved_str,
    hint.reason or ""
  )

  if style == "notify" then
    vim.notify(text, hint.is_strict_block and vim.log.levels.WARN or vim.log.levels.INFO, {
      title = "VimCoach",
    })
  else
    vim.api.nvim_echo({ { text, "DiagnosticInfo" } }, false, {})
  end
end

function M.open_dashboard()
  if vscode_ui.is_vscode() then
    vscode_ui.open_dashboard()
    return
  end
  dashboard.open()
end

function M.close_toast()
  float_ui.close()
end

return M
