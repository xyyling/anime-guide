# 新番导览（Netflix 风格）

纯静态的动漫新番网页，展示未来 7 天每日放送的番剧，按周一到周日分组；点击封面弹出详情，查看简介、制作公司、完整 staff 与 cast。数据来自 [Bangumi](https://bgm.tv) 公开 API。

## 本地预览

仓库根目录已内置一份种子 `data.json`，无需网络即可查看页面结构：

```bash
node scripts/fetch.mjs   # 需要正常网络，拉取真实数据并生成 _site/
npx serve .              # 或 python -m http.server 8000
```

> 不要直接双击 `index.html`（`file://` 下 `fetch` 会被浏览器拦截），请使用本地静态服务器。

生成真实数据的构建产物会输出到 `_site/`，可用 `npx serve _site` 预览。

## 数据抓取

`scripts/fetch.mjs` 会依次请求：

- `GET /calendar`：未来 7 天放送时间表
- `GET /v0/subjects/{id}`：简介、infobox、封面
- `GET /v0/subjects/{id}/persons`：完整制作人员
- `GET /v0/subjects/{id}/characters`：主要角色与声优

并将封面下载到 `_site/assets/covers/`，生成 `_site/data.json`。任一 API 请求失败会以非零状态退出，CI 保留上一次已部署版本。

## 部署

1. 把仓库推送到 GitHub。
2. 在仓库 Settings → Pages 中将 Source 设为 **GitHub Actions**。
3. `.github/workflows/deploy.yml` 每天北京时间 06:00 自动构建部署，也支持手动触发（Actions → Deploy to GitHub Pages → Run workflow）。

首次部署需要构建环境能访问 `api.bgm.tv` 与 `lain.bgm.tv`。
