import * as vscode from "vscode";
import {
  HintPayload,
  StatsSummary,
  VimCoachDashboardProvider,
} from "./dashboardProvider";

let statusBarItem: vscode.StatusBarItem | undefined;
let statusResetTimer: NodeJS.Timeout | undefined;
let latestFluency = 100;
let latestMode = "coach";

function resetStatusBarToIdle(): void {
  if (!statusBarItem) {
    return;
  }
  const modeTag =
    latestMode === "strict"
      ? " [STRICT]"
      : latestMode === "adaptive"
      ? " [ADAPT]"
      : "";
  statusBarItem.text = `$(mortar-board) VimCoach ${latestFluency}%${modeTag}`;
  statusBarItem.backgroundColor = undefined;
  statusBarItem.tooltip = new vscode.MarkdownString(
    `**VimCoach** · Fluency: **${latestFluency}%** · Mode: \`${latestMode}\`\n\nClick to open the Mastery Dashboard.`
  );
}

async function runNeovimLua(luaCode: string): Promise<void> {
  try {
    await vscode.commands.executeCommand("vscode-neovim.lua", luaCode);
  } catch {
    vscode.window.showWarningMessage(
      "VimCoach: Could not communicate with vscode-neovim. Ensure the vscode-neovim extension is active."
    );
  }
}

export function activate(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "vimcoach.openDashboard";
  resetStatusBarToIdle();
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  const cycleMode = (): void => {
    const nextMap: Record<string, string> = {
      coach: "strict",
      strict: "adaptive",
      adaptive: "coach",
    };
    const next = nextMap[latestMode] ?? "coach";
    latestMode = next;
    void runNeovimLua(`require("vimcoach").set_mode("${next}")`);
    resetStatusBarToIdle();
  };

  const resetStats = (): void => {
    void runNeovimLua(`require("vimcoach").reset()`);
  };

  const dashboardProvider = new VimCoachDashboardProvider(
    cycleMode,
    resetStats
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      VimCoachDashboardProvider.viewType,
      dashboardProvider
    )
  );

  // Handshake command queried by vimcoach.nvim on startup
  context.subscriptions.push(
    vscode.commands.registerCommand("vimcoach.ping", () => "pong")
  );

  // Receive a live coaching hint from vimcoach.nvim
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vimcoach.showHint",
      (payload?: HintPayload) => {
        if (!payload) {
          return;
        }

        if (typeof payload.fluency === "number") {
          latestFluency = payload.fluency;
        }
        if (payload.mode) {
          latestMode = payload.mode;
        }

        dashboardProvider.updateHint(payload);

        const cfg = vscode.workspace.getConfiguration("vimcoach");
        const style = cfg.get<string>("notificationStyle", "both");
        const durationMs = cfg.get<number>("statusBarDurationMs", 6500);

        const savedBadge =
          payload.keys_saved > 0
            ? ` (-${payload.keys_saved} key${payload.keys_saved === 1 ? "" : "s"})`
            : "";

        // 1. Update Status Bar HUD
        if (statusBarItem && (style === "statusBar" || style === "both")) {
          const icon = payload.is_strict_block ? "$(stop)" : "$(lightbulb)";
          statusBarItem.text = `${icon} ${payload.actual} → ${payload.suggested}${savedBadge}`;
          statusBarItem.backgroundColor = payload.is_strict_block
            ? new vscode.ThemeColor("statusBarItem.warningBackground")
            : new vscode.ThemeColor("statusBarItem.prominentBackground");
          const md = new vscode.MarkdownString();
          md.appendMarkdown(
            `### VimCoach · ${payload.title}\n\n` +
              `\`${payload.actual}\` → **\`${payload.suggested}\`**${savedBadge}\n\n` +
              `${payload.reason}\n\n` +
              `_Click to open the Mastery Dashboard._`
          );
          statusBarItem.tooltip = md;

          if (statusResetTimer) {
            clearTimeout(statusResetTimer);
          }
          statusResetTimer = setTimeout(() => {
            resetStatusBarToIdle();
          }, durationMs);
        }

        // 2. Crisp VS Code notification toast
        if (style === "toast" || style === "both") {
          const msg = `VimCoach [${payload.title}]: ${payload.actual} → ${payload.suggested}${savedBadge} — ${payload.reason}`;
          const openBtn = "Dashboard";
          const showFn = payload.is_strict_block
            ? vscode.window.showWarningMessage
            : vscode.window.showInformationMessage;

          void showFn(msg, openBtn).then((choice) => {
            if (choice === openBtn) {
              dashboardProvider.reveal();
            }
          });
        }
      }
    )
  );

  // Sync full mastery summary from vimcoach.nvim
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "vimcoach.syncStats",
      (summary?: StatsSummary) => {
        if (!summary) {
          return;
        }
        latestFluency = summary.fluency ?? latestFluency;
        latestMode = summary.mode ?? latestMode;
        dashboardProvider.updateStats(summary);
        if (!statusResetTimer) {
          resetStatusBarToIdle();
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vimcoach.openDashboard", () => {
      dashboardProvider.reveal();
      void runNeovimLua(`require("vimcoach.ui").sync()`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vimcoach.cycleMode", cycleMode)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("vimcoach.resetStats", resetStats)
  );
}

export function deactivate(): void {
  if (statusResetTimer) {
    clearTimeout(statusResetTimer);
    statusResetTimer = undefined;
  }
}
