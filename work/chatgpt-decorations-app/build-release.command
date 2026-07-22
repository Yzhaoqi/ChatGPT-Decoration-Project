#!/bin/zsh
set -euo pipefail
setopt NULL_GLOB

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h:h}"
APP_SOURCE="$SCRIPT_DIR"
THEME_SOURCE="$PROJECT_ROOT/work/snow-miku-runtime-patch"
OUTPUT_ROOT="$PROJECT_ROOT/outputs"
ICON_SOURCE="$APP_SOURCE/AppIcon.icns"

[[ "$OUTPUT_ROOT" == "$PROJECT_ROOT/outputs" ]] || {
  print -u2 "拒绝清理非工程 outputs 目录：$OUTPUT_ROOT"
  exit 2
}

for required in \
  "$APP_SOURCE/Info-Launcher.plist" \
  "$APP_SOURCE/Info-Editor.plist" \
  "$APP_SOURCE/Info-Restore.plist" \
  "$APP_SOURCE/ChatGPTDecorationsLauncher" \
  "$APP_SOURCE/AutoRelaunchWatcher" \
  "$APP_SOURCE/AutoRelaunchAgent.plist" \
  "$APP_SOURCE/EditDecorationsConfig" \
  "$APP_SOURCE/RestoreOriginal" \
  "$APP_SOURCE/README.md" \
  "$ICON_SOURCE" \
  "$THEME_SOURCE/injector.cjs" \
  "$THEME_SOURCE/app-discovery.zsh" \
  "$THEME_SOURCE/decorations.json" \
  "$THEME_SOURCE/decorations.schema.json" \
  "$THEME_SOURCE/assets/snow-miku.png"; do
  [[ -f "$required" ]] || {
    print -u2 "缺少构建文件：$required"
    exit 2
  }
done

VERSION="$(plutil -extract CFBundleShortVersionString raw "$APP_SOURCE/Info-Launcher.plist")"
[[ "$VERSION" == <->.<->.<-> ]] || {
  print -u2 "无效版本号：$VERSION"
  exit 2
}

mkdir -p "$OUTPUT_ROOT"
BASE="ChatGPT-Decorations-App-v$VERSION"
TEMP_ROOT="$(mktemp -d "$OUTPUT_ROOT/.release-${VERSION}.XXXXXX")"
PACKAGE_DIR="$TEMP_ROOT/$BASE"
PACKAGE_ZIP="$TEMP_ROOT/$BASE.zip"
VERIFY_DIR="$TEMP_ROOT/verify"
# Finder/Spotlight 会把构建目录里的 .app 当成另一份已安装应用。
# 使用 .noindex 保留可检查的展开包，同时只让正式安装版出现在应用搜索中。
FINAL_DIR="$OUTPUT_ROOT/$BASE.noindex"
FINAL_ZIP="$OUTPUT_ROOT/$BASE.zip"

cleanup_temp() {
  rm -rf -- "$TEMP_ROOT"
}
trap cleanup_temp EXIT

MAIN_APP="$PACKAGE_DIR/ChatGPT 装饰版.app"
EDITOR_APP="$PACKAGE_DIR/编辑装饰配置.app"
RESTORE_APP="$PACKAGE_DIR/恢复原版 ChatGPT.app"

mkdir -p \
  "$MAIN_APP/Contents/MacOS" \
  "$MAIN_APP/Contents/Resources/theme" \
  "$EDITOR_APP/Contents/MacOS" \
  "$EDITOR_APP/Contents/Resources/defaults/assets" \
  "$RESTORE_APP/Contents/MacOS" \
  "$RESTORE_APP/Contents/Resources"

cp "$APP_SOURCE/Info-Launcher.plist" "$MAIN_APP/Contents/Info.plist"
cp "$APP_SOURCE/ChatGPTDecorationsLauncher" "$MAIN_APP/Contents/MacOS/ChatGPTDecorationsLauncher"
cp "$APP_SOURCE/AutoRelaunchWatcher" "$MAIN_APP/Contents/Resources/AutoRelaunchWatcher"
cp "$APP_SOURCE/AutoRelaunchAgent.plist" "$MAIN_APP/Contents/Resources/AutoRelaunchAgent.plist"
cp -R "$THEME_SOURCE/." "$MAIN_APP/Contents/Resources/theme/"
cp "$ICON_SOURCE" "$MAIN_APP/Contents/Resources/AppIcon.icns"

