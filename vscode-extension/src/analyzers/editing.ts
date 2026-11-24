import * as buf from "../bufferUtils";
import { Candidate, CoachConfig, isRuleEnabled } from "../types";

function makeCandidate(
  config: CoachConfig,
  ruleId: string,
  actual: string,
  suggested: string,
  keysSaved: number,
  priority: number,
  reason: string
): Candidate | null {
  if (!isRuleEnabled(config, ruleId)) {
    return null;
  }
  if (keysSaved < (config.thresholds.minKeysSaved || 1)) {
    return null;
  }
  return {
    ruleId,
    actual,
    suggested,
    keysSaved,
    priority,
    reason,
  };
}

function isCaseFlip(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || a.length !== 1 || b.length !== 1) {
    return false;
  }
  return a !== b && a.toLowerCase() === b.toLowerCase() && /^[A-Za-z]$/.test(a);
}

export interface OperatorContext {
  cmd: string;
  prevKey?: string | null;
}

export function analyzeOperator(ctx: OperatorContext, config: CoachConfig): Candidate[] {
  if (!ctx || !ctx.cmd) {
    return [];
  }

  const cmd = ctx.cmd;
  const prev = ctx.prevKey;
  const candidates: Candidate[] = [];
  const push = (c: Candidate | null) => {
    if (c) {
      candidates.push(c);
    }
  };

  if ((prev === "0" || prev === "^") && (cmd === "d$" || cmd === "D")) {
    push(
      makeCandidate(
        config,
        "visual_whole_line",
        prev + cmd,
        "dd",
        (prev + cmd).length - 2,
        94,
        "Use `dd` to delete the whole line directly."
      )
    );
    return candidates;
  }

  if ((prev === "0" || prev === "^") && (cmd === "c$" || cmd === "C")) {
    push(
      makeCandidate(
        config,
        "visual_whole_line",
        prev + cmd,
        "cc",
        (prev + cmd).length - 2,
        94,
        "Use `cc` (or `S`) to change the whole line directly while preserving indentation."
      )
    );
    return candidates;
  }

  if (cmd === "d$") {
    push(
      makeCandidate(
        config,
        "edit_delete_to_eol",
        "d$",
        "D",
        1,
        90,
        "Use `D` to delete to end of line in 1 key instead of `d$`."
      )
    );
  } else if (cmd === "c$") {
    push(
      makeCandidate(
        config,
        "edit_delete_to_eol",
        "c$",
        "C",
        1,
        90,
        "Use `C` to change to end of line in 1 key instead of `c$`."
      )
    );
  } else if (cmd === "y$" && config.assumeNvimY) {
    push(
      makeCandidate(
        config,
        "edit_delete_to_eol",
        "y$",
        "Y",
        1,
        86,
        "Use `Y` to yank to end of line in 1 key (just like `D` and `C`)."
      )
    );
  }

  return candidates;
}

export interface PrevDeleteContext {
  cmd: string;
  elapsedMs: number;
  deletedText?: string;
  deletedWord?: string;
}

export interface InsertEntryContext {
  insertKey: string;
  prevNav?: { keys: string[]; elapsedMs?: number } | null;
  prevDelete?: PrevDeleteContext | null;
  line: string;
  row: number;
  col: number;
  totalLines: number;
}

