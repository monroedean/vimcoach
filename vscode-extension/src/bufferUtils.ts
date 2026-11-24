/**
 * Pure buffer-inspection & geometry utilities for VimCoach.
 * All row and column coordinates in this module are 1-indexed (matching Vim & lua/vimcoach/buffer_utils.lua).
 */

const OPEN_TO_CLOSE: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "<": ">",
};

const CLOSE_TO_OPEN: Record<string, string> = {
  ")": "(",
  "]": "[",
  "}": "{",
  ">": "<",
};

const BRACKET_DISPLAY: Record<string, string> = {
  "(": "(",
  ")": "(",
  "[": "[",
  "]": "[",
  "{": "{",
  "}": "{",
  "<": "<",
  ">": "<",
};

const DISTINCTIVE_CHARS = new Set([
  "(", ")", "[", "]", "{", "}", "<", ">",
  '"', "'", "`", "=", ":", ";", ",", ".",
  "/", "?", "!", "@", "#", "$", "%", "&",
  "*", "+", "-", "|",
]);

function charAt1(str: string, col1: number): string {
  if (col1 < 1 || col1 > str.length) {
    return "";
  }
  return str[col1 - 1];
}

function sub1(str: string, startCol1: number, endCol1?: number): string {
  const s = Math.max(0, startCol1 - 1);
  if (endCol1 === undefined) {
    return str.slice(s);
  }
  return str.slice(s, Math.max(s, endCol1));
}

export function isBlank(line: string | undefined): boolean {
  return line === undefined || /^\s*$/.test(line);
}

export function firstNonBlank(line: string | undefined): number {
  if (!line || line.length === 0) {
    return 1;
  }
  const idx = line.search(/\S/);
  return idx >= 0 ? idx + 1 : 1;
}

export function lastCharCol(line: string | undefined): number {
  if (!line || line.length === 0) {
    return 1;
  }
  return line.length;
}

export function isWordChar(ch: string | undefined): boolean {
  return !!ch && /^[A-Za-z0-9_]$/.test(ch);
}

export function isSpace(ch: string | undefined): boolean {
  return !!ch && /^\s$/.test(ch);
}

export interface WordSpan {
  word: string;
  startCol: number;
  endCol: number;
}

export function wordAt(line: string | undefined, col: number): WordSpan | null {
  if (!line || col < 1 || col > line.length) {
    return null;
  }
  if (!isWordChar(charAt1(line, col))) {
    return null;
  }
  let s = col;
  while (s > 1 && isWordChar(charAt1(line, s - 1))) {
    s--;
  }
  let e = col;
  while (e < line.length && isWordChar(charAt1(line, e + 1))) {
    e++;
  }
  return {
    word: sub1(line, s, e),
    startCol: s,
    endCol: e,
  };
}

export function matchWordObject(line: string | undefined, sCol: number, eCol: number): string | null {
  if (!line || sCol < 1 || eCol < sCol || eCol > line.length) {
    return null;
  }
  const slice = sub1(line, sCol, eCol);
  if (slice.length < 2) {
    return null;
  }

  const prevCh = sCol > 1 ? charAt1(line, sCol - 1) : "";
  const nextCh = eCol < line.length ? charAt1(line, eCol + 1) : "";

  if (/^[A-Za-z0-9_]+$/.test(slice)) {
    if (!isWordChar(prevCh) && !isWordChar(nextCh)) {
      return "iw";
    }
  }

  if (/^[A-Za-z0-9_]+\s+$/.test(slice)) {
    if (!isWordChar(prevCh) && !isSpace(nextCh)) {
      return "aw";
    }
  } else if (/^\s+[A-Za-z0-9_]+$/.test(slice)) {
    if (!isSpace(prevCh) && !isWordChar(nextCh)) {
      return "aw";
    }
  }

  if (/^\S+$/.test(slice) && /[^A-Za-z0-9_]/.test(slice)) {
    const leftOk = sCol === 1 || isSpace(prevCh);
    const rightOk = eCol === line.length || isSpace(nextCh);
    if (leftOk && rightOk) {
      return "iW";
    }
  }

  if (/^\S+\s+$/.test(slice) && /[^A-Za-z0-9_\s]/.test(slice)) {
    const leftOk = sCol === 1 || isSpace(prevCh);
    const rightOk = eCol === line.length || !isSpace(nextCh);
    if (leftOk && rightOk) {
      return "aW";
    }
  }

  return null;
}

