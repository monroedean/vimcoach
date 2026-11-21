local rep = require("vimcoach.analyzers.repetition")
local mastery = require("vimcoach.mastery")
local analyzers = require("vimcoach.analyzers")

return function(t)
  t.test("repeated manual edit -> dot repeat (.)", function()
    rep.reset()
    local first = rep.analyze_edit_repeat({
      signature = "ciw:userId",
      display = "ciwuserId<Esc>",
      key_cost = 10,
      ts_ms = 1000,
      after_search_next = false,
      replacement = "userId",
    })
    t.eq(#first, 0)

    local second = analyzers.pick_best(rep.analyze_edit_repeat({
      signature = "ciw:userId",
      display = "ciwuserId<Esc>",
      key_cost = 10,
      ts_ms = 4000,
      after_search_next = false,
      replacement = "userId",
    }))
    t.ok(second ~= nil)
    t.eq(second.rule_id, "rep_dot")
    t.eq(second.suggested, ".")
  end)

  t.test("repeated manual change after search `n` -> cgn + .", function()
    rep.reset()
    rep.analyze_edit_repeat({
      signature = "ciw:newName",
      display = "ciwnewName<Esc>",
      key_cost = 11,
      ts_ms = 1000,
      after_search_next = false,
      replacement = "newName",
    })
    local second = analyzers.pick_best(rep.analyze_edit_repeat({
      signature = "ciw:newName",
      display = "ciwnewName<Esc>",
      key_cost = 11,
      ts_ms = 3500,
      after_search_next = true,
      replacement = "newName",
    }))
    t.ok(second ~= nil)
    t.eq(second.rule_id, "rep_cgn")
    t.ok(second.suggested:find("cgnnewName", 1, true) ~= nil)
  end)

  t.test("searching exact word under cursor with / -> *", function()
    local best = analyzers.pick_best(rep.analyze_search({
      cmdtype = "/",
      pattern = "handleClick",
      cword = "handleClick",
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "rep_star_search")
    t.eq(best.suggested, "*")

    local back = analyzers.pick_best(rep.analyze_search({
      cmdtype = "?",
      pattern = "handleClick",
      cword = "handleClick",
    }))
    t.ok(back ~= nil)
    t.eq(back.suggested, "#")
  end)

  t.test("repeated dd -> {N}dd", function()
    local best = analyzers.pick_best(rep.analyze_repeated_line_op({
      op = "dd",
      count = 5,
    }))
    t.ok(best ~= nil)
    t.eq(best.suggested, "5dd")
  end)

  t.test("mastery scoring rises with good motions and tracks top habits", function()
    local cfg = require("vimcoach.config")
    cfg.setup({ track_stats = false })
    mastery.reset()

    mastery.record_miss({ rule_id = "textobj_quotes", actual = "vlllld", suggested = 'di"', keys_saved = 3, reason = "test" })
    mastery.record_miss({ rule_id = "textobj_quotes", actual = "vlllld", suggested = 'di"', keys_saved = 3, reason = "test" })
    local low = mastery.get_skill_mastery("textobj_quotes")
    t.ok(low ~= nil and low < 50)

    for _ = 1, 10 do
      mastery.record_good("textobj_quotes")
    end
    local high = mastery.get_skill_mastery("textobj_quotes")
    t.ok(high ~= nil and high > 75)

    local top = mastery.get_top_habits(5)
    t.eq(top[1].rule_id, "textobj_quotes")
  end)
end