cp "$APP_SOURCE/Info-Editor.plist" "$EDITOR_APP/Contents/Info.plist"
cp "$APP_SOURCE/EditDecorationsConfig" "$EDITOR_APP/Contents/MacOS/EditDecorationsConfig"
cp "$THEME_SOURCE/decorations.json" "$THEME_SOURCE/decorations.schema.json" "$EDITOR_APP/Contents/Resources/defaults/"
cp "$THEME_SOURCE/assets/snow-miku.png" "$EDITOR_APP/Contents/Resources/defaults/assets/snow-miku.png"
cp "$ICON_SOURCE" "$EDITOR_APP/Contents/Resources/AppIcon.icns"

cp "$APP_SOURCE/Info-Restore.plist" "$RESTORE_APP/Contents/Info.plist"
cp "$APP_SOURCE/RestoreOriginal" "$RESTORE_APP/Contents/MacOS/RestoreOriginal"
cp "$THEME_SOURCE/restore-original.command" "$RESTORE_APP/Contents/Resources/restore-original.command"
cp "$ICON_SOURCE" "$RESTORE_APP/Contents/Resources/AppIcon.icns"
cp "$APP_SOURCE/README.md" "$PACKAGE_DIR/README.md"
: > "$PACKAGE_DIR/.metadata_never_index"

chmod +x \
  "$MAIN_APP/Contents/MacOS/ChatGPTDecorationsLauncher" \
  "$MAIN_APP/Contents/Resources/AutoRelaunchWatcher" \
  "$MAIN_APP/Contents/Resources/theme/launch.command" \
  "$MAIN_APP/Contents/Resources/theme/check.command" \
  "$MAIN_APP/Contents/Resources/theme/restore-original.command" \
  "$MAIN_APP/Contents/Resources/theme/uninstall.command" \
  "$EDITOR_APP/Contents/MacOS/EditDecorationsConfig" \
  "$RESTORE_APP/Contents/MacOS/RestoreOriginal" \
  "$RESTORE_APP/Contents/Resources/restore-original.command"

xattr -cr "$PACKAGE_DIR"
codesign --force --deep --sign - "$MAIN_APP"
codesign --force --deep --sign - "$EDITOR_APP"
codesign --force --deep --sign - "$RESTORE_APP"

"$MAIN_APP/Contents/MacOS/ChatGPTDecorationsLauncher" --self-test
codesign --verify --deep --strict "$MAIN_APP"
codesign --verify --deep --strict "$EDITOR_APP"
codesign --verify --deep --strict "$RESTORE_APP"

ditto -c -k --sequesterRsrc --keepParent "$PACKAGE_DIR" "$PACKAGE_ZIP"
unzip -tqq "$PACKAGE_ZIP"
mkdir -p "$VERIFY_DIR"
ditto -x -k "$PACKAGE_ZIP" "$VERIFY_DIR"
codesign --verify --deep --strict "$VERIFY_DIR/$BASE/ChatGPT 装饰版.app"
codesign --verify --deep --strict "$VERIFY_DIR/$BASE/编辑装饰配置.app"
codesign --verify --deep --strict "$VERIFY_DIR/$BASE/恢复原版 ChatGPT.app"

# 新版本完全通过校验后才替换当前版本并清理旧产物。
rm -rf -- "$FINAL_DIR"
rm -f -- "$FINAL_ZIP"
mv "$PACKAGE_DIR" "$FINAL_DIR"
mv "$PACKAGE_ZIP" "$FINAL_ZIP"

for candidate in "$OUTPUT_ROOT"/*(N); do
  [[ "$candidate" == "$FINAL_DIR" || "$candidate" == "$FINAL_ZIP" ]] && continue
  name="${candidate:t}"
  case "$name" in
    ChatGPT-Decorations-App-v*|ChatGPT-Decorations-Config-v*|SnowMiku-Embedded-Conversation-v*|UNSAFE-DO-NOT-USE-SnowMiku-ChatGPT-Patch*|重要说明-旧补丁请勿使用.md|.DS_Store)
      rm -rf -- "$candidate"
      ;;
  esac
done
rm -f -- "$OUTPUT_ROOT/.DS_Store"

print "已生成并仅保留最新版本：$FINAL_ZIP"
shasum -a 256 "$FINAL_ZIP"
