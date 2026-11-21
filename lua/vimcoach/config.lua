---@class VimCoachThresholds
---@field min_keys_saved integer Minimum keystrokes a suggestion must save (default 1)
---@field vertical_count_min integer Minimum j/k lines before suggesting {count}j/k (default 4)
---@field vertical_page_min integer Minimum j/k lines before suggesting <C-d>/<C-u> (default 15)
---@field horizontal_step_min integer Minimum l/h steps before suggesting w/b/e/f/t (default 4)
---@field word_step_min integer Minimum w/b/e steps before suggesting f/t or / (default 5)
---@field repeat_x_min integer Minimum consecutive x/X presses before suggesting d{motion} (default 3)
---@field repeat_line_op_min integer Minimum consecutive dd/yy before suggesting {count}dd/dip (default 4)
---@field insert_bs_min integer Minimum consecutive <BS> in insert mode before suggesting <C-w> (default 4)
---@field insert_arrow_min integer Minimum arrow presses in insert mode before suggesting Normal motions (default 3)
---@field episode_timeout_ms integer Max ms between consecutive keys in a single navigation episode (default 1100)
---@field combo_window_ms integer Max ms between paired actions like dw + i -> cw (default 1600)
---@field dot_repeat_window_ms integer Window in ms to detect repeated identical edits -> `.` (default 25000)

---@class VimCoachUIConfig
---@field style "float"|"notify"|"echo" UI style in terminal Neovim
---@field position "top_right"|"bottom_right"|"cursor" Float position
---@field duration_ms integer Auto-dismiss timeout for floating tips (default 4500)
---@field max_width integer Max width of floating tip window
---@field border string Border style for floating windows
---@field show_keys_saved boolean Show keystrokes-saved badge
---@field show_reason boolean Show brief explanation of why the alternative is better
---@field icons table<string, string>

---@class VimCoachVSCodeConfig
---@field enabled boolean Enable VS Code integration when vim.g.vscode is set
---@field style "inline"|"inline_and_status"|"status_bar"|"toast" How hints render in VS Code (default "inline_and_status", no clunky toast boxes!)
---@field use_companion_extension boolean Use the VimCoach VS Code companion extension if installed
---@field fallback_notify boolean Legacy fallback if eval_async is unavailable
---@field notify_level "info"|"warn" Level for fallback toast notifications

---@class VimCoachStrictConfig
---@field max_count integer Max consecutive restricted key presses allowed before blocking
---@field max_time_ms integer Time window for counting restricted key presses
---@field restricted_keys table<string, boolean> Keys subject to strict blocking when strict mode is active
---@field allow_different_key boolean Reset count when another key is pressed

---@class VimCoachConfig
---@field enabled boolean
---@field mode "coach"|"strict"|"adaptive"
---@field adaptive_strict_misses integer In adaptive mode, number of misses on a restricted habit before blocking kicks in
---@field cooldown_ms integer Minimum ms between any two coaching hints (anti-spam)
---@field rule_cooldown_ms integer Minimum ms before showing the same rule again
---@field mastery_cooldown_multiplier number Cooldown multiplier for mastered rules (>85% mastery)
---@field assume_nvim_Y boolean Whether Y is mapped to y$ (Neovim default since 0.6)
---@field practical_only boolean Filter out Vim-golf / high-cognitive-load tips (e.g., 4fe, 9w, 12l)
---@field track_stats boolean Persist habit & mastery stats to disk
---@field stats_path string|nil Custom path for stats JSON (defaults to stdpath("data")/vimcoach/stats.json)
---@field disabled_filetypes string[]
---@field disabled_buftypes string[]
---@field disabled_rules table<string, boolean> Map of rule_id -> true to disable specific rules
---@field thresholds VimCoachThresholds
---@field ui VimCoachUIConfig
---@field vscode VimCoachVSCodeConfig
---@field strict VimCoachStrictConfig

local M = {}

