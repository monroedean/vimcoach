local M = {}

M.defaults = {
  enabled = true,
  mode = "coach", -- "coach" | "strict" | "adaptive"
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
    style = "float", -- "float" | "notify" | "echo"
    position = "top_right", -- "top_right" | "bottom_right" | "cursor"
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

M.options = vim.deepcopy(M.defaults)

function M.setup(opts)
  M.options = vim.tbl_deep_extend("force", vim.deepcopy(M.defaults), opts or {})

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

function M.is_buffer_disabled(bufnr)
  bufnr = bufnr or 0
  if not vim.api.nvim_buf_is_valid(bufnr) then
    return true
  end

  local bt = vim.bo[bufnr].buftype
  if M._disabled_bt_set and M._disabled_bt_set[bt] then
    -- vscode-neovim uses buftype="nofile" for untitled and virtual tabs
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

function M.is_rule_enabled(rule_id)
  if not M.options.disabled_rules then
    return true
  end
  return not M.options.disabled_rules[rule_id]
end

function M.get_stats_path()
  if M.options.stats_path and M.options.stats_path ~= "" then
    return M.options.stats_path
  end
  return vim.fn.stdpath("data") .. "/vimcoach/stats.json"
end

M.setup({})

return M
