import * as vscode from "vscode";

export interface HintPayload {
  rule_id: string;
  title: string;
  category: string;
  actual: string;
  suggested: string;
  keys_saved: number;
  reason: string;
  is_strict_block?: boolean;
  fluency?: number;
  total_keys_saved?: number;
  session_keys_saved?: number;
  mode?: string;
}

export interface HabitStat {
  rule_id: string;
  title: string;
  shortcut: string;
  category: string;
  missed: number;
  used: number;
  keys_saved: number;
  mastery: number;
}

export interface CategoryStat {
  id: string;
  label: string;
  used: number;
  missed: number;
  keys_saved: number;
  mastery?: number;
  skills: Array<{
    id: string;
    title: string;
    shortcut: string;
    used: number;
    missed: number;
    mastery: number;
  }>;
}

export interface HistoryItem {
  ts: number;
  rule_id: string;
  actual: string;
  suggested: string;
  keys_saved: number;
  reason: string;
}

export interface StatsSummary {
  fluency: number;
  total_hints: number;
  total_keys_saved: number;
  total_good_motions: number;
  session: {
    hints: number;
    keys_saved: number;
    good_motions: number;
  };
  top_habits: HabitStat[];
  categories: CategoryStat[];
  history: HistoryItem[];
  mode: string;
  enabled: boolean;
}

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
      vscode.commands.executeCommand("workbench.view.extension.vimcoach-sidebar");
    }
  }

  private render(): void {
    if (!this.view) {
      return;
    }

    const s = this.latestSummary;
    const fluency = s?.fluency ?? 100;
    const mode = (s?.mode ?? "coach").toUpperCase();
    const totalGood = s?.total_good_motions ?? 0;
    const totalHints = s?.total_hints ?? 0;
    const totalSaved = s?.total_keys_saved ?? 0;
    const sessionSaved = s?.session?.keys_saved ?? 0;

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
        : `<p class="empty">Start editing with vscode-neovim — VimCoach will analyze your motions and rank your top habits here.</p>`;

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
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 999px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
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
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      margin-top: 8px;
      text-align: center;
    }
    .kpi {
      background: var(--vscode-editor-background);
      border-radius: 4px;
      padding: 6px 4px;
    }
    .kpi-val {
      font-size: 15px;
      font-weight: 700;
    }
    .kpi-label {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
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
      margin-top: 8px;
    }
    button {
      flex: 1;
      border: none;
      border-radius: 4px;
      padding: 5px 8px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }
  </style>
</head>
<body>
  <div class="header">
    <span class="title">VimCoach</span>
    <span class="mode-pill">${escapeHtml(mode)}</span>
  </div>

  ${latestHintHtml}

  <section class="card">
    <div class="fluency-row">
      <span>Vim Fluency Score</span>
      <span>${fluency}%</span>
    </div>
    <div class="bar-track"><div class="bar-fill" style="width:${fluency}%"></div></div>
    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-val">${totalGood}</div>
        <div class="kpi-label">Good Motions</div>
      </div>
      <div class="kpi">
        <div class="kpi-val">${totalHints}</div>
        <div class="kpi-label">Tips Shown</div>
      </div>
      <div class="kpi">
        <div class="kpi-val">${totalSaved}</div>
        <div class="kpi-label">Keys Saveable (+${sessionSaved})</div>
      </div>
    </div>
    <div class="actions">
      <button id="cycleBtn">Cycle Mode</button>
      <button id="resetBtn">Reset Stats</button>
    </div>
  </section>

  <h3>Top Habits to Practice</h3>
  <section class="card">${habitsHtml}</section>

  ${categoriesHtml ? `<h3>Category Mastery</h3><section class="card">${categoriesHtml}</section>` : ""}

  <h3>Recent Coaching Feed</h3>
  <section class="card">${feedHtml}</section>

  <script>
    const vscode = acquireVsCodeApi();
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
