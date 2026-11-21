local config = require("vimcoach.config")
local mastery = require("vimcoach.mastery")
local buf = require("vimcoach.buffer_utils")

local uv = vim.uv or vim.loop

local M = {}

local active = false
local saved_maps = {}
local last_key = nil
local repeat_count = 0
local last_time_ms = 0

local KEY_TO_RULE = {
  h = "nav_word_jump",
  l = "nav_word_jump",
  j = "nav_vertical_count",
  k = "nav_vertical_count",
  ["<Up>"] = "nav_arrows",
  ["<Down>"] = "nav_arrows",
  ["<Left>"] = "nav_arrows",
  ["<Right>"] = "nav_arrows",
}

local function now_ms()
  return math.floor(uv.hrtime() / 1e6)
end

---Determine whether blocking should apply right now for `key`.
---@param key string
---@return boolean
local function should_block_key(key)
  local mode = config.options.mode
  if mode == "coach" or not config.options.enabled then
    return false
  end
  if config.is_buffer_disabled(0) then
    return false
  end
  -- Never block counted motions like `5j` or `3w`!
  if vim.v.count > 0 then
    return false
  end
  -- Never block during macro playback
  if vim.fn.reg_executing() ~= "" then
    return false
  end

  if mode == "adaptive" then
    local rule_id = KEY_TO_RULE[key] or "nav_vertical_count"
    if mastery.get_miss_count(rule_id) < (config.options.adaptive_strict_misses or 8) then
      return false
    end
  end

  return true
end

---Generate a buffer-aware suggestion when blocking a mashed key.
---@param key string
---@return table
local function build_strict_hint(key)
  local rule_id = KEY_TO_RULE[key] or "nav_vertical_count"
  local suggested = "w / f<ch> / $"
  local reason = "Strict mode blocked repeated `" .. key .. "`."

  local ok, pos = pcall(vim.api.nvim_win_get_cursor, 0)
  local row = ok and pos[1] or 1
  local col = ok and (pos[2] + 1) or 1
  local line = buf.get_line(0, row)

  if key == "j" or key == "<Down>" then
    suggested = "{count}j / } / <C-d>"
    reason = "Use `{count}j`, `}` (next paragraph), `/pattern`, or `<C-d>` instead of mashing `" .. key .. "`."
  elseif key == "k" or key == "<Up>" then
    suggested = "{count}k / { / <C-u>"
    reason = "Use `{count}k`, `{` (previous paragraph), `?pattern`, or `<C-u>` instead of mashing `" .. key .. "`."
  elseif key == "l" or key == "<Right>" then
    if col < #line then
      suggested = "w / e / f<ch> / $"
    else
      suggested = "$"
    end
    reason = "Use `w`, `e`, `f<ch>`, or `$` to move right faster instead of mashing `" .. key .. "`."
  elseif key == "h" or key == "<Left>" then
    suggested = "b / F<ch> / ^ / 0"
    reason = "Use `b`, `F<ch>`, `^`, or `0` to move left faster instead of mashing `" .. key .. "`."
  end

  return {
    rule_id = rule_id,
    actual = key .. "×" .. tostring(repeat_count),
    suggested = suggested,
    keys_saved = math.max(1, repeat_count - 1),
    reason = reason,
    is_strict_block = true,
  }
end

---Handle a restricted key press inside an expr mapping.
---@param key string
---@return string
local function handle_key(key)
  if not should_block_key(key) then
    repeat_count = 0
    last_key = nil
    return key
  end

  local t = now_ms()
  local sc = config.options.strict
  local same_key = (key == last_key)

  if (t - last_time_ms) > (sc.max_time_ms or 1200) or (sc.allow_different_key and not same_key) then
    repeat_count = 1
  else
    repeat_count = repeat_count + 1
  end

  last_key = key
  last_time_ms = t

  if repeat_count > (sc.max_count or 4) then
    local hint = build_strict_hint(key)
    vim.schedule(function()
      if mastery.can_notify(hint.rule_id, false) then
        mastery.record_miss(hint)
        require("vimcoach.ui").show_hint(hint)
      end
    end)
    return "" -- Block the key!
  end

  return key
end

---Install strict keymaps if mode is "strict" or "adaptive".
function M.enable()
  if active then
    return
  end
  if config.options.mode == "coach" then
    return
  end

  active = true
  saved_maps = {}

  for key, enabled in pairs(config.options.strict.restricted_keys or {}) do
    if enabled then
      for _, m in ipairs({ "n", "x" }) do
        local existing = vim.fn.maparg(key, m, false, true)
        if existing and next(existing) ~= nil then
          saved_maps[m .. ":" .. key] = existing
        end
        vim.keymap.set(m, key, function()
          return handle_key(key)
        end, {
          expr = true,
          silent = true,
          noremap = true,
          desc = "VimCoach strict guard for " .. key,
        })
      end
    end
  end
end

---Remove strict keymaps and restore any previous user mappings.
function M.disable()
  if not active then
    return
  end
  active = false
  repeat_count = 0
  last_key = nil

  for key, enabled in pairs(config.options.strict.restricted_keys or {}) do
    if enabled then
      for _, m in ipairs({ "n", "x" }) do
        pcall(vim.keymap.del, m, key)
        local prev = saved_maps[m .. ":" .. key]
        if prev and prev.rhs then
          pcall(vim.fn.mapset, m, false, prev)
        end
      end
    end
  end
  saved_maps = {}
end

---Sync strict mode hooks with current `config.options.mode`.
function M.sync()
  if config.options.enabled and (config.options.mode == "strict" or config.options.mode == "adaptive") then
    M.enable()
  else
    M.disable()
  end
end

return M
