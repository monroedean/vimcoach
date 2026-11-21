# VimCoach VS Code Companion Extension

Optional native VS Code UI companion for **`vimcoach.nvim`** running inside **`vscode-neovim`**.

> Note: `vimcoach.nvim` already works out of the box in VS Code via `vscode-neovim`'s built-in `vscode.notify` without installing this extension. Installing this companion extension upgrades the experience with:
> - A live **Status Bar Coach Pill** (`vllllld → di" (-4 keys)`) with hover explanations
> - Configurable notification style (`statusBar`, `toast`, or `both`)
> - A dedicated **Activity Bar Mastery Dashboard** sidebar with fluency score, top habits to fix, category mastery bars, and one-click mode cycling

## Build & Install Locally

```bash
cd vscode-extension
npm install
npm run compile
```

To package and install into VS Code:

```bash
npx @vscode/vsce package
code --install-extension vimcoach-vscode-1.0.0.vsix
```

Or open the `vscode-extension/` folder in VS Code and press `F5` to launch an Extension Development Host.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `vimcoach.notificationStyle` | `"both"` | `"both"`, `"statusBar"`, or `"toast"` |
| `vimcoach.statusBarDurationMs` | `6500` | Milliseconds a coaching hint remains highlighted in the status bar |
