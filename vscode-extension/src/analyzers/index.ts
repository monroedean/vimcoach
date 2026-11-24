import { Candidate } from "../types";

export { analyzeNavigation, checkParagraphJump, NavigationContext } from "./navigation";
export { analyzeVisual, VisualContext } from "./visual";
export {
  analyzeOperator,
  analyzeInsertEntry,
  analyzeInsertLeave,
  analyzeRepeatedX,
  OperatorContext,
  InsertEntryContext,
  InsertLeaveContext,
  RepeatedXContext,
  PrevDeleteContext,
} from "./editing";
export {
  RepetitionAnalyzer,
  EditRepeatRecord,
  SearchContext,
  RepeatedLineOpContext,
} from "./repetition";
export {
  analyzeBackspaceRun,
  analyzeInsertArrows,
  BackspaceRunContext,
  InsertArrowsContext,
} from "./insert";

export function pickBest(candidates: Candidate[] | undefined): Candidate | null {
  if (!candidates || candidates.length === 0) {
    return null;
  }

  let best: Candidate | null = null;
  let bestScore = -1;

  for (const c of candidates) {
    const score = (c.priority ?? 50) + Math.min(c.keysSaved ?? 0, 12) * 1.5;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best;
}
