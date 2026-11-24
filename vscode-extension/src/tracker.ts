import * as buf from "./bufferUtils";
import {
  analyzeBackspaceRun,
  analyzeInsertArrows,
  analyzeInsertEntry,
  analyzeInsertLeave,
  analyzeNavigation,
  analyzeRepeatedX,
  analyzeVisual,
  checkParagraphJump,
  pickBest,
  PrevDeleteContext,
  RepetitionAnalyzer,
} from "./analyzers";
import { MasteryStore } from "./mastery";
import {
  DEFAULT_VIM_CURSOR_STYLES,
  detectVimMode,
  isFullLineSelection,
  SelectionLike,
  VimCursorStyleConfig,
} from "./modeDetector";
import { Candidate, CoachConfig, VimMode } from "./types";

export interface Pos0 {
  line: number; // 0-indexed
  character: number; // 0-indexed
}

export interface TextChangeEvent {
  rangeStart: Pos0;
  rangeEnd: Pos0;
  rangeLength: number;
  text: string;
}

export interface DocumentChangeInput {
  docId: string;
  languageId: string;
  changes: TextChangeEvent[];
  reason?: "undo" | "redo" | "other";
  postLines: string[];
  cursor?: Pos0;
  visibleTopRow?: number;
  visibleBotRow?: number;
}

export interface SelectionChangeInput {
  docId: string;
  languageId: string;
  selection: SelectionLike;
  isMouse: boolean;
  cursorStyle?: number;
  lines: string[];
  visibleTopRow?: number;
  visibleBotRow?: number;
}

export interface ModeChangeInput {
  docId: string;
  languageId: string;
  cursorStyle?: number;
  selection: SelectionLike;
  lines: string[];
  visibleTopRow?: number;
  visibleBotRow?: number;
}

export interface TrackerHost {
  onHint(candidate: Candidate): void;
  onStatsUpdated(): void;
  revertCursor?(docId: string, pos: Pos0): void;
  scheduleTimer?(ms: number, cb: () => void): unknown;
  cancelTimer?(handle: unknown): void;
  nowMs?(): number;
}

interface NavEpisode {
  docId: string;
  startRow: number; // 1-indexed
  startCol: number; // 1-indexed
  endRow: number;
  endCol: number;
  keys: string[];
  lastTsMs: number;
  lines: string[];
  totalLines: number;
  winTop?: number;
  winBot?: number;
  analyzed: boolean;
  tsMs: number;
  elapsedMs: number;
}

interface VisualSession {
  docId: string;
  mode: "v" | "V";
  anchorRow: number; // 1-indexed
  anchorCol: number; // 1-indexed
  sRow: number; // 1-indexed inclusive
  sCol: number;
  eRow: number;
  eCol: number;
  lastActiveRow: number;
  lastActiveCol: number;
  keys: string[];
  preNav: NavEpisode | null;
  lines: string[];
  totalLines: number;
  lastTsMs: number;
}

interface LastDeleteState {
  cmd: string;
  row: number;
  col: number;
  tsMs: number;
  deletedText: string;
  deletedWord: string | null;
  wasLinewise: boolean;
}

interface XRunState {
  key: "x" | "X";
  count: number;
  beforeLine: string;
  startCol: number;
  row: number;
  lastTsMs: number;
}

interface LineOpRunState {
  op: "dd" | "yy";
  count: number;
  lastTsMs: number;
}

interface InsertSession {
  docId: string;
  entryKey: string;
  prevDelete: PrevDeleteContext | null;
  insertedKeys: string[];
  beforeLine: string;
  beforeRow: number;
  beforeCol: number;
  beforeLineCount: number;
  deletedWord: string | null;
  bsCount: number;
  arrowKeys: string[];
  enteredAtMs: number;
  prevNav: NavEpisode | null;
}

const ATOMIC_CHANGE_WINDOW_MS = 55;

const STRICT_KEY_TO_RULE: Record<string, string> = {
  h: "nav_word_jump",
  l: "nav_word_jump",
  j: "nav_vertical_count",
  k: "nav_vertical_count",
};

function clampCol1(line: string | undefined, col0: number): number {
  const len = line?.length ?? 0;
  if (len === 0) {
    return 1;
  }
  return Math.max(1, Math.min(len, col0 + 1));
}

function normalizeSelection1(
  sel: SelectionLike,
  lines: string[]
): { sRow: number; sCol: number; eRow: number; eCol: number; anchorRow: number; anchorCol: number } {
  const forward =
    sel.anchorLine < sel.activeLine ||
    (sel.anchorLine === sel.activeLine && sel.anchorChar <= sel.activeChar);
  const startLine0 = forward ? sel.anchorLine : sel.activeLine;
  const startChar0 = forward ? sel.anchorChar : sel.activeChar;
  const endLine0 = forward ? sel.activeLine : sel.anchorLine;
  const endChar0 = forward ? sel.activeChar : sel.anchorChar;

  const sRow = startLine0 + 1;
  const sCol = startChar0 + 1;
  let eRow = endLine0 + 1;
  let eCol = endChar0;

  if (endChar0 === 0 && endLine0 > startLine0) {
    eRow = endLine0; // previous line, 1-indexed
    eCol = Math.max(1, (lines[eRow - 1] ?? "").length);
  } else {
    eCol = Math.max(1, eCol);
  }

  const anchorRow = forward ? sRow : eRow;
  const anchorCol = forward ? sCol : eCol;
  return { sRow, sCol, eRow, eCol, anchorRow, anchorCol };
}

function isWholeLineDeletion(
  change: TextChangeEvent,
  preLines: string[],
  postLines: string[]
): boolean {
  if (change.text !== "") {
    return false;
  }
  const lineDelta = preLines.length - postLines.length;
  if (lineDelta === 1) {
    // Typical `dd`: deletes (r, 0)..(r+1, 0)
    if (
      change.rangeStart.character === 0 &&
      change.rangeEnd.character === 0 &&
      change.rangeEnd.line === change.rangeStart.line + 1
    ) {
      return true;
    }
    // `dd` on last line: deletes (r-1, prevLen)..(r, lastLen)
    const prevLineLen = (preLines[change.rangeStart.line] ?? "").length;
    const endLineLen = (preLines[change.rangeEnd.line] ?? "").length;
    if (
      change.rangeEnd.line === change.rangeStart.line + 1 &&
      change.rangeStart.character === prevLineLen &&
      change.rangeEnd.character === endLineLen
    ) {
      return true;
    }
  }
  // Single-line buffer `dd`
  if (
    preLines.length === 1 &&
    change.rangeStart.line === 0 &&
    change.rangeStart.character === 0 &&
    change.rangeEnd.line === 0 &&
    change.rangeEnd.character === (preLines[0] ?? "").length &&
    (preLines[0] ?? "").length > 0
  ) {
    return true;
  }
  return false;
}