export function analyzeInsertEntry(ctx: InsertEntryContext, config: CoachConfig): Candidate[] {
  if (!ctx || !ctx.insertKey) {
    return [];
  }

  const ik = ctx.insertKey;
  const line = ctx.line ?? "";
  const col = ctx.col ?? 1;
  const firstNb = buf.firstNonBlank(line);
  const lastCol = buf.lastCharCol(line);
  const candidates: Candidate[] = [];
  const push = (c: Candidate | null) => {
    if (c) {
      candidates.push(c);
    }
  };

  const del = ctx.prevDelete;
  if (del && del.elapsedMs <= (config.thresholds.comboWindowMs || 1600)) {
    const dcmd = del.cmd ?? "";

    if (dcmd.startsWith("d") && dcmd.length >= 2 && dcmd !== "dd" && (ik === "i" || ik === "a")) {
      const motion = dcmd.slice(1);
      const suggested = motion === "$" ? "C" : "c" + motion;
      const actual = dcmd + ik;
      push(
        makeCandidate(
          config,
          "edit_delete_then_insert",
          actual,
          suggested,
          actual.length - suggested.length,
          96,
          `Use \`${suggested}\` instead of \`${actual}\` — deletes and enters Insert mode atomically (dot-repeatable with \`.\`).`
        )
      );
      return candidates;
    }

    if (dcmd === "D" && (ik === "a" || ik === "A" || ik === "i")) {
      push(
        makeCandidate(
          config,
          "edit_delete_then_insert",
          "D" + ik,
          "C",
          1,
          96,
          "Use `C` to delete to end of line and enter Insert mode in 1 key."
        )
      );
      return candidates;
    }

    if (dcmd === "dd" && (ik === "O" || (ik === "o" && ctx.row === ctx.totalLines))) {
      push(
        makeCandidate(
          config,
          "edit_delete_then_insert",
          "dd" + ik,
          "cc",
          1,
          95,
          "Use `cc` (or `S`) to clear the line and enter Insert mode while preserving indentation."
        )
      );
      return candidates;
    }
  }

  const nav = ctx.prevNav;
  if (nav && nav.keys && nav.keys.length >= 1) {
    const keys = nav.keys;
    const actual = buf.formatKeys(keys) + ik;
    const totalKeys = keys.length + 1;

    if (ik === "i" && (col === firstNb || (col === 1 && firstNb === 1))) {
      const lastK = keys[keys.length - 1];
      if (
        lastK === "^" ||
        (lastK === "0" && firstNb === 1) ||
        (keys.length >= 3 && (lastK === "h" || lastK === "b" || lastK === "<Left>"))
      ) {
        push(
          makeCandidate(
            config,
            "edit_insert_line_start",
            actual,
            "I",
            totalKeys - 1,
            95,
            "Press `I` to jump to the first non-blank character and enter Insert mode in 1 key."
          )
        );
        return candidates;
      }
    }

    if (ik === "a" && col >= lastCol && line.length > 0) {
      const lastK = keys[keys.length - 1];
      if (
        lastK === "$" ||
        (keys.length >= 2 &&
          (lastK === "l" || lastK === "e" || lastK === "w" || lastK === "<Right>"))
      ) {
        push(
          makeCandidate(
            config,
            "edit_append_line_end",
            actual,
            "A",
            totalKeys - 1,
            95,
            "Press `A` to jump to the end of the line and enter Insert mode in 1 key."
          )
        );
        return candidates;
      }
    }

    if (keys.length === 1 && (nav.elapsedMs ?? 0) <= 600) {
      if (keys[0] === "l" && ik === "i") {
        push(
          makeCandidate(
            config,
            "edit_append_adjacent",
            "li",
            "a",
            1,
            86,
            "Press `a` to append right after the cursor instead of `li`."
          )
        );
      } else if (keys[0] === "h" && ik === "a") {
        push(
          makeCandidate(
            config,
            "edit_append_adjacent",
            "ha",
            "i",
            1,
            86,
            "Press `i` to insert right before the cursor instead of `ha`."
          )
        );
      } else if (keys[0] === "k" && ik === "o" && (ctx.row ?? 1) >= 1) {
        push(
          makeCandidate(
            config,
            "edit_open_line",
            "ko",
            "O",
            1,
            88,
            "Press `O` to open a new line directly above instead of `ko`."
          )
        );
      }
    }
  }

  return candidates;
}

export interface InsertLeaveContext {
  entryKey: string;
  prevDelete?: PrevDeleteContext | null;
  insertedKeys: string[];
  beforeLine?: string;
  afterLine?: string;
  beforeRow?: number;
  afterRow?: number;
  beforeCol?: number;
  beforeLineCount?: number;
  afterLineCount?: number;
  deletedWord?: string | null;
  afterWord?: string | null;
}

