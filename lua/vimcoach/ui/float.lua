local config = require("vimcoach.config")
local catalog = require("vimcoach.catalog")

local uv = vim.uv or vim.loop

local M = {}

local toast_win = nil
local toast_buf = nil
local dismiss_timer = nil
local ns_id = vim.api.nvim_create_namespace("vimcoach_float_ui")

---Define highlight groups linked cleanly to standard Neovim groups (theme-friendly).
function M.setup_highlights()
  local hls = {
    VimCoachBorder = { link = "FloatBorder", default = true },
    VimCoachNormal = { link = "NormalFloat", default = true },
    VimCoachTitle = { link = "Title", default = true },
    VimCoachActual = { link = "DiagnosticError", default = true },
    VimCoachArrow = { link = "Comment", default = true },
    VimCoachSuggested = { link = "DiagnosticOk", default = true },
    VimCoachBadge = { link = "DiagnosticInfo", default = true },
    VimCoachReason = { link = "Comment", default = true },
    VimCoachStrict = { link = "DiagnosticWarn", default = true },
    VimCoachBarFill = { link = "DiagnosticOk", default = true },
    VimCoachBarEmpty = { link = "NonText", default = true },
  }
  for name, val in pairs(hls) do
    vim.api.nvim_set_hl(0, name, val)
  end
end