function classifyNormalDeletion(
  change: TextChangeEvent,
  preLines: string[],
  postLines: string[]
): { cmd: string; praiseRule?: string; deletedText: string; deletedWord: string | null; wasLinewise: boolean } {
  const sRow = change.rangeStart.line + 1;
  const sCol = change.rangeStart.character + 1;
  const line = preLines[sRow - 1] ?? "";

  if (isWholeLineDeletion(change, preLines, postLines)) {
    return {
      cmd: "dd",
      deletedText: line,
      deletedWord: null,
      wasLinewise: true,
    };
  }

  const singleLine = change.rangeStart.line === change.rangeEnd.line;
  const eRow = change.rangeEnd.line + 1;
  const eCol = Math.max(sCol, change.rangeEnd.character);

  if (singleLine) {
    const deletedText = line.slice(change.rangeStart.character, change.rangeEnd.character);

    if (deletedText.length === 1) {
      return {
        cmd: "x",
        deletedText,
        deletedWord: buf.wordAt(line, sCol)?.word ?? null,
        wasLinewise: false,
      };
    }

    const qObj = buf.matchQuoteObject(line, sCol, eCol);
    if (qObj) {
      return {
        cmd: "d" + qObj,
        praiseRule: "textobj_quotes",
        deletedText,
        deletedWord: buf.wordAt(line, sCol)?.word ?? null,
        wasLinewise: false,
      };
    }

    const tObj = buf.matchTagObject(preLines, sRow, sCol, eRow, eCol, 1);
    if (tObj) {
      return {
        cmd: "d" + tObj,
        praiseRule: "textobj_tag",
        deletedText,
        deletedWord: null,
        wasLinewise: false,
      };
    }

    const bObj = buf.matchBracketObject(preLines, sRow, sCol, eRow, eCol, 1, false);
    if (bObj) {
      return {
        cmd: "d" + bObj,
        praiseRule: "textobj_brackets",
        deletedText,
        deletedWord: null,
        wasLinewise: false,
      };
    }

    const wObj = buf.matchWordObject(line, sCol, eCol);
    if (wObj) {
      const cmd = wObj === "aw" ? "dw" : "d" + wObj;
      return {
        cmd,
        praiseRule: "textobj_word",
        deletedText,
        deletedWord: deletedText.trim(),
        wasLinewise: false,
      };
    }

    if (eCol >= line.length && sCol > 1) {
      return {
        cmd: "D",
        praiseRule: "edit_delete_to_eol",
        deletedText,
        deletedWord: buf.wordAt(line, sCol)?.word ?? null,
        wasLinewise: false,
      };
    }

    return {
      cmd: "dw",
      deletedText,
      deletedWord: deletedText.trim() || null,
      wasLinewise: false,
    };
  }

  const bObj = buf.matchBracketObject(preLines, sRow, sCol, eRow, eCol, 1, false);
  if (bObj) {
    return {
      cmd: "d" + bObj,
      praiseRule: "textobj_brackets",
      deletedText: "",
      deletedWord: null,
      wasLinewise: false,
    };
  }
  const pObj = buf.matchParagraphObject(preLines, sRow, eRow, 1, preLines.length);
  if (pObj) {
    return {
      cmd: "d" + pObj,
      praiseRule: "textobj_paragraph",
      deletedText: "",
      deletedWord: null,
      wasLinewise: true,
    };
  }

  return {
    cmd: "dj",
    deletedText: "",
    deletedWord: null,
    wasLinewise: false,
  };
}

export class VSCodeVimTracker {
  private readonly repetition = new RepetitionAnalyzer();
  private cursorStyles: VimCursorStyleConfig = { ...DEFAULT_VIM_CURSOR_STYLES };

  private activeDocId: string | null = null;
  private docLines: Map<string, string[]> = new Map();
  private mode: VimMode = "normal";
  private lastPos: Pos0 | null = null;

  private nav: NavEpisode | null = null;
  private navTimer: unknown = null;
  private lastCompletedNav: NavEpisode | null = null;
  private lastJumpOrigin: { row: number; col: number; tsMs: number } | null = null;

  private visual: VisualSession | null = null;
  private recentlyClearedVisual: { session: VisualSession; clearedAtMs: number } | null = null;

  private lastDelete: LastDeleteState | null = null;
  private xRun: XRunState | null = null;
  private lineOpRun: LineOpRunState | null = null;
  private runTimer: unknown = null;
  private insert: InsertSession | null = null;

  private lastDocChangeTsMs = 0;
  private suppressSelectionEvents = 0;

  private strictLastKey: string | null = null;
  private strictRepeatCount = 0;
  private strictLastTimeMs = 0;

  constructor(
    private readonly getConfig: () => CoachConfig,
    private readonly mastery: MasteryStore,
    private readonly host: TrackerHost
  ) {}

  private nowMs(): number {
    return this.host.nowMs ? this.host.nowMs() : Date.now();
  }

  public setCursorStyleConfig(cfg: VimCursorStyleConfig): void {
    this.cursorStyles = { ...cfg };
  }

  public getMode(): VimMode {
    return this.mode;
  }

  public resetSession(): void {
    this.stopNavTimer();
    this.stopRunTimer();
    this.nav = null;
    this.lastCompletedNav = null;
    this.visual = null;
    this.recentlyClearedVisual = null;
    this.lastDelete = null;
    this.xRun = null;
    this.lineOpRun = null;
    this.insert = null;
    this.strictLastKey = null;
    this.strictRepeatCount = 0;
    this.repetition.reset();
  }

  public dispose(): void {
    this.stopNavTimer();
    this.stopRunTimer();
  }

  public setActiveDocument(
    docId: string,
    lines: string[],
    selection: SelectionLike,
    cursorStyle?: number
  ): void {
    if (this.activeDocId !== docId) {
      this.flushNav(true);
      this.flushXRun();
      this.flushLineOpRun();
      this.visual = null;
      this.recentlyClearedVisual = null;
      this.insert = null;
      this.strictLastKey = null;
      this.strictRepeatCount = 0;
    }
    this.activeDocId = docId;
    this.docLines.set(docId, lines.slice());
    this.lastPos = { line: selection.activeLine, character: selection.activeChar };
    this.mode = detectVimMode(
      cursorStyle,
      selection,
      this.cursorStyles,
      (r) => lines[r] ?? "",
      lines.length,
      "normal"
    );
  }

