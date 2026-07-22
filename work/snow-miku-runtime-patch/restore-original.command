#!/bin/zsh
set -u

STATE_DIR="$HOME/Library/Application Support/SnowMikuEmbeddedConversation"
AUTO_SUPPORT="$HOME/Library/Application Support/ChatGPTDecorations"
AUTO_AGENT="$HOME/Library/LaunchAgents/local.codex.chatgpt-decorations.auto-relaunch.plist"
ROOT="${0:A:h}"
source "$ROOT/app-discovery.zsh"
APP=""

# 先关闭自动接管，避免恢复原版后又被切回装饰版。
mkdir -p "$AUTO_SUPPORT"
: > "$AUTO_SUPPORT/auto-relaunch.disabled"
launchctl bootout "gui/$UID" "$AUTO_AGENT" >/dev/null 2>&1 || true
rm -f "$AUTO_AGENT" "$AUTO_SUPPORT/AutoRelaunchWatcher"

if [[ -f "$STATE_DIR/app-path" ]]; then
  saved_app="$(head -1 "$STATE_DIR/app-path" 2>/dev/null || true)"
  openai_app_metadata_valid "$saved_app" && APP="$saved_app"
fi

if [[ -z "$APP" ]]; then
  APP="$(find_latest_openai_app)"
fi

if [[ -z "$APP" ]]; then
  print -u2 "没有找到 ChatGPT.app 或 Codex.app。"
  [[ -t 0 ]] && read -r "?按回车关闭…" || true
  exit 1
fi

print "正在停止页面装饰 DOM 注入器…"
if [[ -f "$STATE_DIR/injector.pid" ]]; then
  injector_pid="$(head -1 "$STATE_DIR/injector.pid" 2>/dev/null || true)"
  if [[ "$injector_pid" == <-> ]]; then
    command_line="$(ps -p "$injector_pid" -o command= 2>/dev/null || true)"
    if [[ "$command_line" == *"injector.cjs"* ]]; then
      kill -TERM "$injector_pid" >/dev/null 2>&1 || true
    fi
  fi
fi

print "正在正常结束主题模式实例…"
osascript -e 'tell application id "com.openai.codex" to quit' >/dev/null 2>&1 || true
for _ in {1..40}; do
  openai_main_process_running || break
  sleep 0.25
done

if openai_main_process_running; then
  print "应用仍在收尾，发送标准 SIGTERM…"
  openai_main_process_pids | while read -r pid; do
    [[ "$pid" == <-> ]] && kill -TERM "$pid" >/dev/null 2>&1 || true
  done
  for _ in {1..40}; do
    openai_main_process_running || break
    sleep 0.25
  done
fi

if openai_main_process_running; then
  print -u2 "ChatGPT 仍在运行。请手动按 Cmd+Q，随后从 Dock 打开即可恢复原版。"
  [[ -t 0 ]] && read -r "?按回车关闭…" || true
  exit 2
fi

if ! openai_app_signature_verified "$APP"; then
  print "系统 codesign 无法验证此 SDK 26 应用；OpenAI Bundle ID、Team ID、Sparkle 公钥及公证票据均匹配。"
fi

mkdir -p "$STATE_DIR"
: > "$STATE_DIR/injector.pid"
: > "$STATE_DIR/app.pid"

/usr/bin/open "$APP"
print "已停止页面装饰主题，并以普通模式启动原版 ChatGPT/Codex。"
print "已关闭官方更新后的装饰版自动接管。"
print "应用包、账号、会话和 ~/.codex 配置均未改动。"
[[ -t 0 ]] && read -r "?按回车关闭…" || true
