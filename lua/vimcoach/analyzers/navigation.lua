local buf = require("vimcoach.buffer_utils")
local config = require("vimcoach.config")

local M = {}

local ARROW_KEYS = {
  ["<Up>"] = true,
  ["<Down>"] = true,
  ["<Left>"] = true,
  ["<Right>"] = true,
}

---Count occurrences of keys matching a predicate.
---@param keys string[]
---@param pred fun(k: string): boolean
---@return integer
local function count_keys(keys, pred)
  local n = 0
  for _, k in ipairs(keys) do
    if pred(k) then
      n = n + 1
    end
  end
  return n
end

---Detect repeated identical f/F/t/T searches in keys (e.g. `f,f,` -> `f,;`).
---@param keys string[]
---@return table|nil { cmd = string, ch = string, repeats = integer }
local function detect_repeated_find(keys)
  if #keys < 4 then
    return nil
  end
  local i = 1
  while i <= #keys - 3 do
    local k1, k2 = keys[i], keys[i + 1]
    if k1 and k1:match("^[fFtT]$") and k2 and #k2 == 1 then
      local repeats = 1
      local j = i + 2
      while j <= #keys - 1 and keys[j] == k1 and keys[j + 1] == k2 do
        repeats = repeats + 1
        j = j + 2
      end
      if repeats >= 2 then
        return { cmd = k1, ch = k2, repeats = repeats }
      end
      i = j
    else
      i = i + 1
    end
  end
  return nil
end

---Count how many `}` or `{` paragraph jumps reach from start_row to end_row.
---Returns hop count (1 or 2) if end_row is a clean paragraph boundary, else nil.
---@param lines string[]
---@param start_row integer
---@param end_row integer
---@param base_row integer
---@return integer|nil hops, string|nil key
local function check_paragraph_jump(lines, start_row, end_row, base_row)
  if start_row == end_row then
    return nil, nil
  end
  local dir = end_row > start_row and 1 or -1
  local key = dir == 1 and "}" or "{"
  local cur = start_row
  local max_row = base_row + #lines - 1

  for hop = 1, 2 do
    -- Skip any blank lines at/after current position
    local r = cur + dir
    while r >= base_row and r <= max_row and buf.is_blank(lines[r - base_row + 1]) do
      r = r + dir
    end
    -- Skip non-blank lines until the next blank line (paragraph boundary)
    while r >= base_row and r <= max_row and not buf.is_blank(lines[r - base_row + 1]) do
      r = r + dir
    end
    cur = r
    if cur == end_row then
      return hop, key
    end
    -- Also match landing on the first non-blank line right after the blank line (super common!)
    if cur + dir == end_row and end_row >= base_row and end_row <= max_row and not buf.is_blank(lines[end_row - base_row + 1]) then
      return hop, key
    end
  end

  return nil, nil
end

