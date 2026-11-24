import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  analyzeBackspaceRun,
  analyzeInsertArrows,
  analyzeInsertEntry,
  analyzeInsertLeave,
  analyzeNavigation,
  analyzeOperator,
  analyzeRepeatedX,
  analyzeVisual,
  pickBest,
  RepetitionAnalyzer,
} from "../analyzers";
import { MasteryStore } from "../mastery";
import { createConfig } from "../types";

const defaultCfg = createConfig();

describe("visual analyzer", () => {
  it('visually stepping inside quotes -> di"', () => {
    const line = 'const name = "vimcoach";';
    const best = pickBest(
      analyzeVisual(
        {
          visualMode: "v",
          operator: "d",
          sRow: 1,
          sCol: 15,
          eRow: 1,
          eCol: 22,
          anchorRow: 1,
          anchorCol: 15,
          keys: ["v", "l", "l", "l", "l", "l", "l", "l", "d"],
          lines: [line],
        },
        defaultCfg
      )
    );
    assert.ok(best);
    assert.equal(best.ruleId, "textobj_quotes");
    assert.equal(best.suggested, 'di"');
  });

  it("visually stepping inside parentheses -> ci(", () => {
    const line = "handleEvent(alpha, beta)";
    const best = pickBest(
      analyzeVisual(
        {
          visualMode: "v",
          operator: "c",
          sRow: 1,
          sCol: 13,
          eRow: 1,
          eCol: 23,
          anchorRow: 1,
          anchorCol: 13,
          keys: ["v", "w", "w", "e", "c"],
          lines: [line],
        },
        defaultCfg
      )
    );
    assert.ok(best);
    assert.equal(best.ruleId, "textobj_brackets");
    assert.equal(best.suggested, "ci(");
  });

  it("visually selecting inside HTML tag -> cit", () => {
    const line = "<span>Hello World</span>";
    const best = pickBest(
      analyzeVisual(
        {
          visualMode: "v",
          operator: "c",
          sRow: 1,
          sCol: 7,
          eRow: 1,
          eCol: 17,
          anchorRow: 1,
          anchorCol: 7,
          keys: ["v", "w", "e", "c"],
          lines: [line],
        },
        defaultCfg
      )
    );
    assert.ok(best);
    assert.equal(best.ruleId, "textobj_tag");
    assert.equal(best.suggested, "cit");
  });

  it("visual line inside multiline braces -> di{", () => {
    const lines = ["if (ok) {", "  const a = 1;", "  const b = 2;", "}"];
    const best = pickBest(
      analyzeVisual(
        {
          visualMode: "V",
          operator: "d",
          sRow: 2,
          sCol: 1,
          eRow: 3,
          eCol: 14,
          anchorRow: 2,
          anchorCol: 1,
          keys: ["V", "j", "d"],
          lines,
          totalLines: 4,
        },
        defaultCfg
      )
    );
    assert.ok(best);
    assert.equal(best.ruleId, "textobj_brackets");
    assert.equal(best.suggested, "di{");
  });

  it("visual line paragraph selection -> dip", () => {
    const lines = ["", "line 1", "line 2", "line 3", "", "other"];
    const best = pickBest(
      analyzeVisual(
        {
          visualMode: "V",
          operator: "d",
          sRow: 2,
          sCol: 1,
          eRow: 4,
          eCol: 6,
          anchorRow: 2,
          anchorCol: 1,
          keys: ["V", "j", "j", "d"],
          lines,
          totalLines: 6,
        },
        defaultCfg
      )
    );
    assert.ok(best);
    assert.equal(best.ruleId, "textobj_paragraph");
    assert.equal(best.suggested, "dip");
  });

  it("visual to end of line -> D / C", () => {
    const line = "const x = 1 + 2 + 3;";
    const best = pickBest(
      analyzeVisual(
        {
          visualMode: "v",
          operator: "d",
          sRow: 1,
          sCol: 11,
          eRow: 1,
          eCol: line.length,
          anchorRow: 1,
          anchorCol: 11,
          keys: ["v", "l", "l", "l", "l", "l", "l", "l", "l", "l", "d"],
          lines: [line],
        },
        defaultCfg
      )
    );
    assert.ok(best);
    assert.equal(best.ruleId, "visual_to_eol");
    assert.equal(best.suggested, "D");
  });

  it('unnecessary visual mode around text object: vi"d -> di"', () => {
    const line = 'say("hello")';
    const best = pickBest(
      analyzeVisual(
        {
          visualMode: "v",
          operator: "d",
          sRow: 1,
          sCol: 6,
          eRow: 1,
          eCol: 10,
          anchorRow: 1,
          anchorCol: 6,
          keys: ["v", "i", '"', "d"],
          lines: [line],
        },
        defaultCfg
      )
    );
    assert.ok(best);
    assert.equal(best.suggested, 'di"');
  });

  it("blockwise visual <C-v> is NOT nagged", () => {
    const cands = analyzeVisual(
      {
        visualMode: "\x16",
        operator: "d",
        sRow: 1,
        sCol: 1,
        eRow: 3,
        eCol: 1,
        keys: ["<C-v>", "j", "j", "d"],
        lines: ["abc", "def", "ghi"],
      },
      defaultCfg
    );
    assert.equal(cands.length, 0);
  });
});