export interface QuoteSpan {
  openCol: number;
  closeCol: number;
}

export function findQuoteSpans(line: string, quote: string): QuoteSpan[] {
  const spans: QuoteSpan[] = [];
  let openCol: number | null = null;
  let i = 1;
  const len = line.length;
  while (i <= len) {
    const ch = charAt1(line, i);
    if (ch === "\\" && openCol !== null) {
      i += 2;
    } else if (ch === quote) {
      if (openCol === null) {
        openCol = i;
      } else {
        spans.push({ openCol, closeCol: i });
        openCol = null;
      }
      i++;
    } else {
      i++;
    }
  }
  return spans;
}

export function matchQuoteObject(line: string | undefined, sCol: number, eCol: number): string | null {
  if (!line || sCol < 1 || eCol < sCol || eCol > line.length) {
    return null;
  }
  for (const q of ['"', "'", "`"]) {
    const spans = findQuoteSpans(line, q);
    for (const span of spans) {
      if (sCol === span.openCol + 1 && eCol === span.closeCol - 1) {
        return "i" + q;
      }
      if (sCol === span.openCol && eCol === span.closeCol) {
        return "a" + q;
      }
    }
  }
  return null;
}

export interface RowCol {
  row: number;
  col: number;
}

export function findMatchingPair(
  lines: string[],
  row: number,
  col: number,
  baseRow = 1
): RowCol | null {
  const idx = row - baseRow;
  const line = lines[idx];
  if (!line || col < 1 || col > line.length) {
    return null;
  }

  const ch = charAt1(line, col);
  const targetClose = OPEN_TO_CLOSE[ch];
  const targetOpen = CLOSE_TO_OPEN[ch];

  if (targetClose) {
    let depth = 0;
    for (let rIdx = idx; rIdx < lines.length; rIdx++) {
      const curLine = lines[rIdx];
      const cStart = rIdx === idx ? col : 1;
      for (let c = cStart; c <= curLine.length; c++) {
        const cur = charAt1(curLine, c);
        if (cur === ch) {
          depth++;
        } else if (cur === targetClose) {
          depth--;
          if (depth === 0) {
            return { row: baseRow + rIdx, col: c };
          }
        }
      }
    }
  } else if (targetOpen) {
    let depth = 0;
    for (let rIdx = idx; rIdx >= 0; rIdx--) {
      const curLine = lines[rIdx];
      const cStart = rIdx === idx ? col : curLine.length;
      for (let c = cStart; c >= 1; c--) {
        const cur = charAt1(curLine, c);
        if (cur === ch) {
          depth++;
        } else if (cur === targetOpen) {
          depth--;
          if (depth === 0) {
            return { row: baseRow + rIdx, col: c };
          }
        }
      }
    }
  }

  return null;
}

function prevCharPos(
  lines: string[],
  row: number,
  col: number,
  baseRow: number
): { ch: string; row: number; col: number } | null {
  const idx = row - baseRow;
  const line = lines[idx];
  if (line === undefined) {
    return null;
  }
  if (col > 1) {
    return { ch: charAt1(line, col - 1), row, col: col - 1 };
  }
  if (idx > 0) {
    const prevLine = lines[idx - 1];
    const trimmed = prevLine.replace(/\s+$/, "");
    const lastNonWs = trimmed.length;
    if (lastNonWs >= 1 && lastNonWs <= prevLine.length) {
      return { ch: charAt1(prevLine, lastNonWs), row: row - 1, col: lastNonWs };
    }
  }
  return null;
}

