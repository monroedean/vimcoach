import * as buf from "../bufferUtils";
import { Candidate, CoachConfig, isRuleEnabled } from "../types";

const ARROW_KEYS = new Set(["<Up>", "<Down>", "<Left>", "<Right>"]);

function countKeys(keys: string[], pred: (k: string) => boolean): number {
  let n = 0;
  for (const k of keys) {
    if (pred(k)) {
      n++;
    }
  }
  return n;
}

function detectRepeatedFind(keys: string[]): { cmd: string; ch: string; repeats: number } | null {
  if (keys.length < 4) {
    return null;
  }
  let i = 0;
  while (i <= keys.length - 4) {
    const k1 = keys[i];
    const k2 = keys[i + 1];
    if (/^[fFtT]$/.test(k1) && k2 && k2.length === 1) {
      let repeats = 1;
      let j = i + 2;
      while (j <= keys.length - 2 && keys[j] === k1 && keys[j + 1] === k2) {
        repeats++;
        j += 2;
      }
      if (repeats >= 2) {
        return { cmd: k1, ch: k2, repeats };
      }
      i = j;
    } else {
      i++;
    }
  }
  return null;
}

export function checkParagraphJump(
  lines: string[],
  startRow: number,
  endRow: number,
  baseRow: number
): { hops: number; key: "}" | "{" } | null {
  if (startRow === endRow) {
    return null;
  }
  const dir = endRow > startRow ? 1 : -1;
  const key: "}" | "{" = dir === 1 ? "}" : "{";
  let cur = startRow;
  const maxRow = baseRow + lines.length - 1;

  for (let hop = 1; hop <= 2; hop++) {
    let r = cur + dir;
    while (r >= baseRow && r <= maxRow && buf.isBlank(lines[r - baseRow])) {
      r += dir;
    }
    while (r >= baseRow && r <= maxRow && !buf.isBlank(lines[r - baseRow])) {
      r += dir;
    }
    cur = r;
    if (cur === endRow) {
      return { hops: hop, key };
    }
    if (
      cur + dir === endRow &&
      endRow >= baseRow &&
      endRow <= maxRow &&
      !buf.isBlank(lines[endRow - baseRow])
    ) {
      return { hops: hop, key };
    }
  }

  return null;
}

export interface NavigationContext {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  keys: string[];
  lines?: string[];
  baseRow?: number;
  totalLines?: number;
  winTop?: number;
  winBot?: number;
  lastJumpOrigin?: { row: number; col: number; tsMs: number } | null;
}

