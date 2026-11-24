import { VimMode } from "./types";

/**
 * Mirrors vscode.TextEditorCursorStyle numeric enum so this module has zero runtime
 * dependency on `vscode` and can be unit-tested directly in Node.
 */
export const CursorStyle = {
  Line: 1,
  Block: 2,
  Underline: 3,
  LineThin: 4,
  BlockOutline: 5,
  UnderlineThin: 6,
} as const;

export interface VimCursorStyleConfig {
  normal: number;
  insert: number;
  visual: number;
  visualLine: number;
  replace: number;
}

const STYLE_NAME_TO_ENUM: Record<string, number> = {
  line: CursorStyle.Line,
  block: CursorStyle.Block,
  underline: CursorStyle.Underline,
  "line-thin": CursorStyle.LineThin,
  "block-outline": CursorStyle.BlockOutline,
  "underline-thin": CursorStyle.UnderlineThin,
};

export function parseCursorStyleName(name: string | undefined, fallback: number): number {
  if (!name) {
    return fallback;
  }
  return STYLE_NAME_TO_ENUM[name.toLowerCase()] ?? fallback;
}

export const DEFAULT_VIM_CURSOR_STYLES: VimCursorStyleConfig = {
  normal: CursorStyle.Block,
  insert: CursorStyle.Line,
  visual: CursorStyle.Block,
  visualLine: CursorStyle.Block,
  replace: CursorStyle.Underline,
};

export interface SelectionLike {
  anchorLine: number; // 0-indexed
  anchorChar: number; // 0-indexed
  activeLine: number; // 0-indexed
  activeChar: number; // 0-indexed
  isEmpty: boolean;
}

export function isFullLineSelection(
  sel: SelectionLike,
  getLineText: (line0: number) => string,
  lineCount: number
): boolean {
  if (sel.isEmpty) {
    return false;
  }
  const sLine =
    sel.anchorLine < sel.activeLine ||
    (sel.anchorLine === sel.activeLine && sel.anchorChar <= sel.activeChar)
      ? sel.anchorLine
      : sel.activeLine;
  const sChar =
    sel.anchorLine < sel.activeLine ||
    (sel.anchorLine === sel.activeLine && sel.anchorChar <= sel.activeChar)
      ? sel.anchorChar
      : sel.activeChar;
  const eLine =
    sel.anchorLine < sel.activeLine ||
    (sel.anchorLine === sel.activeLine && sel.anchorChar <= sel.activeChar)
      ? sel.activeLine
      : sel.anchorLine;
  const eChar =
    sel.anchorLine < sel.activeLine ||
    (sel.anchorLine === sel.activeLine && sel.anchorChar <= sel.activeChar)
      ? sel.activeChar
      : sel.anchorChar;

  if (sChar !== 0) {
    return false;
  }
  if (eChar === 0 && eLine > sLine) {
    return true;
  }
  if (eLine < 0 || eLine >= lineCount) {
    return false;
  }
  const endLineLen = getLineText(eLine).length;
  // On a single-line non-empty line of length 1, `v` at col 0 also spans 0..1;
  // only treat as linewise if spanning multiple lines or line length > 1.
  if (sLine === eLine && endLineLen <= 1) {
    return false;
  }
  return endLineLen > 0 && eChar >= endLineLen;
}

export function detectVimMode(
  cursorStyle: number | undefined,
  selection: SelectionLike,
  styleCfg: VimCursorStyleConfig,
  getLineText: (line0: number) => string,
  lineCount: number,
  previousMode: VimMode = "normal"
): VimMode {
  if (cursorStyle === styleCfg.insert && styleCfg.insert !== styleCfg.normal) {
    return "insert";
  }
  if (cursorStyle === styleCfg.replace && styleCfg.replace !== styleCfg.normal) {
    return "replace";
  }
  if (!selection.isEmpty) {
    if (
      cursorStyle === styleCfg.visualLine &&
      styleCfg.visualLine !== styleCfg.visual &&
      styleCfg.visualLine !== styleCfg.normal
    ) {
      return "visual-line";
    }
    if (previousMode === "visual-line") {
      return "visual-line";
    }
    if (isFullLineSelection(selection, getLineText, lineCount)) {
      return "visual-line";
    }
    return "visual";
  }
  if (cursorStyle === styleCfg.normal) {
    return "normal";
  }
  // If user customized normal == insert cursor style, preserve previous mode unless selection changed
  return previousMode === "visual" || previousMode === "visual-line" ? "normal" : previousMode;
}