  private isLanguageDisabled(languageId: string): boolean {
    const cfg = this.getConfig();
    return !!cfg.disabledLanguages[languageId];
  }

  private emit(candidates: Candidate[], force = false): Candidate | null {
    const cfg = this.getConfig();
    if (!cfg.enabled) {
      return null;
    }
    const best = pickBest(candidates);
    if (!best) {
      return null;
    }
    if (!this.mastery.canNotify(best.ruleId, force)) {
      return null;
    }
    this.mastery.recordMiss(best);
    this.host.onHint(best);
    return best;
  }

  private praise(ruleId: string): void {
    if (!this.getConfig().enabled) {
      return;
    }
    this.mastery.recordGood(ruleId);
    this.host.onStatsUpdated();
  }

  private stopNavTimer(): void {
    if (this.navTimer !== null) {
      if (this.host.cancelTimer) {
        this.host.cancelTimer(this.navTimer);
      } else {
        clearTimeout(this.navTimer as ReturnType<typeof setTimeout>);
      }
      this.navTimer = null;
    }
  }

  private resetNavTimer(): void {
    this.stopNavTimer();
    const timeout = this.getConfig().thresholds.episodeTimeoutMs || 600;
    if (this.host.scheduleTimer) {
      this.navTimer = this.host.scheduleTimer(timeout, () => {
        this.navTimer = null;
        this.flushNav(false);
      });
    } else {
      this.navTimer = setTimeout(() => {
        this.navTimer = null;
        this.flushNav(false);
      }, timeout);
    }
  }

  private analyzeNavSnapshot(snapshot: NavEpisode): void {
    if (!snapshot || snapshot.analyzed || snapshot.keys.length < 2) {
      return;
    }
    snapshot.analyzed = true;

    const now = this.nowMs();
    const jumpOrigin =
      this.lastJumpOrigin && now - this.lastJumpOrigin.tsMs <= 12000 ? this.lastJumpOrigin : null;

    const minR = Math.max(1, Math.min(snapshot.startRow, snapshot.endRow) - 2);
    const maxR = Math.min(snapshot.totalLines, Math.max(snapshot.startRow, snapshot.endRow) + 2);
    const slice = snapshot.lines.slice(minR - 1, maxR);

    const candidates = analyzeNavigation(
      {
        startRow: snapshot.startRow,
        startCol: snapshot.startCol,
        endRow: snapshot.endRow,
        endCol: snapshot.endCol,
        keys: snapshot.keys,
        lines: slice,
        baseRow: minR,
        totalLines: snapshot.totalLines,
        winTop: snapshot.winTop,
        winBot: snapshot.winBot,
        lastJumpOrigin: jumpOrigin,
      },
      this.getConfig()
    );
    this.emit(candidates);
  }

  public flushNav(suppressEmit = false): NavEpisode | null {
    this.stopNavTimer();
    const nav = this.nav;
    this.nav = null;
    if (!nav || nav.keys.length === 0) {
      return null;
    }

    const t = this.nowMs();
    nav.tsMs = t;
    nav.elapsedMs = Math.max(0, t - nav.lastTsMs);
    this.lastCompletedNav = nav;

    if (!suppressEmit) {
      this.analyzeNavSnapshot(nav);
    }
    return nav;
  }

  private stopRunTimer(): void {
    if (this.runTimer !== null) {
      if (this.host.cancelTimer) {
        this.host.cancelTimer(this.runTimer);
      } else {
        clearTimeout(this.runTimer as ReturnType<typeof setTimeout>);
      }
      this.runTimer = null;
    }
  }

  private resetRunTimer(ms: number): void {
    this.stopRunTimer();
    const cb = () => {
      this.runTimer = null;
      this.flushXRun();
      this.flushLineOpRun();
    };
    if (this.host.scheduleTimer) {
      this.runTimer = this.host.scheduleTimer(ms, cb);
    } else {
      this.runTimer = setTimeout(cb, ms);
    }
  }

  private flushXRun(): void {
    this.stopRunTimer();
    const xr = this.xRun;
    this.xRun = null;
    if (!xr || xr.count < (this.getConfig().thresholds.repeatXMin || 3)) {
      return;
    }
    const candidates = analyzeRepeatedX(
      {
        key: xr.key,
        count: xr.count,
        beforeLine: xr.beforeLine,
        startCol: xr.startCol,
      },
      this.getConfig()
    );
    this.emit(candidates);
  }

  private flushLineOpRun(): void {
    const lr = this.lineOpRun;
    this.lineOpRun = null;
    if (!lr || lr.count < (this.getConfig().thresholds.repeatLineOpMin || 4)) {
      return;
    }
    const candidates = this.repetition.analyzeRepeatedLineOp(
      { op: lr.op, count: lr.count },
      this.getConfig()
    );
    this.emit(candidates);
  }

  private checkStrictGuard(key: "h" | "j" | "k" | "l", docId: string, prevPos: Pos0, lines: string[]): boolean {
    const cfg = this.getConfig();
    if (!cfg.enabled || cfg.mode === "coach") {
      this.strictRepeatCount = 0;
      this.strictLastKey = null;
      return false;
    }

    const ruleId = STRICT_KEY_TO_RULE[key] ?? "nav_vertical_count";
    if (cfg.mode === "adaptive" && this.mastery.getMissCount(ruleId) < cfg.adaptiveStrictMisses) {
      return false;
    }

    const t = this.nowMs();
    const sameKey = key === this.strictLastKey;
    if (t - this.strictLastTimeMs > cfg.strict.maxTimeMs || (cfg.strict.allowDifferentKey && !sameKey)) {
      this.strictRepeatCount = 1;
    } else {
      this.strictRepeatCount += 1;
    }

    this.strictLastKey = key;
    this.strictLastTimeMs = t;

    if (this.strictRepeatCount > cfg.strict.maxCount) {
      const line = lines[prevPos.line] ?? "";
      const col = prevPos.character + 1;
      let suggested = "w / f<ch> / $";
      let reason = `Strict mode blocked repeated \`${key}\`.`;

      if (key === "j") {
        suggested = "{count}j / } / <C-d>";
        reason = "Use `{count}j`, `}` (next paragraph), `/pattern`, or `<C-d>` instead of mashing `j`.";
      } else if (key === "k") {
        suggested = "{count}k / { / <C-u>";
        reason = "Use `{count}k`, `{` (previous paragraph), `?pattern`, or `<C-u>` instead of mashing `k`.";
      } else if (key === "l") {
        suggested = col < line.length ? "w / e / f<ch> / $" : "$";
        reason = "Use `w`, `e`, `f<ch>`, or `$` to move right faster instead of mashing `l`.";
      } else if (key === "h") {
        suggested = "b / F<ch> / ^ / 0";
        reason = "Use `b`, `F<ch>`, `^`, or `0` to move left faster instead of mashing `h`.";
      }

      if (this.host.revertCursor) {
        this.suppressSelectionEvents += 1;
        this.host.revertCursor(docId, prevPos);
      }

      this.emit(
        [
          {
            ruleId,
            actual: `${key}×${this.strictRepeatCount}`,
            suggested,
            keysSaved: Math.max(1, this.strictRepeatCount - 1),
            priority: 99,
            reason,
            isStrictBlock: true,
          },
        ],
        false
      );
      return true;
    }

    return false;
  }

