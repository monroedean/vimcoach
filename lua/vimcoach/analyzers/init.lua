local mastery = require("vimcoach.mastery")
local config = require("vimcoach.config")

local M = {
  visual = require("vimcoach.analyzers.visual"),
  navigation = require("vimcoach.analyzers.navigation"),
  editing = require("vimcoach.analyzers.editing"),
  repetition = require("vimcoach.analyzers.repetition"),
  insert = require("vimcoach.analyzers.insert"),
}

function M.pick_best(candidates)
  if not candidates or #candidates == 0 then
    return nil
  end

  local best = nil
  local best_score = -1

  for _, c in ipairs(candidates) do
    local score = (c.priority or 50) + math.min(c.keys_saved or 0, 12) * 1.5
    if score > best_score then
      best_score = score
      best = c
    end
  end

  return best
end

function M.emit(candidates, opts)
  if not config.options.enabled then
    return nil
  end

  local best = M.pick_best(candidates)
  if not best then
    return nil
  end

  local force = opts and opts.force or false
  if not mastery.can_notify(best.rule_id, force) then
    return nil
  end

  mastery.record_miss(best)

  local ui = require("vimcoach.ui")
  ui.show_hint(best)
  return best
end

return M
