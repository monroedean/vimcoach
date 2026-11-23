local buf = require("vimcoach.buffer_utils")

return function(t)
  t.test("match_quote_object detects inner and around quotes", function()
    local line = 'const greeting = "hello world";'
    -- "hello world" -> open at 18, close at 30
    t.eq(buf.match_quote_object(line, 19, 29), 'i"')
    t.eq(buf.match_quote_object(line, 18, 30), 'a"')
    -- Partial slice inside quotes should NOT match
    t.eq(buf.match_quote_object(line, 19, 23), nil)
  end)

  t.test("match_quote_object does NOT misclassify space between two separate strings", function()
    local line = 'const x = "foo" + "bar";'
    -- " + " is between closing quote of "foo" (15) and opening quote of "bar" (19)
    t.eq(buf.match_quote_object(line, 16, 18), nil)
  end)

  t.test("match_quote_object handles escaped quotes", function()
    local line = 'const s = "say \\"hi\\"";'
    t.eq(buf.match_quote_object(line, 12, 21), 'i"')
  end)

  t.test("match_bracket_object handles nested single-line and multi-line blocks", function()
    local line = "fn(foo(bar), baz)"
    -- inner outer parens: cols 4..16
    t.eq(buf.match_bracket_object({ line }, 1, 4, 1, 16, 1, false), "i(")
    t.eq(buf.match_bracket_object({ line }, 1, 3, 1, 17, 1, false), "a(")
    -- inner nested parens: bar at 8..10
    t.eq(buf.match_bracket_object({ line }, 1, 8, 1, 10, 1, false), "i(")

    local block = {
      "function test() {",
      "  const a = 1;",
      "  return a;",
      "}",
    }
    -- Linewise inside `{ ... }`: rows 2..3
    t.eq(buf.match_bracket_object(block, 2, 1, 3, 11, 1, true), "i{")
  end)

  t.test("match_tag_object detects inline and multi-line HTML tags", function()
    local line = '<div class="card">hello world</div>'
    t.eq(buf.match_tag_object({ line }, 1, 19, 1, 29, 1), "it")
    t.eq(buf.match_tag_object({ line }, 1, 1, 1, #line, 1), "at")
  end)

  t.test("match_word_object detects iw, aw, iW", function()
    local line = "local foo_bar = baz.qux();"
    t.eq(buf.match_word_object(line, 7, 13), "iw")
    t.eq(buf.match_word_object(line, 7, 14), "aw")
    t.eq(buf.match_word_object(line, 17, 26), "iW")
  end)

  t.test("match_paragraph_object detects ip and ap", function()
    local lines = {
      "first block line 1",
      "first block line 2",
      "",
      "second block line 1",
      "second block line 2",
      "second block line 3",
      "",
      "third block",
    }
    t.eq(buf.match_paragraph_object(lines, 4, 6, 1, #lines), "ip")
    t.eq(buf.match_paragraph_object(lines, 4, 7, 1, #lines), "ap")
    -- Single line should NOT trigger paragraph
    t.eq(buf.match_paragraph_object(lines, 8, 8, 1, #lines), nil)
  end)

  t.test("best_char_find picks practical 1st occurrence and rejects golfy >2 occurrences", function()
    local line = "const value = compute(alpha, beta);"
    -- col 1 -> '(' at col 22 (1st occurrence, distinctive!)
    local cf = buf.best_char_find(line, 1, 22, true)
    t.ok(cf ~= nil)
    t.eq(cf.motion, "f(")

    -- Repeated 'e' 4 times -> should NOT suggest 4fe
    local repeated = "eeeeeeeeeeee"
    t.eq(buf.best_char_find(repeated, 1, 6, true), nil)
  end)

  t.test("best_char_find prefers t<delimiter> over f<letter> right before a delimiter", function()
    local line = "local bar(baz)"
    -- col 1 -> 'r' at col 9 (1st occurrence of 'r', directly before '(')
    local cf = buf.best_char_find(line, 1, 9, true)
    t.ok(cf ~= nil)
    t.eq(cf.motion, "t(")
  end)
end
