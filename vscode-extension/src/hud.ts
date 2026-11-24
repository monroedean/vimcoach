import * as vscode from "vscode";
import { getRuleMeta } from "./catalog";
import { VimEnvironment } from "./modeDetector";
import { Candidate, CoachConfig, HintPayload, StatsSummary } from "./types";

export class VimCoachHud {
  private readonly statusBarItem: vscode.StatusBarItem;
  private statusResetTimer: ReturnType<typeof setTimeout> | null = null;
  private inlineDecoration: vscode.TextEditorDecorationType | null = null;
  private inlineTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly getConfig: () => CoachConfig) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = "vimcoach.openDashboard";
    this.statusBarItem.show();
  }

  public updateIdleStatus(
    summary: StatsSummary,
    vscodeVimActive: boolean,
    vimEnv: VimEnvironment = vscodeVimActive ? "vscodevim" : "none"
  ): void {
    const cfg = this.getConfig();
    if (!cfg.enabled) {
      this.statusBarItem.text = "$(mortar-board) VimCoach (Paused)";
      this.statusBarItem.backgroundColor = undefined;
      this.statusBarItem.tooltip = "VimCoach is paused. Click to open the Mastery Dashboard.";
      return;
    }

    if (cfg.onlyWhenVSCodeVimActive && !vscodeVimActive) {
      if (vimEnv === "none") {
        this.statusBarItem.text = "$(mortar-board) VimCoach (install VSCodeVim)";
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.tooltip = "VSCodeVim isn't installed yet. Click to open VimCoach.";
        return;
      }
      if (vimEnv === "vscode-neovim") {
        this.statusBarItem.text = "$(mortar-board) VimCoach (vscode-neovim)";
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.tooltip =
          "This extension is for VSCodeVim. For vscode-neovim, use the Neovim plugin (monroedean/vimcoach).";
        return;
      }
    }

    const modeTag =
      summary.mode === "strict"
        ? " [STRICT]"
        : summary.mode === "adaptive"
          ? " [ADAPT]"
          : "";
    const inactiveTag =
      cfg.onlyWhenVSCodeVimActive && !vscodeVimActive ? " (waiting for VSCodeVim)" : "";

    this.statusBarItem.text = `$(mortar-board) VimCoach ${summary.fluency}%${modeTag}${inactiveTag}`;
    this.statusBarItem.backgroundColor = undefined;
    this.statusBarItem.tooltip = new vscode.MarkdownString(
      `**VimCoach** · Fluency: **${summary.fluency}%** · Mode: \`${summary.mode}\`\n\n` +
        `Good motions: ${summary.total_good_motions} · Tips: ${summary.total_hints} · Keys saveable: ${summary.total_keys_saved}\n\n` +
        `Click to open the Mastery Dashboard.`
    );
  }

  public showHint(candidate: Candidate, summary: StatsSummary, vscodeVimActive: boolean): HintPayload {
    const cfg = this.getConfig();
    const meta = getRuleMeta(candidate.ruleId);
    const title = meta?.title ?? "Vim Tip";
    const category = meta?.category ?? "editing";

    const payload: HintPayload = {
      rule_id: candidate.ruleId,
      title,
      category,
      actual: candidate.actual,
      suggested: candidate.suggested,
      keys_saved: candidate.keysSaved,
      reason: candidate.reason,
      is_strict_block: candidate.isStrictBlock,
      fluency: summary.fluency,
      total_keys_saved: summary.total_keys_saved,
      session_keys_saved: summary.session.keys_saved,
      mode: summary.mode,
    };

    const savedStr =
      candidate.keysSaved > 0
        ? ` (-${candidate.keysSaved} key${candidate.keysSaved === 1 ? "" : "s"})`
        : "";
    const isWarn = candidate.isStrictBlock === true;
    const durationMs = cfg.durationMs || 4500;
    const style = cfg.style || "inline_and_status";

    const inlineText = `⚡ ${candidate.actual} → ${candidate.suggested}${savedStr}`;
    const statusText = `$(sparkle) VimCoach: ${candidate.actual} → ${candidate.suggested}${savedStr} · ${title}`;
    const toastText = `VimCoach [${title}]: ${candidate.actual} → ${candidate.suggested}${savedStr} — ${candidate.reason}`;
    const hoverMd = new vscode.MarkdownString(
      `**VimCoach · ${title}**\n\n\`${candidate.actual}\` → **\`${candidate.suggested}\`**${savedStr}\n\n${candidate.reason}`
    );
    hoverMd.isTrusted = false;

    if (style === "inline" || style === "inline_and_status") {
      this.showInlinePill(inlineText, hoverMd, isWarn, durationMs);
    }

    if (style === "status_bar" || style === "inline_and_status") {
      this.statusBarItem.text = statusText;
      this.statusBarItem.backgroundColor = isWarn
        ? new vscode.ThemeColor("statusBarItem.warningBackground")
        : new vscode.ThemeColor("statusBarItem.prominentBackground");
      this.statusBarItem.tooltip = hoverMd;

      if (this.statusResetTimer) {
        clearTimeout(this.statusResetTimer);
      }
      this.statusResetTimer = setTimeout(() => {
        this.statusResetTimer = null;
        this.updateIdleStatus(summary, vscodeVimActive);
      }, durationMs);
    }

    if (style === "toast") {
      if (isWarn) {
        void vscode.window.showWarningMessage(toastText);
      } else {
        void vscode.window.showInformationMessage(toastText);
      }
    }

    return payload;
  }

  private showInlinePill(
    inlineText: string,
    hoverMd: vscode.MarkdownString,
    isWarn: boolean,
    durationMs: number
  ): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    this.clearInlinePill();

    const deco = vscode.window.createTextEditorDecorationType({
      after: {
        contentText: inlineText,
        color: isWarn ? "#f2cc60" : "#89d185",
        backgroundColor: isWarn
          ? "rgba(242, 204, 96, 0.14)"
          : "rgba(115, 201, 145, 0.14)",
        border: isWarn
          ? "1px solid rgba(242, 204, 96, 0.45)"
          : "1px solid rgba(115, 201, 145, 0.42)",
        margin: "0 0 0 18px",
        textDecoration:
          "none; padding: 1px 8px; border-radius: 4px; font-style: normal; font-weight: 500;",
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    this.inlineDecoration = deco;

    const lineNum = editor.selection.active.line;
    const lineLen = editor.document.lineAt(lineNum).text.length;
    const range = new vscode.Range(lineNum, lineLen, lineNum, lineLen);
    editor.setDecorations(deco, [{ range, hoverMessage: hoverMd }]);

    this.inlineTimer = setTimeout(() => {
      if (this.inlineDecoration === deco) {
        this.clearInlinePill();
      } else {
        deco.dispose();
      }
    }, durationMs);
  }

  public clearInlinePill(): void {
    if (this.inlineTimer) {
      clearTimeout(this.inlineTimer);
      this.inlineTimer = null;
    }
    if (this.inlineDecoration) {
      this.inlineDecoration.dispose();
      this.inlineDecoration = null;
    }
  }

  public dispose(): void {
    this.clearInlinePill();
    if (this.statusResetTimer) {
      clearTimeout(this.statusResetTimer);
      this.statusResetTimer = null;
    }
    this.statusBarItem.dispose();
  }
}
