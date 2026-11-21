local config = require("vimcoach.config")
local buf = require("vimcoach.buffer_utils")
local mastery = require("vimcoach.mastery")
local analyzers = require("vimcoach.analyzers")

local uv = vim.uv or vim.loop

local M = {}

local ns_id = vim.api.nvim_create_namespace("vimcoach_keystream")
local augroup = nil
local attached = false
local keys_seen = 0
local keys_dropped_typed = 0
local last_key_seen = ""

local NAV_KEYS = {
  h = true, j = true, k = true, l = true,
  w = true, W = true, b = true, B = true, e = true, E = true,
  ["0"] = true, ["^"] = true, ["$"] = true,
  f = true, F = true, t = true, T = true,
  [";"] = true, [","] = true,
  ["<Left>"] = true, ["<Right>"] = true, ["<Up>"] = true, ["<Down>"] = true,
}

local INSERT_ENTRY_KEYS = {
  i = true, a = true, I = true, A = true, o = true, O = true, s = true, S = true, C = true,
}

local VISUAL_OPERATORS = {
  d = true, c = true, y = true, x = true, X = true, s = true, S = true,
  D = true, C = true, Y = true, [">"] = true, ["<"] = true, ["="] = true,
  ["~"] = true, u = true, U = true,
}

local OPERATOR_PREFIXES = {
  d = true, c = true, y = true, [">"] = true, ["<"] = true, ["="] = true,
}

local ARROW_KEYS = {
  ["<Left>"] = true, ["<Right>"] = true, ["<Up>"] = true, ["<Down>"] = true,
}

local state = {
  -- Pending multi-key modifiers in Normal mode
  awaiting_char_for = nil, -- "f"|"F"|"t"|"T"|"r"|"m"|"'"|"`"|'"'
  pending_prefix = nil,    -- "g"|"z"|"<C-w>"
  pending_op = nil,        -- { op = "d"|"c"|"y"|..., keys = {}, row = int, col = int, line = str, ts_ms = int, awaiting_target = nil }
  pending_count = "",

  -- Navigation episode
  nav = nil,               -- { bufnr, start_row, start_col, keys, last_ts_ms }
  nav_timer = nil,
  last_completed_nav = nil, -- Kept briefly so `0i`/`$a`/`v` can inspect preceding nav

  -- Last normal-mode key & delete context
  last_normal_key = nil,
  last_normal_ts = 0,
  last_delete = nil,       -- { cmd, row, col, ts_ms, deleted_text, deleted_word }
  after_search_next = false,
  last_jump_origin = nil,  -- { row, col, ts_ms }

  -- Consecutive x/X and dd/yy runs
  x_run = nil,             -- { key, count, before_line, start_col, row, last_ts_ms }
  line_op_run = nil,       -- { op, count, last_ts_ms }

  -- Visual session
  visual = nil,            -- { mode, anchor_row, anchor_col, keys, awaiting_char, awaiting_textobj, pre_nav }

  -- Insert session
  insert = nil,            -- { entry_key, prev_delete, inserted_keys, before_line, before_row, before_col, before_line_count, deleted_word, bs_count, bs_start_col, arrow_keys }

  -- Search cmdline
  search_cword = nil,
  search_cmdtype = nil,
}

local function now_ms()
  return math.floor(uv.hrtime() / 1e6)
end

local function get_cursor_1indexed()
  local ok, pos = pcall(vim.api.nvim_win_get_cursor, 0)
  if not ok or not pos then
    return 1, 1
  end
  return pos[1], pos[2] + 1
end

local function is_ignored_key(k)
  if not k or k == "" then
    return true
  end
  if k:find("Mouse", 1, true)
    or k:find("Scroll", 1, true)
    or k:find("Drag", 1, true)
    or k:find("Release", 1, true)
    or k:find("Focus", 1, true)
    or k == "<Ignore>"
    or k == "<Nop>"
    or k == "<Plug>"
  then
    return true
  end
  return false
end

local function stop_nav_timer()
  if state.nav_timer then
    pcall(function()
      state.nav_timer:stop()
      state.nav_timer:close()
    end)
    state.nav_timer = nil
  end
end

