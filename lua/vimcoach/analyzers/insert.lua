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

---Analyze a burst of consecutive `<BS>` presses in Insert mode.
---@param ctx table { count: integer, cleared_to_sol: boolean }
---@return table[] candidates
function M.analyze_backspace_run(ctx)
  local min_bs = config.options.thresholds.insert_bs_min or 4
  if not ctx or (ctx.count or 0) < min_bs then
    return {}
  end

  local count = ctx.count
  local actual = string.format("<BS>×%d", count)

  -- If they deleted a huge stretch all the way back to line start -> `<C-u>`
  if ctx.cleared_to_sol and count >= 10 then
    local c = make_candidate(
      "insert_ctrl_u",
      actual,
      "<C-u>",
      count - 1,
      90,
      string.format("Press `<C-u>` in Insert mode to clear back to the start of the line instead of %d Backspaces.", count)
    )
    return c and { c } or {}
  end

  local c = make_candidate(
    "insert_ctrl_w",
    actual,
    "<C-w>",
    count - 1,
    88,
    string.format("Press `<C-w>` in Insert mode to delete the previous word in 1 chord instead of %d Backspaces.", count)
  )
  return c and { c } or {}
end

---Analyze consecutive arrow key presses inside Insert mode.
---@param ctx table { keys: string[] }
---@return table[] candidates
function M.analyze_insert_arrows(ctx)
  local min_arrows = config.options.thresholds.insert_arrow_min or 3
  if not ctx or not ctx.keys or #ctx.keys < min_arrows then
    return {}
  end

  local count = #ctx.keys
  local has_vertical = false
  for _, k in ipairs(ctx.keys) do
    if k == "<Up>" or k == "<Down>" then
      has_vertical = true
      break
    end
  end

  local actual = string.format("Arrows×%d (Insert)", count)
  local suggested = has_vertical and "<Esc> + j/k/}" or "<Esc> + b/w/f"
  local c = make_candidate(
    "insert_arrows",
    actual,
    suggested,
    math.max(1, count - 2),
    86,
    "Avoid navigating with arrow keys in Insert mode — press `<Esc>` and use Normal motions (`b`, `w`, `f`, `^`, `$`)."
  )
  return c and { c } or {}
end

return M
