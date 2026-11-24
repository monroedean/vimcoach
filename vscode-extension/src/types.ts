export type CoachMode = "coach" | "strict" | "adaptive";

export type HintStyle = "inline_and_status" | "inline" | "status_bar" | "toast";

export type VimMode = "normal" | "insert" | "visual" | "visual-line" | "replace";

export interface CoachThresholds {
  minKeysSaved: number;
  verticalCountMin: number;
  verticalPageMin: number;
  horizontalStepMin: number;
  wordStepMin: number;
  repeatXMin: number;
  repeatLineOpMin: number;
  insertBsMin: number;
  insertArrowMin: number;
  episodeTimeoutMs: number;
  comboWindowMs: number;
  dotRepeatWindowMs: number;
}

export interface StrictConfig {
  maxCount: number;
  maxTimeMs: number;
  allowDifferentKey: boolean;
}

export interface CoachConfig {
  enabled: boolean;
  mode: CoachMode;
  adaptiveStrictMisses: number;
  onlyWhenVSCodeVimActive: boolean;
  cooldownMs: number;
  ruleCooldownMs: number;
  masteryCooldownMultiplier: number;
  assumeNvimY: boolean;
  practicalOnly: boolean;
  trackStats: boolean;
  style: HintStyle;
  durationMs: number;
  disabledRules: Record<string, boolean>;
  disabledLanguages: Record<string, boolean>;
  thresholds: CoachThresholds;
  strict: StrictConfig;
}

export const DEFAULT_CONFIG: CoachConfig = {
  enabled: true,
  mode: "coach",
  adaptiveStrictMisses: 8,
  onlyWhenVSCodeVimActive: true,
  cooldownMs: 0,
  ruleCooldownMs: 0,
  masteryCooldownMultiplier: 1.0,
  assumeNvimY: false,
  practicalOnly: true,
  trackStats: true,
  style: "inline_and_status",
  durationMs: 4500,
  disabledRules: {},
  disabledLanguages: {
    Log: true,
    output: true,
    scminput: true,
    "git-commit": true,
  },
  thresholds: {
    minKeysSaved: 1,
    verticalCountMin: 4,
    verticalPageMin: 15,
    horizontalStepMin: 4,
    wordStepMin: 5,
    repeatXMin: 3,
    repeatLineOpMin: 4,
    insertBsMin: 4,
    insertArrowMin: 3,
    episodeTimeoutMs: 600,
    comboWindowMs: 1600,
    dotRepeatWindowMs: 25000,
  },
  strict: {
    maxCount: 4,
    maxTimeMs: 1200,
    allowDifferentKey: true,
  },
};

export function createConfig(overrides?: Partial<CoachConfig>): CoachConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    disabledRules: {
      ...DEFAULT_CONFIG.disabledRules,
      ...(overrides?.disabledRules ?? {}),
    },
    disabledLanguages: {
      ...DEFAULT_CONFIG.disabledLanguages,
      ...(overrides?.disabledLanguages ?? {}),
    },
    thresholds: {
      ...DEFAULT_CONFIG.thresholds,
      ...(overrides?.thresholds ?? {}),
    },
    strict: {
      ...DEFAULT_CONFIG.strict,
      ...(overrides?.strict ?? {}),
    },
  };
}

export function isRuleEnabled(config: CoachConfig, ruleId: string): boolean {
  return !config.disabledRules[ruleId];
}

export interface Candidate {
  ruleId: string;
  actual: string;
  suggested: string;
  keysSaved: number;
  priority: number;
  reason: string;
  isStrictBlock?: boolean;
}

export interface HintPayload {
  rule_id: string;
  title: string;
  category: string;
  actual: string;
  suggested: string;
  keys_saved: number;
  reason: string;
  is_strict_block?: boolean;
  fluency?: number;
  total_keys_saved?: number;
  session_keys_saved?: number;
  mode?: CoachMode;
}

export interface SkillStat {
  missed: number;
  used: number;
  keys_saved: number;
  last_missed: number;
}

export interface HistoryItem {
  ts: number;
  rule_id: string;
  actual: string;
  suggested: string;
  keys_saved: number;
  reason: string;
}

export interface MasteryState {
  version: number;
  total_hints: number;
  total_keys_saved: number;
  total_good_motions: number;
  skills: Record<string, SkillStat>;
  history: HistoryItem[];
}

export interface HabitStat {
  rule_id: string;
  title: string;
  shortcut: string;
  category: string;
  missed: number;
  used: number;
  keys_saved: number;
  mastery: number;
}

export interface CategoryStat {
  id: string;
  label: string;
  used: number;
  missed: number;
  keys_saved: number;
  mastery?: number;
  skills: Array<{
    id: string;
    title: string;
    shortcut: string;
    used: number;
    missed: number;
    keys_saved: number;
    mastery: number;
  }>;
}

export interface StatsSummary {
  fluency: number;
  total_hints: number;
  total_keys_saved: number;
  total_good_motions: number;
  session: {
    started_at: number;
    hints: number;
    keys_saved: number;
    good_motions: number;
  };
  top_habits: HabitStat[];
  categories: CategoryStat[];
  history: HistoryItem[];
  mode: CoachMode;
  enabled: boolean;
}
