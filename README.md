# 家庭回忆录网站

《姥姥的那些年》网页试读版，使用 Bibi 阅读器，包含正文、九张照片及一段家庭视频。

阅读地址：https://424197379.github.io/family-memoir/

2026-09-17 按用户认可版本发布。正文源稿 SHA256：`8b41fe54039bab834b56bca4f6fc8e4995effbee34710d5f69957c57cb1a6933`。本次授权仅覆盖该版读者正文和既有十项媒体；后续素材及修订不自动发布。

- 网页文件放在 `docs/`；GitHub Pages 仅部署这个目录。
- `main` 更新后，GitHub Actions 检查视频大小并发布网站。
- 每个视频上限为 50 MiB（52,428,800 字节）；超过即停止部署，不自动压缩。
- 上传前也要在本地运行 `python3 scripts/check_video_sizes.py docs`。云端检查在推送之后执行，不能代替上传前检查。
- 当前仓库只负责网页展示与维护，不作为原始资料备份。不要放入原始采集、编辑说明、本机构建记录或凭据。
- 使用 Bibi 1.2.0（MIT）及思源宋体本书用字子集（OFL，更名 Memoir Serif）；许可证与来源说明随网页资源保留。图片及视频保持原件字节，不自动压缩。
- 正文先打开；照片按阅读位置请求原图，显示已下载字节与百分比，失败或30秒无数据时可单独重试。视频使用 `preload="none"`，点击播放后加载。加载实现位于 `docs/bibi/extensions/memoir-loading.js`，正文图片通过 `data-memoir-src` 接入，不能直接恢复为普通 `src` 而重新阻塞首开。

本地预览：`python3 -m http.server 8875 --bind 127.0.0.1 --directory docs`。

媒体缓存：图片按可见位置自动保存，视频提供“保存视频到本机／暂停／继续”按钮。使用 idb-keyval 6.3.0 将 SHA256 校验后的 256 KiB 分片写入 IndexedDB；中断后复用完整分片，同一文件更新正文时不必重新下载。保存失败会提示，不能将当次能播放当作已保存。

Workbox 7.4.1 额外缓存正文与阅读器，并处理视频 Range 播放。媒体保存不依赖 Service Worker；微信等不支持时仍尝试 IndexedDB 兼容路径。库已打包进网站，不请求第三方 CDN，许可证位于 `docs/licenses/cache/`。本机缓存可能被微信、系统清理或因空间不足而无法保存，不能保证永久离线；未做微信／鸿蒙真机验收。

维护注意：`docs/bibi/memoir-cache.js` 和 `docs/sw.js` 是构建产物，包含媒体分片哈希与网页修订信息。替换正文或媒体时必须从本机构建源执行 `build_book.py`（包含缓存构建），不可只替换静态文件。新版缓存等待用户点击“有新版，点击更新”后切换。不要把本机构建记录和资料库上传。

部署采用 [GitHub 官方 Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。国内各网络及微信中的访问效果需真机确认，不能保证始终可用。
