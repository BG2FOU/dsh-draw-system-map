# dsh-skill-draw-system-map

公开仓库：<https://github.com/BG2FOU/dsh-draw-system-map>

把 [`AMTR-view`](https://github.com/BG2FOU/AMTR-view) 仓库中的 `draw-system-map` skill（位于 `.agents/skills/draw-system-map`）打包成 DSH 插件：一个 **skill provider bundle**。安装后，DSH 的 skill 目录里会出现 `draw-system-map`，模型可以按需加载它，用官方数据、CSV、GTFS 或拓扑数据绘制可编辑的 SVG / PNG 线网图。

- 插件本身零运行时依赖，只 import Node 内置模块。
- skill 载荷（Markdown、Python 脚本、示例、测试）原样放在 `assets/draw-system-map/`。
- 沿用 skill 的相对路径写法：`resourceBase` 指向载荷目录，模型看到的 `Base directory for this skill` 就是它。

## 安装

```bash
git clone https://github.com/BG2FOU/dsh-draw-system-map.git
cd dsh-draw-system-map
dsh plugin --profile web add "link:$PWD"
```

> 仓库名是 `dsh-draw-system-map`，包名仍是 `dsh-skill-draw-system-map`；安装命令和 profile 的 `bundles` 都以包名为准。

安装即启用（包会被追加到 profile 的 `dsh.profile.bundles`，其 `cordis.patch.yml` 再把 provider 插入组合树）。如果当前会话的 skill 目录没有立即刷新，重启一次 DSH Web 即可。

卸载：

```bash
dsh plugin --profile web remove dsh-skill-draw-system-map
```

> 目标 profile 不一定是 `web`，把命令里的 `web` 换成你的 profile 名即可。

## 验证

```bash
npm test                       # 插件单元测试（fake ctx，不依赖 DSH 安装）
npm run test:skill             # 在打包后的载荷上跑 skill 自带 102 个 unittest
npm run test:all
```

这些命令同时也是 husky 钩子（`pre-commit` 跑 `npm test`，`pre-push` 跑 `test:all`）与 GitHub Actions 执行的内容，见下文「开发与提交规范」。

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
├── .husky/                         # 本地钩子：pre-commit / commit-msg / pre-push
├── commitlint.config.mjs           # Conventional Commits 校验规则
├── .lintstagedrc.json              # 提交前只格式化本仓库自有文件
├── .prettierrc.json                # 格式化配置（.prettierignore 排除 skill 载荷）
├── .github/workflows/ci.yml        # GitHub Actions：插件测试 + skill unittest
└── LICENSE                         # CC BY-SA 4.0（沿用上游）
```

## 开发与提交规范（husky）

仓库用 [husky](https://typicode.github.io/husky/) 在本地强制检查，克隆后执行 `npm install` 会通过 `prepare` 脚本自动装好钩子（需要 Node.js 20.18+ 与 Python 3）。

| 钩子         | 检查内容                                                                                                                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre-commit` | `lint-staged` 只格式化仓库自有文件（`lib/`、`test/`、README、配置），**不碰** `assets/draw-system-map/` 的 skill 载荷；随后跑 `npm test`；并拒绝提交 `output/`、`__pycache__/`、`*.pyc`、`*.tgz`、`node_modules/` 等生成物。 |
| `commit-msg` | `commitlint` 校验 [Conventional Commits](https://www.conventionalcommits.org/)，例如 `feat: ...`、`fix: ...`、`docs: ...`；中文标题可用。                                                                                    |
| `pre-push`   | `npm run test:all`：插件测试 + skill 自带 102 个 unittest，全部通过才允许推送。                                                                                                                                              |

- 不要用 `--no-verify` 绕过；钩子失败说明提交/推送还不满足发布条件。
- skill 载荷必须与上游目录逐字节一致，因此任何格式化工具都不得作用于 `assets/draw-system-map/**`（已写入 `.prettierignore` 与 `lint-staged` 白名单）。
- 本地格式化：`npm run format`；只检查不写入：`npm run format:check`。
- 同样的测试也会在 GitHub Actions（`.github/workflows/ci.yml`）上对每次 push / PR 重跑。

## 工作原理

- `apply(ctx)`：读取 `assets/draw-system-map/SKILL.md`，解析 frontmatter 得到 `description`；载荷缺失、`name` 不匹配或描述为空时**立即报错**，不会带着坏数据上线。
- `list()`：返回一个候选（rank 600，与内置 skill 同级），带 `resourceBase` 目录和 `path`，供目录/预览使用。
- `get(candidate, options)`：每次加载都重新读 `SKILL.md` 并去掉 frontmatter，把正文交给模型；支持 `options.signal` 取消。因此改正文、references 或 scripts 后**无需重启**（改 frontmatter 的 description 才需要重载插件）。
- 候选的 `locator` 是 SKILL.md 的绝对路径；DSH 会把它原样传回 `get()`。

## 载荷同步

插件只做原样打包，不改写 skill 内容；载荷来自 [`AMTR-view`](https://github.com/BG2FOU/AMTR-view) 的 `.agents/skills/draw-system-map` 目录。

- 当前同步至源 skill commit `72c2f86`（2026-10-31，`fix(skill): match reference interchange arrows and refresh map examples`），该提交也是源目录最后一次改动；AMTR-view HEAD 为 `21dad13`。
- 插件版本 `0.2.0`：本次只换载荷，`lib/index.js` 的 provider 代码未改；用 `link:` 安装的 profile 无需重装，正文/脚本在下次加载时生效。
- 这一版新增布局模块 `scripts/schematic_layout.py`（八方向主干/支线/环线走廊骨架）与 `scripts/parallel_tracks.py`（共线线路连续平行车道、`station_offsets` 只偏移描边、站心不动），并新增 `tests/test_schematic_layout.py`、`tests/test_parallel_tracks.py`、`tests/test_station_offsets.py`、`tests/test_reference_markers.py`，skill 自带测试由 66 个增至 102 个。
- 载荷内的换乘箭头样式、SVG 示例、`references/*.md` 与 `assets/previews/*` 也随源一起刷新。
- 同步方式：用 rsync 从源目录覆盖到 `assets/draw-system-map/`，排除 `output/`、`__pycache__/`、`*.pyc` 和源目录的 `.gitignore`，再跑 `npm test` 与 `npm run test:skill` 验收。

## 相对路径与可移植性

`SKILL.md` 里的命令和链接都相对 skill 目录书写（`scripts/...`、`references/...`、`assets/...`）。DSH 会把 `resourceBase` 渲染成 `Base directory for this skill: <绝对路径>`，并提示按该目录解析，所以从任意 cwd 执行都能工作。插件安装到任何位置（`link:` 或解包后的 npm 包）都不需要改脚本。

## 与源目录的差异

- 不含 `output/`（620K 生成产物）和 `__pycache__/`、`*.pyc`。
- 不含源目录的 `.gitignore`（由本仓库根目录的 `.gitignore` 统一处理）。
- `scripts/illustrator/` 与 `references/illustrator-guide.md` 原样保留：`SKILL.md` 明确说明 Illustrator 原生 `.ai` 尚未支持（roadmap），它们只是开发草稿和测试夹具，不影响正常出图。
- 其余文件与源目录 `72c2f86` 一致。

## 兼容性

在 DSH 0.2.1-rc.5 上验证过：`dsh plugin` 隔离安装、`--dump-config` 组合、真实 `SkillRegistry` 契约、102 个 Python 测试、端到端 SVG/PNG 出图。插件只使用 `ctx.skills.registerProvider`，没有声明 `engines.dsh` 范围；升级 DSH 后若接口变动，重跑 `npm test` 即可发现。

> `npm test` / `npm run test:skill` 面向源码目录；发布用 tarball 按 `files` 白名单打包，不含 `test/` 与生成物。

## 许可与来源

本仓库是 [`AMTR-view`](https://github.com/BG2FOU/AMTR-view) 中 `draw-system-map` skill 的打包分发，沿用上游 **CC BY-SA 4.0**（见 [LICENSE](LICENSE)）。`lib/` 下的加载代码同样按该许可提供。上游作者：BG2FOU。
