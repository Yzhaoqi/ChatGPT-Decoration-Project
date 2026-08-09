#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const PROJECT_PROVENANCE = Object.freeze({
  project: "ChatGPT-Decoration-Project",
  author: "YZhaoqi",
  marker: "YZQ-CDP-2026"
});

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function finiteNumber(value, fallback, minimum = -Infinity, maximum = Infinity) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function imageMime(extension) {
  return ({
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif"
  })[extension.toLowerCase()] || null;
}

function imageAspectRatio(buffer, extension, fallback) {
  if (extension.toLowerCase() === ".png" && buffer.length >= 24 && buffer.toString("hex", 0, 8) === "89504e470d0a1a0a") {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width > 0 && height > 0) return height / width;
  }
  return finiteNumber(fallback, 1, 0.05, 20);
}

const BUILD_CHANNEL_ID = [
  "002b03c330977989",
  "12115d007404da58",
  "d891b6558f95c46f",
  "e1b1597f4ab1e394"
].join("");

function loadDecorations(configOverride) {
  const configPath = configOverride ? path.resolve(configOverride) : path.join(__dirname, "decorations.json");
  const configRoot = path.dirname(configPath);
  let document;
  try {
    document = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`无法读取 decorations.json：${error.message}`);
  }
  if (document.version !== 1 || !Array.isArray(document.decorations)) {
    throw new Error("decorations.json 必须包含 version: 1 和 decorations 数组。");
  }

  const ids = new Set();
  const root = path.resolve(configRoot) + path.sep;
  const supportedAnchors = new Set([
    "composer-top-right",
    "composer-top-left",
    "viewport-bottom-right",
    "viewport-bottom-left"
  ]);

  return document.decorations.map((raw, index) => {
    const label = `decorations[${index}]`;
    const id = String(raw.id || "");
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`${label}.id 只能包含字母、数字、下划线和连字符。`);
    if (ids.has(id)) throw new Error(`装饰 id 重复：${id}`);
    ids.add(id);

    const relativeAsset = String(raw.asset || "");
    const assetPath = path.resolve(configRoot, relativeAsset);
    if (!assetPath.startsWith(root)) throw new Error(`${label}.asset 必须位于补丁目录内。`);
    const extension = path.extname(assetPath);
    const mime = imageMime(extension);
    if (!mime) throw new Error(`${label}.asset 仅支持 PNG、JPEG、WebP、GIF 或 AVIF。`);
    let buffer;
    try { buffer = fs.readFileSync(assetPath); } catch (error) {
      throw new Error(`无法读取 ${relativeAsset}：${error.message}`);
    }

    const widthConfig = raw.width && typeof raw.width === "object" ? raw.width : {};
    const min = finiteNumber(widthConfig.min, 80, 16, 1200);
    const max = Math.max(min, finiteNumber(widthConfig.max, 180, 16, 1600));
    const compactMin = finiteNumber(widthConfig.compactMin, min, 16, 1200);
    const compactMax = Math.max(compactMin, finiteNumber(widthConfig.compactMax, max, 16, 1600));
    const anchor = supportedAnchors.has(raw.anchor) ? raw.anchor : "composer-top-right";

    return {
      id,
      enabled: raw.enabled !== false,
      asset: relativeAsset,
      dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
      imageAspectRatio: imageAspectRatio(buffer, extension, raw.imageAspectRatio),
      anchor,
      width: {
        min,
        viewportRatio: finiteNumber(widthConfig.viewportRatio, 0.08, 0.01, 1),
        max,
        compactMin,
        compactMax
      },
      imageAnchorY: finiteNumber(raw.imageAnchorY, 1, 0, 1),
      insetX: finiteNumber(raw.insetX, 16, -1000, 1000),
      insetY: finiteNumber(raw.insetY, 16, -1000, 1000),
      offsetX: finiteNumber(raw.offsetX, 0, -2000, 2000),
      offsetY: finiteNumber(raw.offsetY, 0, -2000, 2000),
      normalOpacity: finiteNumber(raw.normalOpacity, 0.9, 0, 1),
      overlapOpacity: finiteNumber(raw.overlapOpacity, 0.2, 0, 1),
      detectTextOverlap: raw.detectTextOverlap !== false,
      reserveInputText: raw.reserveInputText === true,
      safePadding: finiteNumber(raw.safePadding, 12, 0, 500),
      zIndex: Math.round(finiteNumber(raw.zIndex, 40, 1, 999))
    };
  });
}

let decorations;
const configOverride = readArg("--config", process.env.DECORATIONS_CONFIG_PATH || "");
const resolvedConfigPath = configOverride ? path.resolve(configOverride) : path.join(__dirname, "decorations.json");

function saveDecorationSettings(request) {
  const document = JSON.parse(fs.readFileSync(resolvedConfigPath, "utf8"));
  if (document.version !== 1 || !Array.isArray(document.decorations)) throw new Error("配置文件格式无效");
  const id = String(request.id || "");
  const raw = document.decorations.find((item) => String(item.id || "") === id);
  if (!raw) throw new Error(`没有找到装饰：${id}`);
  const settings = request.settings && typeof request.settings === "object" ? request.settings : {};
  const supportedAnchors = new Set(["composer-top-right", "composer-top-left", "viewport-bottom-right", "viewport-bottom-left"]);
  const width = Math.round(finiteNumber(settings.width, 120, 32, 500));

  raw.enabled = settings.enabled !== false;
  raw.anchor = supportedAnchors.has(settings.anchor) ? settings.anchor : "composer-top-right";
  raw.width = {
    min: width,
    viewportRatio: 0.01,
    max: width,
    compactMin: width,
    compactMax: width
  };
  raw.offsetX = Math.round(finiteNumber(settings.offsetX, 0, -600, 600));
  raw.offsetY = Math.round(finiteNumber(settings.offsetY, 0, -500, 500));
  raw.normalOpacity = finiteNumber(settings.normalOpacity, 0.9, 0.1, 1);
  raw.overlapOpacity = finiteNumber(settings.overlapOpacity, 0.2, 0, 1);
  raw.imageAspectRatio = finiteNumber(settings.imageAspectRatio, raw.imageAspectRatio || 1, 0.05, 20);

  if (request.imageDataUrl) {
    const match = String(request.imageDataUrl).match(/^data:image\/(png|jpeg|webp|gif|avif);base64,([a-zA-Z0-9+/=]+)$/);
    if (!match) throw new Error("图片格式无效，仅支持 PNG、JPEG、WebP、GIF 或 AVIF");
    const extension = ({ png: "png", jpeg: "jpg", webp: "webp", gif: "gif", avif: "avif" })[match[1]];
    const buffer = Buffer.from(match[2], "base64");
    if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error("图片必须小于 20 MB");
    const assetsDirectory = path.join(path.dirname(resolvedConfigPath), "assets");
    fs.mkdirSync(assetsDirectory, { recursive: true });
    const assetName = `custom-${id}.${extension}`;
    const assetPath = path.join(assetsDirectory, assetName);
    const temporaryAsset = `${assetPath}.tmp-${process.pid}`;
    fs.writeFileSync(temporaryAsset, buffer, { mode: 0o600 });
    fs.renameSync(temporaryAsset, assetPath);
    raw.asset = `assets/${assetName}`;
  }

  const temporaryConfig = `${resolvedConfigPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryConfig, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryConfig, resolvedConfigPath);
}

function resetDecorationSettings() {
  const defaultPath = path.join(__dirname, "decorations.json");
  if (path.resolve(defaultPath) === path.resolve(resolvedConfigPath)) return;
  const document = JSON.parse(fs.readFileSync(defaultPath, "utf8"));
  const temporaryConfig = `${resolvedConfigPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporaryConfig, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryConfig, resolvedConfigPath);
}
try {
  decorations = loadDecorations(configOverride);
} catch (error) {
  console.error(`[Decorations] 配置错误：${error.message}`);
  process.exit(3);
}

if (process.argv.includes("--check-config")) {
  const enabled = decorations.filter((decoration) => decoration.enabled);
  console.log(`[Decorations] 配置有效：${enabled.length} 个启用装饰。`);
  for (const decoration of enabled) console.log(`- ${decoration.id}: ${decoration.asset}`);
  process.exit(0);
}

const port = Number(readArg("--port", "0"));
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error("无效的调试端口。");
  process.exit(2);
}

