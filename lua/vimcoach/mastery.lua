local config = require("vimcoach.config")
local catalog = require("vimcoach.catalog")

local uv = vim.uv or vim.loop

local M = {}

---@class VimCoachSkillStat
---@field missed integer Number of times an inefficient alternative was caught
---@field used integer Number of times the idiomatic motion was used directly
---@field keys_saved integer Total keystrokes that would have been saved
---@field last_missed integer Unix timestamp (seconds)

---@class VimCoachHistoryEntry
---@field ts integer Unix timestamp
---@field rule_id string
---@field actual string
---@field suggested string
---@field keys_saved integer
---@field reason string

---@class VimCoachState
---@field version integer
---@field total_hints integer
---@field total_keys_saved integer
---@field total_good_motions integer
---@field skills table<string, VimCoachSkillStat>
---@field history VimCoachHistoryEntry[]

local MAX_HISTORY = 60

local function new_empty_state()
  return {
    version = 1,
    total_hints = 0,
    total_keys_saved = 0,
    total_good_motions = 0,
    skills = {},
    history = {},
  }
end

---@type VimCoachState
M.state = new_empty_state()

-- Session-only counters (not persisted)
M.session = {
  started_at = os.time(),
  hints = 0,
  keys_saved = 0,
  good_motions = 0,
}

-- In-memory cooldown timestamps (milliseconds from hrtime)
local last_global_hint_ms = 0
local last_rule_hint_ms = {}
local save_timer = nil
local loaded = false

local function now_ms()
  return math.floor(uv.hrtime() / 1e6)
end

local function ensure_skill(rule_id)
  if not M.state.skills[rule_id] then
    M.state.skills[rule_id] = {
      missed = 0,
      used = 0,
      keys_saved = 0,
      last_missed = 0,
    }
  end
  return M.state.skills[rule_id]
end

---Load stats from disk if enabled.
function M.load()
  if loaded then
    return
  end
  loaded = true

  if not config.options.track_stats then
    return
  end

  local path = config.get_stats_path()
  local fd = io.open(path, "r")
  if not fd then
    return
  end
  local raw = fd:read("*a")
  fd:close()
  if not raw or raw == "" then
    return
  end

  local ok, decoded = pcall(vim.json.decode, raw)
  if ok and type(decoded) == "table" and type(decoded.skills) == "table" then
    M.state = vim.tbl_deep_extend("force", new_empty_state(), decoded)
  end
end

---Write stats to disk immediately.
function M.save_now()
  if not config.options.track_stats then
    return
  end
  local path = config.get_stats_path()
  local dir = vim.fn.fnamemodify(path, ":h")
  if vim.fn.isdirectory(dir) == 0 then
    pcall(vim.fn.mkdir, dir, "p")
  end

  local ok, encoded = pcall(vim.json.encode, M.state)
  if not ok or not encoded then
    return
  end
  local fd = io.open(path, "w")
  if fd then
    fd:write(encoded)
    fd:close()
  end
end

---Debounced save so rapid edits never touch disk synchronously.
local function schedule_save()
  if not config.options.track_stats then
    return
  end
  if save_timer then
    save_timer:stop()
    save_timer:close()
    save_timer = nil
  end
  save_timer = uv.new_timer()
  if not save_timer then
    return
  end
  save_timer:start(1500, 0, vim.schedule_wrap(function()
    if save_timer then
      save_timer:stop()
      save_timer:close()
      save_timer = nil
    end
    M.save_now()
  end))
end

---Compute mastery percentage (0-100) for a rule using Laplace/Bayesian smoothing.
---@param rule_id string
---@return integer|nil pct nil if never observed
function M.get_skill_mastery(rule_id)
  local stat = M.state.skills[rule_id]
  if not stat or (stat.used + stat.missed) == 0 then
    return nil
  end
  -- Prior of 1 used / 1 missed prevents jumping straight to 0% or 100% on 1 sample
  local score = ((stat.used + 1) / (stat.used + stat.missed + 2)) * 100
  return math.floor(score + 0.5)
end

---Compute overall fluency score (0-100) across all observed skills.
---@return integer
function M.get_fluency_score()
  local total_used = 0
  local total_missed = 0
  for _, stat in pairs(M.state.skills) do
    total_used = total_used + (stat.used or 0)
    total_missed = total_missed + (stat.missed or 0)
  end
  if total_used + total_missed == 0 then
    return 100
  end
  local pct = (total_used / (total_used + total_missed)) * 100
  return math.floor(pct + 0.5)
end

---Check whether showing a hint for `rule_id` is currently allowed by cooldowns.
---@param rule_id string
---@param force boolean|nil Bypass cooldown checks
---@return boolean
function M.can_notify(rule_id, force)
  if force then
    return true
  end

  local t = now_ms()
  if t - last_global_hint_ms < config.options.cooldown_ms then
    return false
  end

  local rule_cd = config.options.rule_cooldown_ms
  local stat = M.state.skills[rule_id]
  local mastery = M.get_skill_mastery(rule_id)
  if mastery and mastery >= 85 and stat and stat.used >= 10 then
    rule_cd = math.floor(rule_cd * (config.options.mastery_cooldown_multiplier or 3.0))
  end

  local prev = last_rule_hint_ms[rule_id] or 0
  if t - prev < rule_cd then
    return false
  end

  return true
