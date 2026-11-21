local nav = require("vimcoach.analyzers.navigation")
local analyzers = require("vimcoach.analyzers")

return function(t)
  t.test("stepping to EOL with lllll -> $", function()
    local line = "const x = 42;"
    local best = analyzers.pick_best(nav.analyze({
      start_row = 1, start_col = 7,
      end_row = 1, end_col = #line,
      keys = { "l", "l", "l", "l", "l", "l" },
      lines = { line },
      base_row = 1,
      total_lines = 1,
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "nav_line_end")
    t.eq(best.suggested, "$")
  end)

  t.test("stepping to first non-blank with hhhh -> ^", function()
    local line = "    return value;"
    local best = analyzers.pick_best(nav.analyze({
      start_row = 1, start_col = 12,
      end_row = 1, end_col = 5,
      keys = { "h", "h", "h", "h", "h", "h", "h" },
      lines = { line },
      base_row = 1,
      total_lines = 1,
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "nav_line_start")
    t.eq(best.suggested, "^")
  end)

  t.test("stepping onto distinctive char with llllll -> f(", function()
    local line = "const result = compute(a, b);"
    local best = analyzers.pick_best(nav.analyze({
      start_row = 1, start_col = 16,
      end_row = 1, end_col = 23,
      keys = { "l", "l", "l", "l", "l", "l", "l" },
      lines = { line },
      base_row = 1,
      total_lines = 1,
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "nav_find_char")
    t.eq(best.suggested, "f(")
  end)

  t.test("stepping from open paren to matching close paren -> %", function()
    local line = "call(foo, bar, baz)"
    local best = analyzers.pick_best(nav.analyze({
      start_row = 1, start_col = 5,
      end_row = 1, end_col = 19,
      keys = { "w", "w", "w", "w", "w", "l" },
      lines = { line },
      base_row = 1,
      total_lines = 1,
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "nav_matching_pair")
    t.eq(best.suggested, "%")
  end)

  t.test("repeating identical f,f, -> f,;", function()
    local line = "fn(a, b, c, d)"
    local best = analyzers.pick_best(nav.analyze({
      start_row = 1, start_col = 1,
      end_row = 1, end_col = 8,
      keys = { "f", ",", "f", "," },
      lines = { line },
      base_row = 1,
      total_lines = 1,
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "nav_repeat_find")
    t.eq(best.suggested, "f,;")
  end)

  t.test("vertical jjjjjj to blank line -> }", function()
    local lines = {
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "line 5",
      "",
      "next para",
    }
    local best = analyzers.pick_best(nav.analyze({
      start_row = 1, start_col = 1,
      end_row = 6, end_col = 1,
      keys = { "j", "j", "j", "j", "j" },
      lines = lines,
      base_row = 1,
      total_lines = 7,
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "nav_paragraph")
    t.eq(best.suggested, "}")
  end)

  t.test("jjj (only 3 lines) is NOT nagged as overly niche", function()
    local lines = { "a", "b", "c", "d", "e" }
    local cands = nav.analyze({
      start_row = 1, start_col = 1,
      end_row = 4, end_col = 1,
      keys = { "j", "j", "j" },
      lines = lines,
      base_row = 1,
      total_lines = 5,
    })
    t.eq(#cands, 0)
  end)

  t.test("jjjjj (6 lines inside continuous block) -> 6j", function()
    local lines = { "1", "2", "3", "4", "5", "6", "7", "8", "9" }
    local best = analyzers.pick_best(nav.analyze({
      start_row = 1, start_col = 1,
      end_row = 7, end_col = 1,
      keys = { "j", "j", "j", "j", "j", "j" },
      lines = lines,
      base_row = 1,
      total_lines = 9,
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "nav_vertical_count")
    t.eq(best.suggested, "6j")
  end)

  t.test("fidgeting back to start position returns no hints", function()
    local cands = nav.analyze({
      start_row = 1, start_col = 5,
      end_row = 1, end_col = 5,
      keys = { "l", "l", "h", "h" },
      lines = { "hello world" },
      base_row = 1,
      total_lines = 1,
    })
    t.eq(#cands, 0)
  end)
end
