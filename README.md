# vimcoach

A Vim motion coach for Neovim (and VS Code via `vscode-neovim`).

Unlike `hardtime.nvim`, which mainly blocks key spam and matches short regexes, `vimcoach` reads your actual buffer, visual selections, cursor jumps, and before/after edits to tell you the faster native Vim way to do what you just did.

## What it catches

- **Visual mode & text objects** — stepping through quotes, brackets, HTML tags, words, or paragraphs (`vllllld` → `di"`, `vwwc` → `ci(`, `Vjjjd` → `di{`, `vi"d` → `di"`).
- **Navigation** — walking to line start/end (`0`, `^`, `$`), matching brackets (`%`), characters (`f`/`t`/`;`), paragraphs (`}`/`{`), file bounds (`gg`/`G`), counted jumps (`6j`), half-page scrolls (`<C-d>`/`<C-u>`), and jump-back (`<C-o>`).
- **Editing combos** — `d$` → `D`, `dw`+`i` → `cw`, `dd`+`O` → `cc`, `^i` → `I`, `$a` → `A`, `A<CR>` → `o`, case flips (`xiA<Esc>` → `~`), incrementing numbers (`ciw43` on `42` → `<C-a>`), manual indents (`>>`/`<<`), and line joins (`J`).
- **Repetition & search** — repeating an edit manually → `.`, searching the word under cursor with `/` → `*`/`#`, and repeating search+change → `cgn` + `.`.
- **Insert mode** — mashing `<BS>` → `<C-w>`/`<C-u>`, arrow keys in insert mode.

It skips niche Vim-golf tricks (won't nag `jjj` or suggest `4fe` / `12l`), ignores slow reading pauses, and tracks your mastery over time so it backs off on habits you've already learned.

## Install

With `lazy.nvim`:

```lua
return {
  "your-username/vimcoach",
  vscode = true,
}
```

That's it — it works in both Neovim and VS Code (`vscode-neovim`) with zero extra setup. In VS Code, hints show up as a fading inline badge at the end of the line (hover for details) plus a brief status bar message. An optional companion extension lives in `vscode-extension/` if you also want a sidebar dashboard.

## Commands

- `:VimCoach` / `:VimCoachDashboard` — open the mastery dashboard
- `:VimCoachToggle` — pause or resume
- `:VimCoachStrict` — toggle strict blocking mode
- `:VimCoach coach|strict|adaptive` — switch mode
- `:VimCoach status` — quick fluency summary
- `:VimCoach test` — fire a sample hint
- `:VimCoachReset` — wipe saved stats

Statusline helper (e.g. `lualine.nvim`):

```lua
function() return require("vimcoach").statusline() end
```

## Config

Only override what you need — full defaults live in `lua/vimcoach/config.lua`:

```lua
require("vimcoach").setup({
  mode = "coach",
  cooldown_ms = 2200,
  rule_cooldown_ms = 14000,
  practical_only = true,
  disabled_rules = {}, -- e.g. { nav_vertical_count = true }
  ui = {
    style = "float",        -- "float" | "notify" | "echo"
    position = "top_right", -- "top_right" | "bottom_right" | "cursor"
    duration_ms = 4500,
  },
  vscode = {
    style = "inline_and_status",
  },
})
```

## Tests

```bash
nvim --headless -u tests/minimal_init.lua -l tests/test_runner.lua
```
