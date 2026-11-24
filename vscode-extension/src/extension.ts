import * as path from "path";
import * as vscode from "vscode";
import { VimCoachDashboardProvider } from "./dashboardProvider";
import { VimCoachHud } from "./hud";
import { MasteryStore } from "./mastery";
import {
  DEFAULT_VIM_CURSOR_STYLES,
  parseCursorStyleName,
  resolveVimEnvironment,
  SelectionLike,
  VimCursorStyleConfig,
  VimEnvironment,
} from "./modeDetector";
import { Pos0, VSCodeVimTracker } from "./tracker";
import { CoachConfig, CoachMode, createConfig, HintStyle } from "./types";

const VSCODE_VIM_EXTENSION_ID = "vscodevim.vim";
const VSCODE_NEOVIM_EXTENSION_ID = "asvetliakov.vscode-neovim";
const DISMISS_INSTALL_PROMPT_KEY = "vimcoach.dismissedInstallPrompt";

function isVSCodeVimActive(): boolean {
  const ext = vscode.extensions.getExtension(VSCODE_VIM_EXTENSION_ID);
  return !!ext && ext.isActive;
}

function getVimEnvironment(): VimEnvironment {
  return resolveVimEnvironment(
    !!vscode.extensions.getExtension(VSCODE_VIM_EXTENSION_ID),
    !!vscode.extensions.getExtension(VSCODE_NEOVIM_EXTENSION_ID)
  );
}

function readConfig(): CoachConfig {
  const cfg = vscode.workspace.getConfiguration("vimcoach");
  const disabledRulesArr = cfg.get<string[]>("disabledRules", []);
  const disabledRules: Record<string, boolean> = {};
  for (const r of disabledRulesArr) {
    disabledRules[r] = true;
  }

  const disabledLangsArr = cfg.get<string[]>("disabledLanguages", [
    "Log",
    "output",
    "scminput",
    "git-commit",
  ]);
  const disabledLanguages: Record<string, boolean> = {};
  for (const l of disabledLangsArr) {
    disabledLanguages[l] = true;
  }

  return createConfig({
    enabled: cfg.get<boolean>("enabled", true),
    mode: cfg.get<CoachMode>("mode", "coach"),
    adaptiveStrictMisses: cfg.get<number>("adaptiveStrictMisses", 8),
    onlyWhenVSCodeVimActive: cfg.get<boolean>("onlyWhenVSCodeVimActive", true),
    practicalOnly: cfg.get<boolean>("practicalOnly", true),
    assumeNvimY: cfg.get<boolean>("assumeNvimY", false),
    style: cfg.get<HintStyle>("style", "inline_and_status"),
    durationMs: cfg.get<number>("durationMs", 4500),
    cooldownMs: cfg.get<number>("cooldownMs", 0),
    ruleCooldownMs: cfg.get<number>("ruleCooldownMs", 0),
    disabledRules,
    disabledLanguages,
    strict: {
      maxCount: cfg.get<number>("strict.maxCount", 4),
      maxTimeMs: cfg.get<number>("strict.maxTimeMs", 1200),
      allowDifferentKey: true,
    },
  });
}

function readVSCodeVimCursorStyles(): VimCursorStyleConfig {
  const vimCfg = vscode.workspace.getConfiguration("vim.cursorStylePerMode");
  return {
    normal: parseCursorStyleName(
      vimCfg.get<string>("normal"),
      DEFAULT_VIM_CURSOR_STYLES.normal
    ),
    insert: parseCursorStyleName(
      vimCfg.get<string>("insert"),
      DEFAULT_VIM_CURSOR_STYLES.insert
    ),
    visual: parseCursorStyleName(
      vimCfg.get<string>("visual"),
      DEFAULT_VIM_CURSOR_STYLES.visual
    ),
    visualLine: parseCursorStyleName(
      vimCfg.get<string>("visualline"),
      DEFAULT_VIM_CURSOR_STYLES.visualLine
    ),
    replace: parseCursorStyleName(
      vimCfg.get<string>("replace"),
      DEFAULT_VIM_CURSOR_STYLES.replace
    ),
  };
}

