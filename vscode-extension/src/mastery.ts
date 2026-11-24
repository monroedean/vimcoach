import * as fs from "fs";
import * as path from "path";
import { CATEGORY_LABELS, CATEGORY_ORDER, getRuleMeta, RULES } from "./catalog";
import {
  Candidate,
  CategoryStat,
  CoachConfig,
  HabitStat,
  MasteryState,
  SkillStat,
  StatsSummary,
} from "./types";

const MAX_HISTORY = 60;

function newEmptyState(): MasteryState {
  return {
    version: 1,
    total_hints: 0,
    total_keys_saved: 0,
    total_good_motions: 0,
    skills: {},
    history: [],
  };
}

export class MasteryStore {
  public state: MasteryState = newEmptyState();
  public session = {
    started_at: Math.floor(Date.now() / 1000),
    hints: 0,
    keys_saved: 0,
    good_motions: 0,
  };

  private lastGlobalHintMs = 0;
  private lastRuleHintMs: Record<string, number> = {};
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private loaded = false;

  constructor(
    private readonly statsPath: string | null,
    private readonly getConfig: () => CoachConfig,
    private readonly nowMs: () => number = () => Date.now()
  ) {}

  private ensureSkill(ruleId: string): SkillStat {
    if (!this.state.skills[ruleId]) {
      this.state.skills[ruleId] = {
        missed: 0,
        used: 0,
        keys_saved: 0,
        last_missed: 0,
      };
    }
    return this.state.skills[ruleId];
  }

  public load(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;

    const cfg = this.getConfig();
    if (!cfg.trackStats || !this.statsPath) {
      return;
    }

    try {
      if (!fs.existsSync(this.statsPath)) {
        return;
      }
      const raw = fs.readFileSync(this.statsPath, "utf8");
      if (!raw) {
        return;
      }
      const decoded = JSON.parse(raw) as Partial<MasteryState>;
      if (decoded && typeof decoded === "object" && decoded.skills && typeof decoded.skills === "object") {
        this.state = {
          ...newEmptyState(),
          ...decoded,
          skills: { ...decoded.skills },
          history: Array.isArray(decoded.history) ? decoded.history.slice(0, MAX_HISTORY) : [],
        };
      }
    } catch {
      // Ignore corrupted or inaccessible stats file
    }
  }

  public saveNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.dirty = false;

    const cfg = this.getConfig();
    if (!cfg.trackStats || !this.statsPath) {
      return;
    }