export function analyzeInsertLeave(ctx: InsertLeaveContext, config: CoachConfig): Candidate[] {
  if (!ctx) {
    return [];
  }

  const ik = ctx.entryKey ?? "";
  const ins = ctx.insertedKeys ?? [];
  const del = ctx.prevDelete;
  const candidates: Candidate[] = [];
  const push = (c: Candidate | null) => {
    if (c) {
      candidates.push(c);
    }
  };

  if ((ik === "A" || ik === "$a") && ins.length >= 1 && ins[0] === "<CR>") {
    const actual = ik + "<CR>";
    push(
      makeCandidate(
        config,
        "edit_open_line",
        actual,
        "o",
        ik.length,
        94,
        `Press \`o\` to open a new indented line below in 1 key instead of \`${actual}\`.`
      )
    );
    return candidates;
  }

  if (
    ctx.beforeLineCount !== undefined &&
    ctx.afterLineCount !== undefined &&
    ctx.afterLineCount === ctx.beforeLineCount - 1
  ) {
    if (ins.length >= 1 && ins.length <= 2 && (ins[0] === "<Del>" || ins[0] === "<BS>")) {
      push(
        makeCandidate(
          config,
          "edit_join_lines",
          ik + ins.join(""),
          "J",
          Math.max(1, ik.length + ins.length),
          92,
          "Use `J` (or `gJ` without space) to join lines directly in Normal mode."
        )
      );
      return candidates;
    }
  }

  const isSingleCharDel =
    !!del && (del.cmd === "x" || del.cmd === "X") && (ik === "i" || ik === "a");
  const isSubChar = ik === "s" || ik === "cl";

  if (isSingleCharDel || isSubChar) {
    const typedPrintable = ins.length === 1 && ins[0].length === 1;
    const deletedCh =
      del?.deletedText ??
      (ctx.beforeLine && ctx.beforeCol ? ctx.beforeLine[ctx.beforeCol - 1] ?? "" : "");

    if (typedPrintable) {
      const newCh = ins[0];
      const actual = `${isSingleCharDel ? del!.cmd + ik : ik}${newCh}<Esc>`;

      if (isCaseFlip(deletedCh, newCh)) {
        push(
          makeCandidate(
            config,
            "edit_toggle_case",
            actual,
            "~",
            3,
            96,
            `Press \`~\` to toggle \`${deletedCh}\` → \`${newCh}\` in 1 key without entering Insert mode.`
          )
        );
        return candidates;
      }

      if (/^\d$/.test(deletedCh) && /^\d$/.test(newCh)) {
        const oldN = Number(deletedCh);
        const newN = Number(newCh);
        if (Math.abs(newN - oldN) === 1) {
          const cmd = newN > oldN ? "<C-a>" : "<C-x>";
          push(
            makeCandidate(
              config,
              "edit_increment_number",
              actual,
              cmd,
              2,
              94,
              `Use \`${cmd}\` to ${newN > oldN ? "increment" : "decrement"} \`${oldN}\` → \`${newN}\` in 1 key without leaving Normal mode.`
            )
          );
          return candidates;
        }
      }

      push(
        makeCandidate(
          config,
          "edit_replace_char",
          actual,
          "r" + newCh,
          isSingleCharDel ? 2 : 1,
          93,
          `Use \`r${newCh}\` to replace a single character without entering Insert mode.`
        )
      );
      return candidates;
    } else if (isSingleCharDel && ins.length >= 2) {
      push(
        makeCandidate(
          config,
          "edit_substitute_char",
          del!.cmd + ik,
          "s",
          1,
          84,
          "Use `s` (or `cl`) to delete the character under cursor and enter Insert mode in 1 key."
        )
      );
      return candidates;
    }
  }

  if (ctx.deletedWord && ctx.afterWord && ctx.deletedWord !== ctx.afterWord) {
    if (/^-?\d+$/.test(ctx.deletedWord) && /^-?\d+$/.test(ctx.afterWord)) {
      const oldNum = Number(ctx.deletedWord);
      const newNum = Number(ctx.afterWord);
      if (Math.abs(newNum - oldNum) === 1) {
        const cmd = newNum > oldNum ? "<C-a>" : "<C-x>";
        const actual = `${ik}${ctx.afterWord}<Esc>`;
        push(
          makeCandidate(
            config,
            "edit_increment_number",
            actual,
            cmd,
            Math.max(2, ik.length + ctx.afterWord.length),
            94,
            `Use \`${cmd}\` to ${newNum > oldNum ? "increment" : "decrement"} \`${oldNum}\` → \`${newNum}\` in 1 key without entering Insert mode!`
          )
        );
        return candidates;
      }
    }
  }

  const atLineIndent =
    ik === "I" ||
    ik === "0i" ||
    ik === "^i" ||
    (ik === "i" && (ctx.beforeCol ?? 1) <= buf.firstNonBlank(ctx.beforeLine));

  if (atLineIndent && ins.length >= 1 && ctx.beforeRow === ctx.afterRow) {
    let onlyIndentChars = true;
    let onlyDeleteWs = true;
    for (const k of ins) {
      if (k !== "<Space>" && k !== " " && k !== "<Tab>") {
        onlyIndentChars = false;
      }
      if (k !== "<BS>" && k !== "<Del>") {
        onlyDeleteWs = false;
      }
    }

    if (onlyIndentChars && (ins.length >= 2 || ins[0] === "<Tab>") && ctx.beforeLine !== undefined && ctx.afterLine !== undefined) {
      if (ctx.afterLine.length > ctx.beforeLine.length) {
        const actual = `${ik}${buf.formatKeys(ins)}<Esc>`;
        push(
          makeCandidate(
            config,
            "edit_indent",
            actual,
            ">>",
            Math.max(1, ik.length + ins.length + 1 - 2),
            90,
            "Use `>>` to indent the line directly without entering Insert mode."
          )
        );
        return candidates;
      }
    } else if (onlyDeleteWs && ins.length >= 2 && ctx.beforeLine !== undefined && ctx.afterLine !== undefined) {
      const beforeTrimmed = ctx.beforeLine.replace(/^\s+/, "");
      const afterTrimmed = ctx.afterLine.replace(/^\s+/, "");
      if (beforeTrimmed === afterTrimmed && ctx.afterLine.length < ctx.beforeLine.length) {
        const actual = `${ik}${buf.formatKeys(ins)}<Esc>`;
        push(
          makeCandidate(
            config,
            "edit_indent",
            actual,
            "<<",
            Math.max(1, ik.length + ins.length + 1 - 2),
            90,
            "Use `<<` to outdent the line directly without entering Insert mode."
          )
        );
        return candidates;
      }
    }
  }

  return candidates;
}

