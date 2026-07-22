#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"
source "$ROOT/app-discovery.zsh"
APP="$(find_latest_openai_app)"

if [[ -z "$APP" ]]; then
  print -u2 "没有找到元数据完整的 OpenAI ChatGPT/Codex.app。"
  read -r "?按回车关闭…"
  exit 1
fi

if openai_app_signature_verified "$APP"; then
  SIGNATURE_STATUS="verified"
else
  # SDK 26 应用在部分旧版 macOS codesign 工具上会误报 invalid/internal error。
  # 仍要求 bundle id、OpenAI Team ID、Sparkle 公钥和 notarization ticket 全部匹配。
  SIGNATURE_STATUS="metadata-verified"
  print -u2 "系统 codesign 无法验证此 SDK 26 应用；已改用 OpenAI 签名元数据校验。"
fi

if [[ "${1:-}" == "--preflight" ]]; then
  VERSION="$(/usr/bin/plutil -extract CFBundleShortVersionString raw "$APP/Contents/Info.plist")"
  print "预检通过：$APP（$VERSION，$SIGNATURE_STATUS）"
  exit 0
fi

# Chromium 开关只能在主进程首次启动时生效。当前任务运行期间不强行
# 结束 ChatGPT，以免破坏会话状态；要求用户先通过 Cmd+Q 完全退出。
if openai_main_process_running; then
  print -u2 "ChatGPT/Codex 仍在运行。请先按 Cmd+Q 完全退出，再双击本启动器。"
  [[ -t 0 ]] && read -r "?按回车关闭…" || true
  exit 4
fi

NODE="$APP/Contents/Resources/cua_node/bin/node"
if [[ ! -x "$NODE" ]]; then
  NODE="$(command -v node || true)"
fi
if [[ -z "$NODE" ]]; then
  print -u2 "没有找到可用的 Node.js。"
  read -r "?按回车关闭…"
  exit 1
fi

CONFIG_ARGS=()
if [[ -n "${DECORATIONS_CONFIG_PATH:-}" ]]; then
  CONFIG_ARGS=(--config "$DECORATIONS_CONFIG_PATH")
fi

if ! "$NODE" "$ROOT/injector.cjs" "${CONFIG_ARGS[@]}" --check-config; then
  print -u2 "装饰配置检查失败，启动器已停止；ChatGPT 应用未被修改。"
  [[ -t 0 ]] && read -r "?按回车关闭…" || true
  exit 6
fi

PORT="$($NODE -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
LOG_DIR="$HOME/Library/Logs/SnowMikuCodexRuntime"
STATE_DIR="$HOME/Library/Application Support/SnowMikuEmbeddedConversation"
mkdir -p "$LOG_DIR"
mkdir -p "$STATE_DIR"
LOG_FILE="$LOG_DIR/injector-$PORT.log"
APP_LOG_FILE="$LOG_DIR/app-$PORT.log"
EXECUTABLE="$APP/Contents/MacOS/ChatGPT"

nohup "$NODE" "$ROOT/injector.cjs" "${CONFIG_ARGS[@]}" --port "$PORT" >"$LOG_FILE" 2>&1 &!
INJECTOR_PID=$!
print -r -- "$INJECTOR_PID" > "$STATE_DIR/injector.pid"
print -r -- "$PORT" > "$STATE_DIR/port"

# 新版正式客户端的 Dev 模式要求未随生产包分发的 Resources/git。
# 直接把本机调试参数交给 Electron，并明确使用正式用户数据目录，既能
# 开放仅监听 127.0.0.1 的 CDP，也不会切换到 ChatGPT (Dev) 或触发 Git 检查。
USER_DATA_PATH="${DECORATIONS_USER_DATA_PATH:-$HOME/Library/Application Support/Codex}"
nohup /usr/bin/env -u BUILD_FLAVOR \
  CODEX_ELECTRON_USER_DATA_PATH="$USER_DATA_PATH" \
  "$EXECUTABLE" \
  --user-data-dir="$USER_DATA_PATH" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$PORT" \
  >"$APP_LOG_FILE" 2>&1 &!
APP_PID=$!
print -r -- "$APP_PID" > "$STATE_DIR/app.pid"
print -r -- "$APP" > "$STATE_DIR/app-path"

READY=0
for _ in {1..80}; do
  if curl -fsS "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.25
done

if [[ "$READY" -ne 1 ]]; then
  kill -TERM "$INJECTOR_PID" >/dev/null 2>&1 || true
  : > "$STATE_DIR/injector.pid"
  print -u2 "Codex 已启动，但没有开放本机注入端口；已保持原版界面。"
  print -u2 "应用日志：$APP_LOG_FILE"
  [[ -t 0 ]] && read -r "?按回车关闭…" || true
  exit 3
fi

print "ChatGPT/Codex 配置化页面装饰已启动。"
print "装饰由 decorations.json 管理，是页面内部 DOM，不是独立叠加窗口。"
print "运行日志：$LOG_FILE"
print "此启动器没有修改 $APP 内的任何文件。"
print "客户端运行模式：生产模式（不依赖 Bundled Git）。"
sleep 1