function nextCharPos(
  lines: string[],
  row: number,
  col: number,
  baseRow: number
): { ch: string; row: number; col: number } | null {
  const idx = row - baseRow;
  const line = lines[idx];
  if (line === undefined) {
    return null;
  }
  if (col < line.length) {
    return { ch: charAt1(line, col + 1), row, col: col + 1 };
  }
  if (idx < lines.length - 1) {
    const nextLine = lines[idx + 1];
    const firstNonWsIdx = nextLine.search(/\S/);
    if (firstNonWsIdx >= 0) {
      const c = firstNonWsIdx + 1;
      return { ch: charAt1(nextLine, c), row: row + 1, col: c };
    }
  }
  return null;
}

export function matchBracketObject(
  lines: string[],
  sRow: number,
  sCol: number,
  eRow: number,
  eCol: number,
  baseRow = 1,
  isLinewise = false
): string | null {
  const sIdx = sRow - baseRow;
  const eIdx = eRow - baseRow;
  const sLine = lines[sIdx];
  const eLine = lines[eIdx];
  if (sLine === undefined || eLine === undefined) {
    return null;
  }

  if (isLinewise) {
    if (sIdx > 0 && eIdx < lines.length - 1) {
      const prevLine = lines[sIdx - 1];
      const nextLine = lines[eIdx + 1];
      const openMatch = /([([{])\s*$/.exec(prevLine);
      const closeMatch = /^\s*([)\]}])/.exec(nextLine);
      if (openMatch && closeMatch) {
        const oc = openMatch.index + 1;
        const cc = closeMatch.index + closeMatch[0].length;
        const matched = findMatchingPair(lines, sRow - 1, oc, baseRow);
        if (matched && matched.row === eRow + 1 && matched.col === cc) {
          const bch = charAt1(prevLine, oc);
          return "i" + BRACKET_DISPLAY[bch];
        }
      }
    }
    const sNb = firstNonBlank(sLine);
    const eNb = firstNonBlank(eLine);
    const sc = charAt1(sLine, sNb);
    if (OPEN_TO_CLOSE[sc]) {
      const matched = findMatchingPair(lines, sRow, sNb, baseRow);
      if (matched && matched.row === eRow && matched.col === eNb) {
        return "a" + BRACKET_DISPLAY[sc];
      }
    }
    return null;
  }

  const sCh = charAt1(sLine, sCol);
  if (OPEN_TO_CLOSE[sCh]) {
    const matched = findMatchingPair(lines, sRow, sCol, baseRow);
    if (matched && matched.row === eRow && matched.col === eCol) {
      return "a" + BRACKET_DISPLAY[sCh];
    }
  }

  const p = prevCharPos(lines, sRow, sCol, baseRow);
  if (p && OPEN_TO_CLOSE[p.ch]) {
    const matched = findMatchingPair(lines, p.row, p.col, baseRow);
    const n = nextCharPos(lines, eRow, eCol, baseRow);
    if (matched && n && matched.row === n.row && matched.col === n.col) {
      return "i" + BRACKET_DISPLAY[p.ch];
    }
  }

  return null;
}

export function matchTagObject(
  lines: string[],
  sRow: number,
  sCol: number,
  eRow: number,
  eCol: number,
  baseRow = 1
): string | null {
  const sIdx = sRow - baseRow;
  const eIdx = eRow - baseRow;
  const sLine = lines[sIdx];
  const eLine = lines[eIdx];
  if (sLine === undefined || eLine === undefined) {
    return null;
  }

  if (sRow === eRow) {
    const before = sub1(sLine, 1, sCol - 1);
    const after = sub1(sLine, eCol + 1);
    const selected = sub1(sLine, sCol, eCol);

    const openTag = /<([A-Za-z0-9:_-]+)[^<>]*>$/.exec(before)?.[1];
    const closeTag = /^<\/([A-Za-z0-9:_-]+)\s*>/.exec(after)?.[1];
    if (openTag && closeTag && openTag === closeTag) {
      return "it";
    }

    const selOpen = /^<([A-Za-z0-9:_-]+)[^<>]*>/.exec(selected)?.[1];
    const selClose = /<\/([A-Za-z0-9:_-]+)\s*>$/.exec(selected)?.[1];
    if (selOpen && selClose && selOpen === selClose) {
      return "at";
    }
  }

  // Multi-line check (also handles single-line body between opening/closing tag lines)
  const prevLine = sIdx > 0 ? lines[sIdx - 1] : "";
  const nextLine = eIdx < lines.length - 1 ? lines[eIdx + 1] : "";
  const openTag = /<([A-Za-z0-9:_-]+)[^<>]*>\s*$/.exec(prevLine)?.[1];
  const closeTag = /^\s*<\/([A-Za-z0-9:_-]+)\s*>/.exec(nextLine)?.[1];
  if (openTag && closeTag && openTag === closeTag) {
    return "it";
  }

  if (sRow !== eRow) {
    const selOpen = /^<([A-Za-z0-9:_-]+)[^<>]*>/.exec(sub1(sLine, sCol))?.[1];
    const selClose = /<\/([A-Za-z0-9:_-]+)\s*>$/.exec(sub1(eLine, 1, eCol))?.[1];
    if (selOpen && selClose && selOpen === selClose) {
      return "at";
    }
  }

  return null;
}

