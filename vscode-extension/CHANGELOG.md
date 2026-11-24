# Changelog

## 0.1.2 (2026-11-23)

- Prompt to install `VSCodeVim` if neither `VSCodeVim` nor `vscode-neovim` is installed.
- Show a setup banner in the sidebar dashboard when `VSCodeVim` is missing or `vscode-neovim` is detected.

## 0.1.1 (2026-11-23)

- Update extension description.

## 0.1.0 (2026-11-23)

- Initial release for `VSCodeVim` (`vscodevim.vim`).
- Catches inefficient motions across text objects, navigation, editing combos, repetition, and insert mode.
- Shows hints inline at the end of the line (hover for details) and in the status bar.
- Adds a sidebar dashboard to track fluency, habits, and recent tips.
- Supports `coach`, `adaptive`, and `strict` modes.
- Detects `vscodevim.vim` automatically and stays quiet if you're using `vscode-neovim` instead.