---Wrap a string cleanly into lines of at most `max_width` display chars.
---@param text string
---@param max_width integer
---@return string[]
local function wrap_text(text, max_width)
  if not text or text == "" then
    return {}
  end
  local lines = {}
  local cur = ""
  for word in text:gmatch("%S+") do
    if #cur == 0 then
      cur = word
    elseif #cur + 1 + #word <= max_width then
      cur = cur .. " " .. word
    else
      lines[#lines + 1] = cur
      cur = word
    end
  end
  if #cur > 0 then
    lines[#lines + 1] = cur
  end
  return lines
end

---Close the active floating toast immediately.
function M.close()
  if dismiss_timer then
    pcall(function()
      dismiss_timer:stop()
      dismiss_timer:close()
    end)
    dismiss_timer = nil
  end
  if toast_win and vim.api.nvim_win_is_valid(toast_win) then
    pcall(vim.api.nvim_win_close, toast_win, true)
  end
  toast_win = nil
  if toast_buf and vim.api.nvim_buf_is_valid(toast_buf) then
    pcall(vim.api.nvim_buf_delete, toast_buf, { force = true })
  end
  toast_buf = nil
end

---Display a non-intrusive floating coaching toast in Neovim.
---@param hint table { rule_id, actual, suggested, keys_saved, reason, is_strict_block }
function M.show(hint)
  M.setup_highlights()
  M.close()

  local ui_cfg = config.options.ui
  local icons = ui_cfg.icons or {}
  local meta = catalog.get(hint.rule_id)
  local title_label = meta and meta.title or "Vim Tip"

  local max_w = math.min(ui_cfg.max_width or 58, math.max(30, vim.o.columns - 6))
  local inner_w = max_w - 2

  -- Line 1: Main comparison  `  <actual>  →  <suggested>   (-N keys)`
  local actual = hint.actual or ""
  local arrow = icons.arrow or " → "
  local suggested = hint.suggested or ""
  local badge = ""
  if ui_cfg.show_keys_saved and (hint.keys_saved or 0) > 0 then
    badge = string.format(" (-%d key%s)", hint.keys_saved, hint.keys_saved == 1 and "" or "s")
  end

  local prefix = " "
  local main_line = prefix .. actual .. arrow .. suggested .. badge

  local lines = { main_line }
  if ui_cfg.show_reason and hint.reason and hint.reason ~= "" then
    local wrapped = wrap_text(hint.reason, inner_w)
    for _, wl in ipairs(wrapped) do
      lines[#lines + 1] = " " .. wl
    end
  end

  -- Compute window width from content
  local width = 26
  for _, l in ipairs(lines) do
    width = math.max(width, vim.fn.strdisplaywidth(l) + 1)
  end
  local header_icon = hint.is_strict_block and (icons.strict or "!") or (icons.coach or "")
  local header_title = string.format(" %sVimCoach · %s ", header_icon, title_label)
  width = math.max(width, vim.fn.strdisplaywidth(header_title) + 2)
  width = math.min(width, max_w)
  local height = #lines

  -- Create scratch buffer
  toast_buf = vim.api.nvim_create_buf(false, true)
  vim.bo[toast_buf].bufhidden = "wipe"
  vim.bo[toast_buf].filetype = "vimcoach_hint"
  vim.bo[toast_buf].modifiable = true
  vim.api.nvim_buf_set_lines(toast_buf, 0, -1, false, lines)
  vim.bo[toast_buf].modifiable = false

  -- Apply rich syntax highlights on line 0 and reason lines
  local col_actual_start = #prefix
  local col_actual_end = col_actual_start + #actual
  local col_arrow_end = col_actual_end + #arrow
  local col_sugg_end = col_arrow_end + #suggested
  local col_badge_end = col_sugg_end + #badge

  vim.api.nvim_buf_add_highlight(toast_buf, ns_id, "VimCoachActual", 0, col_actual_start, col_actual_end)
  vim.api.nvim_buf_add_highlight(toast_buf, ns_id, "VimCoachArrow", 0, col_actual_end, col_arrow_end)
  vim.api.nvim_buf_add_highlight(toast_buf, ns_id, "VimCoachSuggested", 0, col_arrow_end, col_sugg_end)
  if #badge > 0 then
    vim.api.nvim_buf_add_highlight(toast_buf, ns_id, "VimCoachBadge", 0, col_sugg_end, col_badge_end)
  end
  for i = 1, #lines - 1 do
    vim.api.nvim_buf_add_highlight(toast_buf, ns_id, "VimCoachReason", i, 0, -1)
  end

  -- Determine window placement
  local win_opts = {
    width = width,
    height = height,
    style = "minimal",
    border = ui_cfg.border or "rounded",
    focusable = false,
    noautocmd = true,
    zindex = 200,
  }

  -- Add title on border (supported in Neovim 0.9+)
  if vim.fn.has("nvim-0.9") == 1 then
    win_opts.title = { { header_title, hint.is_strict_block and "VimCoachStrict" or "VimCoachTitle" } }
    win_opts.title_pos = "left"
  end

  local pos = ui_cfg.position or "top_right"
  if pos == "cursor" then
    win_opts.relative = "cursor"
    win_opts.row = 1
    win_opts.col = 1
  elseif pos == "bottom_right" then
    win_opts.relative = "editor"
    win_opts.anchor = "SE"
    win_opts.row = math.max(1, vim.o.lines - vim.o.cmdheight - 2)
    win_opts.col = math.max(1, vim.o.columns - 2)
  else -- top_right (default)
    win_opts.relative = "editor"
    win_opts.anchor = "NE"
    win_opts.row = 1
    win_opts.col = math.max(1, vim.o.columns - 2)
  end

  local ok, win = pcall(vim.api.nvim_open_win, toast_buf, false, win_opts)
  if not ok then
    M.close()
    return
  end
  toast_win = win

  pcall(vim.api.nvim_set_option_value, "winhl", "Normal:VimCoachNormal,FloatBorder:VimCoachBorder", { win = toast_win })
  pcall(vim.api.nvim_set_option_value, "winblend", 8, { win = toast_win })

  -- Auto-dismiss timer
  local duration = ui_cfg.duration_ms or 4500
  dismiss_timer = uv.new_timer()
  if dismiss_timer then
    dismiss_timer:start(duration, 0, vim.schedule_wrap(function()
      M.close()
    end))
  end
end

return M