    try {
      const dir = path.dirname(this.statsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.statsPath, JSON.stringify(this.state), "utf8");
    } catch {
      // Ignore write failures
    }
  }

  private scheduleSave(): void {
    const cfg = this.getConfig();
    if (!cfg.trackStats || !this.statsPath) {
      return;
    }
    this.dirty = true;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.saveNow();
    }, 1500);
  }

  public dispose(): void {
    if (this.dirty) {
      this.saveNow();
    } else if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  public getSkillMastery(ruleId: string): number | null {
    const stat = this.state.skills[ruleId];
    if (!stat || stat.used + stat.missed === 0) {
      return null;
    }
    const score = ((stat.used + 1) / (stat.used + stat.missed + 2)) * 100;
    return Math.floor(score + 0.5);
  }

  public getFluencyScore(): number {
    let totalUsed = 0;
    let totalMissed = 0;
    for (const stat of Object.values(this.state.skills)) {
      totalUsed += stat.used || 0;
      totalMissed += stat.missed || 0;
    }
    if (totalUsed + totalMissed === 0) {
      return 100;
    }
    return Math.floor((totalUsed / (totalUsed + totalMissed)) * 100 + 0.5);
  }

  public canNotify(ruleId: string, force = false): boolean {
    if (force) {
      return true;
    }
    const cfg = this.getConfig();
    const t = this.nowMs();
    if (t - this.lastGlobalHintMs < cfg.cooldownMs) {
      return false;
    }

    let ruleCd = cfg.ruleCooldownMs;
    const stat = this.state.skills[ruleId];
    const mastery = this.getSkillMastery(ruleId);
    if (mastery !== null && mastery >= 85 && stat && stat.used >= 10) {
      ruleCd = Math.floor(ruleCd * (cfg.masteryCooldownMultiplier || 3.0));
    }

    const prev = this.lastRuleHintMs[ruleId] || 0;
    if (t - prev < ruleCd) {
      return false;
    }

    return true;
  }

  public recordMiss(suggestion: Candidate): void {
    this.load();
    const t = this.nowMs();
    this.lastGlobalHintMs = t;
    this.lastRuleHintMs[suggestion.ruleId] = t;

    const saved = suggestion.keysSaved || 1;
    const stat = this.ensureSkill(suggestion.ruleId);
    stat.missed += 1;
    stat.keys_saved += saved;
    stat.last_missed = Math.floor(Date.now() / 1000);

    this.state.total_hints += 1;
    this.state.total_keys_saved += saved;

    this.session.hints += 1;
    this.session.keys_saved += saved;

    this.state.history.unshift({
      ts: Math.floor(Date.now() / 1000),
      rule_id: suggestion.ruleId,
      actual: suggestion.actual || "",
      suggested: suggestion.suggested || "",
      keys_saved: saved,
      reason: suggestion.reason || "",
    });
    while (this.state.history.length > MAX_HISTORY) {
      this.state.history.pop();
    }

    this.scheduleSave();
  }

  public recordGood(ruleId: string): void {
    this.load();
    if (!RULES[ruleId]) {
      return;
    }
    const stat = this.ensureSkill(ruleId);
    stat.used += 1;
    this.state.total_good_motions += 1;
    this.session.good_motions += 1;
    this.scheduleSave();
  }

  public getMissCount(ruleId: string): number {
    return this.state.skills[ruleId]?.missed ?? 0;
  }

  public getTopHabits(limit = 10): HabitStat[] {
    this.load();
    const items: HabitStat[] = [];
    for (const [ruleId, stat] of Object.entries(this.state.skills)) {
      if (stat.missed > 0) {
        const meta = getRuleMeta(ruleId);
        items.push({
          rule_id: ruleId,
          title: meta?.title ?? ruleId,
          shortcut: meta?.shortcut ?? "",
          category: meta?.category ?? "editing",
          missed: stat.missed,
          used: stat.used,
          keys_saved: stat.keys_saved,
          mastery: this.getSkillMastery(ruleId) ?? 0,
        });
      }
    }

    items.sort((a, b) => {
      if (a.missed !== b.missed) {
        return b.missed - a.missed;
      }
      return b.keys_saved - a.keys_saved;
    });

    return items.slice(0, limit);
  }

  public getSummary(): StatsSummary {
    this.load();
    const cfg = this.getConfig();

    const categories: Record<string, CategoryStat> = {};
    for (const cat of CATEGORY_ORDER) {
      categories[cat] = {
        id: cat,
        label: CATEGORY_LABELS[cat] ?? cat,
        used: 0,
        missed: 0,
        keys_saved: 0,
        skills: [],
      };
    }

    for (const [ruleId, meta] of Object.entries(RULES)) {
      const stat = this.state.skills[ruleId] ?? { missed: 0, used: 0, keys_saved: 0 };
      const catEntry = categories[meta.category];
      if (catEntry) {
        catEntry.used += stat.used;
        catEntry.missed += stat.missed;
        catEntry.keys_saved += stat.keys_saved;
        if (stat.used > 0 || stat.missed > 0) {
          catEntry.skills.push({
            id: ruleId,
            title: meta.title,
            shortcut: meta.shortcut,
            used: stat.used,
            missed: stat.missed,
            keys_saved: stat.keys_saved,
            mastery: this.getSkillMastery(ruleId) ?? 0,
          });
        }
      }
    }

    const catList: CategoryStat[] = [];
    for (const cat of CATEGORY_ORDER) {
      const c = categories[cat];
      c.skills.sort((a, b) => a.mastery - b.mastery);
      const total = c.used + c.missed;
      c.mastery = total > 0 ? Math.floor((c.used / total) * 100 + 0.5) : undefined;
      catList.push(c);
    }

    return {
      fluency: this.getFluencyScore(),
      total_hints: this.state.total_hints,
      total_keys_saved: this.state.total_keys_saved,
      total_good_motions: this.state.total_good_motions,
      session: { ...this.session },
      top_habits: this.getTopHabits(10),
      categories: catList,
      history: [...this.state.history],
      mode: cfg.mode,
      enabled: cfg.enabled,
    };
  }

  public reset(): void {
    this.state = newEmptyState();
    this.session = {
      started_at: Math.floor(Date.now() / 1000),
      hints: 0,
      keys_saved: 0,
      good_motions: 0,
    };
    this.lastGlobalHintMs = 0;
    this.lastRuleHintMs = {};
    this.saveNow();
  }
}