export function analyzeNavigation(ctx: NavigationContext, config: CoachConfig): Candidate[] {
  if (!ctx || !ctx.keys || ctx.keys.length < 2) {
    return [];
  }

  const keys = ctx.keys;
  const keyCount = keys.length;
  const actualStr = buf.formatKeys(keys);
  const sRow = ctx.startRow;
  const sCol = ctx.startCol;
  const eRow = ctx.endRow;
  const eCol = ctx.endCol;

  // Ignore fidgeting that ended right back at start
  if (sRow === eRow && sCol === eCol) {
    return [];
  }

  const lines = ctx.lines ?? [];
  const baseRow = ctx.baseRow ?? 1;
  const totalLines = ctx.totalLines ?? baseRow + lines.length - 1;
  const thresholds = config.thresholds;
  const practicalOnly = config.practicalOnly;

  const sameLine = sRow === eRow;
  const dy = Math.abs(eRow - sRow);
  const dx = Math.abs(eCol - sCol);

  const arrowCount = countKeys(keys, (k) => ARROW_KEYS.has(k));
  const hlCount = countKeys(keys, (k) => k === "h" || k === "l" || k === "<Left>" || k === "<Right>");
  const jCount = countKeys(keys, (k) => k === "j" || k === "<Down>");
  const kCount = countKeys(keys, (k) => k === "k" || k === "<Up>");
  const jkCount = jCount + kCount;
  const isVerticalBrowsing = jCount >= 4 && kCount >= 4;
  const wordKeyCount = countKeys(
    keys,
    (k) => k === "w" || k === "b" || k === "e" || k === "W" || k === "B" || k === "E"
  );

  const candidates: Candidate[] = [];

  const add = (
    ruleId: string,
    suggested: string,
    priority: number,
    reason: string,
    customCost?: number
  ) => {
    if (!isRuleEnabled(config, ruleId)) {
      return;
    }
    const cost = customCost ?? suggested.length;
    const saved = keyCount - cost;
    if (saved < (thresholds.minKeysSaved || 1)) {
      return;
    }
    candidates.push({
      ruleId,
      actual: actualStr,
      suggested,
      keysSaved: saved,
      priority,
      reason,
    });
  };

  const repFind = detectRepeatedFind(keys);
  if (repFind) {
    const suggested = repFind.cmd + repFind.ch + ";".repeat(repFind.repeats - 1);
    add(
      "nav_repeat_find",
      suggested,
      95,
      `Press \`;\` to repeat \`${repFind.cmd}${repFind.ch}\` instead of retyping it (and \`,\` to reverse).`
    );
  }

  if (keyCount >= 3) {
    const matched = buf.findMatchingPair(lines, sRow, sCol, baseRow);
    if (matched && matched.row === eRow && matched.col === eCol) {
      add("nav_matching_pair", "%", 98, "Press `%` to jump straight to the matching bracket in 1 key.");
    }
  }

  if (sameLine) {
    const line = lines[sRow - baseRow] ?? "";
    const firstNb = buf.firstNonBlank(line);
    const lastCol = buf.lastCharCol(line);

    if (keyCount >= 3 && dx >= 3) {
      if (eCol === 1 && sCol > 1) {
        add("nav_line_start", "0", 96, "Press `0` to jump directly to the start of the line.");
      } else if (eCol === firstNb && sCol !== firstNb && firstNb > 1) {
        add("nav_line_start", "^", 96, "Press `^` to jump directly to the first non-blank character.");
      } else if (eCol >= lastCol && sCol < lastCol) {
        add("nav_line_end", "$", 96, "Press `$` to jump directly to the end of the line.");
      }
    }

    const minForFind = hlCount >= 3 ? 3 : thresholds.wordStepMin || 5;
    if (keyCount >= minForFind && dx >= 4) {
      const cf = buf.bestCharFind(line, sCol, eCol, practicalOnly);
      if (cf && keyCount > cf.keyCost + 1) {
        const prio = cf.distinctive ? 92 : 82;
        add(
          "nav_find_char",
          cf.motion,
          prio,
          `Use \`${cf.motion}\` to jump straight to \`${cf.char}\` on this line.`,
          cf.keyCost
        );
      }
    }

    if (hlCount >= (thresholds.horizontalStepMin || 4) && dx >= 4) {
      const wm = buf.bestWordMotion(line, sCol, eCol, 3);
      if (wm && keyCount - wm.keyCost >= 2) {
        add(
          "nav_word_jump",
          wm.motion,
          86,
          `Use word motion \`${wm.motion}\` instead of stepping ${hlCount} characters with \`h\`/\`l\`.`,
          wm.keyCost
        );
      } else if (dx >= 6) {
        const dirHint = eCol > sCol ? "w / e / f<ch>" : "b / F<ch>";
        add(
          "nav_word_jump",
          dirHint,
          75,
          `Hop by words (\`${dirHint}\`) instead of stepping ${hlCount} times horizontally.`,
          2
        );
      }
    }

    if (wordKeyCount >= (thresholds.wordStepMin || 5)) {
      const wSpan = buf.wordAt(line, eCol);
      if (wSpan && wSpan.word.length >= 3) {
        const prefix = wSpan.word.slice(0, Math.min(4, wSpan.word.length));
        add(
          "nav_search_jump",
          "/" + prefix,
          72,
          `Instead of tapping word motions ${wordKeyCount} times, use \`f<ch>\` or \`/${prefix}\` to jump directly.`,
          3
        );
      }
    }
  }

  if (!sameLine && dy >= 3) {
    if (eRow === 1 && dy >= 5 && jkCount >= 5) {
      add("nav_file_bounds", "gg", 97, "Press `gg` to jump straight to the first line of the file.");
    } else if (eRow === totalLines && dy >= 5 && jkCount >= 5) {
      add("nav_file_bounds", "G", 97, "Press `G` to jump straight to the last line of the file.");
    }

    if (ctx.lastJumpOrigin && ctx.lastJumpOrigin.row === eRow && dy >= 6 && jkCount >= 5) {
      add(
        "nav_jumplist",
        "<C-o>",
        95,
        "Press `<C-o>` to jump straight back to your previous location in the jump list.",
        1
      );
    }

    if (dy >= (thresholds.verticalCountMin || 4) && jkCount >= (thresholds.verticalCountMin || 4)) {
      const pjump = checkParagraphJump(lines, sRow, eRow, baseRow);
      if (pjump) {
        const cmd = pjump.key.repeat(pjump.hops);
        add(
          "nav_paragraph",
          cmd,
          92,
          `Use \`${cmd}\` to leap by paragraph/blank lines instead of tapping \`${eRow > sRow ? "j" : "k"}\` ${jkCount} times.`
        );
      }
    }

    if (ctx.winTop !== undefined && ctx.winBot !== undefined && dy >= 10 && jkCount >= 8) {
      const winMid = Math.floor((ctx.winTop + ctx.winBot) / 2);
      if (eRow === ctx.winTop) {
        add("nav_viewport", "H", 84, "Press `H` to jump straight to the top of the visible window.");
      } else if (eRow === ctx.winBot) {
        add("nav_viewport", "L", 84, "Press `L` to jump straight to the bottom of the visible window.");
      } else if (Math.abs(eRow - winMid) <= 1 && Math.abs(sRow - winMid) >= 10) {
        add("nav_viewport", "M", 82, "Press `M` to jump straight to the middle of the visible window.");
      }
    }

    if (dy >= (thresholds.verticalPageMin || 15) && jkCount >= 10) {
      const cmd = eRow > sRow ? "<C-d>" : "<C-u>";
      const dir = eRow > sRow ? "j" : "k";
      const eLine = lines[eRow - baseRow] ?? "";
      const targetWord = buf.wordAt(eLine, eCol);
      let reason = `Use \`${cmd}\` (half-page jump) or \`:${eRow}\` instead of tapping \`${dir}\` ${jkCount} times.`;
      if (targetWord && targetWord.word.length >= 4) {
        reason = `Use \`${cmd}\` or \`/${targetWord.word}\` to jump ${dy} lines instead of mashing \`${dir}\`.`;
      }
      add("nav_half_page", cmd, 90, reason, 2);
    }

    if (isVerticalBrowsing) {
      if (jkCount >= (thresholds.verticalPageMin || 15)) {
        add(
          "nav_half_page",
          "<C-d> / <C-u>",
          86,
          `Use \`<C-d>\` / \`<C-u>\` to browse up and down instead of tapping \`j\`/\`k\` ${jkCount} times.`,
          2
        );
      }
    } else {
      if (
        dy >= (thresholds.verticalCountMin || 4) &&
        dy < (thresholds.verticalPageMin || 15) &&
        jkCount >= (thresholds.verticalCountMin || 4)
      ) {
        const dir = eRow > sRow ? "j" : "k";
        const cmd = `${dy}${dir}`;
        add(
          "nav_vertical_count",
          cmd,
          80,
          `Use \`${cmd}\` instead of pressing \`${dir}\` ${jkCount} times (tip: enable relative line numbers).`
        );
      }
    }
  }

  if (arrowCount >= 2) {
    if (candidates.length > 0) {
      for (const c of candidates) {
        c.reason += " (Avoid arrow keys in Normal mode!)";
        c.priority += 5;
      }
    } else {
      const replacement = sameLine
        ? eCol > sCol
          ? "l / w"
          : "h / b"
        : eRow > sRow
          ? "j"
          : "k";
      add(
        "nav_arrows",
        replacement,
        74,
        "Avoid arrow keys in Normal mode — stay on home row (`hjkl`, `w`/`b`, `f<ch>`, `}`/`{`).",
        1
      );
    }
  }

  return candidates;
}
