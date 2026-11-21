local config = require("vimcoach.config")
local catalog = require("vimcoach.catalog")
local mastery = require("vimcoach.mastery")

local M = {}

local last_bridge_status = "uninitialized"

---Return true when running inside VS Code via vscode-neovim.
---@return boolean
function M.is_vscode()
  return vim.g.vscode ~= nil and config.options.vscode.enabled
end

---Safely load the vscode-neovim Lua module.
---@return table|nil
local function get_vscode()
  local ok, vscode = pcall(require, "vscode")
  if ok and type(vscode) == "table" then
    return vscode
  end
  local ok2, vscode2 = pcall(require, "vscode-neovim")
  if ok2 and type(vscode2) == "table" then
    return vscode2
  end
  return nil
end

---Persist a tiny diagnostic snapshot so VS Code bridge issues are trivially inspectable.
---@param status string
---@param extra table|nil
local function write_debug_snapshot(status, extra)
  last_bridge_status = status
  local path = vim.fn.stdpath("data") .. "/vimcoach/vscode_debug.json"
  local dir = vim.fn.fnamemodify(path, ":h")
  if vim.fn.isdirectory(dir) == 0 then
    pcall(vim.fn.mkdir, dir, "p")
  end
  local payload = vim.tbl_extend("force", {
    ts = os.time(),
    status = status,
    vim_g_vscode = vim.g.vscode ~= nil,
  }, extra or {})
  local ok, encoded = pcall(vim.json.encode, payload)
  if ok and encoded then
    local fd = io.open(path, "w")
    if fd then
      fd:write(encoded)
      fd:close()
    end
  end
end