local function capture_nav_context(snapshot)
  if snapshot.lines or not vim.api.nvim_buf_is_valid(snapshot.bufnr) then
    return
  end
  if vim.api.nvim_get_current_buf() ~= snapshot.bufnr then
    return
  end
  local total_lines = vim.api.nvim_buf_line_count(snapshot.bufnr)
  local min_r = math.max(1, math.min(snapshot.start_row, snapshot.end_row) - 2)
  local max_r = math.min(total_lines, math.max(snapshot.start_row, snapshot.end_row) + 2)
  snapshot.lines = buf.get_lines(snapshot.bufnr, min_r, max_r)
  snapshot.base_row = min_r
  snapshot.total_lines = total_lines
  snapshot.win_top = vim.fn.line("w0")
  snapshot.win_bot = vim.fn.line("w$")
end

local function analyze_nav_snapshot(snapshot)
  if not snapshot or snapshot.analyzed or not snapshot.keys or #snapshot.keys < 2 then
    return
  end
  snapshot.analyzed = true

  capture_nav_context(snapshot)

  local jump_origin = state.last_jump_origin
  if jump_origin and (now_ms() - jump_origin.ts_ms > 12000) then
    jump_origin = nil
  end

  vim.schedule(function()
    if not vim.api.nvim_buf_is_valid(snapshot.bufnr) then
      return
    end
    if vim.api.nvim_get_current_buf() ~= snapshot.bufnr then
      return
    end
    if config.is_buffer_disabled(snapshot.bufnr) then
      return
    end

    snapshot.last_jump_origin = jump_origin

    local candidates = analyzers.navigation.analyze(snapshot)
    analyzers.emit(candidates)
  end)
end

---Flush the active navigation episode and analyze it (unless `suppress_emit` is true).
---@param suppress_emit boolean|nil
local function flush_nav(suppress_emit)
  stop_nav_timer()
  local nav = state.nav
  state.nav = nil
  if not nav or #nav.keys == 0 then
    return nil
  end

  local row, col = get_cursor_1indexed()
  local snapshot = {
    bufnr = nav.bufnr,
    start_row = nav.start_row,
    start_col = nav.start_col,
    end_row = row,
    end_col = col,
    keys = nav.keys,
    elapsed_ms = now_ms() - nav.last_ts_ms,
    ts_ms = now_ms(),
    analyzed = false,
  }
  state.last_completed_nav = snapshot

  if not suppress_emit then
    analyze_nav_snapshot(snapshot)
  end

  return snapshot
end

local function reset_nav_timer()
  stop_nav_timer()
  local timeout = config.options.thresholds.episode_timeout_ms or 1100
  state.nav_timer = uv.new_timer()
  if state.nav_timer then
    state.nav_timer:start(timeout, 0, vim.schedule_wrap(function()
      flush_nav(false)
    end))
  end
end

local function flush_x_run()
  local xr = state.x_run
  state.x_run = nil
  if not xr or xr.count < (config.options.thresholds.repeat_x_min or 3) then
    return
  end
  vim.schedule(function()
    local candidates = analyzers.editing.analyze_repeated_x(xr)
    analyzers.emit(candidates)
  end)
end

local function flush_line_op_run()
  local lr = state.line_op_run
  state.line_op_run = nil
  if not lr or lr.count < (config.options.thresholds.repeat_line_op_min or 4) then
    return
  end
  vim.schedule(function()
    local candidates = analyzers.repetition.analyze_repeated_line_op(lr)
    analyzers.emit(candidates)
  end)
end

local function record_jump_origin(row, col)
  state.last_jump_origin = { row = row, col = col, ts_ms = now_ms() }
end

---Record positive usage for idiomatic single-key/compound Vim motions.
---@param rule_id string
local function praise(rule_id)
  vim.schedule(function()
    mastery.record_good(rule_id)
  end)
end

