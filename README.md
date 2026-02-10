# QQ Music Download

QQ 音乐搜索/下载 Web 应用，支持：

- 搜索歌曲并在线播放
- 下载到当前设备
- 下载到服务器挂载目录
- Auto-Tag（按开关控制下载时写入标签）
- 右上角刷新 Emby 音乐库
- 浏览服务器文件（只读，播放/下载）

## Docker 部署（推荐）

项目镜像已在 GitHub Actions 构建并发布到 GHCR，部署时无需本地 `docker build`。

镜像地址：

- `ghcr.io/spacex-3/qqmusicdownloader:latest`

### 1. 准备目录

```bash
mkdir -p ./config ./downloads
```

- `config`：账号、密码、缓存等配置
- `downloads`：下载后的歌曲

### 2. 使用 Docker Compose

`docker-compose.yml` 示例：

```yaml
services:
  app:
    image: ghcr.io/spacex-3/qqmusicdownloader:latest
    container_name: qq-music-download
    ports:
      - "8001:8001"
    volumes:
      - ./config:/config
      - ./downloads:/downloads
    environment:
      - CONFIG_DIR=/config
      - DOWNLOAD_DIR=/downloads
      - EMBY_URL=${EMBY_URL:-}
      - EMBY_TOKEN=${EMBY_TOKEN:-}
      - EMBY_MUSIC_LIBRARY_ID=${EMBY_MUSIC_LIBRARY_ID:-}
    restart: unless-stopped
```

如 `8001` 端口被占用，可改为例如 `8002:8001`。

### 3. 启动

```bash
docker compose pull
docker compose up -d
```

访问：

- `http://<你的IP>:8001`（或你映射的端口）

## Emby 刷新说明

右上角按钮会调用后端接口：

- 优先：`/Items/{EMBY_MUSIC_LIBRARY_ID}/Refresh`
- 回退：`/Library/Refresh`

需要配置环境变量：

- `EMBY_URL`：例如 `http://192.168.1.17:8096`
- `EMBY_TOKEN`：Emby API Token
- `EMBY_MUSIC_LIBRARY_ID`：音乐库 ID（可选，建议填写）

## 本地开发（可选）

```bash
pip install -r requirements.txt
cd frontend && npm install && cd ..
python api.py
```

默认服务端口：`8001`。

## 免责声明

- 本项目仅用于学习与研究用途，请勿用于商业或侵权用途。
- 请遵守当地法律法规与平台服务条款，支持正版音乐。