const SETTINGS_BINDING = "snowMikuSettingsBridge";

function acquireRuntimeLock(debugPort) {
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  const lockPath = path.join(os.tmpdir(), `chatgpt-decorations-injector-${uid}-${debugPort}.lock`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(descriptor, String(process.pid));
      fs.closeSync(descriptor);
      const release = () => {
        try {
          if (fs.readFileSync(lockPath, "utf8").trim() === String(process.pid)) fs.unlinkSync(lockPath);
        } catch {}
      };
      process.once("exit", release);
      process.once("SIGINT", () => { release(); process.exit(130); });
      process.once("SIGTERM", () => { release(); process.exit(0); });
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let existingPid = 0;
      try { existingPid = Number(fs.readFileSync(lockPath, "utf8").trim()); } catch {}
      if (Number.isInteger(existingPid) && existingPid > 1) {
        try {
          process.kill(existingPid, 0);
          console.log(`[Decorations] 端口 ${debugPort} 已有注入器（PID ${existingPid}），当前重复实例退出。`);
          return false;
        } catch (signalError) {
          if (signalError.code === "EPERM") {
            console.log(`[Decorations] 端口 ${debugPort} 已有其他用户的注入器，当前实例退出。`);
            return false;
          }
        }
      }
      try { fs.unlinkSync(lockPath); } catch {}
    }
  }
  throw new Error("无法获取注入器单实例锁");
}

if (!acquireRuntimeLock(port)) process.exit(0);

