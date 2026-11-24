import * as buf from "../bufferUtils";
import { Candidate, CoachConfig, isRuleEnabled } from "../types";

const LINEWISE_SHORTCUT: Record<string, string> = {
  d: "dd",
  c: "cc",
  y: "yy",
  ">": ">>",
  "<": "<<",
  "=": "==",
};

const OP_PREFIX: Record<string, string> = {
  d: "d",
  c: "c",
  y: "y",
  ">": ">",
  "<": "<",
  "=": "=",
  "~": "g~",
  u: "gu",
  U: "gU",
};

const OP_VERB: Record<string, string> = {
  d: "delete",
  c: "change",
  y: "yank",
  ">": "indent",
  "<": "outdent",
  "=": "auto-indent",
  "~": "toggle case of",
  u: "lowercase",
  U: "uppercase",
};

function normalizeOp(op: string): string | null {
  if (op === "x" || op === "X" || op === "D") {
    return "d";
  }
  if (op === "s" || op === "S" || op === "C" || op === "R") {
    return "c";
  }
  if (op === "Y") {
    return "y";
  }
  if (OP_PREFIX[op]) {
    return op;
  }
  return null;
}

function detectUnnecessaryVisualKeys(keys: string[], op: string): string | null {
  const prefix = OP_PREFIX[op];
  if (!prefix || keys.length < 3) {
    return null;
  }

  const modeKey = keys[0];
  const motionKeys = keys.slice(1, keys.length - 1);
  const motion = motionKeys.join("");

  if (modeKey === "V" && motionKeys.length === 0) {
    return null;
  }

  if (modeKey === "v" && motionKeys.length === 2 && (motionKeys[0] === "i" || motionKeys[0] === "a")) {
    const obj = motionKeys[1];
    if (/^[wWpst"'`()[\]{}<>bB]$/.test(obj)) {
      return prefix + motion;
    }
  }

  if (motionKeys.length === 1) {
    const m = motionKeys[0];
    if (modeKey === "v" && /^[wWeEbB%}{0^G]$/.test(m)) {
      return prefix + m;
    }
    if (modeKey === "V" && /^[jk}{G]$/.test(m)) {
      return prefix + m;
    }
  }

  if (modeKey === "v" && motionKeys.length === 2 && /^[fFtT]$/.test(motionKeys[0])) {
    return prefix + motion;
  }

  if (modeKey === "v" && motion === "$" && !(op === "d" || op === "c" || op === "y")) {
    return prefix + "$";
  }

  return null;
}

export interface VisualContext {
  visualMode: string; // "v" | "V" | "\x16" | "<C-v>"
  operator: string;
  sRow: number;
  sCol: number;
  eRow: number;
  eCol: number;
  anchorRow?: number;
  anchorCol?: number;
  keys: string[];
  preNav?: { keys: string[] } | null;
  lines: string[];
  baseRow?: number;
  totalLines?: number;
}

export function analyzeVisual(ctx: VisualContext, config: CoachConfig): Candidate[] {
  if (!ctx || !ctx.operator) {
    return [];
  }

  // Blockwise visual (`<C-v>`) is idiomatic for column edits; don't nag.
  if (ctx.visualMode === "\x16" || ctx.visualMode === "<C-v>") {
    return [];
  }

  const op = normalizeOp(ctx.operator);
  if (!op) {
    return [];
  }

  const prefix = OP_PREFIX[op];
  const verb = OP_VERB[op] ?? "operate on";
  const isLinewise = ctx.visualMode === "V";
  const keys = ctx.keys ?? [];
  const actualKeyCount = keys.length;
  const actualStr = buf.formatKeys(keys);
  const preNavKeys = ctx.preNav?.keys ?? [];

  const lines = ctx.lines ?? [];
  const baseRow = ctx.baseRow ?? 1;
  const totalLines = ctx.totalLines ?? baseRow + lines.length - 1;
  const sRow = ctx.sRow;
  const sCol = ctx.sCol;
  const eRow = ctx.eRow;
  const eCol = ctx.eCol;
  const anchorRow = ctx.anchorRow ?? sRow;
  const anchorCol = ctx.anchorCol ?? sCol;

  const sLine = lines[sRow - baseRow] ?? "";
  const eLine = lines[eRow - baseRow] ?? "";
  const singleLine = sRow === eRow;
  const numLines = eRow - sRow + 1;
  const practicalOnly = config.practicalOnly;

  const candidates: Candidate[] = [];

  const add = (
    ruleId: string,
    suggested: string,
    priority: number,
    reason: string,
    extraSaved = 0,
    allowZeroSaved = false
  ) => {
    if (!isRuleEnabled(config, ruleId)) {
      return;
    }
    const saved = actualKeyCount + extraSaved - suggested.length;
    const minSaved = allowZeroSaved ? 0 : config.thresholds.minKeysSaved || 1;
    if (saved < minSaved) {
      return;
    }
    candidates.push({
      ruleId,
      actual: actualStr,
      suggested,
      keysSaved: Math.max(0, saved),
      priority,
      reason,
    });
  };

  if (sRow === 1 && eRow === totalLines && totalLines >= 4) {
    const fullStart = isLinewise || sCol <= buf.firstNonBlank(sLine);
    const fullEnd = isLinewise || eCol >= buf.lastCharCol(eLine);
    if (fullStart && fullEnd) {
      const cmd = `gg${prefix}G`;
      add("visual_whole_file", cmd, 96, `Use \`${cmd}\` to ${verb} the entire buffer directly.`);
    }
  }

  if (singleLine && LINEWISE_SHORTCUT[op]) {
    const coversLine =
      isLinewise ||
      (sCol === 1 && eCol >= buf.lastCharCol(sLine) && sLine.length > 0) ||
      (sCol <= buf.firstNonBlank(sLine) && eCol >= buf.lastCharCol(sLine) && actualKeyCount >= 4);

    if (coversLine) {
      const cmd = LINEWISE_SHORTCUT[op];
      const reason =
        op === "c"
          ? "Use `cc` (or `S`) to change the whole line directly while keeping indentation."
          : `Use \`${cmd}\` to ${verb} the whole line directly without Visual mode (dot-repeatable with \`. \`).`.replace(
              "`. `",
              "`.`"
            );
      add("visual_whole_line", cmd, 95, reason, 0, true);
    }
  }

  if (singleLine && !isLinewise) {
    const quoteObj = buf.matchQuoteObject(sLine, sCol, eCol);
    if (quoteObj) {
      const cmd = prefix + quoteObj;
      const extra = preNavKeys.length > 0 ? preNavKeys.length : 0;
      const side = quoteObj[0] === "i" ? "inside" : "around";
      add(
        "textobj_quotes",
        cmd,
        100,
        `Use \`${cmd}\` to ${verb} ${side} quotes directly — works from anywhere inside (or before) them on the line.`,
        extra,
        true
      );
    }
  }

  const tagObj = buf.matchTagObject(lines, sRow, sCol, eRow, eCol, baseRow);
  if (tagObj) {
    const cmd = prefix + tagObj;
    add(
      "textobj_tag",
      cmd,
      98,
      `Use \`${cmd}\` to ${verb} ${tagObj === "it" ? "inside" : "around"} the HTML/XML tag directly without Visual mode.`,
      0,
      true
    );
  }

  const bracketObj = buf.matchBracketObject(lines, sRow, sCol, eRow, eCol, baseRow, isLinewise);
  if (bracketObj) {
    const cmd = prefix + bracketObj;
    const extra = preNavKeys.length > 0 ? preNavKeys.length : 0;
    const side = bracketObj[0] === "i" ? "inside" : "around";
    add(
      "textobj_brackets",
      cmd,
      97,
      `Use \`${cmd}\` to ${verb} ${side} the matching \`${bracketObj[1]}\` block directly (dot-repeatable with \`.\`).`,
      extra,
      true
    );
  }

  if (
    numLines >= 2 &&
    (isLinewise || (sCol <= buf.firstNonBlank(sLine) && eCol >= buf.lastCharCol(eLine)))
  ) {
    const paraObj = buf.matchParagraphObject(lines, sRow, eRow, baseRow, totalLines);
    if (paraObj) {
      const cmd = prefix + paraObj;
      add(
        "textobj_paragraph",
        cmd,
        94,
        `Use \`${cmd}\` to ${verb} the entire paragraph block directly without selecting line by line.`,
        0,
        true
      );
    }
  }

  if (singleLine && !isLinewise) {
    const wordObj = buf.matchWordObject(sLine, sCol, eCol);
    if (wordObj) {
      let cmd = prefix + wordObj;
      const extra = preNavKeys.length > 0 ? preNavKeys.length : 0;
      let reason = `Use \`${cmd}\` to ${verb} the entire word from anywhere inside it — no Visual mode needed.`;
      if (wordObj === "iw" && anchorCol === sCol && extra === 0 && op === "c") {
        cmd = "cw";
        reason = "Since your cursor was at the start of the word, `cw` (or `ciw`) changes it directly.";
      }
      add("textobj_word", cmd, 92, reason, extra);
    }
  }

  if (singleLine && !isLinewise) {
    const lineEnd = buf.lastCharCol(sLine);
    const firstNb = buf.firstNonBlank(sLine);

    if (anchorCol === sCol && eCol >= lineEnd && sCol > 1) {
      if (op === "d") {
        add("visual_to_eol", "D", 93, "Use `D` to delete from cursor to end of line in 1 key.");
      } else if (op === "c") {
        add("visual_to_eol", "C", 93, "Use `C` to change from cursor to end of line in 1 key.");
      } else if (op === "y") {
        const cmd = config.assumeNvimY ? "Y" : "y$";
        add("visual_to_eol", cmd, 91, `Use \`${cmd}\` to yank from cursor to end of line directly.`);
      }
    }

    if (anchorCol === eCol && eCol > sCol) {
      if (sCol === 1 && actualKeyCount >= 3) {
        const cmd = prefix + "0";
        add("visual_to_sol", cmd, 86, `Use \`${cmd}\` to ${verb} back to column 0 directly.`);
      } else if (sCol === firstNb && firstNb > 1 && actualKeyCount >= 3) {
        const cmd = prefix + "^";
        add(
          "visual_to_sol",
          cmd,
          86,
          `Use \`${cmd}\` to ${verb} back to the first non-blank character.`
        );
      }
    }
  }

  const directCmd = detectUnnecessaryVisualKeys(keys, op);
  if (directCmd) {
    add(
      "visual_unnecessary",
      directCmd,
      88,
      `Skip Visual mode — \`${directCmd}\` is shorter and dot-repeatable with \`.\`.`
    );
  }

  if (singleLine && !isLinewise && actualKeyCount >= 4) {
    const forward = anchorCol === sCol && eCol > anchorCol;
    if (forward) {
      const wmEnd = buf.bestWordMotion(sLine, anchorCol, eCol, 2);
      if (wmEnd && wmEnd.motion.endsWith("e")) {
        const cmd = prefix + wmEnd.motion;
        add(
          "visual_motion_direct",
          cmd,
          82,
          `Use \`${cmd}\` to ${verb} directly to the word end without Visual mode.`
        );
      }

      if (op !== "c" && eCol < sLine.length) {
        const wmNext = buf.bestWordMotion(sLine, anchorCol, eCol + 1, 2);
        if (wmNext && wmNext.motion.endsWith("w")) {
          const cmd = prefix + wmNext.motion;
          add(
            "visual_motion_direct",
            cmd,
            84,
            `Use \`${cmd}\` to ${verb} directly by word without stepping in Visual mode.`
          );
        }
      }

      const cf = buf.bestCharFind(sLine, anchorCol, eCol, practicalOnly);
      if (cf && (cf.kind === "f" || cf.kind === "t")) {
        const cmd = prefix + cf.motion;
        add(
          "visual_motion_direct",
          cmd,
          cf.distinctive ? 85 : 76,
          `Use \`${cmd}\` to ${verb} directly up to \`${cf.char}\` without stepping in Visual mode.`
        );
      }
    }
  }

  if (isLinewise && numLines >= (config.thresholds.verticalCountMin || 4)) {
    let stepCount = 0;
    for (let i = 1; i < keys.length - 1; i++) {
      if (keys[i] === "j" || keys[i] === "k" || keys[i] === "<Down>" || keys[i] === "<Up>") {
        stepCount++;
      }
    }

    if (stepCount >= (config.thresholds.verticalCountMin || 4) && numLines <= 20) {
      if (LINEWISE_SHORTCUT[op] && anchorRow === sRow) {
        const cmd = `${numLines}${LINEWISE_SHORTCUT[op]}`;
        add(
          "visual_multi_line",
          cmd,
          80,
          `Use \`${cmd}\` (or \`${prefix}${numLines - 1}j\`) instead of tapping \`j\` ${stepCount} times in Visual Line mode.`
        );
      } else {
        const dir = anchorRow === sRow ? "j" : "k";
        const cmd = `${prefix}${numLines - 1}${dir}`;
        add(
          "visual_multi_line",
          cmd,
          78,
          `Use \`${cmd}\` instead of tapping \`${dir}\` ${stepCount} times in Visual Line mode.`
        );
      }
    }
  }

  return candidates;
}