---Start tracking an Insert session (called right before entering Insert mode).
---@param entry_key string
---@param prev_delete table|nil
---@param prev_nav table|nil
local function begin_insert_session(entry_key, prev_delete, prev_nav)
  local bufnr = vim.api.nvim_get_current_buf()
  local row, col = get_cursor_1indexed()
  local line = buf.get_line(bufnr, row)
  local line_count = vim.api.nvim_buf_line_count(bufnr)
  local word = buf.word_at(line, col)

  state.insert = {
    bufnr = bufnr,
    entry_key = entry_key,
    prev_delete = prev_delete,
    inserted_keys = {},
    before_line = line,
    before_row = row,
    before_col = col,
    before_line_count = line_count,
    deleted_word = (prev_delete and prev_delete.deleted_word) or word,
    bs_count = 0,
    bs_start_col = nil,
    arrow_keys = {},
    after_search_next = state.after_search_next,
    ts_ms = now_ms(),
  }

  -- Check entry-time combos (0i -> I, $a -> A, dw+i -> cw, dd+O -> cc, li -> a, ha -> i, ko -> O)
  local entry_ctx = {
    insert_key = entry_key,
    prev_nav = prev_nav,
    prev_delete = prev_delete,
    line = line,
    row = row,
    col = col,
    total_lines = line_count,
  }

  if prev_nav and not prev_nav.analyzed and prev_nav.keys and #prev_nav.keys >= 2 then
    capture_nav_context(prev_nav)
  end

  vim.schedule(function()
    local candidates = analyzers.editing.analyze_insert_entry(entry_ctx)
    if #candidates > 0 then
      analyzers.emit(candidates)
    elseif prev_nav and not prev_nav.analyzed then
      analyze_nav_snapshot(prev_nav)
    end
  end)
end