local SHOW_HINT_JS = [[
const cmds = await vscode.commands.getCommands(true);
if (args.useCompanion && cmds.includes("vimcoach.showHint")) {
  await vscode.commands.executeCommand("vimcoach.showHint", args.payload);
  if (args.summary) {
    await vscode.commands.executeCommand("vimcoach.syncStats", args.summary);
  }
  return "companion";
}

const style = args.style || "inline_and_status";
const durationMs = args.durationMs || 4500;

// 1. Sleek styled inline pill at end of the active line (with full explanation on hover)
if (style === "inline" || style === "inline_and_status") {
  const editor = vscode.window.activeTextEditor;
  if (editor && args.inlineText) {
    if (globalThis.__vimcoachDeco) {
      try { globalThis.__vimcoachDeco.dispose(); } catch {}
    }
    if (globalThis.__vimcoachTimer) {
      clearTimeout(globalThis.__vimcoachTimer);
    }

    const isWarn = !!args.isWarn;
    const deco = vscode.window.createTextEditorDecorationType({
      after: {
        contentText: args.inlineText,
        color: isWarn ? "#f2cc60" : "#89d185",
        backgroundColor: isWarn ? "rgba(242, 204, 96, 0.14)" : "rgba(115, 201, 145, 0.14)",
        border: isWarn ? "1px solid rgba(242, 204, 96, 0.45)" : "1px solid rgba(115, 201, 145, 0.42)",
        margin: "0 0 0 18px",
        textDecoration: "none; padding: 1px 8px; border-radius: 4px; font-style: normal; font-weight: 500;",
      },
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    globalThis.__vimcoachDeco = deco;

    const lineNum = editor.selection.active.line;
    const lineLen = editor.document.lineAt(lineNum).text.length;
    const range = new vscode.Range(lineNum, lineLen, lineNum, lineLen);
    const md = new vscode.MarkdownString(args.hoverMd || "");
    md.isTrusted = false;

    editor.setDecorations(deco, [{ range, hoverMessage: md }]);
    globalThis.__vimcoachTimer = setTimeout(() => {
      try { deco.dispose(); } catch {}
      if (globalThis.__vimcoachDeco === deco) {
        globalThis.__vimcoachDeco = null;
      }
    }, durationMs);
  }
}

// 2. Clean auto-clearing Status Bar pill (never steals focus, never stacks)
if (style === "status_bar" || style === "inline_and_status") {
  vscode.window.setStatusBarMessage(args.statusText, durationMs);
}

// 3. Toast popup ONLY if explicitly opted into style = "toast"
if (style === "toast") {
  if (args.isWarn) {
    vscode.window.showWarningMessage(args.toastText);
  } else {
    vscode.window.showInformationMessage(args.toastText);
  }
}
return "native:" + style;
]]

local SYNC_STATS_JS = [[
const cmds = await vscode.commands.getCommands(true);
if (cmds.includes("vimcoach.syncStats")) {
  await vscode.commands.executeCommand("vimcoach.syncStats", args.summary);
  return "synced";
}
return "no_companion";
]]

local OPEN_DASHBOARD_JS = [[
const cmds = await vscode.commands.getCommands(true);
if (cmds.includes("vimcoach.openDashboard")) {
  if (args.summary) {
    await vscode.commands.executeCommand("vimcoach.syncStats", args.summary);
  }
  await vscode.commands.executeCommand("vimcoach.openDashboard");
  return "companion";
}
vscode.window.showInformationMessage(args.fallbackText);
return "fallback";
]]

---Send a coaching hint to VS Code (uses eval_async for guaranteed native toast + status bar + inline ghost text,
---and automatically upgrades to the companion extension if installed).
---@param hint table
function M.show_hint(hint)
  local vscode = get_vscode()
  local meta = catalog.get(hint.rule_id)
  local title = meta and meta.title or "Vim Tip"
  local category = meta and meta.category or "editing"
  local summary = mastery.get_summary()

  local saved_str = (hint.keys_saved and hint.keys_saved > 0)
      and string.format(" (-%d key%s)", hint.keys_saved, hint.keys_saved == 1 and "" or "s")
    or ""

  local actual = hint.actual or ""
  local suggested = hint.suggested or ""
  local reason = hint.reason or ""
  local is_warn = (config.options.vscode.notify_level == "warn" or hint.is_strict_block == true)

  local toast_text = string.format("VimCoach [%s]: %s → %s%s — %s", title, actual, suggested, saved_str, reason)
  local status_text = string.format("$(sparkle) VimCoach: %s → %s%s · %s", actual, suggested, saved_str, title)
  local inline_text = string.format("⚡ %s → %s%s", actual, suggested, saved_str)
  local hover_md = string.format(
    "**VimCoach · %s**\n\n`%s` → **`%s`**%s\n\n%s",
    title,
    actual,
    suggested,
    saved_str,
    reason
  )

  local payload = {
    rule_id = hint.rule_id,
    title = title,
    category = category,
    actual = actual,
    suggested = suggested,
    keys_saved = hint.keys_saved or 1,
    reason = reason,
    is_strict_block = hint.is_strict_block == true,
    fluency = summary.fluency,
    total_keys_saved = summary.total_keys_saved,
    session_keys_saved = summary.session.keys_saved,
    mode = config.options.mode,
  }

  -- Primary path: vscode-neovim's built-in eval_async (non-blocking, sleek inline pill + status bar)
  if vscode and type(vscode.eval_async) == "function" then
    local ok, err = pcall(vscode.eval_async, SHOW_HINT_JS, {
      args = {
        useCompanion = config.options.vscode.use_companion_extension == true,
        style = config.options.vscode.style or "inline_and_status",
        payload = payload,
        summary = summary,
        isWarn = is_warn,
        toastText = toast_text,
        statusText = status_text,
        inlineText = inline_text,
        hoverMd = hover_md,
        durationMs = config.options.ui.duration_ms or 4500,
      },
      callback = function(cb_err, res)
        if cb_err then
          write_debug_snapshot("eval_async_cb_error", { error = tostring(cb_err) })
        else
          write_debug_snapshot("eval_async_ok:" .. tostring(res))
        end
      end,
    })
    if ok then
      write_debug_snapshot("eval_async_dispatched")
      return
    else
      write_debug_snapshot("eval_async_pcall_error", { error = tostring(err) })
    end
  end

  -- Fallback 1: vscode.notify
  local lvl = is_warn and vim.log.levels.WARN or vim.log.levels.INFO
  if vscode and type(vscode.notify) == "function" then
    local ok = pcall(vscode.notify, toast_text, lvl)
    if not ok then
      ok = pcall(vscode.notify, toast_text)
    end
    write_debug_snapshot(ok and "vscode_notify_ok" or "vscode_notify_error")
    if ok then
      return
    end
  end

  -- Fallback 2: vim.notify
  write_debug_snapshot("vim_notify_fallback", {
    has_vscode_module = vscode ~= nil,
  })
  vim.notify(toast_text, lvl, { title = "VimCoach" })
end

---Return diagnostic info about VS Code bridge state.
---@return table
function M.debug_info()
  local vscode = get_vscode()
  return {
    vim_g_vscode = vim.g.vscode ~= nil,
    vscode_enabled = config.options.vscode.enabled,
    has_vscode_module = vscode ~= nil,
    has_eval_async = vscode ~= nil and type(vscode.eval_async) == "function",
    has_vscode_notify = vscode ~= nil and type(vscode.notify) == "function",
    has_vscode_action = vscode ~= nil and type(vscode.action) == "function",
    last_bridge_status = last_bridge_status,
  }
end

---Push the latest mastery summary to the VS Code companion extension (non-blocking).
function M.sync_stats()
  local vscode = get_vscode()
  if not vscode or not config.options.vscode.use_companion_extension then
    return
  end
  if type(vscode.eval_async) == "function" then
    pcall(vscode.eval_async, SYNC_STATS_JS, {
      args = { summary = mastery.get_summary() },
    })
  end
end

---Open the Mastery Dashboard in VS Code (companion sidebar if available, else summary notification).
function M.open_dashboard()
  local vscode = get_vscode()
  local summary = mastery.get_summary()
  local top = summary.top_habits[1]
  local top_str = top and string.format(" | Top habit: %s (%s, %dx)", top.title, top.shortcut, top.missed) or ""
  local fallback_text = string.format(
    "VimCoach Fluency: %d%% | Good motions: %d | Tips: %d | Saveable keys: %d%s",
    summary.fluency,
    summary.total_good_motions,
    summary.total_hints,
    summary.total_keys_saved,
    top_str
  )

  if vscode and type(vscode.eval_async) == "function" then
    pcall(vscode.eval_async, OPEN_DASHBOARD_JS, {
      args = { summary = summary, fallbackText = fallback_text },
    })
    return
  end

  if vscode and type(vscode.notify) == "function" then
    pcall(vscode.notify, fallback_text, vim.log.levels.INFO)
    return
  end

  vim.notify(fallback_text, vim.log.levels.INFO, { title = "VimCoach" })
end

return M
