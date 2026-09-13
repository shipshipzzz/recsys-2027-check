# 本地文件 → GitHub → Supabase → GitHub Pages

## 日常只维护哪里

招聘卡片的唯一日常维护源是仓库中的 `data/rec.json` 和 `data/soe.json`。`main` 分支每次 push 后，Actions 自动校验、测试、构建、事务同步 Supabase、核对云端数据、发布 `dist/`。不必打开 Supabase Table Editor，也不必重新生成或手工执行 `seed.sql`。

网页标题、静态说明、排版样式仍在 `index.html`、`soe.html` 和 `src/` 中。它们也通过相同 push 自动部署，不属于数据库卡片字段。`RECHECKED` 表示招聘信息实际核查日期，不是代码发布日期，不能只因部署就改成今天。

个人投递状态仍由网页自动写入 `user_card_states`。卡片发布脚本不读取、不覆盖、不删除该表，也不修改 Auth 账号。跨设备同步继续要求登录同一个账号。

## 一次性启用

数据库同步函数的安装文件是 `supabase/migrations/202609130003_catalog_sync.sql`。它在原有两份 migration 之后安装；本项目已执行安装。以后更新现有卡片字段不再运行 migration。

GitHub → 仓库 Settings → Environments → `github-pages` → Environment secrets 添加：

- Name：`SUPABASE_SECRET_KEY`
- Value：Supabase 项目的服务端 secret API key（`sb_secret_` 开头）。本次专门创建的密钥名为 `github_catalog_sync`。

不要使用浏览器 publishable key；不要把 secret 放进聊天、代码、README、JSON、`.env.example`、`VITE_*` 或 git。workflow 只在同步那一步注入 secret，安装依赖、测试、构建和公开数据校验都不需要它。缺少 secret 会让发布失败并保留原 Pages 部署。

Supabase secret key 仍具有项目级服务端权限；“专用密钥”便于撤销和轮换，不代表平台已把该 key 的权限限制为这10张表。实际日常同步由只允许公共表的 RPC 和脚本约束。只有可信维护者可以修改 main 分支的代码与 workflow。

## 更新已有卡片

在 `DATA`（核心名单）或 `EXTRA`（补充名单）中定位卡片，修改 `jobs`、`note`、`city`、`status`、`links`、`audit` 等现有字段。**保留原 `id`**，包括公司改名时也保留。`name` 改名时，同时修改 `REC_DEADLINES` 中对应的名称键。

每次更新后：

```powershell
cd "C:\Users\25759\Desktop\github项目管理\recsys-2027-check"
npm run data:check
npm test
git diff -- data/rec.json data/soe.json
git add data/rec.json data/soe.json
git commit -m "更新招聘卡片信息"
git push origin main
```

有前端或其他相关修改时，把需要提交的文件明确加入 `git add`。不要提交 `node_modules`、`dist`、本地凭据或临时测试文件。

## 新增卡片

只在新增卡片时生成新 ID：

```powershell
npm run card:id -- rec "新公司名称"
npm run card:id -- soe "新公司名称"
```

把输出的 `rec-...` / `soe-...` 填入新 JSON 卡片的 `id`。可以复制同类卡片作为结构模板，但必须替换名称、ID、真实岗位内容和来源；不要重复已有 ID。校验和云端核对的数量均从 JSON 动态计算，不再写死57/29。发布后这个 ID 不再变更。

同一公司出现在两页时，同一 ID 后缀对应同一公司实体；两页的中英文名称必须一致。相同来源 ID（如 `R01`）也是全局共享，两份 JSON 中该来源的元数据必须一致；更新共享来源时同时修改两份，校验器会指出遗漏。

## 截止日期、历史与来源

推荐页的当前截止节点主要来自 `REC_DEADLINES`，历史日期仍可保留在 `DUE` / `TIMELINE` / `ORIGINAL_ITEMS` 中。核查日志写在 `LOG`，固定时间线写在 `TIMELINE_EVENTS`。`today` 是浏览器动态节点，禁止写入固定时间线。

`links` 使用 `["显示名称", "https://实际地址"]`，引用的来源 ID 必须存在于 `SOURCES`。日期采用真实 `YYYY-MM-DD` 格式，不能写不存在的日期。校验器会拒绝未知字段，避免拼错字段后静默不生效。

`SOURCES.published`（来源发布时间）现在也存入 Supabase 并从云端还原，不会在同步中丢失。

## 删除与归档策略

普通 push 允许新增和更新，**不允许把已发布的公司、卡片或来源 ID 从文件中删除**。数据库和 Git 前后版本均有检查，防止删卡片时级联删除用户投递状态。

不再推荐的卡片请保留 ID，并根据已有页面语义改为 `past`、`watch`、`verify` 等适用状态，同时在 `note` 中说明。不要添加未经支持的 `archived` 字段。

卡片下面的链接、核查来源关联、当前截止节点、时间线和更新日志属于公共从属资料，会按本次 JSON 快照同步；移除某个已失效链接或节点不会残留旧行，也不会删除父卡片。