  public onModeChanged(input: ModeChangeInput): void {
    const cfg = this.getConfig();
    if (!cfg.enabled || this.isLanguageDisabled(input.languageId)) {
      return;
    }

    this.activeDocId = input.docId;
    this.docLines.set(input.docId, input.lines.slice());

    const prevMode = this.mode;
    const nextMode = detectVimMode(
      input.cursorStyle,
      input.selection,
      this.cursorStyles,
      (r) => input.lines[r] ?? "",
      input.lines.length,
      prevMode
    );

    if (nextMode === prevMode) {
      return;
    }
    this.mode = nextMode;

    const t = this.nowMs();
    const row = input.selection.activeLine + 1;
    const line = input.lines[row - 1] ?? "";
    const col = clampCol1(line, input.selection.activeChar);

    if (nextMode === "insert" && prevMode !== "insert") {
      this.enterInsertMode(input.docId, input.lines, row, input.selection.activeChar, t);
    } else if (prevMode === "insert" && nextMode !== "insert") {
      this.leaveInsertMode(input.docId, input.lines, row, col, t);
    }
  }

  private enterInsertMode(
    docId: string,
    lines: string[],
    row: number,
    activeChar0: number,
    t: number
  ): void {
    this.flushXRun();
    this.flushLineOpRun();
    this.strictLastKey = null;
    this.strictRepeatCount = 0;

    const line = lines[row - 1] ?? "";
    const col1 = clampCol1(line, activeChar0);
    const firstNb = buf.firstNonBlank(line);
    const lastCol = buf.lastCharCol(line);

    const prevNav =
      this.flushNav(true) ??
      (this.lastCompletedNav && t - this.lastCompletedNav.tsMs <= 900 ? this.lastCompletedNav : null);

    const recentDel = this.lastDelete;
    const isAtomicChange = !!recentDel && t - recentDel.tsMs <= ATOMIC_CHANGE_WINDOW_MS;

    if (this.recentlyClearedVisual && t - this.recentlyClearedVisual.clearedAtMs <= ATOMIC_CHANGE_WINDOW_MS) {
      this.recentlyClearedVisual = null;
    }

    let entryKey = "i";
    let prevDeleteCtx: PrevDeleteContext | null = null;
    let deletedWord: string | null = buf.wordAt(line, col1)?.word ?? null;

    if (isAtomicChange && recentDel) {
      this.lastDelete = null;
      if (recentDel.cmd === "x" || recentDel.cmd === "X") {
        entryKey = "s";
      } else if (recentDel.cmd === "D") {
        entryKey = "C";
        this.praise("edit_delete_to_eol");
      } else if (recentDel.cmd === "dd") {
        entryKey = "cc";
      } else if (recentDel.cmd.startsWith("d")) {
        entryKey = "c" + recentDel.cmd.slice(1);
      } else {
        entryKey = "c";
      }
      deletedWord = recentDel.deletedWord;
      prevDeleteCtx = {
        cmd: recentDel.cmd,
        elapsedMs: 0,
        deletedText: recentDel.deletedText,
        deletedWord: recentDel.deletedWord ?? undefined,
      };
    } else {
      const prevCol0 = this.lastPos && this.lastPos.line === row - 1 ? this.lastPos.character : activeChar0;
      const jumped = Math.abs(activeChar0 - prevCol0);

      if (activeChar0 === line.length && line.length > 0 && jumped >= 2 && !prevNav) {
        entryKey = "A";
        this.praise("edit_append_line_end");
      } else if (activeChar0 + 1 === firstNb && jumped >= 2 && !prevNav) {
        entryKey = "I";
        this.praise("edit_insert_line_start");
      } else if (activeChar0 === prevCol0 + 1 && line.length > 0) {
        entryKey = "a";
      } else if (activeChar0 === line.length && line.length > 0 && prevNav) {
        entryKey = "a";
      } else if (activeChar0 + 1 === firstNb && prevNav) {
        entryKey = "i";
      }

      if (
        recentDel &&
        t - recentDel.tsMs > ATOMIC_CHANGE_WINDOW_MS &&
        t - recentDel.tsMs <= (this.getConfig().thresholds.comboWindowMs || 1600)
      ) {
        prevDeleteCtx = {
          cmd: recentDel.cmd,
          elapsedMs: t - recentDel.tsMs,
          deletedText: recentDel.deletedText,
          deletedWord: recentDel.deletedWord ?? undefined,
        };
        deletedWord = recentDel.deletedWord ?? deletedWord;
      }
      this.lastDelete = null;
    }

    this.insert = {
      docId,
      entryKey,
      prevDelete: isAtomicChange ? null : prevDeleteCtx,
      insertedKeys: [],
      beforeLine: line,
      beforeRow: row,
      beforeCol: Math.min(lastCol, col1),
      beforeLineCount: lines.length,
      deletedWord,
      bsCount: 0,
      arrowKeys: [],
      enteredAtMs: t,
      prevNav,
    };

    // If atomic `s` was used, store the single-char delete text on beforeLine/beforeCol fallback via prevDelete
    if (isAtomicChange && entryKey === "s" && prevDeleteCtx?.deletedText) {
      this.insert.beforeLine = prevDeleteCtx.deletedText;
      this.insert.beforeCol = 1;
    }

    if (!isAtomicChange) {
      const entryCandidates = analyzeInsertEntry(
        {
          insertKey: entryKey,
          prevNav: prevNav ? { keys: prevNav.keys, elapsedMs: prevNav.elapsedMs } : null,
          prevDelete: prevDeleteCtx,
          line,
          row,
          col: activeChar0 === line.length && line.length > 0 ? line.length : col1,
          totalLines: lines.length,
        },
        this.getConfig()
      );
      if (entryCandidates.length > 0) {
        this.emit(entryCandidates);
      } else if (prevNav && !prevNav.analyzed) {
        this.analyzeNavSnapshot(prevNav);
      }
    }
  }