---Analyze a finished Normal-mode Navigation Episode and return candidate suggestions.
---@param ctx table
---@return table[] candidates
function M.analyze(ctx)
  if not ctx or not ctx.keys or #ctx.keys < 2 then
    return {}
  end

  local keys = ctx.keys
  local key_count = #keys
  local actual_str = buf.format_keys(keys)
  local s_row, s_col = ctx.start_row, ctx.start_col
  local e_row, e_col = ctx.end_row, ctx.end_col

  -- Ignore fidgeting that ended right back at start
  if s_row == e_row and s_col == e_col then
    return {}
  end

  local lines = ctx.lines or {}
  local base_row = ctx.base_row or 1
  local total_lines = ctx.total_lines or (base_row + #lines - 1)
  local thresholds = config.options.thresholds
  local practical_only = config.options.practical_only

  local same_line = (s_row == e_row)
  local dy = math.abs(e_row - s_row)
  local dx = math.abs(e_col - s_col)

  local arrow_count = count_keys(keys, function(k) return ARROW_KEYS[k] == true end)
  local hl_count = count_keys(keys, function(k) return k == "h" or k == "l" or k == "<Left>" or k == "<Right>" end)
  local jk_count = count_keys(keys, function(k) return k == "j" or k == "k" or k == "<Up>" or k == "<Down>" end)
  local word_key_count = count_keys(keys, function(k) return k == "w" or k == "b" or k == "e" or k == "W" or k == "B" or k == "E" end)

  local candidates = {}

  local function add(rule_id, suggested, priority, reason, custom_cost)
    if not config.is_rule_enabled(rule_id) then
      return
    end
    local cost = custom_cost or #suggested
    local saved = key_count - cost
    if saved < (thresholds.min_keys_saved or 1) then
      return
    end
    candidates[#candidates + 1] = {
      rule_id = rule_id,
      actual = actual_str,
      suggested = suggested,
      keys_saved = saved,
      priority = priority,
      reason = reason,
    }
  end

  local rep_find = detect_repeated_find(keys)
  if rep_find then
    local suggested = rep_find.cmd .. rep_find.ch .. string.rep(";", rep_find.repeats - 1)
    add(
      "nav_repeat_find",
      suggested,
      95,
      string.format("Press `;` to repeat `%s%s` instead of retyping it (and `,` to reverse).", rep_find.cmd, rep_find.ch)
    )
  end

  if key_count >= 3 then
    local mr, mc = buf.find_matching_pair(lines, s_row, s_col, base_row)
    if mr == e_row and mc == e_col then
      add(
        "nav_matching_pair",
        "%",
        98,
        "Press `%` to jump straight to the matching bracket in 1 key."
      )
    end
  end

  if same_line then
    local line = lines[s_row - base_row + 1] or ""
    local first_nb = buf.first_non_blank(line)
    local last_col = buf.last_char_col(line)

    -- 3a. Line start (`0` / `^`) and Line end (`$`)
    if key_count >= 3 and dx >= 3 then
      if e_col == 1 and s_col > 1 then
        add("nav_line_start", "0", 96, "Press `0` to jump directly to the start of the line.")
      elseif e_col == first_nb and s_col ~= first_nb and first_nb > 1 then
        add("nav_line_start", "^", 96, "Press `^` to jump directly to the first non-blank character.")
      elseif e_col >= last_col and s_col < last_col then
        add("nav_line_end", "$", 96, "Press `$` to jump directly to the end of the line.")
      end
    end

    -- 3b. Inline character find (`f<ch>`, `F<ch>`, `t<ch>`, `T<ch>`)
    local min_for_find = (hl_count >= 3) and 3 or (thresholds.word_step_min or 5)
    if key_count >= min_for_find and dx >= 4 then
      local cf = buf.best_char_find(line, s_col, e_col, practical_only)
      if cf and key_count > cf.key_cost + 1 then
        local prio = cf.distinctive and 92 or 82
        add(
          "nav_find_char",
          cf.motion,
          prio,
          string.format("Use `%s` to jump straight to `%s` on this line.", cf.motion, cf.char),
          cf.key_cost
        )
      end
    end

    -- 3c. Repeated `h`/`l` stepping across words -> `w`/`b`/`e`
    if hl_count >= (thresholds.horizontal_step_min or 4) and dx >= 4 then
      local wm = buf.best_word_motion(line, s_col, e_col, 3)
      if wm and key_count - wm.key_cost >= 2 then
        add(
          "nav_word_jump",
          wm.motion,
          86,
          string.format("Use word motion `%s` instead of stepping %d characters with `h`/`l`.", wm.motion, hl_count),
          wm.key_cost
        )
      elseif dx >= 6 then
        local dir_hint = (e_col > s_col) and "w / e / f<ch>" or "b / F<ch>"
        add(
          "nav_word_jump",
          dir_hint,
          75,
          string.format("Hop by words (`%s`) instead of stepping %d times horizontally.", dir_hint, hl_count),
          2
        )
      end
    end

    -- 3d. Excessive `w`/`b`/`e` mashing (e.g. `wwwwwww`) when no cleaner target matched
    if word_key_count >= (thresholds.word_step_min or 5) then
      local word = buf.word_at(line, e_col)
      if word and #word >= 3 then
        add(
          "nav_search_jump",
          "/" .. word:sub(1, math.min(4, #word)),
          72,
          string.format("Instead of tapping word motions %d times, use `f<ch>` or `/%s` to jump directly.", word_key_count, word:sub(1, math.min(4, #word))),
          3
        )
      end
    end
  end

  if not same_line and dy >= 3 then
    -- 4a. Top / Bottom of file (`gg` / `G`)
    if e_row == 1 and dy >= 5 and jk_count >= 5 then
      add("nav_file_bounds", "gg", 97, "Press `gg` to jump straight to the first line of the file.")
    elseif e_row == total_lines and dy >= 5 and jk_count >= 5 then
      add("nav_file_bounds", "G", 97, "Press `G` to jump straight to the last line of the file.")
    end

    -- 4b. Return to recent jump origin -> `<C-o>`
    if ctx.last_jump_origin and ctx.last_jump_origin.row == e_row and dy >= 6 and jk_count >= 5 then
      add(
        "nav_jumplist",
        "<C-o>",
        95,
        "Press `<C-o>` to jump straight back to your previous location in the jump list.",
        1
      )
    end

    -- 4c. Paragraph jump (`}` / `{`)
    if dy >= (thresholds.vertical_count_min or 4) and jk_count >= (thresholds.vertical_count_min or 4) then
      local hops, pkey = check_paragraph_jump(lines, s_row, e_row, base_row)
      if hops and pkey then
        local cmd = string.rep(pkey, hops)
        add(
          "nav_paragraph",
          cmd,
          92,
          string.format("Use `%s` to leap by paragraph/blank lines instead of tapping `%s` %d times.", cmd, e_row > s_row and "j" or "k", jk_count)
        )
      end
    end

    -- 4d. Viewport jumps (`H` / `M` / `L`) for large jumps landing right on screen edges/middle
    if ctx.win_top and ctx.win_bot and dy >= 10 and jk_count >= 8 then
      local win_mid = math.floor((ctx.win_top + ctx.win_bot) / 2)
      if e_row == ctx.win_top then
        add("nav_viewport", "H", 84, "Press `H` to jump straight to the top of the visible window.")
      elseif e_row == ctx.win_bot then
        add("nav_viewport", "L", 84, "Press `L` to jump straight to the bottom of the visible window.")
      elseif math.abs(e_row - win_mid) <= 1 and math.abs(s_row - win_mid) >= 10 then
        add("nav_viewport", "M", 82, "Press `M` to jump straight to the middle of the visible window.")
      end
    end

    -- 4e. Long vertical traversal (>= 15 lines) -> `<C-d>` / `<C-u>` or `/pattern`
    if dy >= (thresholds.vertical_page_min or 15) and jk_count >= 10 then
      local cmd = (e_row > s_row) and "<C-d>" or "<C-u>"
      local e_line = lines[e_row - base_row + 1] or ""
      local target_word = buf.word_at(e_line, e_col)
      local reason = string.format("Use `%s` (half-page jump) or `:%d` instead of tapping `%s` %d times.", cmd, e_row, e_row > s_row and "j" or "k", jk_count)
      if target_word and #target_word >= 4 then
        reason = string.format("Use `%s` or `/%s` to jump %d lines instead of mashing `%s`.", cmd, target_word, dy, e_row > s_row and "j" or "k")
      end
      add("nav_half_page", cmd, 90, reason, 2)
    end

    -- 4f. Medium vertical traversal (4..14 lines) -> `{count}j` / `{count}k`
    if dy >= (thresholds.vertical_count_min or 4)
      and dy < (thresholds.vertical_page_min or 15)
      and jk_count >= (thresholds.vertical_count_min or 4)
    then
      local dir = (e_row > s_row) and "j" or "k"
      local cmd = tostring(dy) .. dir
      add(
        "nav_vertical_count",
        cmd,
        80,
        string.format("Use `%s` instead of pressing `%s` %d times (tip: enable `relativenumber`).", cmd, dir, jk_count)
      )
    end
  end

  if arrow_count >= 2 then
    -- If we already found an awesome specific Vim motion (like `$`, `w`, `f(`, `6j`),
    -- enrich its reason so the user learns BOTH "no arrows" AND the exact optimal motion!
    if #candidates > 0 then
      for _, c in ipairs(candidates) do
        c.reason = c.reason .. " (Avoid arrow keys in Normal mode!)"
        c.priority = c.priority + 5
      end
    else
      local replacement = same_line and (e_col > s_col and "l / w" or "h / b") or (e_row > s_row and "j" or "k")
      add(
        "nav_arrows",
        replacement,
        74,
        "Avoid arrow keys in Normal mode — stay on home row (`hjkl`, `w`/`b`, `f<ch>`, `}`/`{`).",
        1
      )
    end
  end

  return candidates
end

return M