## 自动发布流程

1. 仅 `main` 的 push 或手动运行 `Deploy GitHub Pages` 能发布。
2. 安装锁定依赖，校验 JSON，并与 push 前的 Git 版本比较稳定 ID。
3. 运行全部单元测试，构建 Vite，检查两页的资源路径和产物中是否混入 secret key。
4. 以一次 `recsys_apply_catalog` RPC 同步10张公共资料表。数据库拿事务锁、检查删除风险、更新数据，在提交前逐表逐字段比对。本事务任一步出错，整批回滚。
5. 使用浏览器级 public key 再独立读取全部公共表，对比本地快照，验证未登录者不能读取私人状态或调用同步 RPC。
6. 上传 `dist/` 并发布 GitHub Pages。发布步骤使用固定 commit SHA 的官方 GitHub Actions。

公开表：`companies`、`job_entries`、`sources`、`entry_links`、`entry_audits`、`job_sources`、`entry_deadlines`、`catalog_archives`、`timeline_events`、`change_logs`。

## 部署后自动验收

发布流程现在会在 Pages 部署之后继续运行 `npm run test:pages`。它使用不带账号或密钥的公开 HTTP 请求，检查线上 `release.json` 的 Git 提交和公共数据摘要，并把首页、SOE 页及所有直接引用的 JS/CSS 与本次本地构建逐字节比对，同时检查 MIME 类型。这样能识别旧部署、资源缺失以及源码被当作构建产物发布等问题。

短暂的 Pages 分发延迟会触发有限次数重试；持续不一致会明确让工作流失败，不会无限转圈。该检查是公开文件验收，不等同于自动登录或跨设备交互测试。云端数据的完整比对仍由前面的 `npm run test:cloud` 独立完成。

本地手动检查线上版本时，在已部署的同一提交上运行：

```powershell
npm run build
npm run build:check
npm run test:cloud
npm run test:pages
```

本地有尚未发布的修改时，线上比对报不一致是预期行为。不要通过跳过测试来掩盖差异。

## 如何确认成功

GitHub → Actions → `Deploy GitHub Pages` → 当前提交，确认同步、云端核对和 Pages 部署均为绿色。运行摘要会列出事务回执、Git commit、workflow run编号与各表数量。

网站 `/recsys-2027-check/release.json` 包含 Pages 构建的 Git SHA、公共数据 SHA256 和数量。它不包含任何用户状态或凭据。

`npm run test:cloud` 会核对当前云端是否与本地文件一致；本地刚修改、尚未 push 时出现不一致是正常的，不应通过跳过校验来掩盖。

`npm run sync:cloud` 默认为 dry-run；没有本地配置 secret 时会提示缺少凭据。实际写入只由 main 分支的 GitHub Actions 执行，日常无需在本地持有 secret。

## 故障处理与恢复

缺少 secret：检查 `github-pages` 环境的 `SUPABASE_SECRET_KEY`，不是仅仅创建一个同名仓库 Variable。配置后对同一 Actions 运行点 `Re-run all jobs`。

JSON 校验失败：按日志修复字段、来源或 ID，然后重新 commit + push。不会改动数据库。

RPC 校验、权限或约束失败：数据库整批回滚，Pages 不会继续发布。查看同步步骤的明确错误。

**数据库事务和 Pages 部署不是同一个跨服务事务。** 若数据库已成功同步、后续网络验证或 Pages 部署失败，数据库可能已经是新数据，网站静态文件仍是上一版。修复平台故障后重跑当前 workflow；同一编号、同一提交和同一数据可安全重试，不会重复创建卡片。

旧 workflow 不能覆盖更新后的数据。要恢复旧内容，应在当前 main 上恢复需要的字段并创建一个新提交再 push，而不是重跑旧部署。新增过的卡片 ID 仍需保留，可改为观察/历史状态。

数据库 `recsys_sync.releases` 保留最近20次同步前的**公共数据快照**和发布回执，仅服务端角色可访问；它不是私人状态或 Auth 的备份。必要时可由管理员用于排障恢复，正常维护不需要操作它。

## 测试与未来扩展

`npm test` 包含数据往返、改名保留ID、新增、删除保护、错误日期、引用、完整云端差异、单次RPC及原个人同步测试。

`supabase/tests/catalog-sync.sql` 是数据库集成检查，覆盖权限、dry-run、父卡片删除保护、部分写入回滚、正常更新、幂等重跑、旧run拒绝和私人数据不变。整个测试包用事务并在结束时 rollback，不留下测试卡片或状态。运行前应确认连接正确项目。

`npm run seed:sql` 仅为新实例生成本地 bootstrap SQL，不是日常发布路径，不会再改写 JSON 或 migration。

以后添加全新数据库字段/表、修改 Auth/SMTP 或换 Supabase 项目属于结构/平台配置变更，需单独维护版本化 migration。已有字段内的招聘资料更新已经走自动同步，不需手工改表。
