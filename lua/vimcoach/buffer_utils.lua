---Pure buffer-inspection & geometry utilities for VimCoach.
---All row and column coordinates in this module are 1-indexed (matching Vim's getpos() and Lua string indices).

local M = {}

local OPEN_TO_CLOSE = {
  ["("] = ")",
  ["["] = "]",
  ["{"] = "}",
  ["<"] = ">",
}

local CLOSE_TO_OPEN = {
  [")"] = "(",
  ["]"] = "[",
  ["}"] = "{",
  [">"] = "<",
}

local BRACKET_DISPLAY = {
  ["("] = "(",
  [")"] = "(",
  ["["] = "[",
  ["]"] = "[",
  ["{"] = "{",
  ["}"] = "{",
  ["<"] = "<",
  [">"] = "<",
}

-- Distinctive punctuation/delimiters that are high-signal targets for f/F/t/T
local DISTINCTIVE_CHARS = {
  ["("] = true, [")"] = true, ["["] = true, ["]"] = true,
  ["{"] = true, ["}"] = true, ["<"] = true, [">"] = true,
  ['"'] = true, ["'"] = true, ["`"] = true, ["="] = true,
  [":"] = true, [";"] = true, [","] = true, ["."] = true,
  ["/"] = true, ["?"] = true, ["!"] = true, ["@"] = true,
  ["#"] = true, ["$"] = true, ["%"] = true, ["&"] = true,
  ["*"] = true, ["+"] = true, ["-"] = true, ["|"] = true,
}

---Safely get a slice of lines (1-indexed inclusive) from a buffer.
---@param bufnr integer
---@param start_row integer 1-indexed inclusive
---@param end_row integer 1-indexed inclusive
---@return string[]
function M.get_lines(bufnr, start_row, end_row)
  bufnr = bufnr or 0
  if not vim.api.nvim_buf_is_valid(bufnr) then
    return {}
  end
  local total = vim.api.nvim_buf_line_count(bufnr)
  start_row = math.max(1, math.min(start_row, total))
  end_row = math.max(start_row, math.min(end_row, total))
  local ok, lines = pcall(vim.api.nvim_buf_get_lines, bufnr, start_row - 1, end_row, false)
  if not ok or not lines then
    return {}
  end
  return lines
end

---Get a single 1-indexed line from a buffer.
---@param bufnr integer
---@param row integer 1-indexed
---@return string
function M.get_line(bufnr, row)
  local lines = M.get_lines(bufnr, row, row)
  return lines[1] or ""
end

---Check if a line is empty or whitespace-only.
---@param line string
---@return boolean
function M.is_blank(line)
  return line == nil or line:match("^%s*$") ~= nil
end

---1-indexed column of the first non-whitespace character on the line (or 1 if blank).
---@param line string
---@return integer
function M.first_non_blank(line)
  if not line or #line == 0 then
    return 1
  end
  local idx = line:find("%S")
  return idx or 1
end

---1-indexed column of the last character on the line (or 1 if empty).
---@param line string
---@return integer
function M.last_char_col(line)
  if not line or #line == 0 then
    return 1
  end
  return #line
end

---Return true if ch is a keyword character (matching Vim's default iskeyword for code).
---@param ch string
---@return boolean
function M.is_word_char(ch)
  return ch ~= nil and ch ~= "" and ch:match("[%w_]") ~= nil
end

---Return true if ch is whitespace.
---@param ch string
---@return boolean
function M.is_space(ch)
  return ch ~= nil and ch ~= "" and ch:match("%s") ~= nil
end

---Extract the keyword word under `col` (1-indexed), plus its 1-indexed start/end cols.
---@param line string
---@param col integer 1-indexed
---@return string|nil word, integer|nil start_col, integer|nil end_col
function M.word_at(line, col)
  if not line or col < 1 or col > #line then
    return nil, nil, nil
  end
  local ch = line:sub(col, col)
  if not M.is_word_char(ch) then
    return nil, nil, nil
  end
  local s = col
  while s > 1 and M.is_word_char(line:sub(s - 1, s - 1)) do
    s = s - 1
  end
  local e = col
  while e < #line and M.is_word_char(line:sub(e + 1, e + 1)) do
    e = e + 1
  end
  return line:sub(s, e), s, e
end

---Check if [s_col..e_col] on `line` matches a word/WORD text object (`iw`, `aw`, `iW`, `aW`).
---@param line string
---@param s_col integer 1-indexed inclusive
---@param e_col integer 1-indexed inclusive
---@return string|nil textobj e.g. "iw", "aw", "iW", "aW"
function M.match_word_object(line, s_col, e_col)
  if not line or s_col < 1 or e_col < s_col or e_col > #line then
    return nil
  end

  local slice = line:sub(s_col, e_col)
  if #slice < 2 then
    return nil
  end

  local prev_ch = s_col > 1 and line:sub(s_col - 1, s_col - 1) or ""
  local next_ch = e_col < #line and line:sub(e_col + 1, e_col + 1) or ""

  -- Inner word (iw): contiguous word chars bounded by non-word chars
  if slice:match("^[%w_]+$") then
    if not M.is_word_char(prev_ch) and not M.is_word_char(next_ch) then
      return "iw"
    end
  end

  -- Around word (aw): word + trailing whitespace OR leading whitespace + word
  if slice:match("^[%w_]+%s+$") then
    if not M.is_word_char(prev_ch) and not M.is_space(next_ch) then
      return "aw"
    end
  elseif slice:match("^%s+[%w_]+$") then
    if not M.is_space(prev_ch) and not M.is_word_char(next_ch) then
      return "aw"
    end
  end

  -- Inner WORD (iW): non-whitespace run bounded by whitespace or line bounds (and contains punctuation so distinct from iw)
  if slice:match("^%S+$") and slice:match("[^%w_]") then
    local left_ok = (s_col == 1) or M.is_space(prev_ch)
    local right_ok = (e_col == #line) or M.is_space(next_ch)
    if left_ok and right_ok then
      return "iW"
    end
  end

  -- Around WORD (aW)
  if slice:match("^%S+%s+$") and slice:match("[^%w_%s]") then
    local left_ok = (s_col == 1) or M.is_space(prev_ch)
    local right_ok = (e_col == #line) or not M.is_space(next_ch)
    if left_ok and right_ok then
      return "aW"
    end
  end

  return nil
end

---Find all properly paired quote spans for a given quote char on a single line.
---Handles backslash escapes so \" does not toggle quote state.
---@param line string
---@param quote string '"' or "'" or '`'
---@return table[] list of { open_col = integer, close_col = integer }
function M.find_quote_spans(line, quote)
  local spans = {}
  local open_col = nil
  local i = 1
  local len = #line
  while i <= len do
    local ch = line:sub(i, i)
    if ch == "\\" and open_col ~= nil then
      i = i + 2 -- skip escaped character inside quotes
    elseif ch == quote then
      if open_col == nil then
        open_col = i
      else
        spans[#spans + 1] = { open_col = open_col, close_col = i }
        open_col = nil
      end
      i = i + 1
    else
      i = i + 1
    end
  end
  return spans
end

---Check if [s_col..e_col] on `line` matches a quote text object (`i"`, `a"`, `i'`, `a'`, `` i` ``, `` a` ``).
---@param line string
---@param s_col integer 1-indexed inclusive
---@param e_col integer 1-indexed inclusive
---@return string|nil textobj e.g. 'i"', 'a"'
function M.match_quote_object(line, s_col, e_col)
  if not line or s_col < 1 or e_col < s_col or e_col > #line then
    return nil
  end

  for _, q in ipairs({ '"', "'", "`" }) do
    local spans = M.find_quote_spans(line, q)
    for _, span in ipairs(spans) do
      -- Inner quote: strictly between open_col and close_col
      if s_col == span.open_col + 1 and e_col == span.close_col - 1 then
        return "i" .. q
      end
      -- Around quote: exact open_col..close_col (or with trailing space if Vim's a" includes it)
      if s_col == span.open_col and e_col == span.close_col then
        return "a" .. q
      end
    end
  end

  return nil
end

---Scan lines to find the matching bracket for the bracket at (row, col).
---`lines` is a 1-indexed array of lines covering the region; `base_row` is the buffer row of lines[1] (default 1).
---@param lines string[]
---@param row integer 1-indexed buffer row
---@param col integer 1-indexed column
---@param base_row integer|nil 1-indexed buffer row of lines[1] (default 1)
---@return integer|nil match_row, integer|nil match_col
function M.find_matching_pair(lines, row, col, base_row)
  base_row = base_row or 1
  local idx = row - base_row + 1
  local line = lines[idx]
  if not line or col < 1 or col > #line then
    return nil, nil
  end

  local ch = line:sub(col, col)
  local target_close = OPEN_TO_CLOSE[ch]
  local target_open = CLOSE_TO_OPEN[ch]

  if target_close then
    -- Scan forward
    local depth = 0
    for r_idx = idx, #lines do
      local cur_line = lines[r_idx]
      local c_start = (r_idx == idx) and col or 1
      for c = c_start, #cur_line do
        local cur = cur_line:sub(c, c)
        if cur == ch then
          depth = depth + 1
        elseif cur == target_close then
          depth = depth - 1
          if depth == 0 then
            return base_row + r_idx - 1, c
          end
        end
      end
    end
  elseif target_open then
    -- Scan backward
    local depth = 0
    for r_idx = idx, 1, -1 do
      local cur_line = lines[r_idx]
      local c_start = (r_idx == idx) and col or #cur_line
      for c = c_start, 1, -1 do
        local cur = cur_line:sub(c, c)
        if cur == ch then
          depth = depth + 1
        elseif cur == target_open then
          depth = depth - 1
          if depth == 0 then
            return base_row + r_idx - 1, c
          end
        end
      end
    end
  end

  return nil, nil
end

---Return the previous non-empty character position immediately before (row, col) in `lines`.
---@param lines string[]
---@param row integer
---@param col integer
---@param base_row integer
---@return string|nil ch, integer|nil r, integer|nil c
local function prev_char_pos(lines, row, col, base_row)
  local idx = row - base_row + 1
  local line = lines[idx]
  if not line then
    return nil, nil, nil
  end
  if col > 1 then
    return line:sub(col - 1, col - 1), row, col - 1
  end
  -- Step to previous line's last non-whitespace char (for multi-line block interiors like {\n  ...\n})
  if idx > 1 then
    local prev_line = lines[idx - 1]
    local trimmed_end = prev_line:find("%s*$")
    local last_non_ws = (trimmed_end and trimmed_end > 1) and (trimmed_end - 1) or #prev_line
    if last_non_ws >= 1 and last_non_ws <= #prev_line then
      return prev_line:sub(last_non_ws, last_non_ws), row - 1, last_non_ws
    end
  end
  return nil, nil, nil
end

---Return the next character position immediately after (row, col) in `lines`.
---@param lines string[]
---@param row integer
---@param col integer
---@param base_row integer
---@return string|nil ch, integer|nil r, integer|nil c
local function next_char_pos(lines, row, col, base_row)
  local idx = row - base_row + 1
  local line = lines[idx]
  if not line then
    return nil, nil, nil
  end
  if col < #line then
    return line:sub(col + 1, col + 1), row, col + 1
  end
  -- Step to next line's first non-whitespace char (for multi-line block interiors)
  if idx < #lines then
    local next_line = lines[idx + 1]
    local first_non_ws = next_line:find("%S")
    if first_non_ws then
      return next_line:sub(first_non_ws, first_non_ws), row + 1, first_non_ws
    end
  end
  return nil, nil, nil
end

---Check if [s_row:s_col .. e_row:e_col] matches a bracket text object (`i(`, `a(`, `i[`, `a[`, `i{`, `a{`, `i<`, `a<`).
---@param lines string[]
---@param s_row integer 1-indexed
---@param s_col integer 1-indexed
---@param e_row integer 1-indexed
---@param e_col integer 1-indexed
---@param base_row integer|nil
---@param is_linewise boolean|nil
---@return string|nil textobj e.g. "i(", "a{"
function M.match_bracket_object(lines, s_row, s_col, e_row, e_col, base_row, is_linewise)
  base_row = base_row or 1
  local s_idx = s_row - base_row + 1
  local e_idx = e_row - base_row + 1
  local s_line = lines[s_idx]
  local e_line = lines[e_idx]
  if not s_line or not e_line then
    return nil
  end

  if is_linewise then
    -- Check if the line strictly before s_row ends with `{`/`(`/`[` and line strictly after e_row starts with matching closer
    if s_idx > 1 and e_idx < #lines then
      local prev_line = lines[s_idx - 1]
      local next_line = lines[e_idx + 1]
      local open_col = prev_line:find("[%(%[{]%s*$")
      local close_col = next_line:find("^%s*[%)%]}]")
      if open_col and close_col then
        -- find exact non-space bracket columns
        local oc = open_col
        local cc = next_line:find("[%)%]}]", close_col)
        if cc then
          local mr, mc = M.find_matching_pair(lines, s_row - 1, oc, base_row)
          if mr == e_row + 1 and mc == cc then
            local bch = prev_line:sub(oc, oc)
            return "i" .. BRACKET_DISPLAY[bch]
          end
        end
      end
    end
    -- Check if s_row starts with an opener (or ends with one on same block) and e_row is its closing bracket line
    local s_nb = M.first_non_blank(s_line)
    local e_nb = M.first_non_blank(e_line)
    local sc = s_line:sub(s_nb, s_nb)
    if OPEN_TO_CLOSE[sc] then
      local mr, mc = M.find_matching_pair(lines, s_row, s_nb, base_row)
      if mr == e_row and mc == e_nb then
        return "a" .. BRACKET_DISPLAY[sc]
      end
    end
    return nil
  end

  -- 1. Check "around" bracket: s_pos is opener and e_pos is its balanced closer
  local s_ch = s_line:sub(s_col, s_col)
  if OPEN_TO_CLOSE[s_ch] then
    local mr, mc = M.find_matching_pair(lines, s_row, s_col, base_row)
    if mr == e_row and mc == e_col then
      return "a" .. BRACKET_DISPLAY[s_ch]
    end
  end

  -- 2. Check "inner" bracket: char right before s_pos is opener and its balanced closer is right after e_pos
  local p_ch, p_row, p_col = prev_char_pos(lines, s_row, s_col, base_row)
  if p_ch and OPEN_TO_CLOSE[p_ch] then
    local mr, mc = M.find_matching_pair(lines, p_row, p_col, base_row)
    local n_ch, n_row, n_col = next_char_pos(lines, e_row, e_col, base_row)
    if mr and n_ch and mr == n_row and mc == n_col then
      return "i" .. BRACKET_DISPLAY[p_ch]
    end
  end

  return nil
end

---Check if [s_row:s_col .. e_row:e_col] matches an HTML/XML tag text object (`it` or `at`).
---@param lines string[]
---@param s_row integer
---@param s_col integer
---@param e_row integer
---@param e_col integer
---@param base_row integer|nil
---@return string|nil "it"|"at"|nil
function M.match_tag_object(lines, s_row, s_col, e_row, e_col, base_row)
  base_row = base_row or 1
  local s_idx = s_row - base_row + 1
  local e_idx = e_row - base_row + 1
  local s_line = lines[s_idx]
  local e_line = lines[e_idx]
  if not s_line or not e_line then
    return nil
  end

  -- Single-line check (covers 95%+ of inline JSX/HTML tag selections)
  if s_row == e_row then
    local before = s_line:sub(1, s_col - 1)
    local after = s_line:sub(e_col + 1)
    local selected = s_line:sub(s_col, e_col)

    -- Inner tag (`it`): `before` ends with `<tag ...>` and `after` starts with `</tag>`
    local open_tag = before:match("<([%w:%-]+)[^<>]*>$")
    local close_tag = after:match("^</([%w:%-]+)%s*>")
    if open_tag and close_tag and open_tag == close_tag then
      return "it"
    end

    -- Around tag (`at`): `selected` starts with `<tag ...>` and ends with `</tag>`
    local sel_open = selected:match("^<([%w:%-]+)[^<>]*>")
    local sel_close = selected:match("</([%w:%-]+)%s*>$")
    if sel_open and sel_close and sel_open == sel_close then
      return "at"
    end
  else
    -- Multi-line check for `it` / `at`
    local prev_line = s_idx > 1 and lines[s_idx - 1] or ""
    local next_line = e_idx < #lines and lines[e_idx + 1] or ""
    local open_tag = prev_line:match("<([%w:%-]+)[^<>]*>%s*$")
    local close_tag = next_line:match("^%s*</([%w:%-]+)%s*>")
    if open_tag and close_tag and open_tag == close_tag then
      return "it"
    end

    local sel_open = s_line:sub(s_col):match("^<([%w:%-]+)[^<>]*>")
    local sel_close = e_line:sub(1, e_col):match("</([%w:%-]+)%s*>$")
    if sel_open and sel_close and sel_open == sel_close then
      return "at"
    end
  end

  return nil
end

---Check if rows [s_row..e_row] form a complete inner (`ip`) or around (`ap`) paragraph.
---Requires at least 2 lines so single-line selections prefer `dd`/`yy`/`cc` over `dip`.
---@param lines string[]
---@param s_row integer
---@param e_row integer
---@param base_row integer|nil
---@param total_lines integer|nil
---@return string|nil "ip"|"ap"|nil
function M.match_paragraph_object(lines, s_row, e_row, base_row, total_lines)
  base_row = base_row or 1
  total_lines = total_lines or (base_row + #lines - 1)
  if e_row - s_row + 1 < 2 then
    return nil
  end

  local s_idx = s_row - base_row + 1
  local e_idx = e_row - base_row + 1
  if s_idx < 1 or e_idx > #lines then
    return nil
  end

  -- Check if all lines inside s_row..e_row are non-blank -> candidate for `ip`
  local all_non_blank = true
  for i = s_idx, e_idx do
    if M.is_blank(lines[i]) then
      all_non_blank = false
      break
    end
  end

  if all_non_blank then
    local top_bounded = (s_row == 1) or (s_idx > 1 and M.is_blank(lines[s_idx - 1]))
    local bot_bounded = (e_row == total_lines) or (e_idx < #lines and M.is_blank(lines[e_idx + 1]))
    if top_bounded and bot_bounded then
      return "ip"
    end
  end

  -- Check `ap`: non-blank block + trailing blank line(s)
  local non_blank_count = 0
  local trailing_blank_count = 0
  local in_trailing = false
  local valid_ap = true
  for i = s_idx, e_idx do
    if M.is_blank(lines[i]) then
      in_trailing = true
      trailing_blank_count = trailing_blank_count + 1
    else
      if in_trailing then
        valid_ap = false
        break
      end
      non_blank_count = non_blank_count + 1
    end
  end

  if valid_ap and non_blank_count >= 2 and trailing_blank_count >= 1 then
    local top_bounded = (s_row == 1) or (s_idx > 1 and M.is_blank(lines[s_idx - 1]))
    local bot_bounded = (e_row == total_lines) or (e_idx < #lines and not M.is_blank(lines[e_idx + 1]))
    if top_bounded and bot_bounded then
      return "ap"
    end
  end

  return nil
end

---Find the best practical inline char search (`f<ch>`, `F<ch>`, `t<ch>`, `T<ch>`) from start_col to end_col.
---Respects practicality: never suggests `f ` (space) or counting >1 occurrences (or >2 with `;`).
---@param line string
---@param start_col integer 1-indexed
---@param end_col integer 1-indexed
---@param practical_only boolean|nil
---@return table|nil { motion = string, key_cost = integer, kind = "f"|"F"|"t"|"T", char = string, distinctive = boolean }
function M.best_char_find(line, start_col, end_col, practical_only)
  if not line or start_col == end_col then
    return nil
  end
  if start_col < 1 or end_col < 1 or start_col > #line or end_col > #line then
    return nil
  end

  practical_only = practical_only ~= false
  local forward = end_col > start_col
  local dist = math.abs(end_col - start_col)
  if dist < 3 then
    return nil
  end

  local target_ch = line:sub(end_col, end_col)
  local best = nil

  -- 1. Try direct f<ch> / F<ch> onto target_ch
  if not M.is_space(target_ch) then
    local count = 0
    if forward then
      for c = start_col + 1, end_col do
        if line:sub(c, c) == target_ch then
          count = count + 1
        end
      end
    else
      for c = start_col - 1, end_col, -1 do
        if line:sub(c, c) == target_ch then
          count = count + 1
        end
      end
    end

    local distinctive = DISTINCTIVE_CHARS[target_ch] == true
    local cmd = forward and "f" or "F"

    if count == 1 then
      -- First occurrence: always practical!
      -- If practical_only and lowercase common letter at tiny distance (3), only suggest if distinctive or dist >= 4
      if not practical_only or distinctive or dist >= 4 then
        best = {
          motion = cmd .. target_ch,
          key_cost = 2,
          kind = cmd,
          char = target_ch,
          distinctive = distinctive,
        }
      end
    elseif count == 2 and distinctive and dist >= 6 then
      -- 2nd occurrence of a distinctive char is super practical with `f<ch>;`
      best = {
        motion = cmd .. target_ch .. ";",
        key_cost = 3,
        kind = cmd,
        char = target_ch,
        distinctive = true,
      }
    end
  end

  -- 2. Try t<ch> / T<ch> onto an immediately adjacent distinctive delimiter
  if not best or not best.distinctive then
    local adj_col = forward and (end_col + 1) or (end_col - 1)
    if adj_col >= 1 and adj_col <= #line then
      local adj_ch = line:sub(adj_col, adj_col)
      if DISTINCTIVE_CHARS[adj_ch] then
        local count = 0
        if forward then
          for c = start_col + 1, adj_col do
            if line:sub(c, c) == adj_ch then
              count = count + 1
            end
          end
        else
          for c = start_col - 1, adj_col, -1 do
            if line:sub(c, c) == adj_ch then
              count = count + 1
            end
          end
        end

        if count == 1 then
          local cmd = forward and "t" or "T"
          -- Prefer t<delimiter> over f<random_letter> when landing right before a delimiter
          if not best then
            best = {
              motion = cmd .. adj_ch,
              key_cost = 2,
              kind = cmd,
              char = adj_ch,
              distinctive = true,
            }
          end
        end
      end
    end
  end

  return best
end

---Simulate Vim's `w`, `e`, `b` on a single line to see if start_col -> end_col is reachable in <= max_hops.
---@param line string
---@param start_col integer 1-indexed
---@param end_col integer 1-indexed
---@param max_hops integer|nil default 3
---@return table|nil { motion = string, hops = integer, key_cost = integer }
function M.best_word_motion(line, start_col, end_col, max_hops)
  max_hops = max_hops or 3
  if not line or start_col == end_col or start_col < 1 or end_col < 1 or start_col > #line or end_col > #line then
    return nil
  end

  local function char_class(ch)
    if M.is_space(ch) then
      return 0
    elseif M.is_word_char(ch) then
      return 1
    else
      return 2
    end
  end

  local len = #line

  if end_col > start_col then
    -- Try `w` hops
    local col = start_col
    for hop = 1, max_hops do
      local cls = char_class(line:sub(col, col))
      while col <= len and char_class(line:sub(col, col)) == cls and cls ~= 0 do
        col = col + 1
      end
      while col <= len and char_class(line:sub(col, col)) == 0 do
        col = col + 1
      end
      if col > len then
        break
      end
      if col == end_col then
        local motion = hop == 1 and "w" or (tostring(hop) .. "w")
        return { motion = motion, hops = hop, key_cost = #motion }
      end
    end

    -- Try `e` hops
    col = start_col
    for hop = 1, max_hops do
      col = col + 1
      while col <= len and char_class(line:sub(col, col)) == 0 do
        col = col + 1
      end
      if col > len then
        break
      end
      local cls = char_class(line:sub(col, col))
      while col < len and char_class(line:sub(col + 1, col + 1)) == cls do
        col = col + 1
      end
      if col == end_col then
        local motion = hop == 1 and "e" or (tostring(hop) .. "e")
        return { motion = motion, hops = hop, key_cost = #motion }
      end
    end
  else
    -- Try `b` hops
    local col = start_col
    for hop = 1, max_hops do
      col = col - 1
      while col >= 1 and char_class(line:sub(col, col)) == 0 do
        col = col - 1
      end
      if col < 1 then
        break
      end
      local cls = char_class(line:sub(col, col))
      while col > 1 and char_class(line:sub(col - 1, col - 1)) == cls do
        col = col - 1
      end
      if col == end_col then
        local motion = hop == 1 and "b" or (tostring(hop) .. "b")
        return { motion = motion, hops = hop, key_cost = #motion }
      end
    end
  end

  return nil
end

---Format a sequence of keys cleanly for display (compressing long runs like 7×j).
---@param keys string[]
---@return string
function M.format_keys(keys)
  if not keys or #keys == 0 then
    return ""
  end

  local out = {}
  local i = 1
  while i <= #keys do
    local k = keys[i]
    local run = 1
    while i + run <= #keys and keys[i + run] == k do
      run = run + 1
    end
    if run >= 5 then
      out[#out + 1] = string.format("%s×%d", k, run)
    else
      for _ = 1, run do
        out[#out + 1] = k
      end
    end
    i = i + run
  end

  return table.concat(out, "")
end

return M
