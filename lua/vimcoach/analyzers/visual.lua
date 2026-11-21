local buf = require("vimcoach.buffer_utils")
local config = require("vimcoach.config")

local M = {}

local LINEWISE_SHORTCUT = {
  d = "dd",
  c = "cc",
  y = "yy",
  [">"] = ">>",
  ["<"] = "<<",
  ["="] = "==",
}

local OP_PREFIX = {
  d = "d",
  c = "c",
  y = "y",
  [">"] = ">",
  ["<"] = "<",
  ["="] = "=",
  ["~"] = "g~",
  u = "gu",
  U = "gU",
}

local OP_VERB = {
  d = "delete",
  c = "change",
  y = "yank",
  [">"] = "indent",
  ["<"] = "outdent",
  ["="] = "auto-indent",
  ["~"] = "toggle case of",
  u = "lowercase",
  U = "uppercase",
}

---Normalize visual-mode operator aliases (`x` -> `d`, `s` -> `c`).
---@param op string
---@return string|nil
local function normalize_op(op)
  if op == "x" or op == "X" or op == "D" then
    return "d"
  elseif op == "s" or op == "S" or op == "C" or op == "R" then
    return "c"
  elseif op == "Y" then
    return "y"
  elseif OP_PREFIX[op] then
    return op
  end
  return nil
end

