local buf = require("vimcoach.buffer_utils")
local config = require("vimcoach.config")

local M = {}

local function make_candidate(rule_id, actual, suggested, keys_saved, priority, reason)
  if not config.is_rule_enabled(rule_id) then
    return nil
  end
  if keys_saved < (config.options.thresholds.min_keys_saved or 1) then
    return nil
  end
  return {
    rule_id = rule_id,
    actual = actual,
    suggested = suggested,
    keys_saved = keys_saved,
    priority = priority,
    reason = reason,
  }
end

---Check if two single characters are ASCII opposite-case versions of the same letter.
---@param a string
---@param b string
---@return boolean
local function is_case_flip(a, b)
  if not a or not b or #a ~= 1 or #b ~= 1 then
    return false
  end
  return a ~= b and a:lower() == b:lower() and a:match("%a") ~= nil
end

---Analyze an immediate Normal-mode operator command (e.g. `d$`, `c$`, `y$`, `0d$`).
---@param ctx table { cmd = string, prev_key = string|nil }
---@return table[] candidates
function M.analyze_operator(ctx)
  if not ctx or not ctx.cmd then
    return {}
  end

  local cmd = ctx.cmd
  local prev = ctx.prev_key
  local candidates = {}

  local function push(c)
    if c then
      candidates[#candidates + 1] = c
    end
  end

  -- `0d$` / `^d$` -> `dd`, `0c$` / `^c$` -> `cc`
  if (prev == "0" or prev == "^") and (cmd == "d$" or cmd == "D") then
    push(make_candidate(
      "visual_whole_line",
      prev .. cmd,
      "dd",
      #(prev .. cmd) - 2,
      94,
      "Use `dd` to delete the whole line directly."
    ))
    return candidates
  end

  if (prev == "0" or prev == "^") and (cmd == "c$" or cmd == "C") then
    push(make_candidate(
      "visual_whole_line",
      prev .. cmd,
      "cc",
      #(prev .. cmd) - 2,
      94,
      "Use `cc` (or `S`) to change the whole line directly while preserving indentation."
    ))
    return candidates
  end

  -- `d$` -> `D`, `c$` -> `C`, `y$` -> `Y`
  if cmd == "d$" then
    push(make_candidate(
      "edit_delete_to_eol",
      "d$",
      "D",
      1,
      90,
      "Use `D` to delete to end of line in 1 key instead of `d$`."
    ))
  elseif cmd == "c$" then
    push(make_candidate(
      "edit_delete_to_eol",
      "c$",
      "C",
      1,
      90,
      "Use `C` to change to end of line in 1 key instead of `c$`."
    ))
  elseif cmd == "y$" and config.options.assume_nvim_Y then
    push(make_candidate(
      "edit_delete_to_eol",
      "y$",
      "Y",
      1,
      86,
      "In Neovim, `Y` yanks to end of line in 1 key (just like `D` and `C`)."
    ))
  end

  return candidates
end

function M.analyze_insert_entry(ctx)
  if not ctx or not ctx.insert_key then
    return {}
  end

  local ik = ctx.insert_key
  local line = ctx.line or ""
  local col = ctx.col or 1
  local first_nb = buf.first_non_blank(line)
  local last_col = buf.last_char_col(line)
  local candidates = {}

  local function push(c)
    if c then
      candidates[#candidates + 1] = c
    end
  end

  local del = ctx.prev_delete
  if del and del.elapsed_ms <= (config.options.thresholds.combo_window_ms or 1600) then
    local dcmd = del.cmd or ""

    -- `d{motion}` / `d{textobj}` followed by `i` or `a` on same line
    if dcmd:sub(1, 1) == "d" and #dcmd >= 2 and dcmd ~= "dd" and (ik == "i" or ik == "a") then
      local motion = dcmd:sub(2)
      local suggested = (motion == "$") and "C" or ("c" .. motion)
      local actual = dcmd .. ik
      push(make_candidate(
        "edit_delete_then_insert",
        actual,
        suggested,
        #actual - #suggested,
        96,
        string.format("Use `%s` instead of `%s` — deletes and enters Insert mode atomically (dot-repeatable with `.`).", suggested, actual)
      ))
      return candidates
    end

    -- `D` followed by `a` / `A` / `i` -> `C`
    if dcmd == "D" and (ik == "a" or ik == "A" or ik == "i") then
      push(make_candidate(
        "edit_delete_then_insert",
        "D" .. ik,
        "C",
        1,
        96,
        "Use `C` to delete to end of line and enter Insert mode in 1 key."
      ))
      return candidates
    end

    -- `dd` followed by `O` (or `o` when on last line) -> `cc` / `S`
    if dcmd == "dd" and (ik == "O" or (ik == "o" and ctx.row == ctx.total_lines)) then
      push(make_candidate(
        "edit_delete_then_insert",
        "dd" .. ik,
        "cc",
        1,
        95,
        "Use `cc` (or `S`) to clear the line and enter Insert mode while preserving indentation."
      ))
      return candidates
    end
  end

  local nav = ctx.prev_nav
  if nav and nav.keys and #nav.keys >= 1 then
    local keys = nav.keys
    local actual = buf.format_keys(keys) .. ik
    local total_keys = #keys + 1

    -- `0i`, `^i`, or `hhhhi` landing at col 1 or first non-blank -> `I`
    if ik == "i" and (col == first_nb or (col == 1 and first_nb == 1)) then
      local last_k = keys[#keys]
      if last_k == "^" or (last_k == "0" and first_nb == 1) or (#keys >= 3 and (last_k == "h" or last_k == "b" or last_k == "<Left>")) then
        push(make_candidate(
          "edit_insert_line_start",
          actual,
          "I",
          total_keys - 1,
          95,
          "Press `I` to jump to the first non-blank character and enter Insert mode in 1 key."
        ))
        return candidates
      end
    end

    -- `$a`, or `llllla` / `wwwa` landing at EOL -> `A`
    if ik == "a" and col >= last_col and #line > 0 then
      local last_k = keys[#keys]
      if last_k == "$" or (#keys >= 2 and (last_k == "l" or last_k == "e" or last_k == "w" or last_k == "<Right>")) then
        push(make_candidate(
          "edit_append_line_end",
          actual,
          "A",
          total_keys - 1,
          95,
          "Press `A` to jump to the end of the line and enter Insert mode in 1 key."
        ))
        return candidates
      end
    end

    -- Single `li` -> `a`, single `ha` -> `i` (only if immediate, <= 600ms)
    if #keys == 1 and (nav.elapsed_ms or 0) <= 600 then
      if keys[1] == "l" and ik == "i" then
        push(make_candidate(
          "edit_append_adjacent",
          "li",
          "a",
          1,
          86,
          "Press `a` to append right after the cursor instead of `li`."
        ))
      elseif keys[1] == "h" and ik == "a" then
        push(make_candidate(
          "edit_append_adjacent",
          "ha",
          "i",
          1,
          86,
          "Press `i` to insert right before the cursor instead of `ha`."
        ))
      elseif keys[1] == "k" and ik == "o" and (ctx.row or 1) >= 1 then
        push(make_candidate(
          "edit_open_line",
          "ko",
          "O",
          1,
          88,
          "Press `O` to open a new line directly above instead of `ko`."
        ))
      end
    end
  end

  return candidates
end

function M.analyze_insert_leave(ctx)
  if not ctx then
    return {}
  end

  local ik = ctx.entry_key or ""
  local ins = ctx.inserted_keys or {}
  local del = ctx.prev_delete
  local candidates = {}

  local function push(c)
    if c then
      candidates[#candidates + 1] = c
    end
  end

  if (ik == "A" or ik == "$a") and #ins >= 1 and ins[1] == "<CR>" then
    local actual = ik .. "<CR>"
    push(make_candidate(
      "edit_open_line",
      actual,
      "o",
      #ik,
      94,
      "Press `o` to open a new indented line below in 1 key instead of `" .. actual .. "`."
    ))
    return candidates
  end

  if ctx.before_line_count and ctx.after_line_count and ctx.after_line_count == ctx.before_line_count - 1 then
    if #ins >= 1 and #ins <= 2 and (ins[1] == "<Del>" or ins[1] == "<BS>") then
      push(make_candidate(
        "edit_join_lines",
        ik .. table.concat(ins, ""),
        "J",
        math.max(1, #ik + #ins),
        92,
        "Use `J` (or `gJ` without space) to join lines directly in Normal mode."
      ))
      return candidates
    end
  end

  -- Deferred from insert entry so we can distinguish ~, <C-a>/<C-x>, r<ch>, and s
  local is_single_char_del = (del and (del.cmd == "x" or del.cmd == "X") and (ik == "i" or ik == "a"))
  local is_sub_char = (ik == "s" or ik == "cl")

  if is_single_char_del or is_sub_char then
    local typed_printable = (#ins == 1 and #ins[1] == 1)
    local deleted_ch = del and del.deleted_text or (ctx.before_line and ctx.before_col and ctx.before_line:sub(ctx.before_col, ctx.before_col)) or ""

    if typed_printable then
      local new_ch = ins[1]
      local actual = (is_single_char_del and (del.cmd .. ik) or ik) .. new_ch .. "<Esc>"

      -- 3a. Case flip (`xiA<Esc>` when char was `a`) -> `~`!
      if is_case_flip(deleted_ch, new_ch) then
        push(make_candidate(
          "edit_toggle_case",
          actual,
          "~",
          3,
          96,
          string.format("Press `~` to toggle `%s` → `%s` in 1 key without entering Insert mode.", deleted_ch, new_ch)
        ))
        return candidates
      end

      -- 3b. Single-digit increment/decrement (`xi5<Esc>` when char was `4`) -> `<C-a>` / `<C-x>`!
      local old_n = tonumber(deleted_ch)
      local new_n = tonumber(new_ch)
      if old_n and new_n and math.abs(new_n - old_n) == 1 then
        local cmd = (new_n > old_n) and "<C-a>" or "<C-x>"
        push(make_candidate(
          "edit_increment_number",
          actual,
          cmd,
          2,
          94,
          string.format("Use `%s` to %s `%d` → `%d` in 1 key without leaving Normal mode.", cmd, new_n > old_n and "increment" or "decrement", old_n, new_n)
        ))
        return candidates
      end

      -- 3c. Single character replacement -> `r<ch>`!
      push(make_candidate(
        "edit_replace_char",
        actual,
        "r" .. new_ch,
        is_single_char_del and 2 or 1,
        93,
        string.format("Use `r%s` to replace a single character without entering Insert mode.", new_ch)
      ))
      return candidates
    elseif is_single_char_del and #ins >= 2 then
      push(make_candidate(
        "edit_substitute_char",
        del.cmd .. ik,
        "s",
        1,
        84,
        "Use `s` (or `cl`) to delete the character under cursor and enter Insert mode in 1 key."
      ))
      return candidates
    end
  end

  if ctx.deleted_word and ctx.after_word and ctx.deleted_word ~= ctx.after_word then
    if ctx.deleted_word:match("^%-?%d+$") and ctx.after_word:match("^%-?%d+$") then
      local old_num = tonumber(ctx.deleted_word)
      local new_num = tonumber(ctx.after_word)
      if old_num and new_num and math.abs(new_num - old_num) == 1 then
        local cmd = (new_num > old_num) and "<C-a>" or "<C-x>"
        local actual = ik .. ctx.after_word .. "<Esc>"
        push(make_candidate(
          "edit_increment_number",
          actual,
          cmd,
          math.max(2, #ik + #ctx.after_word),
          94,
          string.format("Use `%s` to %s `%d` → `%d` in 1 key without entering Insert mode!", cmd, new_num > old_num and "increment" or "decrement", old_num, new_num)
        ))
        return candidates
      end
    end
  end

  if (ik == "I" or ik == "0i" or ik == "^i") and #ins >= 1 and ctx.before_row == ctx.after_row then
    local only_indent_chars = true
    local only_delete_ws = true
    for _, k in ipairs(ins) do
      if k ~= "<Space>" and k ~= " " and k ~= "<Tab>" then
        only_indent_chars = false
      end
      if k ~= "<BS>" and k ~= "<Del>" then
        only_delete_ws = false
      end
    end

    if only_indent_chars and (#ins >= 2 or ins[1] == "<Tab>") and ctx.before_line and ctx.after_line then
      if #ctx.after_line > #ctx.before_line then
        local actual = ik .. buf.format_keys(ins) .. "<Esc>"
        push(make_candidate(
          "edit_indent",
          actual,
          ">>",
          math.max(1, (#ik + #ins + 1) - 2),
          90,
          "Use `>>` to indent the line directly without entering Insert mode."
        ))
        return candidates
      end
    elseif only_delete_ws and #ins >= 2 and ctx.before_line and ctx.after_line then
      -- Check that only leading whitespace was removed
      local before_trimmed = ctx.before_line:gsub("^%s+", "")
      local after_trimmed = ctx.after_line:gsub("^%s+", "")
      if before_trimmed == after_trimmed and #ctx.after_line < #ctx.before_line then
        local actual = ik .. buf.format_keys(ins) .. "<Esc>"
        push(make_candidate(
          "edit_indent",
          actual,
          "<<",
          math.max(1, (#ik + #ins + 1) - 2),
          90,
          "Use `<<` to outdent the line directly without entering Insert mode."
        ))
        return candidates
      end
    end
  end

  return candidates
end

---Analyze consecutive `x` or `X` presses (e.g. `xxxxx`) with buffer awareness!
---@param ctx table {
---  key: "x"|"X",
---  count: integer,
---  before_line: string,
---  start_col: integer,    -- 1-indexed col before first x/X
---}
---@return table[] candidates
function M.analyze_repeated_x(ctx)
  local min_x = config.options.thresholds.repeat_x_min or 3
  if not ctx or (ctx.count or 0) < min_x then
    return {}
  end

  local count = ctx.count
  local key = ctx.key or "x"
  local line = ctx.before_line or ""
  local start_col = ctx.start_col or 1
  local actual = buf.format_keys(vim.fn.split(string.rep(key, count), "\\zs"))
  local candidates = {}

  local function push(c)
    if c then
      candidates[#candidates + 1] = c
    end
  end

  if key == "x" and #line > 0 and start_col >= 1 and start_col <= #line then
    local end_col = math.min(#line, start_col + count - 1)
    local deleted = line:sub(start_col, end_col)

    -- Deleted leading whitespace -> `<<`
    if start_col <= buf.first_non_blank(line) and deleted:match("^%s+$") then
      push(make_candidate(
        "edit_indent",
        actual,
        "<<",
        count - 2,
        92,
        "Use `<<` to outdent leading whitespace instead of pressing `x` repeatedly."
      ))
      return candidates
    end

    -- Deleted to end of line -> `D`
    if end_col >= #line then
      push(make_candidate(
        "edit_repeated_x",
        actual,
        "D",
        count - 1,
        94,
        string.format("Use `D` to delete to end of line in 1 key instead of pressing `x` %d times.", count)
      ))
      return candidates
    end

    -- Deleted a word -> `dw` / `diw`
    local wobj = buf.match_word_object(line, start_col, end_col)
    if wobj then
      local cmd = (wobj == "aw") and "dw" or ("d" .. wobj)
      push(make_candidate(
        "edit_repeated_x",
        actual,
        cmd,
        math.max(1, count - #cmd),
        92,
        string.format("Use `%s` to delete the word directly instead of pressing `x` %d times.", cmd, count)
      ))
      return candidates
    end

    -- Deleted up to a distinctive char -> `dt<ch>` / `df<ch>`
    local cf = buf.best_char_find(line, start_col, end_col, config.options.practical_only)
    if cf and (cf.kind == "f" or cf.kind == "t") and count > cf.key_cost + 1 then
      local cmd = "d" .. cf.motion
      push(make_candidate(
        "edit_repeated_x",
        actual,
        cmd,
        count - #cmd,
        88,
        string.format("Use `%s` instead of pressing `x` %d times.", cmd, count)
      ))
      return candidates
    end
  end

  -- General fallback
  local fallback = (key == "x") and "dw / dt<ch>" or "db / d0"
  push(make_candidate(
    "edit_repeated_x",
    actual,
    fallback,
    math.max(1, count - 2),
    80,
    string.format("Use `d{motion}` (like `%s`) instead of pressing `%s` %d times.", fallback, key, count)
  ))

  return candidates
end

return M
