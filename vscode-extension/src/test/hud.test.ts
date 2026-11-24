import { describe, it, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import Module = require("module");
import { Candidate, CoachConfig, createConfig, StatsSummary } from "../types";
import type { VimCoachHud as VimCoachHudType } from "../hud";

interface FakeStatusBarItem {
  text: string;
  backgroundColor: { id: string } | undefined;
  tooltip: unknown;
  command: string | undefined;
  shown: boolean;
  disposed: boolean;
  show(): void;
  dispose(): void;
}

function makeSummary(overrides?: Partial<StatsSummary>): StatsSummary {
  return {
    fluency: 80,
    total_hints: 2,
    total_keys_saved: 6,
    total_good_motions: 8,
    session: { started_at: 0, hints: 2, keys_saved: 6, good_motions: 8 },
    top_habits: [],
    categories: [],
    history: [],
    mode: "coach",
    enabled: true,
    ...overrides,
  };
}

const sampleCandidate: Candidate = {
  ruleId: "textobj_quotes",
  actual: "vlllld",
  suggested: 'di"',
  keysSaved: 3,
  priority: 100,
  reason: 'Use di" directly.',
};

function createHudHarness(overrides?: Partial<CoachConfig>) {
  let cfg = createConfig({ durationMs: 30, style: "inline_and_status", ...overrides });
  const statusBarItem: FakeStatusBarItem = {
    text: "",
    backgroundColor: undefined,
    tooltip: undefined,
    command: undefined,
    shown: false,
    disposed: false,
    show() {
      this.shown = true;
    },
    dispose() {
      this.disposed = true;
    },
  };

  const fakeVscode = {
    StatusBarAlignment: { Left: 1, Right: 2 },
    DecorationRangeBehavior: { ClosedClosed: 1 },
    ThemeColor: class ThemeColor {
      constructor(public readonly id: string) {}
    },
    MarkdownString: class MarkdownString {
      public isTrusted = false;
      constructor(public readonly value: string) {}
    },
    Range: class Range {
      constructor(
        public readonly startLine: number,
        public readonly startChar: number,
        public readonly endLine: number,
        public readonly endChar: number
      ) {}
    },
    window: {
      activeTextEditor: undefined,
      createStatusBarItem: () => statusBarItem,
      createTextEditorDecorationType: () => ({ dispose() {} }),
      showWarningMessage: () => Promise.resolve(undefined),
      showInformationMessage: () => Promise.resolve(undefined),
    },
  };

  const moduleInternal = Module as unknown as {
    _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
  };
  const origLoad = moduleInternal._load;
  moduleInternal._load = function (request: string, parent: NodeModule | null, isMain: boolean) {
    if (request === "vscode") {
      return fakeVscode;
    }
    return origLoad.call(this, request, parent, isMain);
  };

  const hudPath = require.resolve("../hud");
  delete require.cache[hudPath];
  const { VimCoachHud } = require("../hud") as { VimCoachHud: typeof VimCoachHudType };
  moduleInternal._load = origLoad;

  const hud = new VimCoachHud(() => cfg);

  return {
    hud,
    statusBarItem,
    setConfig(patch: Partial<CoachConfig>) {
      cfg = { ...cfg, ...patch };
    },
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("VimCoachHud status bar lifecycle", () => {
  let activeHud: VimCoachHudType | null = null;

  afterEach(() => {
    activeHud?.dispose();
    activeHud = null;
  });

  it("keeps status bar hint visible across idle status updates and restores latest stats after timer", async () => {
    const { hud, statusBarItem } = createHudHarness({ durationMs: 40 });
    activeHud = hud;

    hud.updateIdleStatus(makeSummary({ fluency: 80 }), true, "vscodevim");
    assert.equal(statusBarItem.text, "$(mortar-board) VimCoach 80%");

    hud.showHint(sampleCandidate, makeSummary({ fluency: 75 }), true, "vscodevim");
    assert.match(statusBarItem.text, /VimCoach: vlllld → di"/);
    assert.equal(statusBarItem.backgroundColor?.id, "statusBarItem.prominentBackground");

    // Subsequent good motion updates idle state without wiping out the active hint
    hud.updateIdleStatus(makeSummary({ fluency: 92 }), true, "vscodevim");
    assert.match(statusBarItem.text, /VimCoach: vlllld → di"/);

    await wait(65);
    assert.equal(statusBarItem.text, "$(mortar-board) VimCoach 92%");
    assert.equal(statusBarItem.backgroundColor, undefined);
  });

  it("clears active status bar hint immediately when paused", async () => {
    const { hud, statusBarItem, setConfig } = createHudHarness({ durationMs: 100 });
    activeHud = hud;

    hud.showHint(sampleCandidate, makeSummary({ fluency: 75 }), true, "vscodevim");
    assert.match(statusBarItem.text, /VimCoach: vlllld → di"/);

    setConfig({ enabled: false });
    hud.updateIdleStatus(makeSummary({ fluency: 75, enabled: false }), true, "vscodevim");
    assert.equal(statusBarItem.text, "$(mortar-board) VimCoach (Paused)");
    assert.equal(statusBarItem.backgroundColor, undefined);

    // Timer must stay cancelled so paused state is not overwritten later
    await wait(130);
    assert.equal(statusBarItem.text, "$(mortar-board) VimCoach (Paused)");
  });

  it("updates idle status immediately on miss when style does not use status bar", () => {
    const { hud, statusBarItem } = createHudHarness({ style: "inline" });
    activeHud = hud;

    hud.updateIdleStatus(makeSummary({ fluency: 80 }), true, "vscodevim");
    assert.equal(statusBarItem.text, "$(mortar-board) VimCoach 80%");

    hud.showHint(sampleCandidate, makeSummary({ fluency: 70 }), true, "vscodevim");
    assert.equal(statusBarItem.text, "$(mortar-board) VimCoach 70%");
  });
});
