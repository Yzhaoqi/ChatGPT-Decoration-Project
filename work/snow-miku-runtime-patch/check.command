#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"
APP=""
for candidate in "/Applications/Codex.app" "/Applications/ChatGPT.app" "$HOME/Applications/Codex.app" "$HOME/Applications/ChatGPT.app"; do
  if [[ -d "$candidate" ]]; then APP="$candidate"; break; fi
done

if [[ -z "$APP" ]]; then
  print -u2 "没有找到 Codex.app 或 ChatGPT.app。"
  exit 1
fi

print "应用：$APP"
print "补丁方式：外部运行时注入（应用包只读）"
NODE="$APP/Contents/Resources/cua_node/bin/node"
if [[ ! -x "$NODE" ]]; then NODE="$(command -v node || true)"; fi
if [[ -n "$NODE" ]]; then
  print "装饰配置："
  "$NODE" "$ROOT/injector.cjs" --check-config
else
  print "装饰配置：无法检查（没有可用的 Node.js）"
fi
for file in "$APP/Contents/Info.plist" "$APP/Contents/Resources/app.asar" "$APP/Contents/MacOS/ChatGPT"; do
  [[ -f "$file" ]] && shasum -a 256 "$file"
done
print "最近日志："
latest="$(ls -t "$HOME/Library/Logs/SnowMikuCodexRuntime"/injector-*.log 2>/dev/null | head -1 || true)"
if [[ -n "$latest" ]]; then tail -20 "$latest"; else print "尚未运行主题启动器。"; fi
read -r "?按回车关闭…"
