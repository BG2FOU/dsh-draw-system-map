# Illustrator 工程文件：准备、原生保存与验收

**当前状态：按用户 2026-10-29 的最新决定，Illustrator 功能延期，不纳入本次公开发布，也不再阻塞 SVG/PNG 与底图版本发布。** 本文、准备工具及 JSX 作为 AMTR-view 开发草稿保留，不包含在公开包中。Linux 侧检查已通过，但原生保存、重开和编辑尚未验收；后续范围见 [roadmap.md](roadmap.md)。

## 工作流

使用同一份 JSON 和 SVG 作为源，不维护第二套线网几何。准备工具把 SVG 按原绘制顺序拆成带完整画布、继承样式、裁切定义的图层文件。Illustrator 内的 JSX 导入这些文件，按明确清单组织原生图层和子组，再保存 `.ai`。拆分文件重新组合的图像已经与桥接 SVG 做像素对照。

采用分层导入，是为了不依赖 Illustrator 是否把 SVG 的 `id` 自动识别成原生图层名。陆地/岛屿、行政填色、水域/河流、边界、地理标签、每条线路、车站和站名分别组织；同层要素保留子组。曲线、孔洞和裁切仍来自源 SVG。

只有本 skill 生成的 SVG 子集纳入当前方案。工具从 JSON 调用生成器，不接收任意第三方 SVG。`.ai` 中的手工修改不会回写 JSON；源驱动迭代继续修改 JSON，再生成新工程。

## 1. 确认 Illustrator 和字体

需要能够运行脚本的 Adobe Illustrator 桌面环境。先在 Illustrator 里选择“文件 → 脚本 → 其他脚本”，运行 [inspect_environment.jsx](../scripts/illustrator/inspect_environment.jsx)。脚本让你选择文本报告保存位置，记录 Illustrator 版本、操作系统及字体 PostScript 名称，不修改已有文档。

字体名称使用报告中的 PostScript name，不直接填 CSS 回退列表。选择覆盖所需中英文字符的字体。普通文字和粗体标题可以分别指定字体；若省略粗体字体参数，标题也使用所选普通字体。工具不会打包、安装字体或静默转曲。

Adobe 提供 [脚本运行入口](https://helpx.adobe.com/illustrator/desktop/automate-visualize-data/automate-actions/install-and-run-scripts.html)及 [AI 原生保存/PDF 兼容选项](https://helpx.adobe.com/illustrator/using/saving-artwork.html)说明。具体 JSX 行为仍需在目标版本验证，不预先宣称所有版本或两个桌面平台均通过。

## 2. 准备可搬移任务目录

在 skill 根目录运行，字体示例应替换为目标 Illustrator 中实际存在的名称：

```bash
python3 scripts/prepare_illustrator.py assets/inland-basemap-network.json \
  --output-dir output/inland-ai-job \
  --font-name NotoSansCJKsc-Regular \
  --bold-font-name NotoSansCJKsc-Bold
```

`--output-dir` 必须是尚不存在的目录。命令不会生成 `.ai`，会生成：

| 文件 | 用途 |
| --- | --- |
| `source.json`、`artwork.svg` | 源数据与原始可编辑 SVG，继续保留 |
| `bridge.svg` | 显式字体和画板尺寸的导入参考 |
| `layers/*.svg` | 按绘制顺序提取的独立图层/要素，带所需裁切定义 |
| `manifest.json` | 图层、字体、尺寸与文本清单，状态为 `prepared_not_native_verified` |
| `run-export.jsx` | 任务入口，内嵌同一份清单；不依赖目标机的 JSON 解析扩展 |
| `export_ai.jsx` | 原生导入、保存和重开检查代码 |
| `inspect_environment.jsx` | 环境与字体检查脚本 |

整个目录可以复制到另一台机器。路径均相对于该目录，目录名可以有空格或中文。不要只复制入口脚本，也不要单独改 `manifest.json` 后以为入口已更新；更换源图或字体时重新生成任务包。

默认尺寸约定为 1 个源画布单位对应 0.75 pt；可用 `--points-per-unit` 调整。导入文件的 viewBox 保持不变，物理画板尺寸使用 pt；字号和线宽同比缩放。首版为 RGB、单画板，不自动转换印刷 CMYK。桥接字体是显式选择，选择与原图不同的字体会改变排版，必须重新检查。

## 3. 在 Illustrator 中原生保存

选择“文件 → 脚本 → 其他脚本”，运行任务目录中的 `run-export.jsx`。脚本预期执行：

1. 检查字体与输入文件；已有 `network.ai` 或 `native-report.json` 时拒绝覆盖，保留此前工程和验收证据。
2. 新建 RGB 文档，逐个导入 SVG，校对画板尺寸，建立原生图层和命名子组；保持原始叠放顺序及坐标。
3. 检查文字字符、字体、位图/置入对象，确保没有整图栅格化；允许导入器将一行字拆成多个可编辑文字对象。
4. 使用 Illustrator 的保存选项生成带 PDF 兼容表示的临时候选 `.ai`，关闭后重新打开。
5. 比较重开前后的图层/对象统计、文字和画板尺寸。检查通过后将候选文件改名为 `network.ai`，写入 `native-report.json` 并打开工程供查看。

脚本只关闭其创建/导入的临时文档，不保存或关闭用户原有的未保存文档。失败时写报告，可能保留 `native-candidate-*.ai`，或最后打开失败时留下 `network.ai` 供排查；报告仍为 `failed`，文件存在不表示验收通过。重新尝试应准备新的任务目录，保留原报告及候选文件。

`native-report.json` 中的 `saved_and_reopened` 只表示脚本中的检查通过，`manual_review` 仍为 `pending`。文字比较检查字符是否丢失，不能证明阅读顺序、定位或字形正确；对象数量也不能证明裁切和曲线的视觉效果正确。

## 4. 原生视觉与编辑验收

依次使用 `metro-style-network.json`、`coastal-basemap-network.json`、`inland-basemap-network.json`：

- 与 `bridge.svg` 对照整体画板和局部：双语站名、换乘箭头、空心段/转换点、海岸曲线、湖中岛、池塘、行政裁切和共享界线。
- 确认 RGB 色值与源数据一致，记录文档颜色配置文件和导入时的颜色管理提示；脚本只检查 RGB 模式，不证明颜色配置转换无差异。
- 在副本中修改站名，确认仍为文字；移动线路/岸线锚点、改变一条线路颜色，确认路径可编辑。
- 分别隐藏底图、地理标签、线路和站名图层，确认命名/归属和叠放关系正确。
- 保存副本、关闭重开，再检查改动与图层。保留原始交付文件作为对照。
- 记录 Illustrator/操作系统/字体版本、颜色配置、脚本报告、通过/失败项及已知限制；必要时附全图与局部截图。

以后恢复 Illustrator 功能时，须完成三份示例的实际验收，才能发布 `.ai` 支持；这不是当前 SVG/PNG 与底图版本的发布门槛。不改名 PDF/EPS 来代替原生 `.ai`。

## 本地检查的实际边界

Python 测试验证任务目录、拒绝覆盖、源文件保留、图层顺序、裁切引用、单位与字体声明，以及拆分后重组的像素等价。JSX 可进行普通 JavaScript 语法检查；这些都不能验证 Illustrator 的对象模型、SVG 导入器或原生保存行为。当前尚未提供已通过原生验收的 `.ai` 示例。