---@type VimCoachConfig
M.defaults = {
  enabled = true,
  mode = "coach", -- "coach" (non-blocking hints), "strict" (blocks bad habits + hints), "adaptive"
  adaptive_strict_misses = 8,

  cooldown_ms = 2200,
  rule_cooldown_ms = 14000,
  mastery_cooldown_multiplier = 3.0,

  assume_nvim_Y = true,
  practical_only = true,

  track_stats = true,
  stats_path = nil,

  disabled_filetypes = {
    "TelescopePrompt",
    "TelescopeResults",
    "NvimTree",
    "neo-tree",
    "oil",
    "netrw",
    "lazy",
    "mason",
    "qf",
    "help",
    "man",
    "alpha",
    "dashboard",
    "snacks_dashboard",
    "starter",
    "toggleterm",
    "Trouble",
    "trouble",
    "aerial",
    "Outline",
    "undotree",
    "fugitive",
    "gitcommit",
    "DressingInput",
    "noice",
    "notify",
    "vimcoach_dashboard",
    "vimcoach_hint",
  },

  disabled_buftypes = {
    "prompt",
    "terminal",
    "nofile",
    "quickfix",
    "help",
  },

  disabled_rules = {},

  thresholds = {
    min_keys_saved = 1,
    vertical_count_min = 4,
    vertical_page_min = 15,
    horizontal_step_min = 4,
    word_step_min = 5,
    repeat_x_min = 3,
    repeat_line_op_min = 4,
    insert_bs_min = 4,
    insert_arrow_min = 3,
    episode_timeout_ms = 1100,
    combo_window_ms = 1600,
    dot_repeat_window_ms = 25000,
  },

  ui = {
    style = "float",
    position = "top_right",
    duration_ms = 4500,
    max_width = 58,
    border = "rounded",
    show_keys_saved = true,
    show_reason = true,
    icons = {
      coach = "󰌌 ",
      arrow = " → ",
      spark = "✦",
      strict = "⛔",
      check = "✓",
    },
  },

  vscode = {
    enabled = true,
    style = "inline_and_status", -- "inline" | "inline_and_status" | "status_bar" | "toast"
    use_companion_extension = true,
    fallback_notify = false,
    notify_level = "info",
  },

  strict = {
    max_count = 4,
    max_time_ms = 1200,
    allow_different_key = true,
    restricted_keys = {
      h = true,
      j = true,
      k = true,
      l = true,
      ["<Up>"] = true,
      ["<Down>"] = true,
      ["<Left>"] = true,
      ["<Right>"] = true,
    },
  },
}

---@type VimCoachConfig
M.options = vim.deepcopy(M.defaults)

---Merge user options into defaults.
---@param opts table|nil
---@return VimCoachConfig
function M.setup(opts)
  M.options = vim.tbl_deep_extend("force", vim.deepcopy(M.defaults), opts or {})

  -- Normalize disabled_filetypes and disabled_buftypes lookup caches
  M._disabled_ft_set = {}
  for _, ft in ipairs(M.options.disabled_filetypes or {}) do
    M._disabled_ft_set[ft] = true
  end

  M._disabled_bt_set = {}
  for _, bt in ipairs(M.options.disabled_buftypes or {}) do
    M._disabled_bt_set[bt] = true
  end

  return M.options
end

---Check if coaching is disabled for the given buffer.
---@param bufnr integer|nil
---@return boolean
function M.is_buffer_disabled(bufnr)
  bufnr = bufnr or 0
  if not vim.api.nvim_buf_is_valid(bufnr) then
    return true
  end

  local bt = vim.bo[bufnr].buftype
  if M._disabled_bt_set and M._disabled_bt_set[bt] then
    -- vscode-neovim uses buftype="nofile" for untitled and virtual editor tabs
    if not (vim.g.vscode ~= nil and bt == "nofile") then
      return true
    end
  end

  local ft = vim.bo[bufnr].filetype
  if M._disabled_ft_set and M._disabled_ft_set[ft] then
    return true
  end

  return false
end

---Check if a rule ID is enabled.
---@param rule_id string
---@return boolean
function M.is_rule_enabled(rule_id)
  if not M.options.disabled_rules then
    return true
  end
  return not M.options.disabled_rules[rule_id]
end

---Get resolved stats file path.
---@return string
function M.get_stats_path()
  if M.options.stats_path and M.options.stats_path ~= "" then
    return M.options.stats_path
  end
  return vim.fn.stdpath("data") .. "/vimcoach/stats.json"
end

-- Initialize lookup caches with defaults right away
M.setup({})

return M
