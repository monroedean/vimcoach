local passed = 0
local failed = 0
local failures = {}

local t = {}

function t.ok(cond, msg)
  if not cond then
    error(msg or "expected truthy value", 2)
  end
end

function t.eq(actual, expected, msg)
  if actual ~= expected then
    error(
      string.format(
        "%sexpected %s, got %s",
        msg and (msg .. ": ") or "",
        vim.inspect(expected),
        vim.inspect(actual)
      ),
      2
    )
  end
end

function t.test(name, fn)
  local ok, err = pcall(fn)
  if ok then
    passed = passed + 1
    io.write(string.format("  [PASS] %s\n", name))
  else
    failed = failed + 1
    failures[#failures + 1] = { name = name, err = err }
    io.write(string.format("  [FAIL] %s\n         %s\n", name, tostring(err)))
  end
end

local root = vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":h")
local suites = {
  "test_buffer_utils.lua",
  "test_visual.lua",
  "test_navigation.lua",
  "test_editing.lua",
  "test_repetition.lua",
}

for _, file in ipairs(suites) do
  io.write("\n== " .. file .. " ==\n")
  local chunk = assert(loadfile(root .. "/" .. file))
  local runner = chunk()
  runner(t)
end

io.write(string.format("\nSummary: %d passed, %d failed\n", passed, failed))
if failed > 0 then
  vim.cmd("cq 1")
else
  vim.cmd("qa!")
end
