# ChatGPT/Codex 暗色主题装饰系统（配置驱动版 3.2.5）

3.2.5 修复新版客户端中“装饰配置”入口位置错误：兼容“已归档的聊天”新名称，并在名称变化时自动选择侧栏最靠下的菜单项；同时保留预览署名、来源标记、GIF 动画与预览/实际坐标一致等修复。

这是安全运行时装饰系统。它不会修改、重签名或替换 `ChatGPT.app` / `Codex.app` 中的任何文件。所有装饰都由 `decorations.json` 描述，图片保存在补丁目录中。

## 启动

1. 在 ChatGPT/Codex 中按 `Cmd+Q`，确保应用完全退出。
2. 双击 `launch.command`。
3. 启动器读取 `decorations.json` 和图片，以仅监听本机的临时调试端口打开官方客户端。

从 Dock/Finder 普通启动仍是无装饰的原版。只关闭窗口而不退出时无需重新运行；按 `Cmd+Q`、重启电脑或更新客户端后，需要再次运行 `launch.command`。

## 新增装饰

推荐在 Codex 中打开“设置 → 装饰配置”，直接选择图片并调整参数。面板带有实时预览和遮挡模拟，保存后会立即应用。

也可以继续手动编辑配置：

1. 把透明 PNG、JPEG、WebP、GIF 或 AVIF 放入 `assets/`。
2. 复制 `decorations.json` 中现有的一个对象。
3. 修改 `id`、`asset` 和所需参数；每个 `id` 必须唯一。
4. 完全退出 ChatGPT，再运行 `launch.command`。

示例：

```json
{
  "id": "snowflake",
  "enabled": true,
  "asset": "assets/snowflake.png",
  "anchor": "viewport-bottom-left",
  "width": {
    "min": 64,
    "viewportRatio": 0.05,
    "max": 96,
    "compactMin": 48,
    "compactMax": 72
  },
  "imageAnchorY": 1,
  "insetX": 24,
  "insetY": 90,
  "offsetX": 0,
  "offsetY": 0,
  "normalOpacity": 0.7,
  "overlapOpacity": 0.2,
  "detectTextOverlap": true,
  "reserveInputText": false,
  "safePadding": 12,
  "zIndex": 35
}
```

## 参数

- `enabled`：设为 `false` 可暂时停用。
- `asset`：相对于补丁目录的图片路径，文件必须留在补丁目录内。
- `anchor`：支持 `composer-top-right`、`composer-top-left`、`viewport-bottom-right`、`viewport-bottom-left`。
- `width.min/max`：普通窗口下的最小和最大宽度，单位为 CSS 像素。
- `width.viewportRatio`：窗口宽度乘数；`0.075` 表示窗口宽度的 7.5%。
- `width.compactMin/compactMax`：窄窗口或低高度窗口下的尺寸范围。
- `imageAnchorY`：图片垂直锚点，顶部为 `0`、底部为 `1`；坐姿人物通常约为 `0.6–0.7`。
- `insetX/insetY`：相对锚点向内部收进的距离。
- `offsetX/offsetY`：额外微调；正数向右/向下，负数向左/向上。
- `normalOpacity`：没有文字重叠时的透明度。
- `overlapOpacity`：与会话正文或输入文字重叠时的透明度。
- `detectTextOverlap`：是否检测真实文字行框并自动切换透明度。
- `reserveInputText`：右侧装饰是否让编辑器预留安全区，避免长文本进入人物区域。
- `safePadding`：安全区额外留白。
- `zIndex`：装饰自身层级；建议保持在 `20–60`。

`decorations.schema.json` 提供字段约束和说明。支持 JSON Schema 的编辑器会自动提示字段和可选值。

## 检查配置

双击 `check.command` 会检查 `decorations.json`、图片文件、官方应用签名相关文件哈希，并显示最近的注入日志。配置格式或图片路径错误时，启动器会安全退出，不会启动损坏的主题实例。

## 当前默认装饰

默认 `snow-miku` 条目复刻 2.4.2 的效果：

- 以素材 65% 高度处的坐姿点贴合输入框上沿；
- 普通透明度 90%，文字重叠时 20%；
- 保留输入框右侧文字安全区；
- 会话页和新任务页均显示，且不随会话滚动。

## 更新后快速接入

官方应用更新后无需修改应用包，继续运行 `launch.command` 即可。如果页面结构变化，最坏结果是装饰不显示，不会造成应用包损坏。

## 安全边界

- 不写入 `app.asar`、`Info.plist`、可执行文件或代码签名。
- 调试端口只绑定 `127.0.0.1`，每次启动随机选择。
- 图片在本地读取并转为页面数据，不会上传。
- 关闭 ChatGPT 后注入连接随之关闭。

## 卸载与紧急回滚

双击 `restore-original.command` 或 `uninstall.command`：

1. 停止装饰注入器；
2. 正常结束主题模式实例；
3. 验证官方应用签名；
4. 不带开发参数重新启动原版。

账号、会话、项目和 `~/.codex` 配置不会被删除。
