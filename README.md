# 家庭回忆录网站

当前只有“回忆录正在整理”的占位页。尚未发布正文、家庭照片、录音或视频。

- 网页文件放在 `docs/`；GitHub Pages 仅部署这个目录。
- `main` 更新后，GitHub Actions 检查视频大小并发布网站。
- 每个视频上限为 50 MiB（52,428,800 字节）；超过即停止部署，不自动压缩。
- 上传前也要在本地运行 `python3 scripts/check_video_sizes.py docs`。云端检查在推送之后执行，不能代替上传前检查。
- 当前仓库只负责网页展示与维护，不作为原始资料备份。不要放入原始采集、编辑说明、本机构建记录或凭据。
- 后续经确认发布正文时，将阅读器及经选定的成品资源放入 `docs/`，保留软件与字体许可证；地址可沿用。

本地预览：`python3 -m http.server 8875 --bind 127.0.0.1 --directory docs`。

部署采用 [GitHub 官方 Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。国内各网络及微信中的访问效果需真机确认，不能保证始终可用。
