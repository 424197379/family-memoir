#!/usr/bin/env python3
"""Read-only video size gate. Exit nonzero to stop building/publishing."""
import argparse
from pathlib import Path

LIMIT = 50 * 1024 * 1024
VIDEO_SUFFIXES = {'.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.mpg', '.mpeg', '.3gp', '.mts', '.m2ts', '.ts', '.flv', '.wmv'}


def main():
    parser = argparse.ArgumentParser(description='检查待发布视频是否超过 50 MiB；不修改文件。')
    parser.add_argument('directory', nargs='?', type=Path,
                        default=Path(__file__).resolve().parent / 'dist')
    args = parser.parse_args()
    if not args.directory.is_dir():
        parser.error('待检查目录不存在：' + str(args.directory))
    count = 0
    failures = 0
    for path in sorted(args.directory.rglob('*')):
        if path.is_file() and path.suffix.lower() in VIDEO_SUFFIXES:
            count += 1
            size = path.stat().st_size
            oversized = size > LIMIT
            failures += int(oversized)
            print(f'{"超限" if oversized else "通过"}: {path.relative_to(args.directory)} '
                  f'— {size / 1024 / 1024:.2f} MiB ({size} 字节)')
    if failures:
        print(f'停止发布：{failures} 个视频超过 50 MiB（{LIMIT} 字节）。不自动压缩。')
        return 1
    print(f'检查通过：{count} 个视频，均未超过 50 MiB。')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