function extractLines(doc: vscode.TextDocument): string[] {
  const lines: string[] = new Array(doc.lineCount);
  for (let i = 0; i < doc.lineCount; i++) {
    lines[i] = doc.lineAt(i).text;
  }
  return lines;
}

function toSelectionLike(sel: vscode.Selection): SelectionLike {
  return {
    anchorLine: sel.anchor.line,
    anchorChar: sel.anchor.character,
    activeLine: sel.active.line,
    activeChar: sel.active.character,
    isEmpty: sel.isEmpty,
  };
}

function getVisibleBounds(editor: vscode.TextEditor): { top?: number; bot?: number } {
  const vr = editor.visibleRanges[0];
  if (!vr) {
    return {};
  }
  return {
    top: vr.start.line + 1,
    bot: vr.end.line + 1,
  };
}

let activeTracker: VSCodeVimTracker | undefined;
let activeMastery: MasteryStore | undefined;
let activeHud: VimCoachHud | undefined;

export function activate(context: vscode.ExtensionContext): void {
  let config = readConfig();

  const shouldTrack = (): boolean => {
    if (!config.enabled) {
      return false;
    }
    if (config.onlyWhenVSCodeVimActive && !isVSCodeVimActive()) {
      return false;
    }
    return true;
  };

  const statsPath = path.join(context.globalStorageUri.fsPath, "stats.json");
  const mastery = new MasteryStore(statsPath, () => config);
  mastery.load();
  activeMastery = mastery;

  const hud = new VimCoachHud(() => config);
  activeHud = hud;

  const refreshUI = (): void => {
    const summary = mastery.getSummary();
    const env = getVimEnvironment();
    hud.updateIdleStatus(summary, isVSCodeVimActive(), env);
    dashboard.updateEnvironment(config.onlyWhenVSCodeVimActive ? env : "vscodevim");
    dashboard.updateStats(summary);
  };

  const updateSetting = async <T>(key: string, value: T): Promise<void> => {
    await vscode.workspace
      .getConfiguration("vimcoach")
      .update(key, value, vscode.ConfigurationTarget.Global);
    config = readConfig();
    refreshUI();
  };

  const cycleMode = (): void => {
    const nextMap: Record<CoachMode, CoachMode> = {
      coach: "adaptive",
      adaptive: "strict",
      strict: "coach",
    };
    const next = nextMap[config.mode] ?? "coach";
    void updateSetting("mode", next);
    void vscode.window.showInformationMessage(`VimCoach mode set to: ${next}`);
  };

  const toggleEnabled = (): void => {
    const next = !config.enabled;
    void updateSetting("enabled", next);
    if (!next) {
      hud.clearInlinePill();
    }
    void vscode.window.showInformationMessage(
      next ? `VimCoach enabled (${config.mode} mode)` : "VimCoach paused"
    );
  };

  const resetStats = (): void => {
    mastery.reset();
    refreshUI();
    void vscode.window.showInformationMessage("VimCoach stats reset.");
  };

  const installVSCodeVim = async (): Promise<void> => {
    await vscode.commands.executeCommand(
      "workbench.extensions.installExtension",
      VSCODE_VIM_EXTENSION_ID
    );
    const vimExt = vscode.extensions.getExtension(VSCODE_VIM_EXTENSION_ID);
    if (vimExt && !vimExt.isActive) {
      try {
        await vimExt.activate();
      } catch {
        // Ignore activation errors; onDidChange will refresh state
      }
    }
    refreshUI();
  };

  const openNeovimDocs = async (): Promise<void> => {
    await vscode.env.openExternal(
      vscode.Uri.parse("https://github.com/monroedean/vimcoach#vs-code-with-vscode-neovim")
    );
  };

  const dashboard = new VimCoachDashboardProvider(
    cycleMode,
    toggleEnabled,
    resetStats,
    () => void installVSCodeVim(),
    () => void openNeovimDocs()
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      VimCoachDashboardProvider.viewType,
      dashboard
    )
  );

  const tracker = new VSCodeVimTracker(
    () => config,
    mastery,
    {
      onHint(candidate) {
        const summary = mastery.getSummary();
        const payload = hud.showHint(candidate, summary, isVSCodeVimActive(), getVimEnvironment());
        dashboard.updateHint(payload);
        dashboard.updateStats(summary);
      },
      onStatsUpdated() {
        refreshUI();
      },
      revertCursor(docId: string, pos: Pos0) {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.toString() !== docId) {
          return;
        }
        const p = new vscode.Position(pos.line, pos.character);
        editor.selection = new vscode.Selection(p, p);
      },
    }
  );
  tracker.setCursorStyleConfig(readVSCodeVimCursorStyles());
  activeTracker = tracker;

  const syncEditor = (editor: vscode.TextEditor | undefined): void => {
    if (!editor || editor.document.uri.scheme === "output") {
      return;
    }
    tracker.setActiveDocument(
      editor.document.uri.toString(),
      extractLines(editor.document),
      toSelectionLike(editor.selection),
      editor.options.cursorStyle as number | undefined
    );
  };

  syncEditor(vscode.window.activeTextEditor);
  refreshUI();

  // Re-check once VSCodeVim finishes activating after startup
  const vimExt = vscode.extensions.getExtension(VSCODE_VIM_EXTENSION_ID);
  if (vimExt && !vimExt.isActive) {
    void Promise.resolve(vimExt.activate()).then(
      () => refreshUI(),
      () => refreshUI()
    );
  } else if (
    config.onlyWhenVSCodeVimActive &&
    getVimEnvironment() === "none" &&
    !context.globalState.get<boolean>(DISMISS_INSTALL_PROMPT_KEY)
  ) {
    void vscode.window
      .showInformationMessage(
        "VimCoach needs VSCodeVim to track your Vim motions.",
        "Install VSCodeVim",
        "Don't Show Again"
      )
      .then((choice) => {
        if (choice === "Install VSCodeVim") {
          void installVSCodeVim();
        } else if (choice === "Don't Show Again") {
          void context.globalState.update(DISMISS_INSTALL_PROMPT_KEY, true);
        }
      });
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      syncEditor(editor);
      refreshUI();
    }),

    vscode.window.onDidChangeTextEditorOptions((event) => {
      if (!shouldTrack()) {
        return;
      }
      const editor = event.textEditor;
      if (editor !== vscode.window.activeTextEditor || editor.document.uri.scheme === "output") {
        return;
      }
      const { top, bot } = getVisibleBounds(editor);
      tracker.onModeChanged({
        docId: editor.document.uri.toString(),
        languageId: editor.document.languageId,
        cursorStyle: event.options.cursorStyle as number | undefined,
        selection: toSelectionLike(editor.selection),
        lines: extractLines(editor.document),
        visibleTopRow: top,
        visibleBotRow: bot,
      });
    }),

    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (!shouldTrack()) {
        return;
      }
      const editor = event.textEditor;
      if (editor !== vscode.window.activeTextEditor || editor.document.uri.scheme === "output") {
        return;
      }
      const { top, bot } = getVisibleBounds(editor);
      tracker.onSelectionChanged({
        docId: editor.document.uri.toString(),
        languageId: editor.document.languageId,
        selection: toSelectionLike(event.selections[0] ?? editor.selection),
        isMouse: event.kind === vscode.TextEditorSelectionChangeKind.Mouse,
        cursorStyle: editor.options.cursorStyle as number | undefined,
        lines: extractLines(editor.document),
        visibleTopRow: top,
        visibleBotRow: bot,
      });
    }),

    vscode.workspace.onDidChangeTextDocument((event) => {
      if (!shouldTrack()) {
        return;
      }
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document !== event.document || event.document.uri.scheme === "output") {
        return;
      }
      if (event.contentChanges.length === 0) {
        return;
      }
      const reason =
        event.reason === vscode.TextDocumentChangeReason.Undo
          ? "undo"
          : event.reason === vscode.TextDocumentChangeReason.Redo
            ? "redo"
            : "other";
      const { top, bot } = getVisibleBounds(editor);
      tracker.onDocumentChanged({
        docId: event.document.uri.toString(),
        languageId: event.document.languageId,
        changes: event.contentChanges.map((c) => ({
          rangeStart: { line: c.range.start.line, character: c.range.start.character },
          rangeEnd: { line: c.range.end.line, character: c.range.end.character },
          rangeLength: c.rangeLength,
          text: c.text,
        })),
        reason,
        postLines: extractLines(event.document),
        cursor: {
          line: editor.selection.active.line,
          character: editor.selection.active.character,
        },
        visibleTopRow: top,
        visibleBotRow: bot,
      });
    }),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("vimcoach")) {
        config = readConfig();
        refreshUI();
      }
      if (event.affectsConfiguration("vim.cursorStylePerMode")) {
        tracker.setCursorStyleConfig(readVSCodeVimCursorStyles());
      }
    }),

    vscode.extensions.onDidChange(() => {
      const ext = vscode.extensions.getExtension(VSCODE_VIM_EXTENSION_ID);
      if (ext && !ext.isActive) {
        void Promise.resolve(ext.activate()).then(
          () => refreshUI(),
          () => refreshUI()
        );
      } else {
        refreshUI();
      }
    }),

    vscode.commands.registerCommand("vimcoach.openDashboard", () => {
      dashboard.updateStats(mastery.getSummary());
      dashboard.reveal();
    }),

    vscode.commands.registerCommand("vimcoach.toggle", toggleEnabled),

    vscode.commands.registerCommand("vimcoach.cycleMode", cycleMode),

    vscode.commands.registerCommand("vimcoach.setMode", async () => {
      const picked = await vscode.window.showQuickPick(
        [
          { label: "coach", description: "Show hints without blocking keys" },
          { label: "adaptive", description: "Block only habits you miss repeatedly" },
          { label: "strict", description: "Block repeated hjkl spamming" },
        ],
        { placeHolder: "Select VimCoach mode" }
      );
      if (picked) {
        await updateSetting("mode", picked.label as CoachMode);
        void vscode.window.showInformationMessage(`VimCoach mode set to: ${picked.label}`);
      }
    }),

    vscode.commands.registerCommand("vimcoach.status", () => {
      const s = mastery.getSummary();
      const vimStatus = isVSCodeVimActive() ? "active" : "not active";
      void vscode.window.showInformationMessage(
        `VimCoach: ${s.enabled ? "ON" : "OFF"} | Mode: ${s.mode} | VSCodeVim: ${vimStatus} | ` +
          `Fluency: ${s.fluency}% | Good: ${s.total_good_motions} | Tips: ${s.total_hints} | Keys saveable: ${s.total_keys_saved}`
      );
    }),

    vscode.commands.registerCommand("vimcoach.testHint", () => {
      const summary = mastery.getSummary();
      const payload = hud.showHint(
        {
          ruleId: "textobj_quotes",
          actual: "vlllld",
          suggested: 'di"',
          keysSaved: 3,
          priority: 100,
          reason: "Test hint from VimCoach — your VSCodeVim HUD is working!",
        },
        summary,
        isVSCodeVimActive(),
        getVimEnvironment()
      );
      dashboard.updateHint(payload);
    }),

    vscode.commands.registerCommand("vimcoach.resetStats", resetStats),

    hud,
    {
      dispose() {
        tracker.dispose();
        mastery.dispose();
      },
    }
  );
}

export function deactivate(): void {
  activeTracker?.dispose();
  activeMastery?.dispose();
  activeHud?.dispose();
  activeTracker = undefined;
  activeMastery = undefined;
  activeHud = undefined;
}