  private leaveInsertMode(
    docId: string,
    lines: string[],
    afterRow: number,
    afterCol: number,
    t: number
  ): void {
    const ins = this.insert;
    this.insert = null;
    if (!ins || ins.docId !== docId) {
      return;
    }

    const cfg = this.getConfig();

    if (ins.bsCount >= (cfg.thresholds.insertBsMin || 4)) {
      this.emit(
        analyzeBackspaceRun(
          {
            count: ins.bsCount,
            clearedToSol: afterCol <= 2,
          },
          cfg
        )
      );
    }
    if (ins.arrowKeys.length >= (cfg.thresholds.insertArrowMin || 3)) {
      this.emit(analyzeInsertArrows({ keys: ins.arrowKeys }, cfg));
    }

    const afterLine = lines[afterRow - 1] ?? "";
    const afterWord = buf.wordAt(afterLine, afterCol)?.word ?? null;

    const editCands = analyzeInsertLeave(
      {
        entryKey: ins.entryKey,
        prevDelete: ins.prevDelete,
        insertedKeys: ins.insertedKeys,
        beforeLine: ins.beforeLine,
        afterLine,
        beforeRow: ins.beforeRow,
        afterRow,
        beforeCol: ins.beforeCol,
        beforeLineCount: ins.beforeLineCount,
        afterLineCount: lines.length,
        deletedWord: ins.deletedWord,
        afterWord,
      },
      cfg
    );
    if (editCands.length > 0) {
      this.emit(editCands);
      return;
    }

    if (ins.insertedKeys.length >= 1 && ins.insertedKeys.length <= 30) {
      const typedText = ins.insertedKeys.join("");
      if (
        !typedText.includes("<Left>") &&
        !typedText.includes("<Right>") &&
        !typedText.includes("<Up>") &&
        !typedText.includes("<Down>") &&
        !typedText.includes("<CR>") &&
        !typedText.includes("<BS>")
      ) {
        const keyCost = ins.entryKey.length + ins.insertedKeys.length + 1;
        const isChange =
          ins.entryKey.startsWith("c") ||
          ins.entryKey === "C" ||
          ins.entryKey === "s" ||
          ins.entryKey === "S";
        const repCands = this.repetition.analyzeEditRepeat(
          {
            signature: `${ins.entryKey}:${typedText}`,
            display: `${ins.entryKey}${typedText}<Esc>`,
            keyCost,
            tsMs: t,
            replacement: isChange ? typedText : undefined,
          },
          cfg
        );
        this.emit(repCands);
      }
    }
  }

  public onSelectionChanged(input: SelectionChangeInput): void {
    const cfg = this.getConfig();
    if (!cfg.enabled || this.isLanguageDisabled(input.languageId)) {
      return;
    }

    if (this.suppressSelectionEvents > 0) {
      this.suppressSelectionEvents -= 1;
      this.lastPos = { line: input.selection.activeLine, character: input.selection.activeChar };
      return;
    }

    const t = this.nowMs();
    const docChanged = this.activeDocId !== input.docId;
    if (docChanged) {
      this.setActiveDocument(input.docId, input.lines, input.selection, input.cursorStyle);
      return;
    }

    this.docLines.set(input.docId, input.lines.slice());

    const prevPos = this.lastPos;
    const curPos: Pos0 = {
      line: input.selection.activeLine,
      character: input.selection.activeChar,
    };
    this.lastPos = curPos;

    // Mouse clicks reset episodes and are never coached
    if (input.isMouse) {
      this.flushNav(true);
      this.visual = null;
      this.strictLastKey = null;
      this.strictRepeatCount = 0;
      return;
    }

    const prevMode = this.mode;
    const nextMode = detectVimMode(
      input.cursorStyle,
      input.selection,
      this.cursorStyles,
      (r) => input.lines[r] ?? "",
      input.lines.length,
      prevMode
    );

    if (nextMode !== prevMode) {
      this.mode = nextMode;
      if (nextMode === "insert" && prevMode !== "insert") {
        this.enterInsertMode(
          input.docId,
          input.lines,
          curPos.line + 1,
          curPos.character,
          t
        );
        return;
      }
      if (prevMode === "insert" && nextMode !== "insert") {
        const line = input.lines[curPos.line] ?? "";
        this.leaveInsertMode(
          input.docId,
          input.lines,
          curPos.line + 1,
          clampCol1(line, curPos.character),
          t
        );
        return;
      }
    }

    // Handle Insert mode arrow keys (selection moved without a recent doc change)
    if (this.mode === "insert" && this.insert && prevPos) {
      const movedByDocChange = t - this.lastDocChangeTsMs <= 40;
      if (!movedByDocChange) {
        const dr = curPos.line - prevPos.line;
        const dc = curPos.character - prevPos.character;
        let arrow: string | null = null;
        if (dr === 0 && dc === 1) {
          arrow = "<Right>";
        } else if (dr === 0 && dc === -1) {
          arrow = "<Left>";
        } else if (dr === 1) {
          arrow = "<Down>";
        } else if (dr === -1) {
          arrow = "<Up>";
        }
        if (arrow) {
          this.insert.arrowKeys.push(arrow);
        }
      }
      return;
    }

    if (!input.selection.isEmpty && (this.mode === "visual" || this.mode === "visual-line")) {
      this.handleVisualSelection(input, t);
      return;
    }

    if (input.selection.isEmpty && this.visual) {
      this.recentlyClearedVisual = { session: this.visual, clearedAtMs: t };
      this.visual = null;
      return;
    }

    // Ignore selection ripples caused directly by a Normal-mode document edit
    if (t - this.lastDocChangeTsMs <= 35) {
      return;
    }

    if (this.mode === "normal" && prevPos) {
      this.handleNormalMovement(input, prevPos, curPos, t);
    }
  }