export interface RepeatedXContext {
  key: "x" | "X";
  count: number;
  beforeLine: string;
  startCol: number;
}

export function analyzeRepeatedX(ctx: RepeatedXContext, config: CoachConfig): Candidate[] {
  const minX = config.thresholds.repeatXMin || 3;
  if (!ctx || (ctx.count || 0) < minX) {
    return [];
  }

  const count = ctx.count;
  const key = ctx.key ?? "x";
  const line = ctx.beforeLine ?? "";
  const startCol = ctx.startCol ?? 1;
  const actual = buf.formatKeys(Array.from({ length: count }, () => key));
  const candidates: Candidate[] = [];
  const push = (c: Candidate | null) => {
    if (c) {
      candidates.push(c);
    }
  };

  if (key === "x" && line.length > 0 && startCol >= 1 && startCol <= line.length) {
    const endCol = Math.min(line.length, startCol + count - 1);
    const deleted = line.slice(startCol - 1, endCol);

    if (startCol <= buf.firstNonBlank(line) && /^\s+$/.test(deleted)) {
      push(
        makeCandidate(
          config,
          "edit_indent",
          actual,
          "<<",
          count - 2,
          92,
          "Use `<<` to outdent leading whitespace instead of pressing `x` repeatedly."
        )
      );
      return candidates;
    }

    if (endCol >= line.length) {
      push(
        makeCandidate(
          config,
          "edit_repeated_x",
          actual,
          "D",
          count - 1,
          94,
          `Use \`D\` to delete to end of line in 1 key instead of pressing \`x\` ${count} times.`
        )
      );
      return candidates;
    }

    const wobj = buf.matchWordObject(line, startCol, endCol);
    if (wobj) {
      const cmd = wobj === "aw" ? "dw" : "d" + wobj;
      push(
        makeCandidate(
          config,
          "edit_repeated_x",
          actual,
          cmd,
          Math.max(1, count - cmd.length),
          92,
          `Use \`${cmd}\` to delete the word directly instead of pressing \`x\` ${count} times.`
        )
      );
      return candidates;
    }

    const cf = buf.bestCharFind(line, startCol, endCol, config.practicalOnly);
    if (cf && (cf.kind === "f" || cf.kind === "t") && count > cf.keyCost + 1) {
      const cmd = "d" + cf.motion;
      push(
        makeCandidate(
          config,
          "edit_repeated_x",
          actual,
          cmd,
          count - cmd.length,
          88,
          `Use \`${cmd}\` instead of pressing \`x\` ${count} times.`
        )
      );
      return candidates;
    }
  }

  const fallback = key === "x" ? "dw / dt<ch>" : "db / d0";
  push(
    makeCandidate(
      config,
      "edit_repeated_x",
      actual,
      fallback,
      Math.max(1, count - 2),
      80,
      `Use \`d{motion}\` (like \`${fallback}\`) instead of pressing \`${key}\` ${count} times.`
    )
  );

  return candidates;
}