export function matchParagraphObject(
  lines: string[],
  sRow: number,
  eRow: number,
  baseRow = 1,
  totalLines?: number
): string | null {
  const total = totalLines ?? baseRow + lines.length - 1;
  if (eRow - sRow + 1 < 2) {
    return null;
  }

  const sIdx = sRow - baseRow;
  const eIdx = eRow - baseRow;
  if (sIdx < 0 || eIdx >= lines.length) {
    return null;
  }

  let allNonBlank = true;
  for (let i = sIdx; i <= eIdx; i++) {
    if (isBlank(lines[i])) {
      allNonBlank = false;
      break;
    }
  }

  if (allNonBlank) {
    const topBounded = sRow === 1 || (sIdx > 0 && isBlank(lines[sIdx - 1]));
    const botBounded = eRow === total || (eIdx < lines.length - 1 && isBlank(lines[eIdx + 1]));
    if (topBounded && botBounded) {
      return "ip";
    }
  }

  let nonBlankCount = 0;
  let trailingBlankCount = 0;
  let inTrailing = false;
  let validAp = true;
  for (let i = sIdx; i <= eIdx; i++) {
    if (isBlank(lines[i])) {
      inTrailing = true;
      trailingBlankCount++;
    } else {
      if (inTrailing) {
        validAp = false;
        break;
      }
      nonBlankCount++;
    }
  }

  if (validAp && nonBlankCount >= 2 && trailingBlankCount >= 1) {
    const topBounded = sRow === 1 || (sIdx > 0 && isBlank(lines[sIdx - 1]));
    const botBounded = eRow === total || (eIdx < lines.length - 1 && !isBlank(lines[eIdx + 1]));
    if (topBounded && botBounded) {
      return "ap";
    }
  }

  return null;
}

export interface CharFindResult {
  motion: string;
  keyCost: number;
  kind: "f" | "F" | "t" | "T";
  char: string;
  distinctive: boolean;
}