describe("navigation analyzer", () => {
  it("stepping to EOL with lllll -> $", () => {
    const line = "const a = 1;";
    const best = pickBest(
      analyzeNavigation(
        {
          startRow: 1,
          startCol: 6,
          endRow: 1,
          endCol: line.length,
          keys: ["l", "l", "l", "l", "l", "l"],
          lines: [line],
        },
        defaultCfg
      )
    );
    assert.ok(best);
    assert.equal(best.suggested, "$");
  });

  it("stepping to first non-blank with hhhh -> ^", () => {
    const line = "    return true;";
    const best = pickBest(
      analyzeNavigation(
        {
          startRow: 1,
          startCol: 11,
          endRow: 1,
          endCol: 5,
          keys: ["h", "h", "h", "h", "h", "h"],
          lines: [line],
        },
        defaultCfg
      )
    );
    assert.ok(best);
    assert.equal(best.suggested, "^");
  });

  it("stepping onto distinctive char with llllll -> f(", () => {
    const line = "const v = render(props);";
    const best = pickBest(
      analyzeNavigation(
        {
          startRow: 1,
          startCol: 11,
          endRow: 1,
          endCol: 17,
          keys: ["l", "l", "l", "l", "l", "l"],
          lines: [line],
        },
        defaultCfg
      )
    );
    assert.ok(best);
    assert.equal(best.suggested, "f(");
  });

  it("stepping from open paren to matching close paren -> %", () => {
    const line = "foo(a, b, c)";
    const best = pickBest(
      analyzeNavigation(
        {
          startRow: 1,
          startCol: 4,
          endRow: 1,
          endCol: 12,
          keys: ["l", "l", "l", "l", "l", "l", "l", "l"],
          lines: [line],
        },
        defaultCfg
      )
    );
    assert.ok(best);
    assert.equal(best.suggested, "%");
  });

  it("vertical jjjjjj to blank line -> }", () => {
    const lines = ["a", "b", "c", "d", "e", "f", "", "g"];
    const best = pickBest(
      analyzeNavigation(
        {
          startRow: 1,
          startCol: 1,
          endRow: 7,
          endCol: 1,
          keys: ["j", "j", "j", "j", "j", "j"],
          lines,
          totalLines: 8,
        },
        defaultCfg
      )
    );
    assert.ok(best);
    assert.equal(best.suggested, "}");
  });

  it("jjj (only 3 lines) is NOT nagged", () => {
    const lines = ["a", "b", "c", "d", "e"];
    const cands = analyzeNavigation(
      {
        startRow: 1,
        startCol: 1,
        endRow: 4,
        endCol: 1,
        keys: ["j", "j", "j"],
        lines,
        totalLines: 5,
      },
      defaultCfg
    );
    assert.equal(cands.length, 0);
  });

  it("fidgeting back to start returns no hints", () => {
    const cands = analyzeNavigation(
      {
        startRow: 1,
        startCol: 5,
        endRow: 1,
        endCol: 5,
        keys: ["l", "l", "h", "h"],
        lines: ["hello world"],
      },
      defaultCfg
    );
    assert.equal(cands.length, 0);
  });
});