function buildInstallSource(currentDecorations) {
  return `(() => {
  "use strict";
  const VERSION = "3.2.5";
  const PROVENANCE = Object.freeze(${JSON.stringify(PROJECT_PROVENANCE)});
  const BUILD_FINGERPRINT = ${JSON.stringify(BUILD_CHANNEL_ID)};
  const STYLE_ID = "snow-miku-runtime-style-v3";
  const LEGACY_ROOT_ID = "snow-miku-runtime-root";
  const DECORATION_CLASS = "snow-miku-runtime-decoration";
  const VISIBLE_CLASS = "snow-miku-runtime--visible";
  const OVERLAP_CLASS = "snow-miku-runtime--text-overlap";
  const TEXT_LAYER_CLASS = "snow-miku-runtime-text-layer";
  const COMPOSER_CONTENT_CLASS = "snow-miku-runtime-composer-content-layer";
  const INPUT_SAFE_CLASS = "snow-miku-runtime-input-safe-zone";
  const SETTINGS_ENTRY_ID = "snow-miku-decoration-settings-entry";
  const SETTINGS_PANEL_ID = "snow-miku-decoration-settings-panel";
  const SETTINGS_BINDING = "snowMikuSettingsBridge";
  const COMPOSER_SELECTOR = '[contenteditable="true"], textarea, [role="textbox"]';
  const DECORATIONS = ${JSON.stringify(currentDecorations)};
  const CSS = ${JSON.stringify(`
#snow-miku-runtime-root {
  display: none !important;
}
:root { --snow-miku-runtime-build: "${BUILD_CHANNEL_ID}"; }
.snow-miku-runtime-decoration {
  position: fixed !important;
  left: 0;
  top: 0;
  display: block;
  width: 100px;
  height: auto;
  max-width: 42vw;
  max-height: 60vh;
  object-fit: contain;
  object-position: center bottom;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
  -webkit-app-region: no-drag;
  opacity: 0 !important;
  transform: translate3d(0, 8px, 0) scale(0.985);
  transform-origin: center bottom;
  filter: drop-shadow(0 10px 18px rgb(0 0 0 / 0.3)) drop-shadow(0 0 14px rgb(88 214 199 / 0.14));
  transition: opacity 220ms ease, transform 260ms cubic-bezier(0.2, 0.75, 0.2, 1), filter 220ms ease;
  contain: layout style;
}
.snow-miku-runtime-decoration.${"snow-miku-runtime--visible"} {
  opacity: var(--decoration-normal-opacity, 0.9) !important;
  transform: translate3d(0, 0, 0) scale(1);
}
.snow-miku-runtime-decoration.${"snow-miku-runtime--visible"}.${"snow-miku-runtime--text-overlap"} {
  opacity: var(--decoration-overlap-opacity, 0.2) !important;
  filter: drop-shadow(0 8px 14px rgb(0 0 0 / 0.14)) drop-shadow(0 0 10px rgb(88 214 199 / 0.08));
}
.snow-miku-runtime-composer-content-layer {
  position: relative !important;
  z-index: 1000 !important;
}
.snow-miku-runtime-input-safe-zone {
  box-sizing: border-box !important;
  padding-right: var(--snow-miku-input-safe-right, 0px) !important;
}
#snow-miku-decoration-settings-entry {
  appearance: none; border: 0; background: transparent; color: inherit; font: inherit;
  width: 100%; min-height: 36px; padding: 7px 10px; border-radius: 8px;
  display: flex; align-items: center; gap: 10px; text-align: left; cursor: default;
}
#snow-miku-decoration-settings-entry:hover,
#snow-miku-decoration-settings-entry[data-active="true"] { background: rgb(127 127 127 / 0.12); }
#snow-miku-decoration-settings-entry .snow-settings-icon {
  width: 18px; text-align: center; color: #58a9ff; font-size: 16px;
}
#snow-miku-decoration-settings-panel {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147482000; overflow: auto;
  color: #202123; background: #fff;
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.snow-settings-page { width: min(900px, calc(100% - 64px)); margin: 0 auto; padding: 70px 0 80px; }
.snow-settings-header { margin-bottom: 28px; }
.snow-settings-title { margin: 0 0 8px; font-size: 25px; font-weight: 650; }
.snow-settings-subtitle { margin: 0; color: #737373; font-size: 14px; line-height: 1.5; }
.snow-settings-grid { display: grid; grid-template-columns: minmax(310px, 0.9fr) minmax(360px, 1.1fr); gap: 24px; align-items: start; }
.snow-settings-card { border: 1px solid rgb(0 0 0 / 0.1); border-radius: 16px; background: rgb(255 255 255 / 0.78); overflow: hidden; }
.snow-settings-row { padding: 15px 17px; border-bottom: 1px solid rgb(0 0 0 / 0.075); }
.snow-settings-row:last-child { border-bottom: 0; }
.snow-settings-row-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.snow-settings-label { display: block; font-size: 14px; font-weight: 600; }
.snow-settings-help { display: block; margin-top: 3px; color: #818181; font-size: 12px; line-height: 1.35; }
.snow-settings-range-line { display: grid; grid-template-columns: 1fr 52px; gap: 12px; margin-top: 10px; align-items: center; }
.snow-settings-range { width: 100%; accent-color: #3b9cff; }
.snow-settings-value { color: #666; font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
.snow-settings-select, .snow-settings-button {
  min-height: 34px; border: 1px solid rgb(0 0 0 / 0.12); border-radius: 9px;
  background: rgb(255 255 255 / 0.9); color: inherit; padding: 6px 10px; font: inherit; font-size: 13px;
}
.snow-settings-button { cursor: pointer; }
.snow-settings-button:hover { background: rgb(0 0 0 / 0.045); }
.snow-settings-button.primary { background: #1687ff; border-color: #1687ff; color: white; }
.snow-settings-button.primary:hover { background: #0877e8; }
.snow-settings-button:disabled { opacity: 0.5; cursor: default; }
.snow-settings-switch { width: 38px; height: 22px; accent-color: #1687ff; }
.snow-settings-preview-card { padding: 16px; }
.snow-settings-preview-title { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; font-size: 14px; font-weight: 600; }
.snow-settings-preview {
  position: relative; height: 410px; overflow: hidden; border-radius: 14px;
  border: 1px solid rgb(0 0 0 / 0.1); background: linear-gradient(180deg, #fafcff, #f4f7fb);
}
.snow-settings-preview::after {
  content: attr(data-decoration-provenance-label); position: absolute; right: 12px; bottom: 5px; z-index: 5;
  color: #858b92; font-size: 10px; line-height: 1; letter-spacing: 0.055em; opacity: 0.78;
  pointer-events: none; user-select: none; white-space: nowrap;
}
.snow-preview-message { position: absolute; left: 28px; right: 28px; top: 54px; color: #30343a; font-size: 13px; line-height: 1.6; }
.snow-preview-line { height: 8px; border-radius: 5px; background: #dce3eb; margin-bottom: 10px; }
.snow-preview-line.short { width: 62%; }
.snow-preview-composer {
  position: absolute; left: 24px; right: 24px; bottom: 22px; height: 92px;
  border: 1px solid #d6dce4; border-radius: 18px; background: rgb(255 255 255 / 0.94);
  box-shadow: 0 10px 28px rgb(40 55 70 / 0.08);
}
.snow-preview-placeholder { position: absolute; left: 18px; top: 17px; color: #9ca4ae; font-size: 13px; }
.snow-preview-toolbar { position: absolute; left: 18px; right: 18px; bottom: 14px; display: flex; justify-content: space-between; color: #626a74; font-size: 12px; }
.snow-preview-decoration {
  position: absolute; height: auto; object-fit: contain; object-position: center bottom;
  filter: drop-shadow(0 8px 15px rgb(0 0 0 / 0.2)); pointer-events: none;
  transition: left 120ms ease, top 120ms ease, opacity 120ms ease, width 120ms ease;
}
.snow-settings-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
.snow-settings-status { min-height: 20px; margin-top: 10px; color: #737373; font-size: 12px; text-align: right; }
.snow-settings-file-name { max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #777; font-size: 12px; }
@media (prefers-color-scheme: dark) {
  #snow-miku-decoration-settings-panel { color: #f0f3f6; background: #0d141c; }
  .snow-settings-subtitle, .snow-settings-help, .snow-settings-value, .snow-settings-status, .snow-settings-file-name { color: #8e99a5; }
  .snow-settings-preview::after { color: #758391; opacity: 0.86; }
  .snow-settings-card { border-color: rgb(255 255 255 / 0.11); background: rgb(18 28 39 / 0.8); }
  .snow-settings-row { border-color: rgb(255 255 255 / 0.08); }
  .snow-settings-select, .snow-settings-button { border-color: rgb(255 255 255 / 0.14); background: #172331; color: #eef3f8; }
  .snow-settings-button:hover { background: #203044; }
  .snow-settings-preview { border-color: rgb(255 255 255 / 0.1); background: linear-gradient(180deg, #111b26, #0b121a); }
  .snow-preview-message { color: #b7c3cf; }
  .snow-preview-line { background: #263544; }
  .snow-preview-composer { border-color: #2b3948; background: rgb(18 28 39 / 0.96); box-shadow: 0 10px 28px rgb(0 0 0 / 0.3); }
}
@media (max-width: 1050px) {
  .snow-settings-page { width: min(720px, calc(100% - 36px)); padding-top: 42px; }
  .snow-settings-grid { grid-template-columns: 1fr; }
  .snow-settings-preview { height: 330px; }
}
@media (prefers-reduced-motion: reduce) {
  .snow-miku-runtime-decoration { transition: none; }
}`)};

  try { window.__snowMikuRuntimeCleanup?.(); } catch {}
  try { window.__snowMikuRuntimeObserver?.disconnect?.(); } catch {}
  document.getElementById(LEGACY_ROOT_ID)?.remove();
  document.getElementById(SETTINGS_ENTRY_ID)?.remove();
  document.getElementById(SETTINGS_PANEL_ID)?.remove();

  let queued = false;
  let overlapQueued = false;
  let installFrame = 0;
  let overlapFrame = 0;
  let disposed = false;
  const runtimeToken = VERSION + "-" + Date.now() + "-" + Math.random();
  let composerResizeObserver = null;
  let observedComposer = null;
  let managedComposerInput = null;
  let managedComposerContent = null;
  let activeDecorations = [];
  let managedCleanupDone = false;
  let settingsNavigationHandler = null;
  let settingsResultHandler = null;
  const settingsPreviewProvenance = new WeakMap();

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function applyProvenanceMarker(element) {
    if (!element) return element;
    element.dataset.decorationProject = PROVENANCE.project;
    element.dataset.decorationAuthor = PROVENANCE.author;
    element.dataset.decorationProvenance = PROVENANCE.marker;
    element.dataset.decorationBuild = BUILD_FINGERPRINT.slice(0, 24);
    return element;
  }

  function ensureSettingsPreviewProvenance(panel, preview) {
    if (!panel || !preview) return;
    const displayAuthor = PROVENANCE.author.slice(0, 1) + PROVENANCE.author.slice(1).toLowerCase();
    const label = "by " + displayAuthor;
    const buildMarker = BUILD_FINGERPRINT.slice(0, 24);
    if (preview.dataset.decorationProject !== PROVENANCE.project ||
        preview.dataset.decorationAuthor !== PROVENANCE.author ||
        preview.dataset.decorationProvenance !== PROVENANCE.marker ||
        preview.dataset.decorationBuild !== buildMarker) {
      applyProvenanceMarker(preview);
    }
    if (preview.dataset.decorationProvenanceLabel !== label) preview.dataset.decorationProvenanceLabel = label;
    if (preview.getAttribute("aria-description") !== label) preview.setAttribute("aria-description", label);

    if (settingsPreviewProvenance.has(preview)) return;
    let queuedRepair = false;
    const observer = new MutationObserver(() => {
      if (queuedRepair || !panel.isConnected) return;
      queuedRepair = true;
      queueMicrotask(() => {
        queuedRepair = false;
        if (panel.isConnected) ensureSettingsPreviewProvenance(panel, preview);
      });
    });
    observer.observe(preview, {
      attributes: true,
      attributeFilter: [
        "data-decoration-project",
        "data-decoration-author",
        "data-decoration-provenance",
        "data-decoration-build",
        "data-decoration-provenance-label",
        "aria-description"
      ]
    });
    settingsPreviewProvenance.set(preview, observer);
    panel.__snowMikuPreviewProvenanceObserver = observer;
  }

  function findSettingsReferenceRow() {
    const wanted = new Set(["宠物", "Pets", "个性化", "Personalization"]);
    const settingsMarkers = new Set([
      "常规", "General", "个人资料", "Profile", "外观", "Appearance", "语音", "Voice",
      "配置", "Configuration", "个性化", "Personalization", "宠物", "Pets",
      "键盘快捷键", "Keyboard shortcuts", "使用情况和计费", "Usage and billing"
    ]);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    const candidates = [];
    const markersFound = new Set();
    while ((node = walker.nextNode())) {
      const label = String(node.nodeValue || "").trim();
      if (settingsMarkers.has(label) && node.parentElement?.getBoundingClientRect().left < 440) markersFound.add(label);
      if (!wanted.has(label)) continue;
      let element = node.parentElement;
      if (!element || element.closest("#" + SETTINGS_PANEL_ID)) continue;
      const interactive = element.closest("button, a, [role=button]");
      if (interactive) {
        const rect = interactive.getBoundingClientRect();
        if (rect.left < 430 && rect.width > 120 && rect.height >= 24 && rect.height < 70) {
          candidates.push({ row: interactive, preferred: label === "宠物" || label === "Pets" });
          continue;
        }
      }
      for (let depth = 0; element && depth < 5; depth += 1, element = element.parentElement) {
        const rect = element.getBoundingClientRect();
        if (rect.left < 430 && rect.width > 150 && rect.width < 430 && rect.height >= 26 && rect.height < 64) {
          candidates.push({ row: element, preferred: label === "宠物" || label === "Pets" });
          break;
        }
      }
    }
    if (markersFound.size < 3) return null;
    return candidates.find((candidate) => candidate.preferred)?.row || candidates[0]?.row || null;
  }

  function findSettingsSidebar(row) {
    let element = row;
    let best = row.parentElement;
    for (let depth = 0; element && depth < 10; depth += 1, element = element.parentElement) {
      const rect = element.getBoundingClientRect();
      if (rect.left < 24 && rect.width >= 240 && rect.width <= 440 && rect.height > innerHeight * 0.65) best = element;
    }
    return best;
  }

  function findSettingsBottomRow(reference) {
    const bottomLabels = new Set([
      "已归档任务", "Archived tasks",
      "已归档的聊天", "已归档聊天", "Archived chats"
    ]);
    const sidebar = findSettingsSidebar(reference);
    const walker = document.createTreeWalker(sidebar || document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!bottomLabels.has(String(node.nodeValue || "").trim())) continue;
      let element = node.parentElement;
      const interactive = element?.closest("button, a, [role=button]");
      if (interactive) return interactive;
      for (let depth = 0; element && depth < 5; depth += 1, element = element.parentElement) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 150 && rect.width < 440 && rect.height >= 26 && rect.height < 64) return element;
      }
    }

    // 设置项名称可能随客户端版本或语言变化。找不到已知的归档入口时，
    // 使用侧栏中位置最低的可见菜单行，避免退回“宠物”等中间位置。
    let bottomRow = null;
    let bottomEdge = -Infinity;
    for (const candidate of (sidebar || document.body).querySelectorAll("button, a, [role=button]")) {
      if (candidate.id === SETTINGS_ENTRY_ID || candidate.closest("#" + SETTINGS_PANEL_ID)) continue;
      const rect = candidate.getBoundingClientRect();
      if (rect.left >= 440 || rect.width <= 120 || rect.width >= 440 || rect.height < 24 || rect.height >= 70) continue;
      if (rect.bottom <= bottomEdge) continue;
      bottomRow = candidate;
      bottomEdge = rect.bottom;
    }
    return bottomRow;
  }

  function restoreRuntimeConfig(config, snapshot) {
    for (const key of Object.keys(config)) delete config[key];
    Object.assign(config, JSON.parse(JSON.stringify(snapshot)));
    schedule();
  }

  function applyRuntimePreview(config, state) {
    config.enabled = state.enabled;
    config.anchor = state.anchor;
    config.width.min = state.width;
    config.width.max = state.width;
    config.width.compactMin = state.width;
    config.width.compactMax = state.width;
    config.width.viewportRatio = 0.01;
    config.offsetX = state.offsetX;
    config.offsetY = state.offsetY;
    config.normalOpacity = state.normalOpacity;
    config.overlapOpacity = state.overlapOpacity;
    config.imageAspectRatio = state.imageAspectRatio;
    if (state.imageDataUrl) config.dataUrl = state.imageDataUrl;
    schedule();
  }

  function closeDecorationSettings(restoreUnsaved = true) {
    const panel = document.getElementById(SETTINGS_PANEL_ID);
    if (panel && restoreUnsaved && panel.__snowMikuSaved !== true && panel.__snowMikuConfig && panel.__snowMikuSnapshot) {
      restoreRuntimeConfig(panel.__snowMikuConfig, panel.__snowMikuSnapshot);
    }
    panel?.__snowMikuPreviewProvenanceObserver?.disconnect?.();
    panel?.remove();
    const entry = document.getElementById(SETTINGS_ENTRY_ID);
    if (entry) entry.dataset.active = "false";
  }

  function updateSettingsPreview(panel) {
    const state = panel.__snowMikuState;
    const preview = panel.querySelector(".snow-settings-preview");
    const image = panel.querySelector(".snow-preview-decoration");
    if (!state || !preview || !image) return;
    const previewWidth = preview.clientWidth || 460;
    const previewHeight = preview.clientHeight || 410;
    ensureSettingsPreviewProvenance(panel, preview);
    const composerLeft = 24;
    const composerRight = previewWidth - 24;
    const composerTop = previewHeight - 114;
    const previewComposerWidth = composerRight - composerLeft;
    const recentComposerWidth = Number(window.__snowMikuLastComposerWidth) || 720;
    const scale = Math.max(0.25, Math.min(0.75, previewComposerWidth / recentComposerWidth));
    const width = state.width * scale;
    const height = width * state.imageAspectRatio;
    const referenceComposer = {
      left: composerLeft / scale,
      right: composerRight / scale,
      top: composerTop / scale
    };
    const position = calculateDecorationPosition({
      ...panel.__snowMikuConfig,
      anchor: state.anchor,
      offsetX: state.offsetX,
      offsetY: state.offsetY
    }, referenceComposer, state.width, state.width * state.imageAspectRatio, previewWidth / scale, previewHeight / scale);
    const left = position.left * scale;
    const top = position.top * scale;
    image.style.width = Math.round(width) + "px";
    image.style.left = Math.round(left) + "px";
    image.style.top = Math.round(top) + "px";
    image.style.opacity = state.enabled ? String(state.simulateOverlap ? state.overlapOpacity : state.normalOpacity) : "0";
    if (image.src !== (state.imageDataUrl || panel.__snowMikuConfig.dataUrl)) image.src = state.imageDataUrl || panel.__snowMikuConfig.dataUrl;
  }

  function openDecorationSettings() {
    const entry = document.getElementById(SETTINGS_ENTRY_ID) || ensureSettingsUI();
    const reference = entry?.__snowMikuReference || findSettingsReferenceRow();
    const config = DECORATIONS[0];
    if (!entry || !reference || !config) return false;
    closeDecorationSettings(true);
    entry.dataset.active = "true";

    const sidebar = findSettingsSidebar(reference);
    const sidebarRect = sidebar?.getBoundingClientRect() || reference.getBoundingClientRect();
    const panel = applyProvenanceMarker(createElement("section"));
    panel.id = SETTINGS_PANEL_ID;
    panel.style.left = Math.max(220, Math.round(sidebarRect.right)) + "px";
    panel.__snowMikuConfig = config;
    panel.__snowMikuSnapshot = JSON.parse(JSON.stringify(config));
    panel.__snowMikuSaved = false;
    panel.__snowMikuState = {
      enabled: config.enabled !== false,
      anchor: config.anchor,
      width: Math.round(config.width.max),
      offsetX: Math.round(config.offsetX),
      offsetY: Math.round(config.offsetY),
      normalOpacity: config.normalOpacity,
      overlapOpacity: config.overlapOpacity,
      imageAspectRatio: config.imageAspectRatio,
      imageDataUrl: "",
      simulateOverlap: false
    };
    panel.innerHTML = '<div class="snow-settings-page">' +
      '<div class="snow-settings-header"><h1 class="snow-settings-title">装饰配置</h1><p class="snow-settings-subtitle">自定义会话页面的装饰图片、大小与位置。预览会实时更新，点击保存后重启仍会保留。</p></div>' +
      '<div class="snow-settings-grid"><div><div class="snow-settings-card">' +
      '<div class="snow-settings-row"><div class="snow-settings-row-head"><div><span class="snow-settings-label">启用装饰</span><span class="snow-settings-help">在会话页和新任务页显示装饰</span></div><input class="snow-settings-switch" data-field="enabled" type="checkbox"></div></div>' +
      '<div class="snow-settings-row"><div class="snow-settings-row-head"><div><span class="snow-settings-label">装饰图片</span><span class="snow-settings-help">支持 PNG、JPEG、WebP、GIF、AVIF，最大 20 MB</span></div><button class="snow-settings-button" data-action="choose">选择图片</button></div><div class="snow-settings-file-name" data-role="file-name">当前图片</div><input data-field="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden></div>' +
      '<div class="snow-settings-row"><div class="snow-settings-row-head"><div><span class="snow-settings-label">锚点</span><span class="snow-settings-help">决定装饰贴合输入框或窗口的位置</span></div><select class="snow-settings-select" data-field="anchor"><option value="composer-top-right">输入框右上</option><option value="composer-top-left">输入框左上</option><option value="viewport-bottom-right">窗口右下</option><option value="viewport-bottom-left">窗口左下</option></select></div></div>' +
      '<div class="snow-settings-row"><span class="snow-settings-label">大小</span><div class="snow-settings-range-line"><input class="snow-settings-range" data-field="width" type="range" min="48" max="280" step="1"><span class="snow-settings-value" data-value="width"></span></div></div>' +
      '<div class="snow-settings-row"><span class="snow-settings-label">水平位置</span><span class="snow-settings-help">负数向左，正数向右</span><div class="snow-settings-range-line"><input class="snow-settings-range" data-field="offsetX" type="range" min="-300" max="300" step="1"><span class="snow-settings-value" data-value="offsetX"></span></div></div>' +
      '<div class="snow-settings-row"><span class="snow-settings-label">垂直位置</span><span class="snow-settings-help">负数向上，正数向下</span><div class="snow-settings-range-line"><input class="snow-settings-range" data-field="offsetY" type="range" min="-250" max="250" step="1"><span class="snow-settings-value" data-value="offsetY"></span></div></div>' +
      '<div class="snow-settings-row"><span class="snow-settings-label">普通透明度</span><div class="snow-settings-range-line"><input class="snow-settings-range" data-field="normalOpacity" type="range" min="10" max="100" step="1"><span class="snow-settings-value" data-value="normalOpacity"></span></div></div>' +
      '<div class="snow-settings-row"><span class="snow-settings-label">遮挡时透明度</span><span class="snow-settings-help">装饰与文字或图片重叠时自动使用</span><div class="snow-settings-range-line"><input class="snow-settings-range" data-field="overlapOpacity" type="range" min="0" max="100" step="1"><span class="snow-settings-value" data-value="overlapOpacity"></span></div></div>' +
      '</div></div><div><div class="snow-settings-card snow-settings-preview-card"><div class="snow-settings-preview-title"><span>效果预览</span><label><input data-field="simulateOverlap" type="checkbox"> 模拟文字重叠</label></div>' +
      '<div class="snow-settings-preview"><div class="snow-preview-message"><div class="snow-preview-line"></div><div class="snow-preview-line"></div><div class="snow-preview-line short"></div></div><div class="snow-preview-composer"><span class="snow-preview-placeholder">随心输入</span><div class="snow-preview-toolbar"><span>＋　替我审批</span><span>5.6 Sol 高　↑</span></div></div><img class="snow-preview-decoration" alt=""></div></div>' +
      '<div class="snow-settings-actions"><button class="snow-settings-button" data-action="reset">恢复默认</button><button class="snow-settings-button primary" data-action="save">保存设置</button></div><div class="snow-settings-status" data-role="status"></div></div></div></div>';
    document.body.appendChild(panel);

    const state = panel.__snowMikuState;
    const enabledInput = panel.querySelector('[data-field="enabled"]');
    const anchorInput = panel.querySelector('[data-field="anchor"]');
    const fileInput = panel.querySelector('[data-field="image"]');
    const overlapInput = panel.querySelector('[data-field="simulateOverlap"]');
    enabledInput.checked = state.enabled;
    anchorInput.value = state.anchor;
    overlapInput.checked = state.simulateOverlap;

    function syncControls() {
      for (const field of ["width", "offsetX", "offsetY"]) {
        const input = panel.querySelector('[data-field="' + field + '"]');
        input.value = String(state[field]);
        panel.querySelector('[data-value="' + field + '"]').textContent = String(state[field]) + "px";
      }
      for (const field of ["normalOpacity", "overlapOpacity"]) {
        const input = panel.querySelector('[data-field="' + field + '"]');
        input.value = String(Math.round(state[field] * 100));
        panel.querySelector('[data-value="' + field + '"]').textContent = Math.round(state[field] * 100) + "%";
      }
      updateSettingsPreview(panel);
      applyRuntimePreview(config, state);
    }

    enabledInput.addEventListener("change", () => { state.enabled = enabledInput.checked; syncControls(); });
    anchorInput.addEventListener("change", () => { state.anchor = anchorInput.value; syncControls(); });
    overlapInput.addEventListener("change", () => { state.simulateOverlap = overlapInput.checked; updateSettingsPreview(panel); });
    for (const field of ["width", "offsetX", "offsetY"]) {
      panel.querySelector('[data-field="' + field + '"]').addEventListener("input", (event) => {
        state[field] = Number(event.target.value);
        syncControls();
      });
    }
    for (const field of ["normalOpacity", "overlapOpacity"]) {
      panel.querySelector('[data-field="' + field + '"]').addEventListener("input", (event) => {
        state[field] = Number(event.target.value) / 100;
        syncControls();
      });
    }
    panel.querySelector('[data-action="choose"]').addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      const status = panel.querySelector('[data-role="status"]');
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) { status.textContent = "图片超过 20 MB，请重新选择"; return; }
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        state.imageDataUrl = String(reader.result || "");
        panel.querySelector('[data-role="file-name"]').textContent = file.name;
        const probe = new Image();
        probe.addEventListener("load", () => {
          if (probe.naturalWidth > 0) state.imageAspectRatio = probe.naturalHeight / probe.naturalWidth;
          syncControls();
        });
        probe.src = state.imageDataUrl;
      });
      reader.readAsDataURL(file);
    });
    panel.querySelector('[data-action="save"]').addEventListener("click", () => {
      const saveButton = panel.querySelector('[data-action="save"]');
      const status = panel.querySelector('[data-role="status"]');
      if (typeof window[SETTINGS_BINDING] !== "function") { status.textContent = "设置桥未连接，请从 ChatGPT 装饰版启动"; return; }
      saveButton.disabled = true;
      status.textContent = "正在保存…";
      panel.__snowMikuSaved = true;
      window[SETTINGS_BINDING](JSON.stringify({
        requestId: Date.now() + "-" + Math.random(), action: "save", id: config.id,
        settings: {
          enabled: state.enabled, anchor: state.anchor, width: state.width,
          offsetX: state.offsetX, offsetY: state.offsetY,
          normalOpacity: state.normalOpacity, overlapOpacity: state.overlapOpacity,
          imageAspectRatio: state.imageAspectRatio
        },
        imageDataUrl: state.imageDataUrl || undefined
      }));
    });
    panel.querySelector('[data-action="reset"]').addEventListener("click", () => {
      const status = panel.querySelector('[data-role="status"]');
      if (typeof window[SETTINGS_BINDING] !== "function") { status.textContent = "设置桥未连接，请从 ChatGPT 装饰版启动"; return; }
      status.textContent = "正在恢复默认设置…";
      panel.__snowMikuSaved = true;
      window[SETTINGS_BINDING](JSON.stringify({ requestId: Date.now() + "-" + Math.random(), action: "reset" }));
    });
    syncControls();
    return true;
  }

  function ensureSettingsUI() {
    const existing = document.getElementById(SETTINGS_ENTRY_ID);
    if (existing?.isConnected) return existing;
    const reference = findSettingsReferenceRow();
    if (!reference?.parentElement) return null;
    const insertionReference = findSettingsBottomRow(reference) || reference;
    const entry = createElement("button");
    entry.id = SETTINGS_ENTRY_ID;
    entry.type = "button";
    entry.dataset.active = "false";
    entry.appendChild(createElement("span", "snow-settings-icon", "❄"));
    entry.appendChild(createElement("span", "", "装饰配置"));
    entry.__snowMikuReference = insertionReference;
    insertionReference.insertAdjacentElement("afterend", entry);
    entry.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openDecorationSettings();
    });
    return entry;
  }

  settingsNavigationHandler = (event) => {
    const panel = document.getElementById(SETTINGS_PANEL_ID);
    if (!panel || panel.contains(event.target) || event.target.closest?.("#" + SETTINGS_ENTRY_ID)) return;
    const row = event.target.closest?.("button, a, [role=button]");
    if (row && row.getBoundingClientRect().left < 440) closeDecorationSettings(true);
  };
  settingsResultHandler = (event) => {
    const panel = document.getElementById(SETTINGS_PANEL_ID);
    const status = panel?.querySelector('[data-role="status"]');
    if (!panel || !status) return;
    status.textContent = event.detail?.message || (event.detail?.ok ? "设置已保存" : "保存失败");
    const saveButton = panel.querySelector('[data-action="save"]');
    if (saveButton) saveButton.disabled = false;
  };
  document.addEventListener("click", settingsNavigationHandler, true);
  window.addEventListener("snow-miku-settings-result", settingsResultHandler);
  window.__snowMikuOpenDecorationSettings = openDecorationSettings;

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 80 && rect.height > 16 && rect.bottom > 0 && rect.top < innerHeight &&
      style.display !== "none" && style.visibility !== "hidden";
  }

  function findComposerInput() {
    const viewportArea = innerWidth * innerHeight;
    let best = null;
    let bestScore = -Infinity;
    for (const element of document.querySelectorAll(COMPOSER_SELECTOR)) {
      if (!isVisible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.top < innerHeight * 0.45 || rect.bottom > innerHeight + 8) continue;
      const bottomAffinity = 1 - Math.min(1, Math.abs(innerHeight - rect.bottom) / innerHeight);
      const area = Math.min(1, (rect.width * rect.height) / Math.max(1, viewportArea * 0.04));
      const score = bottomAffinity * 8 + area * 2 + rect.top / innerHeight;
      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }
    return best;
  }

  function findComposerShell(input) {
    let best = input;
    let bestScore = -Infinity;
    let element = input;
    for (let depth = 0; element && depth < 10; depth += 1, element = element.parentElement) {
      const rect = element.getBoundingClientRect();
      if (rect.width < Math.min(280, innerWidth * 0.28) || rect.height < 44 || rect.height > 300) continue;
      if (rect.bottom < innerHeight * 0.72 || rect.bottom > innerHeight + 12) continue;
      const style = getComputedStyle(element);
      const radius = Number.parseFloat(style.borderTopLeftRadius) || 0;
      const bottomDistance = Math.abs(innerHeight - rect.bottom);
      const idealHeightDistance = Math.abs(118 - rect.height);
      const score = Math.min(rect.width, innerWidth * 0.82) / innerWidth * 7 +
        Math.max(0, 3 - bottomDistance / 32) +
        Math.max(0, 2 - idealHeightDistance / 90) +
        Math.min(radius, 28) / 14 + depth * 0.06;
      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }
    return best;
  }

  function findComposerContentLayer(input, composer) {
    let element = input;
    let fallback = input;
    while (element && element !== composer) {
      const className = String(element.className || "");
      if (className.split(/\\s+/).includes("z-10")) return element;
      if (element.parentElement === composer) fallback = element;
      element = element.parentElement;
    }
    return fallback;
  }

  function decorationWidth(config) {
    const compact = innerWidth < 1050 || innerHeight < 700;
    const minimum = compact ? config.width.compactMin : config.width.min;
    const maximum = compact ? config.width.compactMax : config.width.max;
    return Math.max(minimum, Math.min(maximum, Math.round(innerWidth * config.width.viewportRatio)));
  }

  function setStyleIfChanged(element, property, value) {
    if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value);
  }

  function calculateDecorationPosition(config, composerRect, width, height, viewportWidth, viewportHeight) {
    let left;
    let top;
    if (config.anchor === "composer-top-left") {
      left = composerRect.left + config.insetX + config.offsetX;
      top = composerRect.top - height * config.imageAnchorY + config.insetY + config.offsetY;
    } else if (config.anchor === "viewport-bottom-right") {
      left = viewportWidth - width - config.insetX + config.offsetX;
      top = viewportHeight - height - config.insetY + config.offsetY;
    } else if (config.anchor === "viewport-bottom-left") {
      left = config.insetX + config.offsetX;
      top = viewportHeight - height - config.insetY + config.offsetY;
    } else {
      left = composerRect.right - width - config.insetX + config.offsetX;
      top = composerRect.top - height * config.imageAnchorY + config.insetY + config.offsetY;
    }
    return {
      left: Math.max(8, Math.min(viewportWidth - width - 8, left)),
      top: Math.max(48, Math.min(viewportHeight - height - 8, top))
    };
  }

  function positionDecoration(element, config, composer) {
    const composerRect = composer.getBoundingClientRect();
    window.__snowMikuLastComposerWidth = composerRect.width;
    const width = decorationWidth(config);
    const aspectRatio = element.naturalWidth > 0 ? element.naturalHeight / element.naturalWidth : config.imageAspectRatio;
    const height = width * aspectRatio;
    const { left, top } = calculateDecorationPosition(config, composerRect, width, height, innerWidth, innerHeight);
    setStyleIfChanged(element, "width", Math.round(width) + "px");
    setStyleIfChanged(element, "left", Math.round(left) + "px");
    setStyleIfChanged(element, "top", Math.round(top) + "px");
    setStyleIfChanged(element, "z-index", String(config.zIndex));
    setStyleIfChanged(element, "--decoration-normal-opacity", String(config.normalOpacity));
    setStyleIfChanged(element, "--decoration-overlap-opacity", String(config.overlapOpacity));
    element.dataset.snowMikuAnchor = config.anchor;
    return { left, top, right: left + width, bottom: top + height, width, height };
  }

  function rectsOverlap(a, b) {
    const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return horizontal > 2 && vertical > 2;
  }

  function intersectionRect(a, b) {
    return {
      left: Math.max(a.left, b.left),
      top: Math.max(a.top, b.top),
      right: Math.min(a.right, b.right),
      bottom: Math.min(a.bottom, b.bottom)
    };
  }

  function buildDecorationAlphaMask(element) {
    if (!element.complete || !element.naturalWidth || !element.naturalHeight) return;
    try {
      const maximum = 256;
      const scale = Math.min(1, maximum / Math.max(element.naturalWidth, element.naturalHeight));
      const width = Math.max(1, Math.round(element.naturalWidth * scale));
      const height = Math.max(1, Math.round(element.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("canvas context unavailable");
      context.drawImage(element, 0, 0, width, height);
      element.__snowMikuAlphaMask = {
        width,
        height,
        pixels: context.getImageData(0, 0, width, height).data
      };
    } catch {
      // 无法读取透明通道时退回矩形检测，确保其他图片格式仍可使用。
      element.__snowMikuAlphaMask = false;
    }
  }

  function decorationPointIsOpaque(element, elementRect, x, y) {
    if (element.__snowMikuAlphaMask === undefined) buildDecorationAlphaMask(element);
    const mask = element.__snowMikuAlphaMask;
    if (!mask) return true;
    const normalizedX = (x - elementRect.left) / elementRect.width;
    const normalizedY = (y - elementRect.top) / elementRect.height;
    if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) return false;
    const pixelX = Math.min(mask.width - 1, Math.max(0, Math.floor(normalizedX * mask.width)));
    const pixelY = Math.min(mask.height - 1, Math.max(0, Math.floor(normalizedY * mask.height)));
    return mask.pixels[(pixelY * mask.width + pixelX) * 4 + 3] >= 48;
  }

  function contentIntersectionIsVisible(parent, intersection, decoration, decorationRect) {
    const width = intersection.right - intersection.left;
    const height = intersection.bottom - intersection.top;
    if (width <= 2 || height <= 2) return false;
    const ratios = [0.1, 0.3, 0.5, 0.7, 0.9];
    for (const yRatio of ratios) {
      for (const xRatio of ratios) {
        const x = intersection.left + width * xRatio;
        const y = intersection.top + height * yRatio;
        if (!decorationPointIsOpaque(decoration, decorationRect, x, y)) continue;
        const hit = document.elementsFromPoint(x, y).find((element) => !element.closest("." + DECORATION_CLASS));
        if (hit && (hit === parent || hit.contains(parent) || parent.contains(hit))) return true;
      }
    }
    return false;
  }

  function elementHasVisibleText(element, collisionRect, decoration, decorationRect) {
    if (!element) return false;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest("." + DECORATION_CLASS)) return NodeFilter.FILTER_REJECT;
        const parentRect = parent.getBoundingClientRect();
        if (!rectsOverlap(collisionRect, parentRect)) return NodeFilter.FILTER_REJECT;
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const range = document.createRange();
    let node;
    while ((node = walker.nextNode())) {
      range.selectNodeContents(node);
      for (const textRect of range.getClientRects()) {
        if (textRect.width <= 1 || textRect.height <= 1 || !rectsOverlap(collisionRect, textRect)) continue;
        const intersection = intersectionRect(collisionRect, textRect);
        if (contentIntersectionIsVisible(node.parentElement, intersection, decoration, decorationRect)) {
          range.detach?.();
          return true;
        }
      }
    }
    range.detach?.();
    return false;
  }

  function elementHasVisibleMedia(element, collisionRect, decoration, decorationRect) {
    if (!element) return false;
    const mediaElements = element.querySelectorAll("img, picture, video, canvas");
    for (const media of mediaElements) {
      if (media.closest("." + DECORATION_CLASS)) continue;
      const mediaRect = media.getBoundingClientRect();
      // 排除头像、按钮图标和其他小型 UI 图形，只处理消息图片等实质内容。
      if (mediaRect.width < 48 || mediaRect.height < 48 || mediaRect.width * mediaRect.height < 4096) continue;
      if (!rectsOverlap(collisionRect, mediaRect)) continue;
      const style = getComputedStyle(media);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      const intersection = intersectionRect(collisionRect, mediaRect);
      // 继续核对屏幕最上层命中，避免把已被输入框遮住的滚动图片算作重叠。
      if (contentIntersectionIsVisible(media, intersection, decoration, decorationRect)) return true;
    }
    return false;
  }

  function updateOverlapState(element, config) {
    if (!config.detectTextOverlap) {
      element.classList.remove(OVERLAP_CLASS);
      element.dataset.snowMikuTextOverlap = "false";
      element.dataset.snowMikuOverlapReason = "none";
      return;
    }
    const rect = element.getBoundingClientRect();
    const collisionRect = {
      left: rect.left + 4,
      top: rect.top + 4,
      right: rect.right - 4,
      bottom: rect.bottom - 4
    };
    // 横幅、新任务引导、建议卡片和状态提示并不属于会话或输入框 DOM。
    // 扫描整个页面，再由 elementsFromPoint 排除已经被输入框等上层界面遮住的文字。
    const textOverlap = elementHasVisibleText(document.body, collisionRect, element, rect);
    const mediaOverlap = !textOverlap && elementHasVisibleMedia(document.body, collisionRect, element, rect);
    const overlaps = textOverlap || mediaOverlap;
    element.classList.toggle(OVERLAP_CLASS, overlaps);
    element.dataset.snowMikuTextOverlap = overlaps ? "true" : "false";
    element.dataset.snowMikuOverlapReason = textOverlap ? "text" : mediaOverlap ? "media" : "none";
  }

  function ensureDecoration(config) {
    const id = "snow-miku-runtime-decoration-" + config.id;
    let element = document.getElementById(id);
    if (!element) {
      element = applyProvenanceMarker(document.createElement("img"));
      element.id = id;
      element.className = DECORATION_CLASS;
      element.alt = "";
      element.draggable = false;
      element.setAttribute("aria-hidden", "true");
      document.body.appendChild(element);
    } else if (element.parentElement !== document.body) {
      document.body.appendChild(element);
    }
    if (element.__snowMikuRuntimeToken !== runtimeToken) {
      if (element.__snowMikuLoadHandler) element.removeEventListener("load", element.__snowMikuLoadHandler);
      const loadHandler = () => {
        if (disposed || element.__snowMikuRuntimeToken !== runtimeToken) return;
        buildDecorationAlphaMask(element);
        schedule();
      };
      element.__snowMikuRuntimeToken = runtimeToken;
      element.__snowMikuLoadHandler = loadHandler;
      element.addEventListener("load", loadHandler);
    }
    if (element.__snowMikuDataUrl !== config.dataUrl) {
      if (element.__snowMikuPendingDataUrl !== config.dataUrl) {
        const nextDataUrl = config.dataUrl;
        element.__snowMikuPendingDataUrl = nextDataUrl;
        const replacement = applyProvenanceMarker(new Image());
        element.__snowMikuPreloader = replacement;
        replacement.className = element.className;
        replacement.alt = "";
        replacement.draggable = false;
        replacement.setAttribute("aria-hidden", "true");
        replacement.dataset.decorationId = config.id;
        replacement.style.cssText = element.style.cssText;
        replacement.addEventListener("load", () => {
          if (disposed || element.__snowMikuRuntimeToken !== runtimeToken || element.__snowMikuPendingDataUrl !== nextDataUrl) return;
          element.__snowMikuPendingDataUrl = "";
          replacement.id = id;
          replacement.__snowMikuDataUrl = nextDataUrl;
          replacement.__snowMikuAlphaMask = undefined;
          if (element.__snowMikuLoadHandler) element.removeEventListener("load", element.__snowMikuLoadHandler);
          element.replaceWith(replacement);
          element.__snowMikuLoadHandler = null;
          element.__snowMikuPreloader = null;
          buildDecorationAlphaMask(replacement);
          schedule();
        }, { once: true });
        replacement.addEventListener("error", () => {
          if (element.__snowMikuPendingDataUrl === nextDataUrl) element.__snowMikuPendingDataUrl = "";
        }, { once: true });
        replacement.src = nextDataUrl;
      }
    } else if (element.complete && element.__snowMikuAlphaMask === undefined) {
      buildDecorationAlphaMask(element);
    }
    applyProvenanceMarker(element);
    element.dataset.decorationId = config.id;
    return element;
  }

  function observeComposer(composer) {
    if (disposed) return;
    if (observedComposer === composer) return;
    composerResizeObserver?.disconnect();
    observedComposer = composer;
    if (typeof ResizeObserver === "function") {
      composerResizeObserver = new ResizeObserver(schedule);
      composerResizeObserver.observe(composer);
    }
  }

  function syncManagedComposer(composerInput, composerContent) {
    if (!managedCleanupDone) {
      document.querySelectorAll(".snow-miku-runtime-host, ." + TEXT_LAYER_CLASS + ", ." + COMPOSER_CONTENT_CLASS + ", ." + INPUT_SAFE_CLASS).forEach((element) => {
        element.classList.remove("snow-miku-runtime-host", TEXT_LAYER_CLASS, COMPOSER_CONTENT_CLASS, INPUT_SAFE_CLASS);
        element.style.removeProperty("--snow-miku-input-safe-right");
      });
      managedCleanupDone = true;
    }
    if (managedComposerContent !== composerContent) {
      managedComposerContent?.classList.remove(COMPOSER_CONTENT_CLASS);
      managedComposerContent = composerContent;
      managedComposerContent?.classList.add(COMPOSER_CONTENT_CLASS);
    }
    if (managedComposerInput !== composerInput) {
      managedComposerInput?.classList.remove(INPUT_SAFE_CLASS);
      managedComposerInput?.style.removeProperty("--snow-miku-input-safe-right");
      managedComposerInput = composerInput;
      managedComposerInput?.classList.add(INPUT_SAFE_CLASS);
    }
  }

  function refreshOverlapOnly() {
    if (disposed) return;
    if (!managedComposerInput?.isConnected) return;
    for (const item of activeDecorations) {
      if (item.element.isConnected) updateOverlapState(item.element, item.config);
    }
  }

  function install() {
    if (disposed || !document.documentElement || !document.body) return false;
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    if (style.textContent !== CSS) style.textContent = CSS;

    const settingsEntry = ensureSettingsUI();
    if (!settingsEntry && document.getElementById(SETTINGS_PANEL_ID)) closeDecorationSettings(true);

    const composerInput = findComposerInput();
    const composer = composerInput ? findComposerShell(composerInput) : null;
    const composerContent = composerInput && composer ? findComposerContentLayer(composerInput, composer) : null;
    const configuredIds = new Set(DECORATIONS.filter((config) => config.enabled).map((config) => config.id));
    document.querySelectorAll("." + DECORATION_CLASS).forEach((element) => {
      if (!configuredIds.has(element.dataset.decorationId)) element.remove();
    });
    if (!composer) {
      document.querySelectorAll("." + DECORATION_CLASS).forEach((element) => element.classList.remove(VISIBLE_CLASS));
      syncManagedComposer(null, null);
      activeDecorations = [];
      return false;
    }

    syncManagedComposer(composerInput, composerContent);

    const inputRect = composerInput.getBoundingClientRect();
    const active = [];
    let safeRight = 0;
    for (const config of DECORATIONS) {
      if (!config.enabled) continue;
      const element = ensureDecoration(config);
      const rect = positionDecoration(element, config, composer);
      element.classList.add(VISIBLE_CLASS);
      active.push({ config, element, rect });
      if (config.reserveInputText && config.anchor.endsWith("right") && rect.left < inputRect.right) {
        safeRight = Math.max(safeRight, Math.round(inputRect.right - rect.left + config.safePadding));
      }
    }
    setStyleIfChanged(composerInput, "--snow-miku-input-safe-right", safeRight + "px");
    activeDecorations = active;
    for (const item of active) updateOverlapState(item.element, item.config);
    observeComposer(composer);
    return true;
  }

  function schedule() {
    if (disposed || queued) return;
    queued = true;
    installFrame = requestAnimationFrame(() => {
      installFrame = 0;
      queued = false;
      if (disposed) return;
      install();
    });
  }

  function scheduleOverlap() {
    if (disposed || overlapQueued) return;
    overlapQueued = true;
    overlapFrame = requestAnimationFrame(() => {
      overlapFrame = 0;
      overlapQueued = false;
      if (disposed) return;
      refreshOverlapOnly();
    });
  }

  const observer = new MutationObserver((records) => {
    if (disposed) return;
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (target?.closest?.("#" + STYLE_ID + ", ." + DECORATION_CLASS)) continue;
      schedule();
      break;
    }
  });
  observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
  window.addEventListener("resize", schedule);
  window.addEventListener("pageshow", schedule);
  window.addEventListener("popstate", schedule);
  document.addEventListener("scroll", scheduleOverlap, true);
  window.__snowMikuRuntimeObserver = observer;
  window.__snowMikuApplyDecorationConfig = (nextDecorations) => {
    if (disposed || !Array.isArray(nextDecorations)) return false;
    DECORATIONS.splice(0, DECORATIONS.length, ...nextDecorations);
    schedule();
    return true;
  };
  window.__snowMikuRuntimeCleanup = () => {
    if (disposed) return;
    disposed = true;
    if (installFrame) cancelAnimationFrame(installFrame);
    if (overlapFrame) cancelAnimationFrame(overlapFrame);
    installFrame = 0;
    overlapFrame = 0;
    queued = false;
    overlapQueued = false;
    observer.disconnect();
    composerResizeObserver?.disconnect();
    document.getElementById(SETTINGS_PANEL_ID)?.__snowMikuPreviewProvenanceObserver?.disconnect?.();
    window.removeEventListener("resize", schedule);
    window.removeEventListener("pageshow", schedule);
    window.removeEventListener("popstate", schedule);
    document.removeEventListener("scroll", scheduleOverlap, true);
    document.removeEventListener("click", settingsNavigationHandler, true);
    window.removeEventListener("snow-miku-settings-result", settingsResultHandler);
    document.removeEventListener("DOMContentLoaded", install);
    document.querySelectorAll("." + DECORATION_CLASS).forEach((element) => {
      if (element.__snowMikuRuntimeToken !== runtimeToken) return;
      if (element.__snowMikuLoadHandler) element.removeEventListener("load", element.__snowMikuLoadHandler);
      element.__snowMikuLoadHandler = null;
      element.__snowMikuPreloader = null;
      element.__snowMikuPendingDataUrl = "";
    });
  };
  window.__snowMikuRuntimeVersion = VERSION;
  Object.defineProperty(window, "__chatGPTDecorationProvenance", {
    configurable: true,
    value: PROVENANCE
  });
  Object.defineProperty(window, "__chatGPTDecorationBuild", {
    configurable: true,
    value: BUILD_FINGERPRINT
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
  return {
    installed: true,
    version: VERSION,
    provenance: PROVENANCE.marker,
    build: BUILD_FINGERPRINT.slice(-24),
    configured: DECORATIONS.filter((config) => config.enabled).length,
    decorations: DECORATIONS.map((config) => {
      const element = document.getElementById("snow-miku-runtime-decoration-" + config.id);
      return {
        id: config.id,
        visible: element?.classList.contains(VISIBLE_CLASS) === true,
        textOverlap: element?.dataset.snowMikuTextOverlap === "true",
        overlapReason: element?.dataset.snowMikuOverlapReason || "none",
        opacity: element ? getComputedStyle(element).opacity : null
      };
    })
  };
})()`;
}

let installSource = buildInstallSource(decorations);

const sessions = new Map();
let everConnected = false;
let unavailablePolls = 0;

function call(socket, method, params = {}) {
  const id = ++socket.__snowMikuSequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.__snowMikuPending.delete(id);
      reject(new Error(`${method} 超时`));
    }, 5000);
    socket.__snowMikuPending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function emitSettingsResult(socket, detail) {
  const serialized = JSON.stringify(detail).replace(/</g, "\\u003c");
  await call(socket, "Runtime.evaluate", {
    expression: `window.dispatchEvent(new CustomEvent("snow-miku-settings-result", { detail: ${serialized} }));`,
    returnByValue: true
  });
}

async function refreshConnectedPages(reopenSettingsSocket = null) {
  const sockets = [...sessions.values()].filter((socket) => socket && socket.readyState === WebSocket.OPEN);
  const serializedDecorations = JSON.stringify(decorations).replace(/</g, "\\u003c");
  for (const socket of sockets) {
    try {
      if (socket.__snowMikuScriptId) {
        await call(socket, "Page.removeScriptToEvaluateOnNewDocument", { identifier: socket.__snowMikuScriptId });
      }
      const registration = await call(socket, "Page.addScriptToEvaluateOnNewDocument", { source: installSource });
      socket.__snowMikuScriptId = registration.identifier;
      const applied = await call(socket, "Runtime.evaluate", {
        expression: `typeof window.__snowMikuApplyDecorationConfig === "function" && window.__snowMikuApplyDecorationConfig(${serializedDecorations})`,
        awaitPromise: true,
        returnByValue: true
      });
      if (applied.result?.value !== true) {
        await call(socket, "Runtime.evaluate", {
          expression: installSource,
          awaitPromise: true,
          returnByValue: true
        });
      }
      if (socket === reopenSettingsSocket) {
        await call(socket, "Runtime.evaluate", {
          expression: "window.__snowMikuOpenDecorationSettings?.()",
          returnByValue: true
        });
      }
    } catch (error) {
      console.error(`[Decorations] 刷新页面失败：${error.message}`);
    }
  }
}

async function handleSettingsBinding(socket, params) {
  let request = {};
  try {
    request = JSON.parse(String(params.payload || "{}"));
    if (request.action === "save") saveDecorationSettings(request);
    else if (request.action === "reset") resetDecorationSettings();
    else throw new Error("不支持的设置操作");

    decorations = loadDecorations(configOverride);
    installSource = buildInstallSource(decorations);
    await refreshConnectedPages(socket);
    await emitSettingsResult(socket, {
      requestId: request.requestId,
      ok: true,
      message: request.action === "reset" ? "已恢复默认装饰设置" : "装饰设置已保存并立即生效"
    });
    console.log(`[Decorations] 设置已${request.action === "reset" ? "恢复默认" : "保存"}。`);
  } catch (error) {
    try {
      await emitSettingsResult(socket, {
        requestId: request.requestId,
        ok: false,
        message: error.message
      });
    } catch {}
    console.error(`[Decorations] 保存设置失败：${error.message}`);
  }
}

async function connectTarget(target) {
  const key = target.webSocketDebuggerUrl;
  if (!key || sessions.has(key)) return;
  sessions.set(key, null);
  const socket = new WebSocket(key);
  socket.__snowMikuSequence = 0;
  socket.__snowMikuPending = new Map();

  socket.addEventListener("message", (event) => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (message.method === "Runtime.bindingCalled" && message.params?.name === SETTINGS_BINDING) {
      void handleSettingsBinding(socket, message.params);
      return;
    }
    if (!message.id) return;
    const pending = socket.__snowMikuPending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    socket.__snowMikuPending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  });

  socket.addEventListener("close", () => {
    sessions.delete(key);
    for (const pending of socket.__snowMikuPending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("调试连接已关闭"));
    }
    socket.__snowMikuPending.clear();
  });

  socket.addEventListener("error", () => sessions.delete(key));

  socket.addEventListener("open", async () => {
    sessions.set(key, socket);
    try {
      await call(socket, "Page.enable");
      await call(socket, "Runtime.enable");
      await call(socket, "Runtime.addBinding", { name: SETTINGS_BINDING });
      const registration = await call(socket, "Page.addScriptToEvaluateOnNewDocument", { source: installSource });
      socket.__snowMikuScriptId = registration.identifier;
      const result = await call(socket, "Runtime.evaluate", {
        expression: installSource,
        awaitPromise: true,
        returnByValue: true,
      });
      everConnected = true;
      console.log(`[Decorations] 已注入：${target.title || target.url || "Codex"}`, result.result?.value || "");
    } catch (error) {
      console.error(`[Decorations] 注入失败：${error.message}`);
      socket.close();
    }
  });
}

async function discover() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return;
    unavailablePolls = 0;
    const targets = await response.json();
    for (const target of targets) {
      if (target.type === "page" && target.webSocketDebuggerUrl) connectTarget(target);
    }
  } catch (error) {
    if (everConnected && sessions.size === 0) {
      unavailablePolls += 1;
      if (unavailablePolls >= 25) {
        console.log("[Decorations] ChatGPT 已关闭，注入器退出。");
        process.exit(0);
      }
    }
    if (everConnected && error.name !== "TimeoutError") {
      console.error(`[Decorations] 等待 Codex：${error.message}`);
    }
  }
}

console.log(`[Decorations] 配置驱动注入器 3.2.5 已启动，共 ${decorations.filter((decoration) => decoration.enabled).length} 个启用装饰，端口 ${port}。`);
discover();
setInterval(discover, 1200);
