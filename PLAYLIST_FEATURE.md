# QQ音乐歌单批量下载功能

## 功能概述

已实现完整的QQ音乐歌单批量下载功能，包含反检测机制、流式进度显示和灵活的配置选项。

## 实现文件

- `playlist.py` - 核心功能模块
- `api.py` - 已添加相关API端点

## 主要特性

### 1. 歌单URL解析
支持多种格式的歌单链接：
- 纯数字ID: `8522515502`
- 标准URL: `https://y.qq.com/n/ryqq/playlist/8522515502`
- 老版URL: `https://y.qq.com/n/m/detail/taoge/index.html?id=8522515502`

### 2. 反检测机制
- **随机延迟**: 每首歌下载间隔 1.5-4秒，偶尔增加更长延迟（10%概率额外+2-5秒）
- **批量控制**: 每下载3首歌后暂停8秒
- **并发限制**: 最大并发下载数2个
- **User-Agent轮换**: 支持多种浏览器标识

### 3. 存储管理
- 自动创建歌单专属目录：`{歌单名}_{歌单ID}/`
- 智能跳过已下载歌曲（检测文件存在且>1KB）
- 支持自定义输出目录

### 4. API端点

#### 解析歌单URL
```bash
POST /api/playlist/parse
{
  "input": "https://y.qq.com/n/ryqq/playlist/8522515502"
}
```

#### 获取歌单信息
```bash
GET /api/playlist/{playlist_id}/info
```

#### 开始下载任务
```bash
POST /api/playlist/download
{
  "playlist_id": "8522515502",
  "quality": "320",
  "output_dir": "/downloads"
}
```

#### 查询任务状态
```bash
GET /api/playlist/download/{task_id}/status
```

#### 流式下载进度 (SSE)
```bash
GET /api/playlist/download/stream?playlist_id=8522515502&quality=320
```

#### 反检测配置
```bash
GET /api/playlist/settings
POST /api/playlist/settings
{
  "min_delay": 2.0,
  "max_delay": 5.0,
  "batch_size": 3,
  "batch_interval": 10.0,
  "max_concurrent": 2
}
```

## 使用方法

### Docker运行
```bash
docker build -t qq-music-download .
docker run -p 8001:8001 -v /path/to/downloads:/downloads qq-music-download
```

### 本地开发
```bash
pip install -r requirements.txt
python api.py
```

### Python API调用示例
```python
from playlist import download_qq_playlist
import asyncio

async def main():
    result = await download_qq_playlist(
        playlist_input="https://y.qq.com/n/ryqq/playlist/8522515502",
        output_dir="./downloads",
        quality="320"
    )
    print(f"下载完成: {result['success']}/{result['total']}")

asyncio.run(main())
```

## 注意事项

1. **VIP歌曲**: 需要配置登录凭证才能下载高品质VIP歌曲
2. **下载目录**: 默认保存在 `./downloads/` 或环境变量 `DOWNLOAD_DIR` 指定的目录
3. **并发控制**: 避免过高并发导致IP被封，建议保持默认设置
4. **存储空间**: 批量下载前请确保有足够存储空间

## 反检测调优建议

如果遇到下载限制，可以调整以下参数：
- 增加 `min_delay` 和 `max_delay` 减少请求频率
- 增大 `batch_interval` 让批次间隔更长
- 减小 `max_concurrent` 到1，单线程下载

## 与CyreneMusic对比

| 功能 | CyreneMusic | qq-music-download |
|-----|-------------|-------------------|
| 歌单导入 | 通过后端API获取歌单信息 | 直接使用qqmusic_api获取 |
| 反检测 | 无明确机制 | 随机延迟+批量控制+并发限制 |
| 批量下载 | 前端导入，不直接下载 | 直接下载到服务器 |
| 进度显示 | 一次性导入 | 支持SSE流式进度 |
| 配置灵活度 | 固定配置 | 可动态调整反检测参数 |