  private handleVisualSelection(input: SelectionChangeInput, t: number): void {
    const sel = input.selection;
    const lines = input.lines;
    const norm = normalizeSelection1(sel, lines);
    const isLinewise =
      this.mode === "visual-line" ||
      isFullLineSelection(sel, (r) => lines[r] ?? "", lines.length);

    if (!this.visual || this.visual.docId !== input.docId) {
      const preNav = this.flushNav(true);
      this.flushXRun();
      this.flushLineOpRun();
      const modeChar: "v" | "V" = isLinewise ? "V" : "v";
      const keys: string[] = [modeChar];

      // Check if selection jumped straight to a text object on first step (e.g. `vi"`, `va(`)
      const sLine = lines[norm.sRow - 1] ?? "";
      if (!isLinewise && norm.sRow === norm.eRow && norm.eCol - norm.sCol >= 1) {
        const q = buf.matchQuoteObject(sLine, norm.sCol, norm.eCol);
        const b = buf.matchBracketObject(lines, norm.sRow, norm.sCol, norm.eRow, norm.eCol, 1, false);
        const w = buf.matchWordObject(sLine, norm.sCol, norm.eCol);
        const obj = q ?? b ?? w;
        if (obj) {
          keys.push(obj[0], obj[1]);
        }
      }

      this.visual = {
        docId: input.docId,
        mode: modeChar,
        anchorRow: norm.anchorRow,
        anchorCol: norm.anchorCol,
        sRow: norm.sRow,
        sCol: norm.sCol,
        eRow: norm.eRow,
        eCol: norm.eCol,
        lastActiveRow: sel.activeLine + 1,
        lastActiveCol: Math.max(1, sel.activeChar),
        keys,
        preNav: preNav && t - preNav.tsMs <= 2000 ? preNav : null,
        lines: lines.slice(),
        totalLines: lines.length,
        lastTsMs: t,
      };
      return;
    }

    const vs = this.visual;
    const activeRow = sel.activeLine + 1;
    const activeCol = Math.max(1, sel.activeChar);
    const dr = activeRow - vs.lastActiveRow;
    const dc = activeCol - vs.lastActiveCol;

    if (dr === 0 && dc === 0 && norm.sRow === vs.sRow && norm.sCol === vs.sCol && norm.eRow === vs.eRow && norm.eCol === vs.eCol) {
      return;
    }

    let stepKey = "l";
    if (isLinewise && vs.mode === "v" && norm.sCol === 1) {
      vs.mode = "V";
    }

    if (dr === 1) {
      stepKey = "j";
    } else if (dr === -1) {
      stepKey = "k";
    } else if (dr === 0 && dc === 1) {
      stepKey = "l";
    } else if (dr === 0 && dc === -1) {
      stepKey = "h";
    } else if (dr === 0 && Math.abs(dc) > 1) {
      const sLine = lines[norm.sRow - 1] ?? "";
      const q = buf.matchQuoteObject(sLine, norm.sCol, norm.eCol);
      const b = buf.matchBracketObject(lines, norm.sRow, norm.sCol, norm.eRow, norm.eCol, 1, false);
      const w = buf.matchWordObject(sLine, norm.sCol, norm.eCol);
      const obj = q ?? b ?? w;
      if (obj && vs.keys.length === 1) {
        vs.keys.push(obj[0], obj[1]);
        stepKey = "";
      } else {
        const wm = buf.bestWordMotion(sLine, vs.lastActiveCol, activeCol, 1);
        if (wm) {
          stepKey = wm.motion;
        } else if (norm.eCol >= buf.lastCharCol(sLine)) {
          stepKey = "$";
        } else if (norm.sCol === 1) {
          stepKey = "0";
        } else {
          stepKey = dc > 0 ? "w" : "b";
        }
      }
    } else if (Math.abs(dr) > 1) {
      stepKey = dr > 0 ? "}" : "{";
    }

    if (stepKey) {
      vs.keys.push(stepKey);
    }

    vs.sRow = norm.sRow;
    vs.sCol = norm.sCol;
    vs.eRow = norm.eRow;
    vs.eCol = norm.eCol;
    vs.lastActiveRow = activeRow;
    vs.lastActiveCol = activeCol;
    vs.lines = lines.slice();
    vs.totalLines = lines.length;
    vs.lastTsMs = t;
  }

  private handleNormalMovement(
    input: SelectionChangeInput,
    prevPos: Pos0,
    curPos: Pos0,
    t: number
  ): void {
    const lines = input.lines;
    const prevRow = prevPos.line + 1;
    const curRow = curPos.line + 1;
    const prevLine = lines[prevRow - 1] ?? "";
    const curLine = lines[curRow - 1] ?? "";
    const prevCol = clampCol1(prevLine, prevPos.character);
    const curCol = clampCol1(curLine, curPos.character);

    if (prevPos.line !== curPos.line || prevPos.character !== curPos.character) {
      this.flushXRun();
      this.flushLineOpRun();
    }

    if (prevRow === curRow && prevCol === curCol) {
      return;
    }

    const dr = curRow - prevRow;
    const dc = curCol - prevCol;
    const sameLine = dr === 0;

    let navKey: string | null = null;
    let isSingleStep = false;

    if (sameLine && Math.abs(dc) === 1) {
      navKey = dc > 0 ? "l" : "h";
      isSingleStep = true;
    } else if (Math.abs(dr) === 1) {
      navKey = dr > 0 ? "j" : "k";
      isSingleStep = true;
    } else if (sameLine && Math.abs(dc) > 1) {
      const firstNb = buf.firstNonBlank(curLine);
      const lastCol = buf.lastCharCol(curLine);
      const matched = buf.findMatchingPair(lines, prevRow, prevCol, 1);

      if (matched && matched.row === curRow && matched.col === curCol && Math.abs(dc) >= 2) {
        this.flushNav(false);
        this.lastJumpOrigin = { row: prevRow, col: prevCol, tsMs: t };
        this.praise("nav_matching_pair");
        this.strictRepeatCount = 0;
        return;
      }

      const wm = buf.bestWordMotion(curLine, prevCol, curCol, 1);
      if (wm) {
        navKey = wm.motion;
      } else if (curCol === 1 && prevCol > 2) {
        navKey = "0";
        this.praise("nav_line_start");
      } else if (curCol === firstNb && prevCol !== firstNb && firstNb > 1 && Math.abs(dc) >= 2) {
        navKey = "^";
        this.praise("nav_line_start");
      } else if (curCol >= lastCol && prevCol < lastCol - 1) {
        navKey = "$";
        this.praise("nav_line_end");
      } else if (Math.abs(dc) >= 3) {
        this.flushNav(false);
        this.praise("nav_find_char");
        this.strictRepeatCount = 0;
        return;
      }
    } else if (!sameLine && Math.abs(dr) >= 2) {
      this.flushNav(false);
      this.strictRepeatCount = 0;

      const absDy = Math.abs(dr);
      const matched = buf.findMatchingPair(lines, prevRow, prevCol, 1);
      if (matched && matched.row === curRow && matched.col === curCol) {
        this.lastJumpOrigin = { row: prevRow, col: prevCol, tsMs: t };
        this.praise("nav_matching_pair");
        return;
      }

      if (this.lastJumpOrigin && this.lastJumpOrigin.row === curRow && t - this.lastJumpOrigin.tsMs <= 12000 && absDy >= 4) {
        this.praise("nav_jumplist");
        return;
      }

      if ((curRow === 1 || curRow === lines.length) && absDy >= 5) {
        this.lastJumpOrigin = { row: prevRow, col: prevCol, tsMs: t };
        this.praise("nav_file_bounds");
        return;
      }

      const pjump = checkParagraphJump(lines, prevRow, curRow, 1);
      if (pjump && pjump.hops === 1 && absDy >= 3) {
        this.lastJumpOrigin = { row: prevRow, col: prevCol, tsMs: t };
        this.praise("nav_paragraph");
        return;
      }

      if (absDy >= 10) {
        this.lastJumpOrigin = { row: prevRow, col: prevCol, tsMs: t };
        this.praise("nav_half_page");
        return;
      }

      if (absDy >= 3) {
        this.praise("nav_vertical_count");
      }
      return;
    }

    if (!navKey) {
      return;
    }

    if (isSingleStep && (navKey === "h" || navKey === "j" || navKey === "k" || navKey === "l")) {
      const blocked = this.checkStrictGuard(navKey, input.docId, prevPos, lines);
      if (blocked) {
        return;
      }
    } else {
      this.strictRepeatCount = 0;
      this.strictLastKey = null;
    }

    const timeout = this.getConfig().thresholds.episodeTimeoutMs || 600;
    if (!this.nav || this.nav.docId !== input.docId || t - this.nav.lastTsMs > timeout) {
      this.flushNav(false);
      this.nav = {
        docId: input.docId,
        startRow: prevRow,
        startCol: prevCol,
        endRow: curRow,
        endCol: curCol,
        keys: [navKey],
        lastTsMs: t,
        lines: lines.slice(),
        totalLines: lines.length,
        winTop: input.visibleTopRow,
        winBot: input.visibleBotRow,
        analyzed: false,
        tsMs: t,
        elapsedMs: 0,
      };
    } else {
      this.nav.keys.push(navKey);
      this.nav.endRow = curRow;
      this.nav.endCol = curCol;
      this.nav.lastTsMs = t;
      this.nav.lines = lines.slice();
      this.nav.totalLines = lines.length;
      this.nav.winTop = input.visibleTopRow;
      this.nav.winBot = input.visibleBotRow;
    }

    this.resetNavTimer();
  }