local function handle_normal_key(k, t)
  local bufnr = vim.api.nvim_get_current_buf()
  local row, col = get_cursor_1indexed()

  -- 1. Consume target char for f/F/t/T/r/m/'/`/"
  if state.awaiting_char_for then
    local cmd = state.awaiting_char_for
    state.awaiting_char_for = nil

    if k == "<Esc>" or k == "<C-c>" then
      return
    end

    if cmd:match("^[fFtT]$") then
      if state.nav then
        state.nav.keys[#state.nav.keys + 1] = k
        state.nav.last_ts_ms = t
        reset_nav_timer()
      end
      praise("nav_find_char")
    elseif cmd == "r" then
      praise("edit_replace_char")
      -- Check if `r<ch>` was actually a case flip (`rA` on `a`)!
      local line = buf.get_line(bufnr, row)
      local cur_ch = line:sub(col, col)
      if #k == 1 and #cur_ch == 1 and cur_ch ~= k and cur_ch:lower() == k:lower() and cur_ch:match("%a") then
        vim.schedule(function()
          analyzers.emit({
            {
              rule_id = "edit_toggle_case",
              actual = "r" .. k,
              suggested = "~",
              keys_saved = 1,
              priority = 88,
              reason = string.format("Press `~` to toggle `%s` → `%s` in 1 key instead of `r%s`.", cur_ch, k, k),
            },
          })
        end)
      end
    end
    return
  end

  -- 2. Consume second key of `g` / `z` / `<C-w>` prefix
  if state.pending_prefix then
    local p = state.pending_prefix
    state.pending_prefix = nil
    if p == "g" then
      if k == "g" then
        record_jump_origin(row, col)
        praise("nav_file_bounds")
      elseif k == "J" then
        praise("edit_join_lines")
      end
    end
    return
  end

  -- 3. Active operator-pending sequence (e.g. `d`, `c`, `y`, `>`, `<`, `=`)
  if state.pending_op then
    local po = state.pending_op
    if k == "<Esc>" or k == "<C-c>" then
      state.pending_op = nil
      return
    end

    -- Still awaiting the target character for e.g. `dt<ch>` or `di"`
    if po.awaiting_target then
      po.keys[#po.keys + 1] = k
      po.awaiting_target = nil
    else
      -- Digits inside operator-pending mode are a count prefix (e.g. `d2w`, `c10j`)
      if k:match("^[1-9]$") or (k == "0" and po.in_count) then
        po.keys[#po.keys + 1] = k
        po.in_count = true
        return
      end
      po.in_count = false
      po.keys[#po.keys + 1] = k
      -- Does this motion need another character? (i/a textobj, f/F/t/T, g prefix like cgn)
      if k == "i" or k == "a" or k == "f" or k == "F" or k == "t" or k == "T" or k == "g" then
        po.awaiting_target = k
        return
      end
    end

    -- Complete operator command!
    local full_cmd = table.concat(po.keys, "")
    state.pending_op = nil

    -- Praise idiomatic text objects & cgn & linewise ops
    if full_cmd:match('^[dcy><=][ia]["\'`]$') then
      praise("textobj_quotes")
    elseif full_cmd:match("^[dcy><=][ia][%(%)%[%]%{%}<>bB]$") then
      praise("textobj_brackets")
    elseif full_cmd:match("^[dcy><=][ia][t]$") then
      praise("textobj_tag")
    elseif full_cmd:match("^[dcy><=][ia][wW]$") then
      praise("textobj_word")
    elseif full_cmd:match("^[dcy><=][ia]p$") then
      praise("textobj_paragraph")
    elseif full_cmd == "cgn" or full_cmd == "cgN" then
      praise("rep_cgn")
    elseif full_cmd == ">>" or full_cmd == "<<" or full_cmd == "==" then
      praise("edit_indent")
    end

    -- Track consecutive `dd` / `yy`
    if full_cmd == "dd" or full_cmd == "yy" then
      if state.line_op_run and state.line_op_run.op == full_cmd and (t - state.line_op_run.last_ts_ms) <= 1500 then
        state.line_op_run.count = state.line_op_run.count + 1
        state.line_op_run.last_ts_ms = t
      else
        flush_line_op_run()
        state.line_op_run = { op = full_cmd, count = 1, last_ts_ms = t }
      end
    else
      flush_line_op_run()
    end

    -- Check direct operator optimizations (`d$` -> `D`, `c$` -> `C`, `y$` -> `Y`, `0d$` -> `dd`)
    local prev_key = (t - state.last_normal_ts <= 900) and state.last_normal_key or nil
    vim.schedule(function()
      local candidates = analyzers.editing.analyze_operator({ cmd = full_cmd, prev_key = prev_key })
      analyzers.emit(candidates)
    end)

    -- Record delete context for `d{motion}` + `i` -> `c{motion}`
    if po.op == "d" then
      local word = buf.word_at(po.line, po.col)
      state.last_delete = {
        cmd = full_cmd,
        row = po.row,
        col = po.col,
        ts_ms = t,
        deleted_word = word,
      }
      -- Record non-trivial delete for dot-repeat detection
      if #full_cmd >= 3 then
        vim.schedule(function()
          local cands = analyzers.repetition.analyze_edit_repeat({
            signature = "op:" .. full_cmd,
            display = full_cmd,
            key_cost = #full_cmd,
            ts_ms = t,
            after_search_next = state.after_search_next,
          })
          analyzers.emit(cands)
        end)
      end
    elseif po.op == "c" then
      -- Entering Insert mode via `c...`!
      begin_insert_session(full_cmd, nil, nil)
    end

    return
  end

  -- 4. Count prefix digits (`1`-`9`, or `0` continuing a count)
  if k:match("^[1-9]$") or (k == "0" and #state.pending_count > 0) then
    flush_x_run()
    flush_line_op_run()
    state.pending_count = state.pending_count .. k
    return
  end

  local had_count = (#state.pending_count > 0)
  state.pending_count = ""

  -- 5. Flush x-run if key is not x/X
  if k ~= "x" and k ~= "X" then
    flush_x_run()
  end

  -- 6. Visual mode entry (`v` / `V` / `<C-v>`)
  if k == "v" or k == "V" or k == "<C-v>" then
    local pre_nav = flush_nav(true)
    if pre_nav and (t - pre_nav.ts_ms > 2000) then
      pre_nav = nil
    end
    flush_line_op_run()
    state.visual = {
      mode = k == "<C-v>" and "\22" or k,
      anchor_row = row,
      anchor_col = col,
      keys = { k },
      awaiting_char = false,
      awaiting_textobj = false,
      pre_nav = pre_nav,
    }
    return
  end

  -- 7. Pure navigation keys -> accumulate into Navigation Episode
  if NAV_KEYS[k] and not had_count then
    flush_line_op_run()
    state.after_search_next = false

    -- Praise single idiomatic jumps
    if k == "0" or k == "^" then
      praise("nav_line_start")
    elseif k == "$" then
      praise("nav_line_end")
    elseif k == ";" or k == "," then
      praise("nav_repeat_find")
    end

    if not state.nav or state.nav.bufnr ~= bufnr or (t - state.nav.last_ts_ms) > (config.options.thresholds.episode_timeout_ms or 1100) then
      flush_nav(false)
      state.nav = {
        bufnr = bufnr,
        start_row = row,
        start_col = col,
        keys = { k },
        last_ts_ms = t,
      }
    else
      state.nav.keys[#state.nav.keys + 1] = k
      state.nav.last_ts_ms = t
    end

    if k:match("^[fFtT]$") then
      state.awaiting_char_for = k
    end

    reset_nav_timer()
    state.last_normal_key = k
    state.last_normal_ts = t
    return
  end

  -- Counted navigation (e.g. `6j`, `3w`) -> praise and flush any prior uncounted nav!
  if NAV_KEYS[k] and had_count then
    flush_nav(false)
    if k == "j" or k == "k" then
      praise("nav_vertical_count")
    elseif k == "w" or k == "b" or k == "e" then
      praise("nav_word_jump")
    end
    return
  end

  -- 8. Insert entry keys (`i`, `a`, `I`, `A`, `o`, `O`, `s`, `S`, `C`)
  if INSERT_ENTRY_KEYS[k] then
    -- Suppress nav emit if this insert entry may absorb it (e.g. `0i`, `$a`, `llllla`, `li`, `ha`, `ko`)
    local prev_nav = flush_nav(true)
    if not prev_nav and state.last_completed_nav and (t - state.last_completed_nav.ts_ms <= 900) then
      prev_nav = state.last_completed_nav
    end
    flush_line_op_run()

    -- Praise idiomatic direct entries when NOT preceded by redundant motion
    if k == "I" then praise("edit_insert_line_start")
    elseif k == "A" then praise("edit_append_line_end")
    elseif k == "o" or k == "O" then praise("edit_open_line")
    elseif k == "C" then praise("edit_delete_to_eol")
    elseif k == "s" or k == "S" then praise("edit_substitute_char")
    end

    local prev_del = nil
    if state.last_delete and (t - state.last_delete.ts_ms) <= (config.options.thresholds.combo_window_ms or 1600) then
      prev_del = vim.deepcopy(state.last_delete)
      prev_del.elapsed_ms = t - state.last_delete.ts_ms
    end
    state.last_delete = nil

    begin_insert_session(k, prev_del, prev_nav)
    return
  end

  -- Any other key ends the current navigation episode
  flush_nav(false)

  -- 9. Single-key Normal operators & idiomatic motions
  if OPERATOR_PREFIXES[k] then
    local line = buf.get_line(bufnr, row)
    state.pending_op = {
      op = k,
      keys = { k },
      row = row,
      col = col,
      line = line,
      ts_ms = t,
      awaiting_target = nil,
    }
    return
  end

  if k == "x" or k == "X" then
    local line = buf.get_line(bufnr, row)
    local del_ch = (k == "x") and line:sub(col, col) or (col > 1 and line:sub(col - 1, col - 1) or "")
    state.last_delete = {
      cmd = k,
      row = row,
      col = col,
      ts_ms = t,
      deleted_text = del_ch,
    }
    if state.x_run and state.x_run.key == k and state.x_run.row == row and (t - state.x_run.last_ts_ms) <= 1200 then
      state.x_run.count = state.x_run.count + 1
      state.x_run.last_ts_ms = t
    else
      flush_x_run()
      state.x_run = {
        key = k,
        count = 1,
        before_line = line,
        start_col = col,
        row = row,
        last_ts_ms = t,
      }
    end
    return
  end

  if k == "D" then
    praise("edit_delete_to_eol")
    state.last_delete = { cmd = "D", row = row, col = col, ts_ms = t }
  elseif k == "Y" then
    praise("edit_delete_to_eol")
  elseif k == "%" then
    record_jump_origin(row, col)
    praise("nav_matching_pair")
  elseif k == "G" then
    record_jump_origin(row, col)
    praise("nav_file_bounds")
  elseif k == "}" or k == "{" then
    record_jump_origin(row, col)
    praise("nav_paragraph")
  elseif k == "<C-d>" or k == "<C-u>" or k == "<C-f>" or k == "<C-b>" then
    record_jump_origin(row, col)
    praise("nav_half_page")
  elseif k == "H" or k == "M" or k == "L" then
    record_jump_origin(row, col)
    praise("nav_viewport")
  elseif k == "<C-o>" or k == "<C-i>" then
    praise("nav_jumplist")
  elseif k == "*" or k == "#" then
    record_jump_origin(row, col)
    state.after_search_next = true
    praise("rep_star_search")
  elseif k == "n" or k == "N" then
    state.after_search_next = true
  elseif k == "." then
    praise("rep_dot")
  elseif k == "~" then
    praise("edit_toggle_case")
  elseif k == "<C-a>" or k == "<C-x>" then
    praise("edit_increment_number")
  elseif k == "J" then
    praise("edit_join_lines")
  elseif k == "r" or k == "m" or k == "'" or k == "`" or k == '"' then
    state.awaiting_char_for = k
  elseif k == "g" or k == "z" or k == "<C-w>" then
    state.pending_prefix = k
  end

  state.last_normal_key = k
  state.last_normal_ts = t
end

local function handle_visual_key(k, mode)
  if not state.visual then
    local row, col = get_cursor_1indexed()
    state.visual = {
      mode = mode,
      anchor_row = row,
      anchor_col = col,
      keys = { mode == "\22" and "<C-v>" or mode },
      awaiting_char = false,
      awaiting_textobj = false,
      pre_nav = nil,
    }
  end

  local vs = state.visual

  -- Cancel visual mode cleanly
  if k == "<Esc>" or k == "<C-c>" or (k == vs.mode and not vs.awaiting_char and not vs.awaiting_textobj) then
    state.visual = nil
    return
  end

  -- Consume target char for f/F/t/T or i/a text objects inside Visual mode
  if vs.awaiting_char then
    vs.keys[#vs.keys + 1] = k
    vs.awaiting_char = false
    return
  end

  if vs.awaiting_textobj then
    vs.keys[#vs.keys + 1] = k
    vs.awaiting_textobj = false
    return
  end

  if k:match("^[fFtT]$") then
    vs.keys[#vs.keys + 1] = k
    vs.awaiting_char = true
    return
  end

  if k == "i" or k == "a" then
    vs.keys[#vs.keys + 1] = k
    vs.awaiting_textobj = true
    return
  end

  -- Operator applied to the Visual selection!
  -- Capture exact selection bounds & intact buffer lines RIGHT BEFORE Neovim executes the edit!
  if VISUAL_OPERATORS[k] then
    vs.keys[#vs.keys + 1] = k
    local bufnr = vim.api.nvim_get_current_buf()
    local v_pos = vim.fn.getpos("v")
    local c_pos = vim.fn.getpos(".")
    local v_row, v_col = v_pos[2], v_pos[3]
    local c_row, c_col = c_pos[2], c_pos[3]

    local s_row, s_col, e_row, e_col = v_row, v_col, c_row, c_col
    if s_row > e_row or (s_row == e_row and s_col > e_col) then
      s_row, s_col, e_row, e_col = e_row, e_col, s_row, s_col
    end

    local total_lines = vim.api.nvim_buf_line_count(bufnr)
    local min_r = math.max(1, s_row - 2)
    local max_r = math.min(total_lines, e_row + 2)
    local lines = buf.get_lines(bufnr, min_r, max_r)

    local snapshot = {
      visual_mode = vs.mode,
      operator = k,
      s_row = s_row,
      s_col = s_col,
      e_row = e_row,
      e_col = e_col,
      anchor_row = vs.anchor_row,
      anchor_col = vs.anchor_col,
      keys = vim.deepcopy(vs.keys),
      pre_nav = vs.pre_nav,
      lines = lines,
      base_row = min_r,
      total_lines = total_lines,
    }

    state.visual = nil

    vim.schedule(function()
      local candidates = analyzers.visual.analyze(snapshot)
      analyzers.emit(candidates)
    end)
    return
  end

  -- Switching between `v` and `V`
  if k == "v" or k == "V" then
    vs.mode = k
  end

  vs.keys[#vs.keys + 1] = k
end

local function handle_insert_key(k)
  if not state.insert then
    return
  end

  local ins = state.insert

  -- Track positive usage of <C-w> / <C-u>
  if k == "<C-w>" then
    praise("insert_ctrl_w")
    ins.bs_count = 0
    return
  elseif k == "<C-u>" then
    praise("insert_ctrl_u")
    ins.bs_count = 0
    return
  end

  -- Track consecutive <BS> runs
  if k == "<BS>" then
    if ins.bs_count == 0 then
      local _, col = get_cursor_1indexed()
      ins.bs_start_col = col
    end
    ins.bs_count = ins.bs_count + 1
  else
    if ins.bs_count >= (config.options.thresholds.insert_bs_min or 4) then
      local count = ins.bs_count
      local _, col = get_cursor_1indexed()
      local cleared_to_sol = (col <= 2)
      vim.schedule(function()
        local cands = analyzers.insert.analyze_backspace_run({
          count = count,
          cleared_to_sol = cleared_to_sol,
        })
        analyzers.emit(cands)
      end)
    end
    ins.bs_count = 0
    ins.bs_start_col = nil
  end

  -- Track arrow keys inside Insert mode
  if ARROW_KEYS[k] then
    ins.arrow_keys[#ins.arrow_keys + 1] = k
  else
    if #ins.arrow_keys >= (config.options.thresholds.insert_arrow_min or 3) then
      local keys_copy = vim.deepcopy(ins.arrow_keys)
      vim.schedule(function()
        local cands = analyzers.insert.analyze_insert_arrows({ keys = keys_copy })
        analyzers.emit(cands)
      end)
    end
    ins.arrow_keys = {}
  end

  if k ~= "<Esc>" and k ~= "<C-c>" and k ~= "<C-[>" and #ins.inserted_keys < 80 then
    ins.inserted_keys[#ins.inserted_keys + 1] = k
  end
end

local function on_insert_leave()
  local ins = state.insert
  state.insert = nil
  if not ins then
    return
  end

  -- Flush any trailing <BS> or arrow bursts
  if ins.bs_count >= (config.options.thresholds.insert_bs_min or 4) then
    local _, col = get_cursor_1indexed()
    local cands = analyzers.insert.analyze_backspace_run({
      count = ins.bs_count,
      cleared_to_sol = (col <= 2),
    })
    analyzers.emit(cands)
  end
  if #ins.arrow_keys >= (config.options.thresholds.insert_arrow_min or 3) then
    local cands = analyzers.insert.analyze_insert_arrows({ keys = ins.arrow_keys })
    analyzers.emit(cands)
  end

  local bufnr = ins.bufnr
  if not vim.api.nvim_buf_is_valid(bufnr) or config.is_buffer_disabled(bufnr) then
    return
  end

  local after_row, after_col = get_cursor_1indexed()
  local after_line = buf.get_line(bufnr, after_row)
  local after_line_count = vim.api.nvim_buf_line_count(bufnr)
  local after_word = buf.word_at(after_line, after_col)

  local leave_ctx = {
    entry_key = ins.entry_key,
    prev_delete = ins.prev_delete,
    inserted_keys = ins.inserted_keys,
    before_line = ins.before_line,
    after_line = after_line,
    before_row = ins.before_row,
    after_row = after_row,
    before_col = ins.before_col,
    before_line_count = ins.before_line_count,
    after_line_count = after_line_count,
    deleted_word = ins.deleted_word,
    after_word = after_word,
  }

  local edit_cands = analyzers.editing.analyze_insert_leave(leave_ctx)
  if #edit_cands > 0 then
    analyzers.emit(edit_cands)
    return
  end

  -- Check dot-repeat / `cgn`+`.` opportunities for non-trivial complete edits
  if #ins.inserted_keys >= 1 and #ins.inserted_keys <= 30 then
    local typed_text = table.concat(ins.inserted_keys, "")
    -- Only track clean single-line text edits without arrows/complex navigation
    if not typed_text:find("<Left>", 1, true)
      and not typed_text:find("<Right>", 1, true)
      and not typed_text:find("<Up>", 1, true)
      and not typed_text:find("<Down>", 1, true)
      and not typed_text:find("<CR>", 1, true)
    then
      local key_cost = #ins.entry_key + #ins.inserted_keys + 1
      local is_change = ins.entry_key:sub(1, 1) == "c" or ins.entry_key == "C" or ins.entry_key == "s" or ins.entry_key == "S"
      local rep_cands = analyzers.repetition.analyze_edit_repeat({
        signature = ins.entry_key .. ":" .. typed_text,
        display = ins.entry_key .. typed_text .. "<Esc>",
        key_cost = key_cost,
        ts_ms = now_ms(),
        after_search_next = ins.after_search_next,
        replacement = is_change and typed_text or nil,
      })
      analyzers.emit(rep_cands)
    end
  end
end

local function on_key_cb(key, typed)
  if not config.options.enabled then
    return
  end

  -- In Neovim 0.10+, `typed == ""` means key came from a mapping/macro/plugin, not user typing.
  if typed ~= nil and typed == "" then
    keys_dropped_typed = keys_dropped_typed + 1
    return
  end
  if vim.fn.reg_executing() ~= "" then
    return
  end

  local raw = (typed and typed ~= "") and typed or key
  if not raw or raw == "" then
    return
  end

  local ok_k, k = pcall(vim.fn.keytrans, raw)
  if not ok_k or is_ignored_key(k) then
    return
  end

  keys_seen = keys_seen + 1
  last_key_seen = k

  if config.is_buffer_disabled(0) then
    return
  end

  local ok_m, mode_info = pcall(vim.api.nvim_get_mode)
  if not ok_m or not mode_info then
    return
  end
  local mode = mode_info.mode
  local t = now_ms()

  if mode == "n" or mode == "no" then
    handle_normal_key(k, t)
  elseif mode == "v" or mode == "V" or mode == "\22" then
    handle_visual_key(k, mode)
  elseif mode == "i" or mode == "ic" or mode == "ix" then
    handle_insert_key(k)
  end
end

---Attach keystroke listener & autocmds.
function M.attach()
  if attached then
    return
  end
  attached = true

  vim.on_key(on_key_cb, ns_id)

  augroup = vim.api.nvim_create_augroup("VimCoachKeystream", { clear = true })

  vim.api.nvim_create_autocmd("InsertLeave", {
    group = augroup,
    callback = function()
      if config.options.enabled then
        on_insert_leave()
      end
    end,
  })

  vim.api.nvim_create_autocmd("CmdlineEnter", {
    group = augroup,
    pattern = { "/", "?" },
    callback = function()
      if not config.options.enabled or config.is_buffer_disabled(0) then
        return
      end
      local row, col = get_cursor_1indexed()
      record_jump_origin(row, col)
      state.search_cmdtype = vim.fn.getcmdtype()
      state.search_cword = vim.fn.expand("<cword>")
    end,
  })

  vim.api.nvim_create_autocmd("CmdlineLeave", {
    group = augroup,
    pattern = { "/", "?" },
    callback = function()
      local cword = state.search_cword
      local cmdtype = state.search_cmdtype
      state.search_cword = nil
      state.search_cmdtype = nil
      if not config.options.enabled or not cword or not cmdtype then
        return
      end
      if vim.v.event and vim.v.event.abort then
        return
      end
      local pattern = vim.fn.getcmdline()
      if pattern and pattern ~= "" then
        state.after_search_next = true
        vim.schedule(function()
          local cands = analyzers.repetition.analyze_search({
            cmdtype = cmdtype,
            pattern = pattern,
            cword = cword,
          })
          analyzers.emit(cands)
        end)
      end
    end,
  })

  vim.api.nvim_create_autocmd({ "BufLeave", "WinLeave" }, {
    group = augroup,
    callback = function()
      flush_nav(true)
      flush_x_run()
      flush_line_op_run()
      state.visual = nil
      state.pending_op = nil
      state.awaiting_char_for = nil
      state.pending_prefix = nil
    end,
  })
end

---Detach keystroke listener & autocmds cleanly.
function M.detach()
  if not attached then
    return
  end
  attached = false
  stop_nav_timer()
  vim.on_key(nil, ns_id)
  if augroup then
    pcall(vim.api.nvim_del_augroup_by_id, augroup)
    augroup = nil
  end
end

---Return diagnostic state for :VimCoach debug.
---@return table
function M.debug_info()
  return {
    attached = attached,
    keys_seen = keys_seen,
    keys_dropped_typed = keys_dropped_typed,
    last_key_seen = last_key_seen,
  }
end

return M
