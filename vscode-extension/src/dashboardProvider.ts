import * as vscode from "vscode";
import { HintPayload, StatsSummary } from "./types";

function escapeHtml(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export class VimCoachDashboardProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "vimcoach.dashboardView";

  private view?: vscode.WebviewView;
  private latestSummary?: StatsSummary;
  private latestHint?: HintPayload;

  constructor(
    private readonly onCycleMode: () => void,
    private readonly onToggleEnabled: () => void,
    private readonly onResetStats: () => void
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === "cycleMode") {
        this.onCycleMode();
      } else if (msg?.type === "toggleEnabled") {
        this.onToggleEnabled();
      } else if (msg?.type === "resetStats") {
        this.onResetStats();
      }
    });

    this.render();
  }

  public updateHint(hint: HintPayload): void {
    this.latestHint = hint;
    this.render();
  }

  public updateStats(summary: StatsSummary): void {
    this.latestSummary = summary;
    this.render();
  }

  public reveal(): void {
    if (this.view) {
      this.view.show(true);
    } else {
      void vscode.commands.executeCommand("workbench.view.extension.vimcoach-sidebar");
    }
  }

  private render(): void {
    if (!this.view) {
      return;
    }

    const s = this.latestSummary;
    const fluency = s?.fluency ?? 100;
    const enabled = s?.enabled ?? true;
    const rawMode = enabled ? (s?.mode ?? "coach") : "paused";
    const modeLabel = enabled ? `Mode: ${rawMode.toUpperCase()}` : "PAUSED";
    const modeClass = `mode-${rawMode}`;

    const latestHintHtml = this.latestHint
      ? `
      <section class="card highlight">
        <div class="card-header">
          <span class="badge">${escapeHtml(this.latestHint.title)}</span>
          <span class="saved">-${this.latestHint.keys_saved} key${this.latestHint.keys_saved === 1 ? "" : "s"}</span>
        </div>
        <div class="diff-row">
          <code class="actual">${escapeHtml(this.latestHint.actual)}</code>
          <span class="arrow">→</span>
          <code class="suggested">${escapeHtml(this.latestHint.suggested)}</code>
        </div>
        <p class="reason">${escapeHtml(this.latestHint.reason)}</p>
      </section>
      `
      : "";

    const habitsHtml =
      s && s.top_habits && s.top_habits.length > 0
        ? s.top_habits
            .slice(0, 6)
            .map(
              (h) => `
          <div class="habit-row">
            <div class="habit-top">
              <span class="habit-title">${escapeHtml(h.title)}</span>
              <code class="shortcut">${escapeHtml(h.shortcut)}</code>
            </div>
            <div class="bar-wrap">
              <div class="bar-track"><div class="bar-fill" style="width:${h.mastery}%"></div></div>
              <span class="pct">${h.mastery}% · ${h.missed}×</span>
            </div>
          </div>`
            )
            .join("")
        : `<p class="empty">Start editing with VSCodeVim — VimCoach will analyze your motions and rank your top habits here.</p>`;

    const categoriesHtml =
      s && s.categories
        ? s.categories
            .map((c) => {
              const pct = c.mastery ?? 0;
              const hasData = c.used + c.missed > 0;
              return `
          <div class="cat-row">
            <div class="habit-top">
              <span>${escapeHtml(c.label)}</span>
              <span class="muted">${hasData ? `${pct}% (${c.used}✓ / ${c.missed}×)` : "No data yet"}</span>
            </div>
            <div class="bar-track"><div class="bar-fill" style="width:${hasData ? pct : 0}%"></div></div>
          </div>`;
            })
            .join("")
        : "";

    const feedHtml =
      s && s.history && s.history.length > 0
        ? s.history
            .slice(0, 10)
            .map(
              (item) => `
          <div class="feed-item">
            <div class="diff-row small">
              <code class="actual">${escapeHtml(item.actual)}</code>
              <span class="arrow">→</span>
              <code class="suggested">${escapeHtml(item.suggested)}</code>
              <span class="saved">-${item.keys_saved}</span>
            </div>
            <div class="feed-reason">${escapeHtml(item.reason)}</div>
          </div>`
            )
            .join("")
        : `<p class="empty">No tips recorded yet.</p>`;

    this.view.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      padding: 10px 12px;
      margin: 0;
      font-size: 12px;
      line-height: 1.45;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
    }
    .title {
      font-size: 14px;
      font-weight: 700;
    }
    .mode-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.03em;
      padding: 3px 9px;
      border-radius: 999px;
      border: 1px solid transparent;
    }
    .mode-pill .mode-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .mode-pill.mode-coach {
      background: rgba(74, 222, 128, 0.14);
      border-color: rgba(74, 222, 128, 0.45);
      color: var(--vscode-charts-green, #4ade80);
    }
    .mode-pill.mode-coach .mode-dot {
      background: var(--vscode-charts-green, #4ade80);
    }
    .mode-pill.mode-strict {
      background: rgba(242, 204, 96, 0.14);
      border-color: rgba(242, 204, 96, 0.45);
      color: var(--vscode-charts-yellow, #f2cc60);
    }
    .mode-pill.mode-strict .mode-dot {
      background: var(--vscode-charts-yellow, #f2cc60);
    }
    .mode-pill.mode-adaptive {
      background: rgba(79, 193, 255, 0.14);
      border-color: rgba(79, 193, 255, 0.45);
      color: var(--vscode-charts-blue, #4fc1ff);
    }
    .mode-pill.mode-adaptive .mode-dot {
      background: var(--vscode-charts-blue, #4fc1ff);
    }
    .mode-pill.mode-paused {
      background: rgba(128, 128, 128, 0.16);
      border-color: rgba(128, 128, 128, 0.35);
      color: var(--vscode-descriptionForeground);
    }
    .mode-pill.mode-paused .mode-dot {
      background: var(--vscode-descriptionForeground);
    }
    .card {
      background: var(--vscode-editorWidget-background, var(--vscode-sideBarSectionHeader-background));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 10px;
    }
    .card.highlight {
      border-color: var(--vscode-focusBorder);
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .badge {
      font-weight: 600;
      font-size: 11px;
    }
    .saved {
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-charts-blue, #4fc1ff);
    }
    .fluency-row {
      display: flex;
      justify-content: space-between;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .bar-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .bar-track {
      flex: 1;
      height: 6px;
      border-radius: 4px;
      background: var(--vscode-scrollbarSlider-background);
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      border-radius: 4px;
      background: var(--vscode-charts-green, #73c991);
      transition: width 0.25s ease;
    }
    .diff-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      margin: 4px 0;
    }
    code {
      font-family: var(--vscode-editor-font-family);
      padding: 2px 5px;
      border-radius: 4px;
      font-size: 11.5px;
    }
    code.actual {
      background: rgba(244, 71, 71, 0.16);
      color: var(--vscode-charts-red, #f48771);
    }
    code.suggested {
      background: rgba(115, 201, 145, 0.18);
      color: var(--vscode-charts-green, #89d185);
      font-weight: 700;
    }
    code.shortcut {
      background: var(--vscode-editor-background);
      color: var(--vscode-textPreformat-foreground);
      font-size: 10.5px;
    }
    .arrow {
      color: var(--vscode-descriptionForeground);
    }
    .reason, .feed-reason, .empty, .muted {
      color: var(--vscode-descriptionForeground);
      margin: 4px 0 0 0;
      font-size: 11px;
    }
    h3 {
      margin: 12px 0 6px 0;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--vscode-descriptionForeground);
    }
    .habit-row, .cat-row, .feed-item {
      margin-bottom: 8px;
    }
    .habit-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 3px;
    }
    .habit-title {
      font-weight: 600;
    }
    .pct {
      font-size: 10.5px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }
    .actions {
      display: flex;
      gap: 6px;
      margin: 0 0 10px 0;
    }
    button {
      flex: 1;
      border: 1px solid var(--vscode-button-border, rgba(128, 128, 128, 0.35));
      border-radius: 5px;
      padding: 6px 8px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: 11px;
      font-weight: 600;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18);
      transition: background 0.12s ease, border-color 0.12s ease, transform 0.06s ease;
    }
    button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
      border-color: var(--vscode-focusBorder);
    }
    button:active {
      transform: translateY(1px);
    }
    button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }
  </style>
</head>
<body>
  <div class="header">
    <span class="title">VimCoach</span>
    <span class="mode-pill ${modeClass}" title="Current active coaching mode">
      <span class="mode-dot"></span>
      <span>${escapeHtml(modeLabel)}</span>
    </span>
  </div>

  <div class="actions">
    <button id="toggleBtn" type="button">${enabled ? "Pause" : "Resume"}</button>
    <button id="cycleBtn" type="button">Cycle Mode</button>
    <button id="resetBtn" type="button">Reset</button>
  </div>

  ${latestHintHtml}

  <section class="card">
    <div class="fluency-row">
      <span>Vim Fluency Score</span>
      <span>${fluency}%</span>
    </div>
    <div class="bar-track"><div class="bar-fill" style="width:${fluency}%"></div></div>
  </section>

  <h3>Top Habits to Practice</h3>
  <section class="card">${habitsHtml}</section>

  ${categoriesHtml ? `<h3>Category Mastery</h3><section class="card">${categoriesHtml}</section>` : ""}

  <h3>Recent Coaching Feed</h3>
  <section class="card">${feedHtml}</section>

  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById("toggleBtn")?.addEventListener("click", () => {
      vscode.postMessage({ type: "toggleEnabled" });
    });
    document.getElementById("cycleBtn")?.addEventListener("click", () => {
      vscode.postMessage({ type: "cycleMode" });
    });
    document.getElementById("resetBtn")?.addEventListener("click", () => {
      vscode.postMessage({ type: "resetStats" });
    });
  </script>
</body>
</html>`;
  }
}