  public onDocumentChanged(input: DocumentChangeInput): void {
    const cfg = this.getConfig();
    const preLines = this.docLines.get(input.docId) ?? input.postLines.slice();
    this.docLines.set(input.docId, input.postLines.slice());

    if (!cfg.enabled || this.isLanguageDisabled(input.languageId)) {
      return;
    }
    if (input.changes.length === 0) {
      return;
    }
    if (input.reason === "undo" || input.reason === "redo") {
      this.flushXRun();
      this.flushLineOpRun();
      this.visual = null;
      return;
    }

    const t = this.nowMs();
    this.lastDocChangeTsMs = t;

    const vis =
      this.visual ??
      (this.recentlyClearedVisual && t - this.recentlyClearedVisual.clearedAtMs <= 60
        ? this.recentlyClearedVisual.session
        : null);

    if (vis && vis.docId === input.docId) {
      this.visual = null;
      this.recentlyClearedVisual = null;
      this.handleVisualEdit(vis, input.changes, preLines, input.postLines, t);
      return;
    }

    if (this.mode === "insert" && this.insert && this.insert.docId === input.docId) {
      this.handleInsertEdit(input.changes, preLines, input.postLines, t);
      return;
    }

    if (input.changes.length === 1) {
      this.handleNormalEdit(input.changes[0], preLines, input.postLines, t);
    }
  }

  private handleVisualEdit(
    vis: VisualSession,
    changes: TextChangeEvent[],
    preLines: string[],
    postLines: string[],
    t: number
  ): void {
    let op: string | null = null;

    if (changes.length === 1 && changes[0].text === "") {
      op = this.mode === "insert" ? "c" : "d";
    } else if (changes.every((c) => c.rangeLength === 0 && /^[ \t]+$/.test(c.text))) {
      op = ">";
    } else if (
      changes.every(
        (c) =>
          c.text === "" &&
          c.rangeStart.line === c.rangeEnd.line &&
          /^[ \t]+$/.test((preLines[c.rangeStart.line] ?? "").slice(c.rangeStart.character, c.rangeEnd.character))
      )
    ) {
      op = "<";
    } else if (changes.length === 1 && changes[0].rangeStart.line === changes[0].rangeEnd.line) {
      const oldText = (preLines[changes[0].rangeStart.line] ?? "").slice(
        changes[0].rangeStart.character,
        changes[0].rangeEnd.character
      );
      const newText = changes[0].text;
      if (oldText.length > 0 && oldText.length === newText.length && oldText !== newText) {
        if (oldText.toLowerCase() === newText) {
          op = "u";
        } else if (oldText.toUpperCase() === newText) {
          op = "U";
        } else if (oldText.toLowerCase() === newText.toLowerCase()) {
          op = "~";
        }
      }
    }

    if (!op) {
      return;
    }

    const keysWithOp = [...vis.keys, op];
    const minR = Math.max(1, vis.sRow - 2);
    const maxR = Math.min(preLines.length, vis.eRow + 2);
    const slice = preLines.slice(minR - 1, maxR);

    const cands = analyzeVisual(
      {
        visualMode: vis.mode,
        operator: op,
        sRow: vis.sRow,
        sCol: vis.sCol,
        eRow: vis.eRow,
        eCol: vis.eCol,
        anchorRow: vis.anchorRow,
        anchorCol: vis.anchorCol,
        keys: keysWithOp,
        preNav: vis.preNav ? { keys: vis.preNav.keys } : null,
        lines: slice,
        baseRow: minR,
        totalLines: preLines.length,
      },
      this.getConfig()
    );
    this.emit(cands);
    void postLines;
    void t;
  }

