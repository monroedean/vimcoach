import { Candidate, CoachConfig, isRuleEnabled } from "../types";

export interface EditRepeatRecord {
  signature: string;
  display: string;
  keyCost: number;
  tsMs: number;
  afterSearchNext?: boolean;
  replacement?: string;
}

export interface SearchContext {
  cmdtype: "/" | "?";
  pattern: string;
  cword: string;
}

export interface RepeatedLineOpContext {
  op: "dd" | "yy";
  count: number;
}

const MAX_RECENT = 10;

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

export class RepetitionAnalyzer {
  private recentEdits: EditRepeatRecord[] = [];

  public reset(): void {
    this.recentEdits = [];
  }

  public analyzeEditRepeat(record: EditRepeatRecord, config: CoachConfig): Candidate[] {
    if (!record || !record.signature || (record.keyCost || 0) < 3) {
      return [];
    }

    const now = record.tsMs || 0;
    const windowMs = config.thresholds.dotRepeatWindowMs || 25000;
    const candidates: Candidate[] = [];

    this.recentEdits = this.recentEdits.filter((e) => now - e.tsMs <= windowMs);

    let match: EditRepeatRecord | null = null;
    for (let i = this.recentEdits.length - 1; i >= 0; i--) {
      if (this.recentEdits[i].signature === record.signature) {
        match = this.recentEdits[i];
        break;
      }
    }

    this.recentEdits.push(record);
    while (this.recentEdits.length > MAX_RECENT) {
      this.recentEdits.shift();
    }

    if (match) {
      const alreadyCgn =
        record.signature.startsWith("cgn") || record.signature.startsWith("cgN");
      if (!alreadyCgn && record.afterSearchNext && record.replacement && record.replacement.length >= 1) {
        const cgnCmd = `cgn${record.replacement}<Esc> then .`;
        const c = makeCandidate(
          config,
          "rep_cgn",
          `${record.display} (again after n)`,
          cgnCmd,
          Math.max(2, record.keyCost - 1),
          96,
          `After \`*\` or \`/\`, use \`cgn${record.replacement}<Esc>\` once, then just tap \`.\` to jump-and-replace each next match!`
        );
        if (c) {
          candidates.push(c);
          return candidates;
        }
      }

      const c = makeCandidate(
        config,
        "rep_dot",
        `${record.display} (repeated)`,
        ".",
        record.keyCost - 1,
        92,
        `You just repeated \`${record.display}\` manually — press \`.\` to replay your last edit in 1 key!`
      );
      if (c) {
        candidates.push(c);
      }
    }

    return candidates;
  }

  public analyzeSearch(ctx: SearchContext, config: CoachConfig): Candidate[] {
    if (!ctx || !ctx.pattern || !ctx.cword) {
      return [];
    }
    const pat = ctx.pattern;
    const cword = ctx.cword;
    const cleanPat = pat.replace(/^\\</, "").replace(/\\>$/, "");

    if (cword.length >= 2 && cleanPat === cword) {
      const cmd = ctx.cmdtype === "?" ? "#" : "*";
      const actual = `${ctx.cmdtype}${pat}<CR>`;
      const saved = pat.length + 2 - 1;
      const c = makeCandidate(
        config,
        "rep_star_search",
        actual,
        cmd,
        saved,
        93,
        `Press \`${cmd}\` to search for the word under your cursor (\`${cword}\`) in 1 key!`
      );
      if (c) {
        return [c];
      }
    }

    return [];
  }

  public analyzeRepeatedLineOp(ctx: RepeatedLineOpContext, config: CoachConfig): Candidate[] {
    const minRep = config.thresholds.repeatLineOpMin || 4;
    if (!ctx || (ctx.count || 0) < minRep) {
      return [];
    }

    const op = ctx.op;
    const count = ctx.count;
    const actual = `${op}×${count}`;
    const suggested = `${count}${op}`;
    const alt = op === "dd" ? "dip" : "yip";
    const saved = count * 2 - suggested.length;

    const c = makeCandidate(
      config,
      "rep_line_ops",
      actual,
      suggested,
      saved,
      85,
      `Use \`${suggested}\` (or \`${alt}\` for a whole block) instead of pressing \`${op}\` ${count} times.`
    );
    return c ? [c] : [];
  }
}
