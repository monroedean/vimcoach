import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { MasteryStore } from "../mastery";
import {
  CursorStyle,
  getEnvironmentNotice,
  resolveVimEnvironment,
  SelectionLike,
} from "../modeDetector";
import { Pos0, VSCodeVimTracker } from "../tracker";
import { Candidate, CoachConfig, createConfig } from "../types";

function collapsed(line: number, ch: number): SelectionLike {
  return { anchorLine: line, anchorChar: ch, activeLine: line, activeChar: ch, isEmpty: true };
}

function range(aLine: number, aChar: number, bLine: number, bChar: number): SelectionLike {
  return {
    anchorLine: aLine,
    anchorChar: aChar,
    activeLine: bLine,
    activeChar: bChar,
    isEmpty: aLine === bLine && aChar === bChar,
  };
}

function createHarness(overrides?: Partial<CoachConfig>) {
  let clock = 1000;
  const cfg = createConfig(overrides);
  const hints: Candidate[] = [];
  const reverted: Pos0[] = [];
  const mastery = new MasteryStore(null, () => cfg, () => clock);

  const tracker = new VSCodeVimTracker(
    () => cfg,
    mastery,
    {
      onHint(c) {
        hints.push(c);
      },
      onStatsUpdated() {},
      revertCursor(_docId, pos) {
        reverted.push(pos);
      },
      scheduleTimer(_ms, _cb) {
        return 1;
      },
      cancelTimer() {},
      nowMs: () => clock,
    }
  );

  return {
    tracker,
    mastery,
    hints,
    reverted,
    tick(ms: number) {
      clock += ms;
    },
  };
}

