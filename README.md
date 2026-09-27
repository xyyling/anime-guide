# 新番导览（Netflix 风格）

纯静态的动漫新番网页，展示 2026 秋季（9–12 月开播）新番，按周一到周日分组；点击封面弹出详情，查看简介、制作公司、完整 staff 与 cast。数据来自 [bangumi-data](https://github.com/bangumi-data/bangumi-data) 季度数据集与 [Bangumi](https://bgm.tv) 公开 API。

## 本地预览

仓库根目录已内置一份种子 `data.json`，无需网络即可查看页面结构：

```bash
node scripts/fetch.mjs   # 需要正常网络，拉取真实数据并生成 _site/
npx serve .              # 或 python -m http.server 8000
```

> 不要直接双击 `index.html`（`file://` 下 `fetch` 会被浏览器拦截），请使用本地静态服务器。

生成真实数据的构建产物会输出到 `_site/`，可用 `npx serve _site` 预览。

## 数据抓取

`scripts/fetch.mjs` 会：

- 从 `unpkg.com/bangumi-data` 拉取季度数据集，筛选出 2026 秋季（北京时间 9–12 月开播）的番剧，并取其 Bangumi 条目 id
- `GET /v0/subjects/{id}`：简介、infobox、封面
- `GET /v0/subjects/{id}/persons`：完整制作人员
- `GET /v0/subjects/{id}/characters`：主要角色与声优

并将封面下载到 `_site/assets/covers/`，生成 `_site/data.json`。拉取季度数据集失败会以非零状态退出，CI 保留上一次已部署版本；单个条目的详情拉取失败则跳过详情、保留标题与占位封面。

## 部署

1. 把仓库推送到 GitHub。
2. 在仓库 Settings → Pages 中将 Source 设为 **GitHub Actions**。
3. `.github/workflows/deploy.yml` 默认不设定时任务，改为手动触发（Actions → Deploy to GitHub Pages → Run workflow）；向 `main`/`master` 推送代码时也会触发一次。

首次部署需要构建环境能访问 `api.bgm.tv` 与 `lain.bgm.tv`。

## 里番站（按年份展示）

`r18/` 目录是一个独立的里番（成人动画）站点，与主站风格一致，但按发售年份分组展示。部署后的访问路径为 `<站点>/r18/`。

里番属于 Bangumi 的 NSFW 内容，匿名 API 拿不到，需要配置 Access Token：

1. 注册并登录 [bangumi.tv](https://bgm.tv)。
2. 打开 [https://next.bgm.tv/demo/access-token](https://next.bgm.tv/demo/access-token) 生成一个 Access Token。
3. 在 GitHub 仓库 **Settings → Secrets and variables → Actions → New repository secret** 新建 secret，名字填 `BANGUMI_TOKEN`，值为刚才的 token。

`r18/scripts/fetch.mjs` 会调用 Bangumi 搜索接口，用 `filter.nsfw = true` 拉取里番，按发售日期倒序生成 `_site/r18/`。未配置 token 时会回退到种子数据（空列表），不影响主站。
