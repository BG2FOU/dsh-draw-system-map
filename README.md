# dsh-skill-draw-system-map

把 [`AMTR-view`](https://github.com/BG2FOU/AMTR-view) 仓库中的 `draw-system-map` skill（位于 `.agents/skills/draw-system-map`）打包成 DSH 插件：一个 **skill provider bundle**。安装后，DSH 的 skill 目录里会出现 `draw-system-map`，模型可以按需加载它，用官方数据、CSV、GTFS 或拓扑数据绘制可编辑的 SVG / PNG 线网图。

- 插件本身零运行时依赖，只 import Node 内置模块。
- skill 载荷（Markdown、Python 脚本、示例、测试）原样放在 `assets/draw-system-map/`。
- 沿用 skill 的相对路径写法：`resourceBase` 指向载荷目录，模型看到的 `Base directory for this skill` 就是它。

## 安装

```bash
cd /path/to/dsh-skill-draw-system-map
dsh plugin --profile web add "link:$PWD"
```

安装即启用（包会被追加到 profile 的 `dsh.profile.bundles`，其 `cordis.patch.yml` 再把 provider 插入组合树）。在 HMR 下插件会立即重载；如果不生效，重启一次 DSH Web 即可。

卸载：

```bash
dsh plugin --profile web remove dsh-skill-draw-system-map
```

> 目标 profile 不一定是 `web`，把命令里的 `web` 换成你的 profile 名即可。

## 验证

```bash
npm test                       # 插件单元测试（fake ctx，不依赖 DSH 安装）
npm run test:skill             # 在打包后的载荷上跑 skill 自带 66 个 unittest
npm run test:all
```

端到端（用打包后的脚本真实出图）：

```bash
cd assets/draw-system-map
mkdir -p output
python3 scripts/draw_map.py assets/minimal-network.json --output output/check.svg
python3 scripts/export_png.py output/check.svg output/check.png   # 需要本机有 SVG 渲染器
```

## 目录结构

```text
.
├── lib/index.js                    # skill provider（name / inject / apply / list / get）
├── cordis.patch.yml                # bundle 补丁：把 provider 插入 profile
├── icon.svg                        # 插件图标
├── assets/draw-system-map/         # skill 本体（SKILL.md、references、scripts、assets、tests）
├── test/plugin.test.mjs            # 插件单元测试
└── LICENSE                         # CC BY-SA 4.0（沿用上游）
```

## 工作原理

- `apply(ctx)`：读取 `assets/draw-system-map/SKILL.md`，解析 frontmatter 得到 `description`；载荷缺失、`name` 不匹配或描述为空时**立即报错**，不会带着坏数据上线。
- `list()`：返回一个候选（rank 600，与内置 skill 同级），带 `resourceBase` 目录和 `path`，供目录/预览使用。
- `get(candidate, options)`：每次加载都重新读 `SKILL.md` 并去掉 frontmatter，把正文交给模型；支持 `options.signal` 取消。因此改正文、references 或 scripts 后**无需重启**（改 frontmatter 的 description 才需要重载插件）。
- 候选的 `locator` 是 SKILL.md 的绝对路径；DSH 会把它原样传回 `get()`。

## 相对路径与可移植性

`SKILL.md` 里的命令和链接都相对 skill 目录书写（`scripts/...`、`references/...`、`assets/...`）。DSH 会把 `resourceBase` 渲染成 `Base directory for this skill: <绝对路径>`，并提示按该目录解析，所以从任意 cwd 执行都能工作。插件安装到任何位置（`link:` 或解包后的 npm 包）都不需要改脚本。

## 与源目录的差异

- 不含 `output/`（620K 生成产物）和 `__pycache__/`、`*.pyc`。
- 不含源目录的 `.gitignore`（由本仓库根目录的 `.gitignore` 统一处理）。
- `scripts/illustrator/` 与 `references/illustrator-guide.md` 原样保留：`SKILL.md` 明确说明 Illustrator 原生 `.ai` 尚未支持（roadmap），它们只是开发草稿和测试夹具，不影响正常出图。
- 其余文件与源目录一致。

## 许可与来源

本仓库是 [`AMTR-view`](https://github.com/BG2FOU/AMTR-view) 中 `draw-system-map` skill 的打包分发，沿用上游 **CC BY-SA 4.0**（见 [LICENSE](LICENSE)）。`lib/` 下的加载代码同样按该许可提供。上游作者：BG2FOU。