describe("VSCodeVimTracker end-to-end event simulations", () => {
  it('detects visually stepping inside quotes and deleting -> di"', () => {
    const h = createHarness();
    const docId = "file:///demo.ts";
    const line = 'const msg = "hello";';
    const lines = [line];

    h.tracker.setActiveDocument(docId, lines, collapsed(0, 13), CursorStyle.Block);

    for (let endCol = 14; endCol <= 18; endCol++) {
      h.tick(100);
      h.tracker.onSelectionChanged({
        docId,
        languageId: "typescript",
        selection: range(0, 13, 0, endCol),
        isMouse: false,
        cursorStyle: CursorStyle.Block,
        lines,
      });
    }

    h.tick(100);
    h.tracker.onDocumentChanged({
      docId,
      languageId: "typescript",
      changes: [
        {
          rangeStart: { line: 0, character: 13 },
          rangeEnd: { line: 0, character: 18 },
          rangeLength: 5,
          text: "",
        },
      ],
      postLines: ['const msg = "";'],
    });

    assert.equal(h.hints.length, 1);
    assert.equal(h.hints[0].ruleId, "textobj_quotes");
    assert.equal(h.hints[0].suggested, 'di"');
  });

  it("detects Normal-mode jjjjjj to blank line -> }", () => {
    const h = createHarness();
    const docId = "file:///demo.ts";
    const lines = ["a", "b", "c", "d", "e", "f", "", "g"];

    h.tracker.setActiveDocument(docId, lines, collapsed(0, 0), CursorStyle.Block);
    for (let r = 1; r <= 6; r++) {
      h.tick(80);
      h.tracker.onSelectionChanged({
        docId,
        languageId: "typescript",
        selection: collapsed(r, 0),
        isMouse: false,
        cursorStyle: CursorStyle.Block,
        lines,
      });
    }

    h.tracker.flushNav(false);
    assert.equal(h.hints.length, 1);
    assert.equal(h.hints[0].ruleId, "nav_paragraph");
    assert.equal(h.hints[0].suggested, "}");
  });

  it("ignores mouse clicks completely", () => {
    const h = createHarness();
    const docId = "file:///demo.ts";
    const lines = ["const msg = 'hello world';"];

    h.tracker.setActiveDocument(docId, lines, collapsed(0, 0), CursorStyle.Block);
    h.tick(100);
    h.tracker.onSelectionChanged({
      docId,
      languageId: "typescript",
      selection: collapsed(0, 20),
      isMouse: true,
      cursorStyle: CursorStyle.Block,
      lines,
    });
    h.tracker.flushNav(false);
    assert.equal(h.hints.length, 0);
  });

  it("distinguishes dw + pause + i (-> cw) from atomic cw (praised, NOT nagged)", () => {
    const h = createHarness();
    const docId = "file:///demo.ts";
    const lines = ["const alpha = 1;"];

    // Atomic `cw` (delete + Insert within 20ms)
    h.tracker.setActiveDocument(docId, lines, collapsed(0, 6), CursorStyle.Block);
    h.tick(100);
    h.tracker.onDocumentChanged({
      docId,
      languageId: "typescript",
      changes: [
        {
          rangeStart: { line: 0, character: 6 },
          rangeEnd: { line: 0, character: 12 },
          rangeLength: 6,
          text: "",
        },
      ],
      postLines: ["const = 1;"],
    });
    h.tick(15);
    h.tracker.onModeChanged({
      docId,
      languageId: "typescript",
      cursorStyle: CursorStyle.Line,
      selection: collapsed(0, 6),
      lines: ["const = 1;"],
    });
    assert.equal(h.hints.length, 0);
    assert.ok(h.mastery.state.total_good_motions >= 1);

    h.tick(200);
    h.tracker.onModeChanged({
      docId,
      languageId: "typescript",
      cursorStyle: CursorStyle.Block,
      selection: collapsed(0, 6),
      lines: ["const = 1;"],
    });

    // Separate `dw`, pause, then `i`
    const lines2 = ["const beta = 2;"];
    h.tracker.setActiveDocument(docId, lines2, collapsed(0, 6), CursorStyle.Block);
    h.tick(100);
    h.tracker.onDocumentChanged({
      docId,
      languageId: "typescript",
      changes: [
        {
          rangeStart: { line: 0, character: 6 },
          rangeEnd: { line: 0, character: 11 },
          rangeLength: 5,
          text: "",
        },
      ],
      postLines: ["const = 2;"],
    });
    h.tick(250);
    h.tracker.onModeChanged({
      docId,
      languageId: "typescript",
      cursorStyle: CursorStyle.Line,
      selection: collapsed(0, 6),
      lines: ["const = 2;"],
    });
    assert.equal(h.hints.length, 1);
    assert.equal(h.hints[0].ruleId, "edit_delete_then_insert");
    assert.equal(h.hints[0].suggested, "cw");
  });

  it("detects xiA<Esc> on lowercase 'a' -> ~", () => {
    const h = createHarness();
    const docId = "file:///demo.ts";
    h.tracker.setActiveDocument(docId, ["apple"], collapsed(0, 0), CursorStyle.Block);

    h.tick(100);
    h.tracker.onDocumentChanged({
      docId,
      languageId: "typescript",
      changes: [
        {
          rangeStart: { line: 0, character: 0 },
          rangeEnd: { line: 0, character: 1 },
          rangeLength: 1,
          text: "",
        },
      ],
      postLines: ["pple"],
    });

    h.tick(150);
    h.tracker.onModeChanged({
      docId,
      languageId: "typescript",
      cursorStyle: CursorStyle.Line,
      selection: collapsed(0, 0),
      lines: ["pple"],
    });

    h.tick(100);
    h.tracker.onDocumentChanged({
      docId,
      languageId: "typescript",
      changes: [
        {
          rangeStart: { line: 0, character: 0 },
          rangeEnd: { line: 0, character: 0 },
          rangeLength: 0,
          text: "A",
        },
      ],
      postLines: ["Apple"],
    });

    h.tick(100);
    h.tracker.onModeChanged({
      docId,
      languageId: "typescript",
      cursorStyle: CursorStyle.Block,
      selection: collapsed(0, 0),
      lines: ["Apple"],
    });

    assert.equal(h.hints.length, 1);
    assert.equal(h.hints[0].ruleId, "edit_toggle_case");
    assert.equal(h.hints[0].suggested, "~");
  });

  it("detects repeated xxxxx deleting to EOL -> D", () => {
    const h = createHarness();
    const docId = "file:///demo.ts";
    let text = "const x = 12345";
    h.tracker.setActiveDocument(docId, [text], collapsed(0, 10), CursorStyle.Block);

    for (let i = 0; i < 5; i++) {
      h.tick(100);
      text = text.slice(0, 10) + text.slice(11);
      h.tracker.onDocumentChanged({
        docId,
        languageId: "typescript",
        changes: [
          {
            rangeStart: { line: 0, character: 10 },
            rangeEnd: { line: 0, character: 11 },
            rangeLength: 1,
            text: "",
          },
        ],
        postLines: [text],
      });
    }

    // Move cursor to flush x-run
    h.tick(100);
    h.tracker.onSelectionChanged({
      docId,
      languageId: "typescript",
      selection: collapsed(0, 9),
      isMouse: false,
      cursorStyle: CursorStyle.Block,
      lines: [text],
    });

    assert.equal(h.hints.length, 1);
    assert.equal(h.hints[0].ruleId, "edit_repeated_x");
    assert.equal(h.hints[0].suggested, "D");
  });

  it("detects Insert mode repeated <BS> -> <C-w> and arrows -> <Esc>", () => {
    const h = createHarness();
    const docId = "file:///demo.ts";
    let text = "const hello";
    h.tracker.setActiveDocument(docId, [text], collapsed(0, 10), CursorStyle.Block);

    h.tick(100);
    h.tracker.onModeChanged({
      docId,
      languageId: "typescript",
      cursorStyle: CursorStyle.Line,
      selection: collapsed(0, 11),
      lines: [text],
    });

    for (let i = 0; i < 5; i++) {
      h.tick(80);
      const col = text.length;
      text = text.slice(0, col - 1);
      h.tracker.onDocumentChanged({
        docId,
        languageId: "typescript",
        changes: [
          {
            rangeStart: { line: 0, character: col - 1 },
            rangeEnd: { line: 0, character: col },
            rangeLength: 1,
            text: "",
          },
        ],
        postLines: [text],
      });
    }

    h.tick(100);
    h.tracker.onModeChanged({
      docId,
      languageId: "typescript",
      cursorStyle: CursorStyle.Block,
      selection: collapsed(0, 5),
      lines: [text],
    });

    assert.equal(h.hints.length, 1);
    assert.equal(h.hints[0].ruleId, "insert_ctrl_w");
    assert.equal(h.hints[0].suggested, "<C-w>");
  });

  it("strict mode blocks repeated j spamming and reverts cursor", () => {
    const h = createHarness({ mode: "strict" });
    const docId = "file:///demo.ts";
    const lines = ["1", "2", "3", "4", "5", "6", "7"];
    h.tracker.setActiveDocument(docId, lines, collapsed(0, 0), CursorStyle.Block);

    for (let r = 1; r <= 5; r++) {
      h.tick(80);
      h.tracker.onSelectionChanged({
        docId,
        languageId: "typescript",
        selection: collapsed(r, 0),
        isMouse: false,
        cursorStyle: CursorStyle.Block,
        lines,
      });
    }

    assert.equal(h.reverted.length, 1);
    assert.equal(h.reverted[0].line, 4);
    assert.equal(h.hints.length, 1);
    assert.equal(h.hints[0].isStrictBlock, true);
  });
});

describe("Vim environment detection", () => {
  it("resolves installed extension combinations cleanly", () => {
    assert.equal(resolveVimEnvironment(true, false), "vscodevim");
    assert.equal(resolveVimEnvironment(true, true), "vscodevim");
    assert.equal(resolveVimEnvironment(false, true), "vscode-neovim");
    assert.equal(resolveVimEnvironment(false, false), "none");
  });

  it("returns the right dashboard notice for each environment", () => {
    assert.equal(getEnvironmentNotice("vscodevim"), null);

    const missingNotice = getEnvironmentNotice("none");
    assert.ok(missingNotice);
    assert.equal(missingNotice.actionType, "installVSCodeVim");

    const neovimNotice = getEnvironmentNotice("vscode-neovim");
    assert.ok(neovimNotice);
    assert.equal(neovimNotice.actionType, "openNeovimDocs");
  });
});
