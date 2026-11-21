# VimCoach (`vimcoach.nvim`)

A **buffer-aware, history-aware Vim motion & editing coach** for **Neovim** and **VS Code (`vscode-neovim`)** — built to go far beyond regex-only keystroke blockers like `hardtime.nvim`.

Instead of blindly counting `jjjj` or matching static key strings, **VimCoach inspects your actual buffer text, Visual selection bounds, navigation trajectories, and before/after edit diffs** to recommend the fastest *practical* native Vim idiom every time you take a slower path.

---

## Why VimCoach Beats `hardtime.nvim`

| Capability | `hardtime.nvim` | **VimCoach** |
| --- | --- | --- |
| Visual selection → exact text object (`vllllld` inside `"..."` → `di"`, `vwwc` inside `(...)` → `ci(`, `Vjjjd` inside `{...}` → `di{`, HTML tags → `cit`, paragraphs → `dip`, words → `ciw`) | No | **Yes (100% buffer-aware)** |
| Unnecessary Visual mode (`vi"d` → `di"`, `vwd` → `dw`, `Vd` → `dd`, `v$d` → `D`) | Partial | **Yes + explains `.` dot-repeatability** |
| Start-to-end trajectory optimization (`llllll` → `f(` / `w` / `$`, `hhhh` → `^` / `0`, matching brackets → `%`, blank lines → `}` / `{`, `gg`/`G`, `<C-d>`/`<C-u>`, `<C-o>`, `;`) | Key counting only | **Yes (computes optimal motion for exact buffer geometry)** |
| Compound editing & buffer-diff detection (`dw`+`i` → `cw`, `dd`+`O` → `cc`, `^i` → `I`, `$a` → `A`, `A<CR>` → `o`, `xiA<Esc>` → `~`, `ciw43<Esc>` on `42` → `<C-a>`, `I  <Esc>` → `>>`, `A<Del>` → `J`) | Very limited | **Yes (pre/post diff semantic engine)** |
| Repetition & search coaching (manual repeated edit → `.`, `/<word_under_cursor>` → `*`, search + `n` + repeated change → `*` + `cgn` + `.`) | No | **Yes** |
| Insert-mode habit coaching (repeated `<BS>` → `<C-w>` / `<C-u>`, arrow keys in Insert mode) | No | **Yes** |
| Practicality / Anti-Vim-Golf filter (never nags `jjj`, never suggests `4fe`, `12l`, or `8w`, ignores slow reading pauses) | Basic | **Built-in** |
| Positive reinforcement + persistent Mastery Dashboard (`:VimCoachDashboard`) | No | **Yes (tracks both good & missed motions, adaptive cooldowns)** |
| First-class VS Code (`vscode-neovim`) integration + optional companion VS Code UI extension | No | **Yes** |

---

## Installation

### 1. Neovim (`lazy.nvim`)

```lua
return {
  "your-username/vimcoach.nvim", -- or dir = "~/projects/teach-me-vim"
  name = "vimcoach.nvim",
  main = "vimcoach",
  vscode = true, -- also loads inside vscode-neovim
  lazy = false,
  opts = {
    mode = "coach", -- "coach" (default) | "strict" | "adaptive"
  },
}
```

### 2. VS Code with `vscode-neovim`

#### Works Out of the Box (Zero Extra VS Code Extensions)
Because `vscode-neovim` runs your real Neovim config, adding `vscode = true` and `lazy = false` above is all you need. Out of the box, `vimcoach.nvim` detects `vim.g.vscode` and renders:
- A sleek **inline pill badge** (`⚡ vlllld → di" (-3 keys)`) at the end of your active line (with full explanation on hover, auto-fading after 4.5s)
- A quiet auto-clearing **Status Bar flash** (set `vscode = { style = "inline" }` for pure inline only)

#### Optional: Install the Companion VS Code Extension
Installing `vscode-extension/` additionally adds a persistent **Activity Bar Mastery Dashboard** sidebar inside VS Code:

```bash
cd vscode-extension
npm install
npm run compile
npx @vscode/vsce package
code --install-extension vimcoach-vscode-1.0.0.vsix
```

Once installed, `vimcoach.nvim` automatically detects it and streams live hints & mastery stats to the VS Code sidebar and status bar.

---

## Commands

| Command | Description |
| --- | --- |
| `:VimCoach` / `:VimCoachDashboard` | Open the interactive Mastery Dashboard (`1`/`2`/`3` tabs) |
| `:VimCoachToggle` | Pause or resume VimCoach |
| `:VimCoachStrict` | Toggle Strict blocking mode on/off |
| `:VimCoach coach\|strict\|adaptive` | Switch between Coach, Strict, and Adaptive modes |
| `:VimCoach status` | Show current fluency score and session counters |
| `:VimCoachReset` | Reset all persisted mastery statistics |

### Statusline Integration (`lualine.nvim`)

```lua
sections = {
  lualine_x = {
    { function() return require("vimcoach").statusline() end },
  },
}
```

---

## Configuration Defaults

```lua
require("vimcoach").setup({
  enabled = true,
  mode = "coach",              -- "coach" | "strict" | "adaptive"
  adaptive_strict_misses = 8,  -- misses before blocking kicks in (adaptive mode)

  cooldown_ms = 2200,          -- min time between any two hints
  rule_cooldown_ms = 14000,    -- min time before repeating the same rule
  mastery_cooldown_multiplier = 3.0, -- mastered skills (>85%) nag 3x less often

  assume_nvim_Y = true,        -- Neovim maps Y -> y$ by default
  practical_only = true,       -- filter out obscure/golfy suggestions
  track_stats = true,          -- persist mastery stats in stdpath("data")/vimcoach/stats.json

  disabled_rules = {
    -- e.g. nav_vertical_count = true,
  },

  thresholds = {
    min_keys_saved = 1,
    vertical_count_min = 4,    -- jj/jjj are never nagged
    vertical_page_min = 15,
    horizontal_step_min = 4,
    word_step_min = 5,
    repeat_x_min = 3,
    repeat_line_op_min = 4,
    insert_bs_min = 4,
    insert_arrow_min = 3,
    episode_timeout_ms = 1100, -- slow reading pauses won't trigger hints
  },

  ui = {
    style = "float",           -- "float" | "notify" | "echo"
    position = "top_right",    -- "top_right" | "bottom_right" | "cursor"
    duration_ms = 4500,
    max_width = 58,
    border = "rounded",
    show_keys_saved = true,
    show_reason = true,
  },

  vscode = {
    enabled = true,
    style = "inline_and_status", -- "inline" | "inline_and_status" | "status_bar" | "toast"
    use_companion_extension = true,
    fallback_notify = false,
    notify_level = "info",
  },
})
```

---

## Running the Test Suite

Run the full automated analyzer & buffer-geometry test suite with headless Neovim:

```bash
nvim --headless -u tests/minimal_init.lua -l tests/test_runner.lua
```
