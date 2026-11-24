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

export interface BackspaceRunContext {
  count: number;
  clearedToSol: boolean;
}

export function analyzeBackspaceRun(ctx: BackspaceRunContext, config: CoachConfig): Candidate[] {
  const minBs = config.thresholds.insertBsMin || 4;
  if (!ctx || (ctx.count || 0) < minBs) {
    return [];
  }

  const count = ctx.count;
  const actual = `<BS>×${count}`;

  if (ctx.clearedToSol && count >= 10) {
    const c = makeCandidate(
      config,
      "insert_ctrl_u",
      actual,
      "<C-u>",
      count - 1,
      90,
      `Press \`<C-u>\` in Insert mode to clear back to the start of the line instead of ${count} Backspaces.`
    );
    return c ? [c] : [];
  }

  const c = makeCandidate(
    config,
    "insert_ctrl_w",
    actual,
    "<C-w>",
    count - 1,
    88,
    `Press \`<C-w>\` in Insert mode to delete the previous word in 1 chord instead of ${count} Backspaces.`
  );
  return c ? [c] : [];
}

export interface InsertArrowsContext {
  keys: string[];
}

export function analyzeInsertArrows(ctx: InsertArrowsContext, config: CoachConfig): Candidate[] {
  const minArrows = config.thresholds.insertArrowMin || 3;
  if (!ctx || !ctx.keys || ctx.keys.length < minArrows) {
    return [];
  }

  const count = ctx.keys.length;
  const hasVertical = ctx.keys.some((k) => k === "<Up>" || k === "<Down>");
  const actual = `Arrows×${count} (Insert)`;
  const suggested = hasVertical ? "<Esc> + j/k/}" : "<Esc> + b/w/f";
  const c = makeCandidate(
    config,
    "insert_arrows",
    actual,
    suggested,
    Math.max(1, count - 2),
    86,
    "Avoid navigating with arrow keys in Insert mode — press `<Esc>` and use Normal motions (`b`, `w`, `f`, `^`, `$`)."
  );
  return c ? [c] : [];
}