export function bestCharFind(
  line: string | undefined,
  startCol: number,
  endCol: number,
  practicalOnly = true
): CharFindResult | null {
  if (!line || startCol === endCol) {
    return null;
  }
  if (startCol < 1 || endCol < 1 || startCol > line.length || endCol > line.length) {
    return null;
  }

  const forward = endCol > startCol;
  const dist = Math.abs(endCol - startCol);
  if (dist < 3) {
    return null;
  }

  const targetCh = charAt1(line, endCol);
  let best: CharFindResult | null = null;

  if (!isSpace(targetCh)) {
    let count = 0;
    if (forward) {
      for (let c = startCol + 1; c <= endCol; c++) {
        if (charAt1(line, c) === targetCh) {
          count++;
        }
      }
    } else {
      for (let c = startCol - 1; c >= endCol; c--) {
        if (charAt1(line, c) === targetCh) {
          count++;
        }
      }
    }

    const distinctive = DISTINCTIVE_CHARS.has(targetCh);
    const cmd: "f" | "F" = forward ? "f" : "F";

    if (count === 1) {
      if (!practicalOnly || distinctive || dist >= 4) {
        best = {
          motion: cmd + targetCh,
          keyCost: 2,
          kind: cmd,
          char: targetCh,
          distinctive,
        };
      }
    } else if (count === 2 && distinctive && dist >= 6) {
      best = {
        motion: cmd + targetCh + ";",
        keyCost: 3,
        kind: cmd,
        char: targetCh,
        distinctive: true,
      };
    }
  }

  if (!best || !best.distinctive) {
    const adjCol = forward ? endCol + 1 : endCol - 1;
    if (adjCol >= 1 && adjCol <= line.length) {
      const adjCh = charAt1(line, adjCol);
      if (DISTINCTIVE_CHARS.has(adjCh)) {
        let count = 0;
        if (forward) {
          for (let c = startCol + 1; c <= adjCol; c++) {
            if (charAt1(line, c) === adjCh) {
              count++;
            }
          }
        } else {
          for (let c = startCol - 1; c >= adjCol; c--) {
            if (charAt1(line, c) === adjCh) {
              count++;
            }
          }
        }

        if (count === 1) {
          const cmd: "t" | "T" = forward ? "t" : "T";
          best = {
            motion: cmd + adjCh,
            keyCost: 2,
            kind: cmd,
            char: adjCh,
            distinctive: true,
          };
        }
      }
    }
  }

  return best;
}

export interface WordMotionResult {
  motion: string;
  hops: number;
  keyCost: number;
}

export function bestWordMotion(
  line: string | undefined,
  startCol: number,
  endCol: number,
  maxHops = 3
): WordMotionResult | null {
  if (
    !line ||
    startCol === endCol ||
    startCol < 1 ||
    endCol < 1 ||
    startCol > line.length ||
    endCol > line.length
  ) {
    return null;
  }

  const charClass = (ch: string): number => {
    if (isSpace(ch)) {
      return 0;
    }
    if (isWordChar(ch)) {
      return 1;
    }
    return 2;
  };

  const len = line.length;

  if (endCol > startCol) {
    let col = startCol;
    for (let hop = 1; hop <= maxHops; hop++) {
      const cls = charClass(charAt1(line, col));
      while (col <= len && charClass(charAt1(line, col)) === cls && cls !== 0) {
        col++;
      }
      while (col <= len && charClass(charAt1(line, col)) === 0) {
        col++;
      }
      if (col > len) {
        break;
      }
      if (col === endCol) {
        const motion = hop === 1 ? "w" : `${hop}w`;
        return { motion, hops: hop, keyCost: motion.length };
      }
    }

    col = startCol;
    for (let hop = 1; hop <= maxHops; hop++) {
      col++;
      while (col <= len && charClass(charAt1(line, col)) === 0) {
        col++;
      }
      if (col > len) {
        break;
      }
      const cls = charClass(charAt1(line, col));
      while (col < len && charClass(charAt1(line, col + 1)) === cls) {
        col++;
      }
      if (col === endCol) {
        const motion = hop === 1 ? "e" : `${hop}e`;
        return { motion, hops: hop, keyCost: motion.length };
      }
    }
  } else {
    let col = startCol;
    for (let hop = 1; hop <= maxHops; hop++) {
      col--;
      while (col >= 1 && charClass(charAt1(line, col)) === 0) {
        col--;
      }
      if (col < 1) {
        break;
      }
      const cls = charClass(charAt1(line, col));
      while (col > 1 && charClass(charAt1(line, col - 1)) === cls) {
        col--;
      }
      if (col === endCol) {
        const motion = hop === 1 ? "b" : `${hop}b`;
        return { motion, hops: hop, keyCost: motion.length };
      }
    }
  }

  return null;
}

export function formatKeys(keys: string[] | undefined): string {
  if (!keys || keys.length === 0) {
    return "";
  }
  const out: string[] = [];
  let i = 0;
  while (i < keys.length) {
    const k = keys[i];
    let run = 1;
    while (i + run < keys.length && keys[i + run] === k) {
      run++;
    }
    if (run >= 5) {
      out.push(`${k}×${run}`);
    } else {
      for (let j = 0; j < run; j++) {
        out.push(k);
      }
    }
    i += run;
  }
  return out.join("");
}
