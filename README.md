# 新番导览（Netflix 风格）

纯静态的动漫新番网页，展示 2026 秋季（9–12 月开播）新番，按周一到周日分组；点击封面弹出详情，查看简介、制作公司、完整 staff 与 cast。数据来自 [bangumi-data](https://github.com/bangumi-data/bangumi-data) 季度数据集与 [Bangumi](https://bgm.tv) 公开 API。

## 本地预览

仓库根目录已内置一份种子 `data.json`，无需网络即可查看页面结构：

```bash
node scripts/fetch.mjs   # 需要正常网络，拉取真实数据并生成 _site/
npx serve _site          # 或 python -m http.server 8000 --directory _site
```

> 不要直接双击仓库根目录的源 `index.html`（源文件需要 `fetch('data.json')`）。运行构建后，`_site/` 里的页面已经把数据内联进 HTML，可以直接双击 `_site/index.html` 或 `_site/r18/index.html` 离线打开。

生成真实数据的构建产物会输出到 `_site/`，可用 `npx serve _site` 预览。

## 离线使用

构建脚本会把抓取到的数据内联进 HTML，并把封面下载到本地 `_site/assets/covers/`，所以 `_site/` 是一个自包含的离线站点：无需网络、无需本地服务器，直接打开 `_site/index.html`（主站）或 `_site/r18/index.html`（里番站）即可浏览。详情弹窗里的预告片和站外链接需要联网才能播放，其余内容全部离线可用。

两种获取离线包的方式：

- 本地运行 `npm run fetch` 与 `npm run fetch:r18`，然后打包 `_site/` 目录。
- 在 GitHub Actions 的任意一次构建里，下载名为 `offline-site` 的 artifact（就是完整的 `_site/` 目录，保留 5 天）。

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

数据来自 [AniList](https://anilist.co) 公开 GraphQL API（`isAdult: true`），无需 token。标题和简介可用 [DeepSeek](https://platform.deepseek.com/) API 翻译成中文：在 GitHub 仓库的 Actions Secrets 里新建 `DEEPSEEK_API_KEY`，值为你的 DeepSeek API Key；未配置时保留日文标题与英文简介。`r18/scripts/fetch.mjs` 会拉取 2000 年至今的 OVA/ONA 里番，下载封面并按发售日期倒序生成 `_site/r18/`。抓取失败且没有可用种子数据时会中止构建（非零退出），让 CI 保留上一次部署，避免发布空白页面。

### 本地封面覆盖

如果你想替换某部里番的封面（例如你自己确认过版权的图），把它按 AniList 条目 id 命名放进 `r18/covers/`，构建时会优先使用本地图，找不到才回退到 AniList 下载的封面。支持 `.jpg`、`.jpeg`、`.png`、`.webp`，说明见 `r18/covers/README.md`。
