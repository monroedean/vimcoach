local config = require("vimcoach.config")

local M = {}

---@class VimCoachEditRecord
---@field signature string Normalized edit signature (e.g. "ciw:hello" or "A:;")
---@field display string Human-readable actual keys
---@field key_cost integer Number of keys the edit took
---@field ts_ms integer Timestamp in ms
---@field after_search_next boolean Whether this edit occurred right after `n`/`N` or `*`/`/`
---@field replacement string|nil Replacement text if it was a change edit

---@type VimCoachEditRecord[]
local recent_edits = {}
local MAX_RECENT = 10

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

---Reset internal rolling state (useful in tests).
function M.reset()
  recent_edits = {}
end

---Record a completed non-dot edit and check if `.` or `cgn` + `.` would have been faster!
---@param record VimCoachEditRecord
---@return table[] candidates
function M.analyze_edit_repeat(record)
  if not record or not record.signature or (record.key_cost or 0) < 3 then
    return {}
  end

  local now = record.ts_ms or 0
  local window = config.options.thresholds.dot_repeat_window_ms or 25000
  local candidates = {}

  -- Prune stale edits
  local fresh = {}
  for _, e in ipairs(recent_edits) do
    if now - e.ts_ms <= window then
      fresh[#fresh + 1] = e
    end
  end
  recent_edits = fresh

  -- Look for a recent identical edit
  local match = nil
  for i = #recent_edits, 1, -1 do
    if recent_edits[i].signature == record.signature then
      match = recent_edits[i]
      break
    end
  end

  -- Push current edit into history
  recent_edits[#recent_edits + 1] = record
  while #recent_edits > MAX_RECENT do
    table.remove(recent_edits, 1)
  end

  if match then
    -- Special superpower: searched + `n` + repeated identical change -> `cgn` + `.`!
    -- (If they already used `cgn`/`cgN`, fall through to the dot-repeat `.` tip instead.)
    local already_cgn = record.signature:sub(1, 3) == "cgn" or record.signature:sub(1, 3) == "cgN"
    if not already_cgn and record.after_search_next and record.replacement and #record.replacement >= 1 then
      local cgn_cmd = "cgn" .. record.replacement .. "<Esc> then ."
      local c = make_candidate(
        "rep_cgn",
        record.display .. " (again after n)",
        cgn_cmd,
        math.max(2, record.key_cost - 1),
        96,
        "After `*` or `/`, use `cgn" .. record.replacement .. "<Esc>` once, then just tap `.` to jump-and-replace each next match!"
      )
      if c then
        candidates[#candidates + 1] = c
        return candidates
      end
    end

    -- General dot-repeat opportunity!
    local c = make_candidate(
      "rep_dot",
      record.display .. " (repeated)",
      ".",
      record.key_cost - 1,
      92,
      string.format("You just repeated `%s` manually — press `.` to replay your last edit in 1 key!", record.display)
    )
    if c then
      candidates[#candidates + 1] = c
    end
  end

  return candidates
end

---Analyze a `/` or `?` search command when it matches the exact word under the cursor.
---@param ctx table { cmdtype: "/"|"?", pattern: string, cword: string }
---@return table[] candidates
function M.analyze_search(ctx)
  if not ctx or not ctx.pattern or not ctx.cword then
    return {}
  end

  local pat = ctx.pattern
  local cword = ctx.cword
  -- Strip optional \< \> word boundaries if the user typed them
  local clean_pat = pat:gsub("^\\<", ""):gsub("\\>$", "")

  if #cword >= 2 and clean_pat == cword then
    local cmd = (ctx.cmdtype == "?") and "#" or "*"
    local actual = ctx.cmdtype .. pat .. "<CR>"
    local saved = (#pat + 2) - 1
    local c = make_candidate(
      "rep_star_search",
      actual,
      cmd,
      saved,
      93,
      string.format("Press `%s` to search for the word under your cursor (`%s`) in 1 key!", cmd, cword)
    )
    if c then
      return { c }
    end
  end

  return {}
end

---Analyze consecutive `dd` or `yy` presses (e.g., `dd` x 5 -> `5dd` or `dip`).
---@param ctx table { op: "dd"|"yy", count: integer }
---@return table[] candidates
function M.analyze_repeated_line_op(ctx)
  local min_rep = config.options.thresholds.repeat_line_op_min or 4
  if not ctx or (ctx.count or 0) < min_rep then
    return {}
  end

  local op = ctx.op
  local count = ctx.count
  local actual = string.format("%s×%d", op, count)
  local suggested = tostring(count) .. op
  local alt = (op == "dd") and "dip" or "yip"
  local saved = (count * 2) - #suggested

  local c = make_candidate(
    "rep_line_ops",
    actual,
    suggested,
    saved,
    85,
    string.format("Use `%s` (or `%s` for a whole block) instead of pressing `%s` %d times.", suggested, alt, op, count)
  )
  return c and { c } or {}
end

return M
