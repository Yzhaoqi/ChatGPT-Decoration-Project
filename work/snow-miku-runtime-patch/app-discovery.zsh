#!/bin/zsh

OPENAI_CODEX_BUNDLE_ID="com.openai.codex"
OPENAI_TEAM_ID="2DC432GLL2"
OPENAI_SPARKLE_PUBLIC_KEY="mNfr1v9t63BfgDtlw4C8lRvSY6uMggIXABDOCi3tS6k="

# macOS 上通过 LaunchServices 启动的 GUI 进程可能不会把完整路径暴露给
# pgrep -f，但 ps 的 command 列仍然可靠。统一从完整命令行定位官方主进程，
# 避免误把已有实例当成已退出，导致 Electron 忽略新的调试参数。
openai_main_process_pids() {
  /bin/ps -axo pid=,command= | /usr/bin/awk \
    -v system_chatgpt="/Applications/ChatGPT.app/Contents/MacOS/ChatGPT" \
    -v system_codex="/Applications/Codex.app/Contents/MacOS/ChatGPT" \
    -v user_chatgpt="$HOME/Applications/ChatGPT.app/Contents/MacOS/ChatGPT" \
    -v user_codex="$HOME/Applications/Codex.app/Contents/MacOS/ChatGPT" '
      function is_command(command, executable) {
        return index(command, executable) == 1 && \
          (length(command) == length(executable) || substr(command, length(executable) + 1, 1) == " ")
      }
      {
        pid = $1
        sub(/^[[:space:]]*[0-9]+[[:space:]]+/, "", $0)
        if (is_command($0, system_chatgpt) || is_command($0, system_codex) || \
            is_command($0, user_chatgpt) || is_command($0, user_codex)) print pid
      }
    '
}

openai_main_process_running() {
  [[ -n "$(openai_main_process_pids)" ]]
}

openai_app_metadata_valid() {
  local app="$1"
  [[ -x "$app/Contents/MacOS/ChatGPT" ]] || return 1
  [[ -f "$app/Contents/Resources/app.asar" ]] || return 1
  [[ -x "$app/Contents/Resources/cua_node/bin/node" ]] || return 1

  local bundle_id version build public_key signature_details
  bundle_id="$(/usr/bin/plutil -extract CFBundleIdentifier raw "$app/Contents/Info.plist" 2>/dev/null || true)"
  version="$(/usr/bin/plutil -extract CFBundleShortVersionString raw "$app/Contents/Info.plist" 2>/dev/null || true)"
  build="$(/usr/bin/plutil -extract CFBundleVersion raw "$app/Contents/Info.plist" 2>/dev/null || true)"
  public_key="$(/usr/bin/plutil -extract SUPublicEDKey raw "$app/Contents/Info.plist" 2>/dev/null || true)"
  signature_details="$(/usr/bin/codesign -dv --verbose=4 "$app" 2>&1 || true)"

  [[ "$bundle_id" == "$OPENAI_CODEX_BUNDLE_ID" ]] || return 1
  [[ -n "$version" && "$build" == <-> ]] || return 1
  [[ "$public_key" == "$OPENAI_SPARKLE_PUBLIC_KEY" ]] || return 1
  [[ "$signature_details" == *"Identifier=$OPENAI_CODEX_BUNDLE_ID"* ]] || return 1
  [[ "$signature_details" == *"TeamIdentifier=$OPENAI_TEAM_ID"* ]] || return 1
  [[ "$signature_details" == *"Notarization Ticket=stapled"* ]] || return 1
  return 0
}

openai_app_signature_verified() {
  /usr/bin/codesign --verify --deep --strict \
    -R='identifier "com.openai.codex" and anchor apple generic and certificate leaf[subject.OU] = "2DC432GLL2"' \
    "$1" >/dev/null 2>&1
}

find_latest_openai_app() {
  local -a candidates
  if [[ -n "${DECORATIONS_APP_PATH:-}" ]]; then
    candidates=("$DECORATIONS_APP_PATH")
  else
    candidates=(
      "/Applications/ChatGPT.app"
      "/Applications/Codex.app"
      "$HOME/Applications/ChatGPT.app"
      "$HOME/Applications/Codex.app"
    )
  fi

  local candidate build best="" best_build=-1
  for candidate in "${candidates[@]}"; do
    openai_app_metadata_valid "$candidate" || continue
    build="$(/usr/bin/plutil -extract CFBundleVersion raw "$candidate/Contents/Info.plist" 2>/dev/null || true)"
    if [[ "$build" == <-> && "$build" -gt "$best_build" ]]; then
      best="$candidate"
      best_build="$build"
    fi
  done
  print -r -- "$best"
}