---Check if the visual key sequence was a single clean direct motion or text object
---(e.g. `vi"d`, `vawd`, `vwd`, `v$y`, `vftd`, `v%c`, `Vjd`, `v}d`).
---@param keys string[]
---@param op string normalized operator
---@return string|nil direct_cmd
local function detect_unnecessary_visual_keys(keys, op)
  local prefix = OP_PREFIX[op]
  if not prefix or not keys or #keys < 3 then
    return nil
  end

  local mode_key = keys[1]
  -- Extract the motion keys strictly between visual entry and operator
  local motion_keys = {}
  for i = 2, #keys - 1 do
    motion_keys[#motion_keys + 1] = keys[i]
  end
  local motion = table.concat(motion_keys, "")

  -- Visual Line `V` + single operator (`Vd`, `Vc`, `Vy`) -> handled by whole_line rule
  if mode_key == "V" and #motion_keys == 0 then
    return nil
  end

  -- Text object inside visual mode: `vi"`, `va(`, `viw`, `vap`, `vit`, etc.
  if mode_key == "v" and #motion_keys == 2 and (motion_keys[1] == "i" or motion_keys[1] == "a") then
    local obj = motion_keys[2]
    if obj:match('^[wWpst"\'`%(%)%[%]%{%}<>bB]$') then
      return prefix .. motion
    end
  end

  -- Simple single-key motion in visual mode: `vwd`, `ved`, `vbd`, `v}y`, `v%c`, `v0d`, `v^d`, `Vjd`, `Vkd`, `V}d`, `V{d`
  if #motion_keys == 1 then
    local m = motion_keys[1]
    if mode_key == "v" and m:match("^[wWeEbB%%%}%{0%^G]$") then
      return prefix .. m
    end
    if mode_key == "V" and m:match("^[jk%}%{G]$") then
      return prefix .. m
    end
  end

  -- Two-key f/F/t/T motion in visual mode: `vf,d`, `vt)c`
  if mode_key == "v" and #motion_keys == 2 and motion_keys[1]:match("^[fFtT]$") then
    return prefix .. motion
  end

  -- `v$` handled better by D/C/Y below, so skip here if op is d/c/y
  if mode_key == "v" and motion == "$" and not (op == "d" or op == "c" or op == "y") then
    return prefix .. "$"
  end

  return nil
end

---Analyze a completed Visual-mode operation and return candidate coaching suggestions.
---@param ctx table
---@return table[] candidates
function M.analyze(ctx)
  if not ctx or not ctx.operator then
    return {}
  end

  -- Blockwise visual (`<C-v>`) is idiomatic for column edits; don't nag.
  if ctx.visual_mode == "\22" or ctx.visual_mode == "<C-v>" then
    return {}
  end

  local op = normalize_op(ctx.operator)
  if not op then
    return {}
  end

  local prefix = OP_PREFIX[op]
  local verb = OP_VERB[op] or "operate on"
  local is_linewise = (ctx.visual_mode == "V")
  local keys = ctx.keys or {}
  local actual_key_count = #keys
  local actual_str = buf.format_keys(keys)
  local pre_nav_keys = (ctx.pre_nav and ctx.pre_nav.keys) or {}
  local total_effort_keys = actual_key_count + #pre_nav_keys

  local lines = ctx.lines or {}
  local base_row = ctx.base_row or 1
  local total_lines = ctx.total_lines or (base_row + #lines - 1)
  local s_row, s_col = ctx.s_row, ctx.s_col
  local e_row, e_col = ctx.e_row, ctx.e_col
  local anchor_row = ctx.anchor_row or s_row
  local anchor_col = ctx.anchor_col or s_col

  local s_line = lines[s_row - base_row + 1] or ""
  local e_line = lines[e_row - base_row + 1] or ""
  local single_line = (s_row == e_row)
  local num_lines = e_row - s_row + 1
  local practical_only = config.options.practical_only

  local candidates = {}

  local function add(rule_id, suggested, priority, reason, extra_saved, allow_zero_saved)
    if not config.is_rule_enabled(rule_id) then
      return
    end
    local saved = (actual_key_count + (extra_saved or 0)) - #suggested
    local min_saved = allow_zero_saved and 0 or (config.options.thresholds.min_keys_saved or 1)
    if saved < min_saved then
      return
    end
    candidates[#candidates + 1] = {
      rule_id = rule_id,
      actual = actual_str,
      suggested = suggested,
      keys_saved = math.max(0, saved),
      priority = priority,
      reason = reason,
    }
  end

  -- Whole file
  if s_row == 1 and e_row == total_lines and total_lines >= 4 then
    local full_start = is_linewise or s_col <= buf.first_non_blank(s_line)
    local full_end = is_linewise or e_col >= buf.last_char_col(e_line)
    if full_start and full_end then
      local cmd = "gg" .. prefix .. "G"
      add(
        "visual_whole_file",
        cmd,
        96,
        string.format("Use `%s` to %s the entire buffer directly.", cmd, verb)
      )
    end
  end

  -- Whole single line
  if single_line and LINEWISE_SHORTCUT[op] then
    local covers_line = is_linewise
      or (s_col == 1 and e_col >= buf.last_char_col(s_line) and #s_line > 0)
      or (s_col <= buf.first_non_blank(s_line) and e_col >= buf.last_char_col(s_line) and actual_key_count >= 4)

    if covers_line then
      local cmd = LINEWISE_SHORTCUT[op]
      local reason = string.format("Use `%s` to %s the whole line directly without Visual mode (dot-repeatable with `.`).", cmd, verb)
      if op == "c" then
        reason = "Use `cc` (or `S`) to change the whole line directly while keeping indentation."
      end
      add("visual_whole_line", cmd, 95, reason, 0, true)
    end
  end

  -- Text objects (quotes, tags, brackets, paragraphs, words)
  if single_line and not is_linewise then
    local quote_obj = buf.match_quote_object(s_line, s_col, e_col)
    if quote_obj then
      local cmd = prefix .. quote_obj
      local extra = #pre_nav_keys > 0 and #pre_nav_keys or 0
      local reason = string.format(
        "Use `%s` to %s %s quotes directly — works from anywhere inside (or before) them on the line.",
        cmd,
        verb,
        quote_obj:sub(1, 1) == "i" and "inside" or "around"
      )
      add("textobj_quotes", cmd, 100, reason, extra, true)
    end
  end

  -- 3b. HTML / XML Tags (`it` / `at`)
  local tag_obj = buf.match_tag_object(lines, s_row, s_col, e_row, e_col, base_row)
  if tag_obj then
    local cmd = prefix .. tag_obj
    add(
      "textobj_tag",
      cmd,
      98,
      string.format(
        "Use `%s` to %s %s the HTML/XML tag directly without Visual mode.",
        cmd,
        verb,
        tag_obj == "it" and "inside" or "around"
      ),
      0,
      true
    )
  end

  -- 3c. Brackets (`i(`, `a(`, `i[`, `a[`, `i{`, `a{`, `i<`, `a<`)
  local bracket_obj = buf.match_bracket_object(lines, s_row, s_col, e_row, e_col, base_row, is_linewise)
  if bracket_obj then
    local cmd = prefix .. bracket_obj
    local extra = #pre_nav_keys > 0 and #pre_nav_keys or 0
    add(
      "textobj_brackets",
      cmd,
      97,
      string.format(
        "Use `%s` to %s %s the matching `%s` block directly (dot-repeatable with `.`).",
        cmd,
        verb,
        bracket_obj:sub(1, 1) == "i" and "inside" or "around",
        bracket_obj:sub(2, 2)
      ),
      extra,
      true
    )
  end

  -- 3d. Paragraphs (`ip` / `ap`) for multi-line selections
  if num_lines >= 2 and (is_linewise or (s_col <= buf.first_non_blank(s_line) and e_col >= buf.last_char_col(e_line))) then
    local para_obj = buf.match_paragraph_object(lines, s_row, e_row, base_row, total_lines)
    if para_obj then
      local cmd = prefix .. para_obj
      add(
        "textobj_paragraph",
        cmd,
        94,
        string.format(
          "Use `%s` to %s the entire paragraph block directly without selecting line by line.",
          cmd,
          verb
        ),
        0,
        true
      )
    end
  end

  -- 3e. Word / WORD (`iw`, `aw`, `iW`, `aW`)
  if single_line and not is_linewise then
    local word_obj = buf.match_word_object(s_line, s_col, e_col)
    if word_obj then
      -- If user started at the exact first character of the word (and didn't walk there first),
      -- `cw` / `de` / `dw` may be even shorter than `ciw` / `diw`.
      local cmd = prefix .. word_obj
      local extra = #pre_nav_keys > 0 and #pre_nav_keys or 0
      local reason = string.format(
        "Use `%s` to %s the entire word from anywhere inside it — no Visual mode needed.",
        cmd,
        verb
      )
      if word_obj == "iw" and anchor_col == s_col and extra == 0 and op == "c" then
        cmd = "cw"
        reason = "Since your cursor was at the start of the word, `cw` (or `ciw`) changes it directly."
      end
      add("textobj_word", cmd, 92, reason, extra)
    end
  end

  -- To end/start of line
  if single_line and not is_linewise then
    local line_end = buf.last_char_col(s_line)
    local first_nb = buf.first_non_blank(s_line)

    -- Cursor started inside line and selected through end of line
    if anchor_col == s_col and e_col >= line_end and s_col > 1 then
      if op == "d" then
        add("visual_to_eol", "D", 93, "Use `D` to delete from cursor to end of line in 1 key.")
      elseif op == "c" then
        add("visual_to_eol", "C", 93, "Use `C` to change from cursor to end of line in 1 key.")
      elseif op == "y" then
        local cmd = config.options.assume_nvim_Y and "Y" or "y$"
        add("visual_to_eol", cmd, 91, string.format("Use `%s` to yank from cursor to end of line directly.", cmd))
      end
    end

    -- Selected backward to column 0 or first non-blank
    if anchor_col == e_col and e_col > s_col then
      if s_col == 1 and actual_key_count >= 3 then
        local cmd = prefix .. "0"
        add("visual_to_sol", cmd, 86, string.format("Use `%s` to %s back to column 0 directly.", cmd, verb))
      elseif s_col == first_nb and first_nb > 1 and actual_key_count >= 3 then
        local cmd = prefix .. "^"
        add("visual_to_sol", cmd, 86, string.format("Use `%s` to %s back to the first non-blank character.", cmd, verb))
      end
    end
  end

  local direct_cmd = detect_unnecessary_visual_keys(keys, op)
  if direct_cmd then
    add(
      "visual_unnecessary",
      direct_cmd,
      88,
      string.format("Skip Visual mode — `%s` is shorter and dot-repeatable with `.`.", direct_cmd)
    )
  end

  if single_line and not is_linewise and actual_key_count >= 4 then
    local forward = (anchor_col == s_col and e_col > anchor_col)

    -- 6a. Forward word motion (`dw` / `de` / `2dw`)
    if forward then
      -- `de` / `ce` / `ye` is inclusive through e_col
      local wm_end = buf.best_word_motion(s_line, anchor_col, e_col, 2)
      if wm_end and wm_end.motion:match("e$") then
        local cmd = prefix .. wm_end.motion
        add(
          "visual_motion_direct",
          cmd,
          82,
          string.format("Use `%s` to %s directly to the word end without Visual mode.", cmd, verb)
        )
      end

      -- `dw` / `yw` is exclusive (deletes up to char before next word start -> e_col + 1)
      if op ~= "c" and e_col < #s_line then
        local wm_next = buf.best_word_motion(s_line, anchor_col, e_col + 1, 2)
        if wm_next and wm_next.motion:match("w$") then
          local cmd = prefix .. wm_next.motion
          add(
            "visual_motion_direct",
            cmd,
            84,
            string.format("Use `%s` to %s directly by word without stepping in Visual mode.", cmd, verb)
          )
        end
      end

      -- 6b. Forward inline char target (`df<ch>` / `dt<ch>` / `cf<ch>` / `ct<ch>`)
      local cf = buf.best_char_find(s_line, anchor_col, e_col, practical_only)
      if cf and (cf.kind == "f" or cf.kind == "t") then
        local cmd = prefix .. cf.motion
        add(
          "visual_motion_direct",
          cmd,
          cf.distinctive and 85 or 76,
          string.format("Use `%s` to %s directly up to `%s` without stepping in Visual mode.", cmd, verb, cf.char)
        )
      end
    end
  end

  if is_linewise and num_lines >= (config.options.thresholds.vertical_count_min or 4) then
    -- Count how many j/k/arrow presses were used inside Visual Line mode
    local step_count = 0
    for i = 2, #keys - 1 do
      if keys[i] == "j" or keys[i] == "k" or keys[i] == "<Down>" or keys[i] == "<Up>" then
        step_count = step_count + 1
      end
    end

    if step_count >= (config.options.thresholds.vertical_count_min or 4) and num_lines <= 20 then
      if LINEWISE_SHORTCUT[op] and anchor_row == s_row then
        local cmd = tostring(num_lines) .. LINEWISE_SHORTCUT[op]
        add(
          "visual_multi_line",
          cmd,
          80,
          string.format("Use `%s` (or `%s%dj`) instead of tapping `j` %d times in Visual Line mode.", cmd, prefix, num_lines - 1, step_count)
        )
      else
        local dir = (anchor_row == s_row) and "j" or "k"
        local cmd = string.format("%s%d%s", prefix, num_lines - 1, dir)
        add(
          "visual_multi_line",
          cmd,
          78,
          string.format("Use `%s` instead of tapping `%s` %d times in Visual Line mode.", cmd, dir, step_count)
        )
      end
    end
  end

  -- Also check if total_effort_keys was huge even if visual alone was short (unused var guard)
  local _ = total_effort_keys

  return candidates
end

return M
