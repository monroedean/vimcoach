local visual = require("vimcoach.analyzers.visual")
local analyzers = require("vimcoach.analyzers")

return function(t)
  t.test("visually stepping inside quotes -> di\"", function()
    local line = 'const msg = "hello";'
    local best = analyzers.pick_best(visual.analyze({
      visual_mode = "v",
      operator = "d",
      s_row = 1, s_col = 14,
      e_row = 1, e_col = 18,
      anchor_row = 1, anchor_col = 14,
      keys = { "v", "l", "l", "l", "l", "d" },
      lines = { line },
      base_row = 1,
      total_lines = 1,
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "textobj_quotes")
    t.eq(best.suggested, 'di"')
  end)

  t.test("visually stepping inside parentheses -> ci(", function()
    local line = "compute(alpha, beta)"
    local best = analyzers.pick_best(visual.analyze({
      visual_mode = "v",
      operator = "c",
      s_row = 1, s_col = 9,
      e_row = 1, e_col = 19,
      anchor_row = 1, anchor_col = 9,
      keys = { "v", "w", "w", "e", "c" },
      lines = { line },
      base_row = 1,
      total_lines = 1,
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "textobj_brackets")
    t.eq(best.suggested, "ci(")
  end)

  t.test("visually selecting inside HTML tag -> cit", function()
    local line = "<button>Submit Form</button>"
    local best = analyzers.pick_best(visual.analyze({
      visual_mode = "v",
      operator = "c",
      s_row = 1, s_col = 9,
      e_row = 1, e_col = 19,
      anchor_row = 1, anchor_col = 9,
      keys = { "v", "w", "e", "c" },
      lines = { line },
      base_row = 1,
      total_lines = 1,
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "textobj_tag")
    t.eq(best.suggested, "cit")
  end)

  t.test("visual line inside multiline braces -> di{", function()
    local lines = {
      "if (ok) {",
      "  doThing();",
      "  finish();",
      "}",
    }
    local best = analyzers.pick_best(visual.analyze({
      visual_mode = "V",
      operator = "d",
      s_row = 2, s_col = 1,
      e_row = 3, e_col = 11,
      anchor_row = 2, anchor_col = 1,
      keys = { "V", "j", "d" },
      lines = lines,
      base_row = 1,
      total_lines = 4,
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "textobj_brackets")
    t.eq(best.suggested, "di{")
  end)

  t.test("visual line paragraph selection -> dip", function()
    local lines = {
      "top",
      "",
      "para 1",
      "para 2",
      "para 3",
      "",
      "bottom",
    }
    local best = analyzers.pick_best(visual.analyze({
      visual_mode = "V",
      operator = "d",
      s_row = 3, s_col = 1,
      e_row = 5, e_col = 6,
      anchor_row = 3, anchor_col = 1,
      keys = { "V", "j", "j", "d" },
      lines = lines,
      base_row = 1,
      total_lines = 7,
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "textobj_paragraph")
    t.eq(best.suggested, "dip")
  end)

  t.test("visual to end of line -> D / C", function()
    local line = "const x = compute(a, b);"
    local best = analyzers.pick_best(visual.analyze({
      visual_mode = "v",
      operator = "d",
      s_row = 1, s_col = 11,
      e_row = 1, e_col = #line,
      anchor_row = 1, anchor_col = 11,
      keys = { "v", "$", "d" },
      lines = { line },
      base_row = 1,
      total_lines = 1,
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "visual_to_eol")
    t.eq(best.suggested, "D")
  end)

  t.test("unnecessary visual mode around text object: vi\"d -> di\"", function()
    local line = 'print("hi")'
    local best = analyzers.pick_best(visual.analyze({
      visual_mode = "v",
      operator = "d",
      s_row = 1, s_col = 8,
      e_row = 1, e_col = 9,
      anchor_row = 1, anchor_col = 8,
      keys = { "v", "i", '"', "d" },
      lines = { line },
      base_row = 1,
      total_lines = 1,
    }))
    t.ok(best ~= nil)
    t.eq(best.suggested, 'di"')
  end)

  t.test("visual single line Vd -> dd", function()
    local best = analyzers.pick_best(visual.analyze({
      visual_mode = "V",
      operator = "d",
      s_row = 1, s_col = 1,
      e_row = 1, e_col = 10,
      anchor_row = 1, anchor_col = 1,
      keys = { "V", "d" },
      lines = { "const a = 1;" },
      base_row = 1,
      total_lines = 1,
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "visual_whole_line")
    t.eq(best.suggested, "dd")
  end)

  t.test("blockwise visual <C-v> is NOT nagged", function()
    local cands = visual.analyze({
      visual_mode = "\22",
      operator = "d",
      s_row = 1, s_col = 1,
      e_row = 3, e_col = 3,
      anchor_row = 1, anchor_col = 1,
      keys = { "<C-v>", "j", "j", "d" },
      lines = { "aaa", "bbb", "ccc" },
      base_row = 1,
      total_lines = 3,
    })
    t.eq(#cands, 0)
  end)
end
