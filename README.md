<div align="center">

中文 | [English](README.en.md)

# Styrigx Curio

奇趣（Curio）：在网上偶然遇到、想留下的好东西，一格一件收起来。

[在线访问 curio.styrigx.com](https://curio.styrigx.com) · [主站 styrigx.com](https://styrigx.com) · [日刻 daymark.styrigx.com](https://daymark.styrigx.com) · [博客 blog.styrigx.com](https://blog.styrigx.com) · [GitHub @styrigx](https://github.com/styrigx)

![Hugo](https://img.shields.io/badge/dynamic/yaml?url=https://raw.githubusercontent.com/styrigx/styrigx-space/main/.github/actions/setup-hugo/action.yml&query=%24..HUGO_VERSION&label=Hugo&style=flat-square&color=2563eb&logo=hugo)
![Version](https://img.shields.io/badge/dynamic/yaml?url=https://raw.githubusercontent.com/styrigx/styrigx-curio/main/web/hugo.yaml&query=%24.params.version&label=Curio&style=flat-square&color=2563eb)
![Deploy](https://img.shields.io/github/actions/workflow/status/styrigx/styrigx-curio/deploy.yml?style=flat-square&label=Deploy&color=2563eb)
![License](https://img.shields.io/badge/License-MIT-2563eb?style=flat-square)

</div>

---

## 这是什么

Styrigx's Space 的子站，从主站的「书签」独立出来（2026-10-21）：自己的仓库、自己的 Pages、自己的 Worker、自己的 D1 和 R2。
名字取自多宝格（中国人自己的 curio cabinet）：一格放一件。界面和日刻、博客同款沉浸式 app：左边九宫格切站，中间长条是 **发现 / 设备 / 游戏** 三段滑块，右边分享按钮（管理员生成带临时会话的短链，访客分享当前页）；
深浅色、调色板、强调色、语言都跟主站设置走（`sgx-ui` cookie，首帧前读，不闪屏）。

## 能做什么

- **三个页签**（顶栏分段滑块，左右滑也能切；`#devices` / `#games` 直达）：
  - **发现**：收藏的网站。分类条 + 格子，每格是网站图标、名字、一句简介；点开新标签页。
  - **设备**：用过的设备。照片、类型、购买 / 退役日期（使用天数自动算）、系统版本、参数、配件、体验，退役时记下换成了哪台，详情里能顺着换代往前往后看。
  - **游戏**：玩过 / 想玩的游戏。封面、平台、在哪台设备上玩、版本、状态（想玩 / 在玩 / 通关 / 搁置）、评分、评价。
- **图标**：Worker 去网站抓 apple-touch-icon / favicon，存进 R2，同一个网站共用一份；抓不到显示首字母方块（同一个域名同一个颜色）。
- **管理员**：右下角按钮跟着页签变（「收藏」「设备」「游戏」）；设备和游戏点卡片看详情、左上角编辑。发现里：右下角「收藏」（填网址后「自动填写」抓标题和简介）、长按格子编辑（换分类、上下移、私密、删除）、「⋯」里管理分类。
- **导入浏览器书签**：三星浏览器、Chrome 等导出的 `.html`（Netscape 书签格式）。文件夹 → 分类，已有的网址跳过，**默认仅自己可见**；
  原文件先原样存进 R2（`imports/<时间>-<哈希>.html`）再导入，存不进去就不导入。
- **导出**：整份收藏导出成浏览器能直接导入的书签文件。
- **私密**：分类或收藏都能设成仅自己可见；访客看不到私密分类、私密收藏和空分类。
- 中英文：名字、简介各两份，当前语言那份空着就显示另一份。

## 怎么搭的

| 部分 | 用什么 |
|---|---|
| 页面 | Hugo + Tailwind 4（CSS-first 配置写在 `web/assets/css/input.css`，`npm run build:css` 用 `@tailwindcss/cli`），Cloudflare Pages 只放静态文件 |
| 接口 | Worker `styrigx-curio-core`（`workers/core/`），路由 `curio.styrigx.com/api/*` |
| 数据 | Cloudflare D1 `styrigx-curio-core`（分类、收藏、导入记录、设备、游戏） |
| 文件 | Cloudflare R2 `styrigx-curio-core`（`icons/` 图标缓存、`imports/` 导入原文备份、`photos/` 设备照片和游戏封面） |
| 登录 | 不持任何钥匙：页面由主站鉴权网关验会话，接口经服务绑定问网关 |

目录说明见 [STRUCTURE.md](STRUCTURE.md)。

## 接口

全部要有效会话（没有公开接口）；写操作只给管理员，且必须同源。

| 接口 | 谁能用 | 做什么 |
|---|---|---|
| `GET /api/links` | 有效会话 | 全部分类和收藏；管理员含私密，访客只有公开的 |
| `POST /api/links` | 管理员 + 同源 | `{op}`：`cat.add / cat.edit / cat.del / cat.order / link.add / link.edit / link.del / link.order` |
| `POST /api/import[?private=0]` | 管理员 + 同源 | body 是书签文件原文；先备份到 R2 再导入 |
| `GET /api/export[?lang=en]` | 管理员 + 同站 | 下载书签文件 |
| `GET /api/preview?url=` | 管理员 + 同站 | 抓网页标题、简介、图标（只抓公网地址） |
| `GET /api/icon?id=` | 有效会话 | 收藏的图标（R2 缓存，浏览器缓存一周） |
| `GET /api/items` | 有效会话 | 全部设备和游戏；管理员含私密，访客只有公开的 |
| `POST /api/items` | 管理员 + 同源 | `{op}`：`device.add / device.edit / device.del / device.order / game.add / game.edit / game.del / game.order` |
| `GET /api/photo?kind=device\|game&id=` | 有效会话 | 设备照片 / 游戏封面（访客拿不到私密条目的） |
| `POST` `DELETE /api/photo?kind=…&id=` | 管理员 + 同源 | 传（webp / jpeg / png，≤ 3 MB，浏览器先缩到长边 1600）/ 删照片 |

数据库迁移在 `workers/core/migrations/`，CI 部署 core 之前自动跑（`d1 migrations apply styrigx-curio-core --remote`）。
`0002_seed` 是从主站书签迁来的初始收藏（`data/seed.json` → `node scripts/gen-seed-sql.mjs`），只往空库里写，不删不改已有数据。

## 本地开发

```bash
npm ci
npm run build:css
hugo server -s web
npm test            # 单元测试（Node 22+，D1 的 SQL 用 node:sqlite 真跑，含迁移和导入）
node scripts/gen-seed-sql.mjs     # 改了 data/seed.json 以后重新生成种子迁移
node scripts/sync-shell.mjs       # 主站共享外壳改了以后同步（默认主站 main；--ref <分支>、--from <本地主站目录>）
npm run test:e2e    # 手机 E2E（先 hugo --minify -s web）
```

## 主站共享外壳

色彩角色（22 套预设 × 亮 / 暗 + 自定义种子）、顶栏材质、导航抽屉、自定义主题色引擎、抽屉项都来自主站 styrigx-space 的 `web/shared/shell`，
副本在 `web/assets/css/input.css` 的 `@sgx-shell:begin / end` 段、`web/assets/js/sgx/shell/`、`web/assets/sgx-shell/`，来源和版本记在 `sgx-shell.lock.json`。
**不要手改**：主站改了以后跑 `node scripts/sync-shell.mjs`，再 `npm run build:css`。CI 跑 `--check`，副本被手改或落后主站 main 都会红。

### 外观 cookie（`sgx-ui`）

深浅色、调色板、主题色读主站写的 `sgx-ui` cookie（本站只读，不写）。cookie 的属性、字段、版本、旧数据迁移和改格式的步骤见主站契约
[docs/ui-cookie-contract.md](https://github.com/styrigx/styrigx-space/blob/main/docs/ui-cookie-contract.md)。
本仓库读它的是主站共享外壳的读端 `web/assets/js/sgx/shell/ui-cookie-read.js`（sync-shell 原样同步，勿手改），
由 `web/layouts/_default/baseof.html` 原样内联进 `<head>`，紧跟的 `web/assets/js/sgx/ui-inherit-run.js` 调 `SgxUI.apply` 首帧前落外观；
语言跟随在 `web/assets/js/sgx/lib/ui-inherit.js`：只认读端 `SgxUI.read().lang`（主站用户明确选的 `zh` / `en`；跟随系统为空，不跳）。
契约夹具 `tests/fixtures/ui-cookie-contract.json`（同样由 sync-shell 同步）由 `tests/web/ui-cookie-contract.test.mjs` 和 `tests/web/e2e/ui-cookie.spec.js` 逐个跑；
主站改了 cookie 格式，跑 `node scripts/sync-shell.mjs` 同步读端和夹具即可，本仓库不用改代码。

## 许可

[MIT](LICENSE)