describe("editing, repetition, insert & mastery", () => {
  it("d$ -> D, c$ -> C, y$ -> Y (when assumeNvimY)", () => {
    assert.equal(pickBest(analyzeOperator({ cmd: "d$" }, defaultCfg))?.suggested, "D");
    assert.equal(pickBest(analyzeOperator({ cmd: "c$" }, defaultCfg))?.suggested, "C");
    assert.equal(
      pickBest(analyzeOperator({ cmd: "y$" }, createConfig({ assumeNvimY: true })))?.suggested,
      "Y"
    );
  });

  it("dw + i -> cw, di\" + i -> ci\", dd + O -> cc", () => {
    assert.equal(
      pickBest(
        analyzeInsertEntry(
          {
            insertKey: "i",
            prevDelete: { cmd: "dw", elapsedMs: 300 },
            line: "hello",
            row: 1,
            col: 1,
            totalLines: 5,
          },
          defaultCfg
        )
      )?.suggested,
      "cw"
    );
    assert.equal(
      pickBest(
        analyzeInsertEntry(
          {
            insertKey: "i",
            prevDelete: { cmd: 'di"', elapsedMs: 400 },
            line: '""',
            row: 1,
            col: 2,
            totalLines: 5,
          },
          defaultCfg
        )
      )?.suggested,
      'ci"'
    );
    assert.equal(
      pickBest(
        analyzeInsertEntry(
          {
            insertKey: "O",
            prevDelete: { cmd: "dd", elapsedMs: 400 },
            line: "next",
            row: 2,
            col: 1,
            totalLines: 5,
          },
          defaultCfg
        )
      )?.suggested,
      "cc"
    );
  });

  it("InsertLeave: xiA<Esc> -> ~, ciw43<Esc> -> <C-a>, xiz<Esc> -> rz, A<CR> -> o", () => {
    assert.equal(
      pickBest(
        analyzeInsertLeave(
          {
            entryKey: "i",
            prevDelete: { cmd: "x", elapsedMs: 200, deletedText: "a" },
            insertedKeys: ["A"],
          },
          defaultCfg
        )
      )?.suggested,
      "~"
    );

    assert.equal(
      pickBest(
        analyzeInsertLeave(
          {
            entryKey: "ciw",
            insertedKeys: ["4", "3"],
            deletedWord: "42",
            afterWord: "43",
          },
          defaultCfg
        )
      )?.suggested,
      "<C-a>"
    );

    assert.equal(
      pickBest(
        analyzeInsertLeave(
          {
            entryKey: "i",
            prevDelete: { cmd: "x", elapsedMs: 200, deletedText: "a" },
            insertedKeys: ["z"],
          },
          defaultCfg
        )
      )?.suggested,
      "rz"
    );

    assert.equal(
      pickBest(
        analyzeInsertLeave(
          {
            entryKey: "A",
            insertedKeys: ["<CR>"],
          },
          defaultCfg
        )
      )?.suggested,
      "o"
    );
  });

  it("repeated xxxxx deleting to EOL -> D", () => {
    const best = pickBest(
      analyzeRepeatedX(
        { key: "x", count: 5, beforeLine: "const x = 12345", startCol: 11 },
        defaultCfg
      )
    );
    assert.equal(best?.suggested, "D");
  });

  it("insert mode repeated <BS> -> <C-w> / <C-u> and arrows -> <Esc>", () => {
    assert.equal(
      pickBest(analyzeBackspaceRun({ count: 6, clearedToSol: false }, defaultCfg))?.suggested,
      "<C-w>"
    );
    assert.equal(
      pickBest(analyzeBackspaceRun({ count: 12, clearedToSol: true }, defaultCfg))?.suggested,
      "<C-u>"
    );
    assert.equal(
      pickBest(analyzeInsertArrows({ keys: ["<Left>", "<Left>", "<Left>"] }, defaultCfg))?.ruleId,
      "insert_arrows"
    );
  });

  it("repetition analyzer & mastery scoring", () => {
    const rep = new RepetitionAnalyzer();
    assert.equal(
      rep.analyzeEditRepeat(
        { signature: "ciw:foo", display: "ciwfoo<Esc>", keyCost: 7, tsMs: 1000 },
        defaultCfg
      ).length,
      0
    );
    assert.equal(
      pickBest(
        rep.analyzeEditRepeat(
          { signature: "ciw:foo", display: "ciwfoo<Esc>", keyCost: 7, tsMs: 3000 },
          defaultCfg
        )
      )?.suggested,
      "."
    );
    assert.equal(
      pickBest(rep.analyzeRepeatedLineOp({ op: "dd", count: 5 }, defaultCfg))?.suggested,
      "5dd"
    );

    const store = new MasteryStore(null, () => defaultCfg);
    store.recordMiss({
      ruleId: "textobj_quotes",
      actual: "vlllld",
      suggested: 'di"',
      keysSaved: 3,
      priority: 100,
      reason: "test",
    });
    store.recordGood("textobj_quotes");
    store.recordGood("textobj_quotes");
    store.recordGood("textobj_quotes");
    const summary = store.getSummary();
    assert.equal(summary.total_hints, 1);
    assert.equal(summary.total_good_motions, 3);
    assert.equal(summary.fluency, 75);
    assert.equal(summary.top_habits[0].rule_id, "textobj_quotes");
  });
});
