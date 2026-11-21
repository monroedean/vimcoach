local mastery = require("vimcoach.mastery")
local config = require("vimcoach.config")
local float_ui = require("vimcoach.ui.float")

local M = {}

local dash_win = nil
local dash_buf = nil
local current_tab = 1
local ns_id = vim.api.nvim_create_namespace("vimcoach_dashboard")

local function progress_bar(pct, width)
  width = width or 14
  pct = math.max(0, math.min(100, pct or 0))
  local filled = math.floor((pct / 100) * width + 0.5)
  local empty = width - filled
  return string.rep("█", filled) .. string.rep("░", empty)
end

local function pad_right(str, width)
  local w = vim.fn.strdisplaywidth(str)
  if w >= width then
    return str
  end
  return str .. string.rep(" ", width - w)
end

local function close_dashboard()
  if dash_win and vim.api.nvim_win_is_valid(dash_win) then
    pcall(vim.api.nvim_win_close, dash_win, true)
  end
  dash_win = nil
  if dash_buf and vim.api.nvim_buf_is_valid(dash_buf) then
    pcall(vim.api.nvim_buf_delete, dash_buf, { force = true })
  end
  dash_buf = nil
end

local function render()
  if not dash_buf or not vim.api.nvim_buf_is_valid(dash_buf) then
    return
  end

  local s = mastery.get_summary()
  local lines = {}
  local hls = {}

  local function add_line(text, hl_group)
    lines[#lines + 1] = text
    if hl_group then
      hls[#hls + 1] = { line = #lines - 1, group = hl_group, col_start = 0, col_end = -1 }
    end
  end

  -- Header & Tabs
  local mode_badge = string.upper(s.mode) .. (s.enabled and "" or " (PAUSED)")
  add_line(string.format("  VimCoach Dashboard                                    [%s]", mode_badge), "VimCoachTitle")
  add_line("  " .. string.rep("─", 66), "VimCoachBorder")

  local t1 = current_tab == 1 and "[1 Overview & Habits]" or " 1 Overview & Habits "
  local t2 = current_tab == 2 and "[2 Skill Mastery]" or " 2 Skill Mastery "
  local t3 = current_tab == 3 and "[3 Recent Feed]" or " 3 Recent Feed "
  add_line(string.format("  %s   %s   %s", t1, t2, t3), "VimCoachBadge")
  add_line("  " .. string.rep("─", 66), "VimCoachBorder")
  add_line("")

  if current_tab == 1 then
    -- Overview KPIs
    add_line(string.format(
      "  Vim Fluency Score:  %s  %3d%%",
      progress_bar(s.fluency, 20),
      s.fluency
    ), "VimCoachSuggested")
    add_line(string.format(
      "  All-Time:  %d idiomatic motions  ·  %d tips  ·  %d keys saveable",
      s.total_good_motions,
      s.total_hints,
      s.total_keys_saved
    ))
    add_line(string.format(
      "  Session:   %d idiomatic motions  ·  %d tips  ·  %d keys saveable",
      s.session.good_motions,
      s.session.hints,
      s.session.keys_saved
    ), "VimCoachReason")
    add_line("")

    add_line("  Top Habits to Improve Next", "VimCoachTitle")
    add_line("  " .. string.rep("─", 66), "VimCoachBorder")

    if #s.top_habits == 0 then
      add_line("  No coaching tips triggered yet — start editing and VimCoach will", "VimCoachReason")
      add_line("  automatically track your motions and surface faster idioms here!", "VimCoachReason")
    else
      for idx, h in ipairs(s.top_habits) do
        local left = string.format("  %2d. %s", idx, pad_right(h.title, 28))
        local bar = progress_bar(h.mastery, 10)
        local row = string.format(
          "%s %s %3d%%  (%dx missed · %s)",
          left,
          bar,
          h.mastery,
          h.missed,
          h.shortcut
        )
        add_line(row)
      end
    end
  elseif current_tab == 2 then
    add_line("  Mastery by Skill Category", "VimCoachTitle")
    add_line("  " .. string.rep("─", 66), "VimCoachBorder")

    local any_skill = false
    for _, cat in ipairs(s.categories) do
      local pct_str = cat.mastery and string.format("%3d%%", cat.mastery) or "  -- "
      local bar = cat.mastery and progress_bar(cat.mastery, 12) or string.rep("░", 12)
      add_line(string.format(
        "  %s  %s  %s  (%d good / %d missed)",
        pad_right(cat.label, 22),
        bar,
        pct_str,
        cat.used,
        cat.missed
      ), "VimCoachTitle")

      for _, sk in ipairs(cat.skills) do
        any_skill = true
        add_line(string.format(
          "      %-26s %s %3d%%  [%s]",
          sk.title:sub(1, 26),
          progress_bar(sk.mastery, 8),
          sk.mastery,
          sk.shortcut
        ), "VimCoachReason")
      end
      add_line("")
    end

    if not any_skill then
      add_line("  Start editing to populate your per-skill mastery profile!", "VimCoachReason")
    end
  elseif current_tab == 3 then
    add_line("  Recent Coaching Feed (Newest First)", "VimCoachTitle")
    add_line("  " .. string.rep("─", 66), "VimCoachBorder")

    if #s.history == 0 then
      add_line("  No recent tips yet.", "VimCoachReason")
    else
      for i = 1, math.min(18, #s.history) do
        local item = s.history[i]
        local ts = os.date("%H:%M:%S", item.ts)
        add_line(string.format(
          "  [%s]  %s  →  %s   (-%d keys)",
          ts,
          item.actual,
          item.suggested,
          item.keys_saved or 1
        ), "VimCoachSuggested")
        if item.reason and item.reason ~= "" then
          add_line("             " .. item.reason:sub(1, 56), "VimCoachReason")
        end
      end
    end
  end

  add_line("")
  add_line("  " .. string.rep("─", 66), "VimCoachBorder")
  add_line("  Keys: [1/2/3/Tab] Switch Tab  ·  [s] Cycle Mode  ·  [R] Reset  ·  [q] Close", "VimCoachReason")

  vim.bo[dash_buf].modifiable = true
  vim.api.nvim_buf_set_lines(dash_buf, 0, -1, false, lines)
  vim.bo[dash_buf].modifiable = false

  vim.api.nvim_buf_clear_namespace(dash_buf, ns_id, 0, -1)
  for _, h in ipairs(hls) do
    vim.api.nvim_buf_add_highlight(dash_buf, ns_id, h.group, h.line, h.col_start, h.col_end)
  end
end

---Open the interactive VimCoach Mastery Dashboard.
function M.open()
  float_ui.setup_highlights()
  close_dashboard()

  local width = math.min(72, math.max(50, vim.o.columns - 8))
  local height = math.min(28, math.max(16, vim.o.lines - 6))
  local row = math.floor((vim.o.lines - height) / 2)
  local col = math.floor((vim.o.columns - width) / 2)

  dash_buf = vim.api.nvim_create_buf(false, true)
  vim.bo[dash_buf].bufhidden = "wipe"
  vim.bo[dash_buf].filetype = "vimcoach_dashboard"

  local win_opts = {
    relative = "editor",
    width = width,
    height = height,
    row = row,
    col = col,
    style = "minimal",
    border = config.options.ui.border or "rounded",
    zindex = 220,
  }
  if vim.fn.has("nvim-0.9") == 1 then
    win_opts.title = { { " 󰌌 VimCoach Mastery Dashboard ", "VimCoachTitle" } }
    win_opts.title_pos = "center"
  end

  dash_win = vim.api.nvim_open_win(dash_buf, true, win_opts)
  pcall(vim.api.nvim_set_option_value, "winhl", "Normal:VimCoachNormal,FloatBorder:VimCoachBorder", { win = dash_win })
  pcall(vim.api.nvim_set_option_value, "cursorline", true, { win = dash_win })

  render()

  local function map(lhs, fn)
    vim.keymap.set("n", lhs, fn, { buffer = dash_buf, silent = true, nowait = true })
  end

  map("q", close_dashboard)
  map("<Esc>", close_dashboard)
  map("1", function() current_tab = 1; render() end)
  map("2", function() current_tab = 2; render() end)
  map("3", function() current_tab = 3; render() end)
  map("<Tab>", function() current_tab = (current_tab % 3) + 1; render() end)
  map("l", function() current_tab = (current_tab % 3) + 1; render() end)
  map("h", function() current_tab = ((current_tab - 2) % 3) + 1; render() end)
  map("s", function()
    local modes = { coach = "strict", strict = "adaptive", adaptive = "coach" }
    config.options.mode = modes[config.options.mode] or "coach"
    require("vimcoach.strict").sync()
    render()
  end)
  map("R", function()
    mastery.reset()
    render()
  end)
end

return M