  private handleInsertEdit(
    changes: TextChangeEvent[],
    preLines: string[],
    postLines: string[],
    t: number
  ): void {
    const ins = this.insert;
    if (!ins || changes.length !== 1) {
      return;
    }

    const ch = changes[0];
    const cfg = this.getConfig();

    if (ins.arrowKeys.length >= (cfg.thresholds.insertArrowMin || 3)) {
      this.emit(analyzeInsertArrows({ keys: ins.arrowKeys }, cfg));
    }
    ins.arrowKeys = [];

    // Atomic `o` or `O` arrives as a newline edit right after entering Insert mode
    if (t - ins.enteredAtMs <= ATOMIC_CHANGE_WINDOW_MS && ch.rangeLength === 0 && /^\r?\n/.test(ch.text)) {
      const openedAbove = ch.rangeStart.character === 0 && ch.rangeStart.line === ins.beforeRow - 1;
      const openKey = openedAbove ? "O" : "o";
      ins.entryKey = openKey;
      ins.beforeLineCount = postLines.length;
      ins.beforeRow = openKey === "o" ? ins.beforeRow + 1 : ins.beforeRow;

      const entryCands = analyzeInsertEntry(
        {
          insertKey: openKey,
          prevNav: ins.prevNav ? { keys: ins.prevNav.keys, elapsedMs: ins.prevNav.elapsedMs } : null,
          prevDelete: ins.prevDelete,
          line: preLines[ch.rangeStart.line] ?? "",
          row: ch.rangeStart.line + 1,
          col: ch.rangeStart.character + 1,
          totalLines: preLines.length,
        },
        cfg
      );
      if (entryCands.length > 0) {
        this.emit(entryCands);
      } else {
        this.praise("edit_open_line");
      }
      return;
    }

    if (ch.text === "" && ch.rangeLength > 0) {
      const sameLine = ch.rangeStart.line === ch.rangeEnd.line;
      if (sameLine && ch.rangeLength === 1) {
        ins.bsCount += 1;
        if (ins.insertedKeys.length < 80) {
          ins.insertedKeys.push("<BS>");
        }
        return;
      }

      // Multi-char single-line deletion in Insert mode indicates `<C-w>` or `<C-u>`
      if (sameLine && ch.rangeLength >= 3) {
        ins.bsCount = 0;
        if (ch.rangeStart.character === 0 && ch.rangeLength >= 4) {
          this.praise("insert_ctrl_u");
        } else {
          this.praise("insert_ctrl_w");
        }
        return;
      }

      if (!sameLine) {
        if (ins.insertedKeys.length < 80) {
          ins.insertedKeys.push(ch.rangeStart.character === 0 ? "<BS>" : "<Del>");
        }
        return;
      }
    }

    if (ins.bsCount >= (cfg.thresholds.insertBsMin || 4)) {
      this.emit(
        analyzeBackspaceRun(
          {
            count: ins.bsCount,
            clearedToSol: ch.rangeStart.character <= 1,
          },
          cfg
        )
      );
    }
    ins.bsCount = 0;

    if (ch.text.length > 0 && ins.insertedKeys.length < 80) {
      if (/^\r?\n/.test(ch.text)) {
        ins.insertedKeys.push("<CR>");
      } else if (ch.text === "\t") {
        ins.insertedKeys.push("<Tab>");
      } else if (ch.text === " ") {
        ins.insertedKeys.push(" ");
      } else if (ch.text.length === 1) {
        ins.insertedKeys.push(ch.text);
      } else if (/^[ ]+$/.test(ch.text)) {
        // Tab-expanded spaces
        ins.insertedKeys.push("<Tab>");
      } else {
        for (const c of ch.text.slice(0, 30)) {
          if (ins.insertedKeys.length < 80) {
            ins.insertedKeys.push(c);
          }
        }
      }
    }
  }

  private handleNormalEdit(
    change: TextChangeEvent,
    preLines: string[],
    postLines: string[],
    t: number
  ): void {
    const cfg = this.getConfig();
    this.flushNav(false);

    if (change.text === "" && change.rangeLength > 0) {
      const info = classifyNormalDeletion(change, preLines, postLines);
      const row = change.rangeStart.line + 1;
      const col = change.rangeStart.character + 1;

      if (info.praiseRule) {
        this.praise(info.praiseRule);
      }

      this.lastDelete = {
        cmd: info.cmd,
        row,
        col,
        tsMs: t,
        deletedText: info.deletedText,
        deletedWord: info.deletedWord,
        wasLinewise: info.wasLinewise,
      };

      if (info.cmd === "x") {
        this.flushLineOpRun();
        if (this.xRun && this.xRun.row === row && t - this.xRun.lastTsMs <= 1200) {
          this.xRun.count += 1;
          this.xRun.lastTsMs = t;
        } else {
          this.flushXRun();
          this.xRun = {
            key: "x",
            count: 1,
            beforeLine: preLines[row - 1] ?? "",
            startCol: col,
            row,
            lastTsMs: t,
          };
        }
        this.resetRunTimer(1200);
        return;
      }

      this.flushXRun();

      if (info.cmd === "dd") {
        if (this.lineOpRun && this.lineOpRun.op === "dd" && t - this.lineOpRun.lastTsMs <= 1500) {
          this.lineOpRun.count += 1;
          this.lineOpRun.lastTsMs = t;
        } else {
          this.flushLineOpRun();
          this.lineOpRun = { op: "dd", count: 1, lastTsMs: t };
        }
        this.resetRunTimer(1500);
        return;
      }

      this.flushLineOpRun();

      if (info.cmd.length >= 3) {
        const repCands = this.repetition.analyzeEditRepeat(
          {
            signature: "op:" + info.cmd,
            display: info.cmd,
            keyCost: info.cmd.length,
            tsMs: t,
          },
          cfg
        );
        this.emit(repCands);
      }
      return;
    }

    this.flushXRun();
    this.flushLineOpRun();

    if (change.rangeStart.line === change.rangeEnd.line && change.rangeLength === 1 && change.text.length === 1) {
      const preLine = preLines[change.rangeStart.line] ?? "";
      const oldCh = preLine[change.rangeStart.character] ?? "";
      const newCh = change.text;
      if (oldCh && newCh && oldCh !== newCh) {
        if (oldCh.toLowerCase() === newCh.toLowerCase() && /^[A-Za-z]$/.test(oldCh)) {
          this.praise("edit_toggle_case");
        } else {
          this.praise("edit_replace_char");
        }
      }
      return;
    }

    if (change.rangeStart.line === change.rangeEnd.line && change.rangeLength > 0 && change.text.length > 0) {
      const preLine = preLines[change.rangeStart.line] ?? "";
      const oldText = preLine.slice(change.rangeStart.character, change.rangeEnd.character);
      if (/^-?\d+$/.test(oldText) && /^-?\d+$/.test(change.text) && Math.abs(Number(change.text) - Number(oldText)) === 1) {
        this.praise("edit_increment_number");
        return;
      }
    }

    if (preLines.length - postLines.length === 1 && change.rangeEnd.line === change.rangeStart.line + 1) {
      this.praise("edit_join_lines");
      return;
    }

    if (change.rangeStart.character === 0 && change.rangeLength === 0 && /^[ \t]+$/.test(change.text)) {
      this.praise("edit_indent");
    }
  }
}
