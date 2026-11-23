local editing = require("vimcoach.analyzers.editing")
local insert = require("vimcoach.analyzers.insert")
local analyzers = require("vimcoach.analyzers")

return function(t)
  t.test("d$ -> D, c$ -> C, y$ -> Y", function()
    local d = analyzers.pick_best(editing.analyze_operator({ cmd = "d$" }))
    t.ok(d ~= nil)
    t.eq(d.suggested, "D")

    local c = analyzers.pick_best(editing.analyze_operator({ cmd = "c$" }))
    t.ok(c ~= nil)
    t.eq(c.suggested, "C")

    local y = analyzers.pick_best(editing.analyze_operator({ cmd = "y$" }))
    t.ok(y ~= nil)
    t.eq(y.suggested, "Y")
  end)

  t.test("dw + i -> cw, di\" + i -> ci\", dd + O -> cc", function()
    local cw = analyzers.pick_best(editing.analyze_insert_entry({
      insert_key = "i",
      prev_delete = { cmd = "dw", elapsed_ms = 300 },
      line = "hello world",
      row = 1, col = 1, total_lines = 1,
    }))
    t.ok(cw ~= nil)
    t.eq(cw.suggested, "cw")

    local ciq = analyzers.pick_best(editing.analyze_insert_entry({
      insert_key = "i",
      prev_delete = { cmd = 'di"', elapsed_ms = 400 },
      line = 'const s = "";',
      row = 1, col = 12, total_lines = 1,
    }))
    t.ok(ciq ~= nil)
    t.eq(ciq.suggested, 'ci"')

    local cc = analyzers.pick_best(editing.analyze_insert_entry({
      insert_key = "O",
      prev_delete = { cmd = "dd", elapsed_ms = 300 },
      line = "next line",
      row = 1, col = 1, total_lines = 3,
    }))
    t.ok(cc ~= nil)
    t.eq(cc.suggested, "cc")
  end)

  t.test("^i -> I and $a -> A", function()
    local big_i = analyzers.pick_best(editing.analyze_insert_entry({
      insert_key = "i",
      prev_nav = { keys = { "^" }, elapsed_ms = 200 },
      line = "    const x = 1;",
      row = 1, col = 5, total_lines = 1,
    }))
    t.ok(big_i ~= nil)
    t.eq(big_i.suggested, "I")

    local big_a = analyzers.pick_best(editing.analyze_insert_entry({
      insert_key = "a",
      prev_nav = { keys = { "$" }, elapsed_ms = 200 },
      line = "    const x = 1;",
      row = 1, col = 16, total_lines = 1,
    }))
    t.ok(big_a ~= nil)
    t.eq(big_a.suggested, "A")
  end)

  t.test("InsertLeave: xiA<Esc> on 'a' -> ~ (case flip)", function()
    local best = analyzers.pick_best(editing.analyze_insert_leave({
      entry_key = "i",
      prev_delete = { cmd = "x", deleted_text = "a" },
      inserted_keys = { "A" },
      before_line = "apple",
      after_line = "Apple",
      before_row = 1, after_row = 1, before_col = 1,
      before_line_count = 1, after_line_count = 1,
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "edit_toggle_case")
    t.eq(best.suggested, "~")
  end)

  t.test("InsertLeave: ciw43<Esc> replacing 42 -> <C-a>", function()
    local best = analyzers.pick_best(editing.analyze_insert_leave({
      entry_key = "ciw",
      inserted_keys = { "4", "3" },
      before_line = "const n = 42;",
      after_line = "const n = 43;",
      before_row = 1, after_row = 1, before_col = 11,
      before_line_count = 1, after_line_count = 1,
      deleted_word = "42",
      after_word = "43",
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "edit_increment_number")
    t.eq(best.suggested, "<C-a>")
  end)

  t.test("InsertLeave: xiz<Esc> on 'a' -> rz", function()
    local best = analyzers.pick_best(editing.analyze_insert_leave({
      entry_key = "i",
      prev_delete = { cmd = "x", deleted_text = "a" },
      inserted_keys = { "z" },
      before_line = "cat",
      after_line = "czt",
      before_row = 1, after_row = 1, before_col = 2,
      before_line_count = 1, after_line_count = 1,
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "edit_replace_char")
    t.eq(best.suggested, "rz")
  end)

  t.test("InsertLeave: A<CR> -> o", function()
    local best = analyzers.pick_best(editing.analyze_insert_leave({
      entry_key = "A",
      inserted_keys = { "<CR>", "x" },
      before_line = "line 1",
      after_line = "x",
      before_row = 1, after_row = 2, before_col = 6,
      before_line_count = 1, after_line_count = 2,
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "edit_open_line")
    t.eq(best.suggested, "o")
    t.eq(best.keys_saved, 1)
  end)

  t.test("InsertLeave: manual indent I<Space><Space><Esc> -> >>", function()
    local best = analyzers.pick_best(editing.analyze_insert_leave({
      entry_key = "I",
      inserted_keys = { "<Space>", "<Space>" },
      before_line = "return x;",
      after_line = "  return x;",
      before_row = 1, after_row = 1, before_col = 1,
      before_line_count = 1, after_line_count = 1,
    }))
    t.ok(best ~= nil)
    t.eq(best.rule_id, "edit_indent")
    t.eq(best.suggested, ">>")
  end)

  t.test("repeated xxxxx deleting to EOL -> D", function()
    local best = analyzers.pick_best(editing.analyze_repeated_x({
      key = "x",
      count = 5,
      before_line = "hello world",
      start_col = 7,
    }))
    t.ok(best ~= nil)
    t.eq(best.suggested, "D")
  end)

  t.test("insert mode repeated <BS> -> <C-w> / <C-u>", function()
    local cw = analyzers.pick_best(insert.analyze_backspace_run({ count = 6, cleared_to_sol = false }))
    t.ok(cw ~= nil)
    t.eq(cw.suggested, "<C-w>")

    local cu = analyzers.pick_best(insert.analyze_backspace_run({ count = 14, cleared_to_sol = true }))
    t.ok(cu ~= nil)
    t.eq(cu.suggested, "<C-u>")
  end)
end