end

---Record a coaching hint (missed optimization).
---@param suggestion table { rule_id, actual, suggested, keys_saved, reason }
function M.record_miss(suggestion)
  M.load()

  local t = now_ms()
  last_global_hint_ms = t
  last_rule_hint_ms[suggestion.rule_id] = t

  local stat = ensure_skill(suggestion.rule_id)
  stat.missed = stat.missed + 1
  stat.keys_saved = stat.keys_saved + (suggestion.keys_saved or 1)
  stat.last_missed = os.time()

  M.state.total_hints = M.state.total_hints + 1
  M.state.total_keys_saved = M.state.total_keys_saved + (suggestion.keys_saved or 1)

  M.session.hints = M.session.hints + 1
  M.session.keys_saved = M.session.keys_saved + (suggestion.keys_saved or 1)

  table.insert(M.state.history, 1, {
    ts = os.time(),
    rule_id = suggestion.rule_id,
    actual = suggestion.actual or "",
    suggested = suggestion.suggested or "",
    keys_saved = suggestion.keys_saved or 1,
    reason = suggestion.reason or "",
  })
  while #M.state.history > MAX_HISTORY do
    table.remove(M.state.history)
  end

  schedule_save()
end

---Record positive usage of an idiomatic Vim skill!
---@param rule_id string
function M.record_good(rule_id)
  M.load()
  if not catalog.rules[rule_id] then
    return
  end
  local stat = ensure_skill(rule_id)
  stat.used = stat.used + 1
  M.state.total_good_motions = M.state.total_good_motions + 1
  M.session.good_motions = M.session.good_motions + 1
  schedule_save()
end

---Get how many times a rule has been missed (used by adaptive strict mode).
---@param rule_id string
---@return integer
function M.get_miss_count(rule_id)
  local stat = M.state.skills[rule_id]
  return stat and stat.missed or 0
end

---Return top N habits that need the most work, sorted by misses descending.
---@param limit integer|nil
---@return table[]
function M.get_top_habits(limit)
  M.load()
  limit = limit or 10
  local items = {}
  for rule_id, stat in pairs(M.state.skills) do
    if stat.missed > 0 then
      local meta = catalog.get(rule_id)
      items[#items + 1] = {
        rule_id = rule_id,
        title = meta and meta.title or rule_id,
        shortcut = meta and meta.shortcut or "",
        category = meta and meta.category or "editing",
        missed = stat.missed,
        used = stat.used,
        keys_saved = stat.keys_saved,
        mastery = M.get_skill_mastery(rule_id) or 0,
      }
    end
  end

  table.sort(items, function(a, b)
    if a.missed ~= b.missed then
      return a.missed > b.missed
    end
    return a.keys_saved > b.keys_saved
  end)

  local sliced = {}
  for i = 1, math.min(limit, #items) do
    sliced[i] = items[i]
  end
  return sliced
end

---Return structured summary payload (used by Dashboard & VS Code Companion Extension).
---@return table
function M.get_summary()
  M.load()

  local categories = {}
  for _, cat in ipairs(catalog.category_order) do
    categories[cat] = {
      id = cat,
      label = catalog.category_labels[cat] or cat,
      used = 0,
      missed = 0,
      keys_saved = 0,
      skills = {},
    }
  end

  for rule_id, meta in pairs(catalog.rules) do
    local stat = M.state.skills[rule_id] or { missed = 0, used = 0, keys_saved = 0 }
    local cat_entry = categories[meta.category]
    if cat_entry then
      cat_entry.used = cat_entry.used + stat.used
      cat_entry.missed = cat_entry.missed + stat.missed
      cat_entry.keys_saved = cat_entry.keys_saved + stat.keys_saved
      if stat.used > 0 or stat.missed > 0 then
        cat_entry.skills[#cat_entry.skills + 1] = {
          id = rule_id,
          title = meta.title,
          shortcut = meta.shortcut,
          used = stat.used,
          missed = stat.missed,
          keys_saved = stat.keys_saved,
          mastery = M.get_skill_mastery(rule_id) or 0,
        }
      end
    end
  end

  local cat_list = {}
  for _, cat in ipairs(catalog.category_order) do
    local c = categories[cat]
    table.sort(c.skills, function(a, b)
      return a.mastery < b.mastery
    end)
    local total = c.used + c.missed
    c.mastery = total > 0 and math.floor((c.used / total) * 100 + 0.5) or nil
    cat_list[#cat_list + 1] = c
  end

  return {
    fluency = M.get_fluency_score(),
    total_hints = M.state.total_hints,
    total_keys_saved = M.state.total_keys_saved,
    total_good_motions = M.state.total_good_motions,
    session = vim.deepcopy(M.session),
    top_habits = M.get_top_habits(10),
    categories = cat_list,
    history = M.state.history,
    mode = config.options.mode,
    enabled = config.options.enabled,
  }
end

---Reset all persisted and session stats.
function M.reset()
  M.state = new_empty_state()
  M.session = {
    started_at = os.time(),
    hints = 0,
    keys_saved = 0,
    good_motions = 0,
  }
  last_global_hint_ms = 0
  last_rule_hint_ms = {}
  M.save_now()
end

return M
