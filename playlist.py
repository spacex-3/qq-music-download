#!/usr/bin/env python3
"""
QQ Music Playlist Batch Downloader
支持歌单解析、批量下载、反检测机制
"""

import asyncio
import re
import random
import time
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass
from urllib.parse import urlparse, parse_qs
import logging

import aiohttp
from qqmusic_api import search
from qqmusic_api.song import get_song_urls, SongFileType
from qqmusic_api.songlist import get_song_list
from qqmusic_api.login import Credential

from song import QQMusicSingleDownloader, Config as SongConfig, SongInfo, DownloadError

logger = logging.getLogger(__name__)


@dataclass
class PlaylistInfo:
    """歌单信息"""
    id: str
    name: str
    creator: str
    description: str
    cover_url: str
    song_count: int
    songs: List[SongInfo]


class AntiDetectionConfig:
    """反检测配置"""
    # 随机延迟范围（秒）
    MIN_DELAY = 1.5
    MAX_DELAY = 4.0
    
    # 批量下载间隔
    BATCH_SIZE = 3
    BATCH_INTERVAL = 8.0
    
    # 并发控制
    MAX_CONCURRENT = 2
    
    # User-Agent 轮换
    USER_AGENTS = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.0",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    ]


class PlaylistParser:
    """歌单链接解析器"""
    
    @staticmethod
    def parse_qq_playlist_id(input_str: str) -> Optional[str]:
        """
        从各种格式的输入中提取 QQ 音乐歌单 ID
        
        支持格式：
        - 纯数字ID: 8522515502
        - 完整URL: https://y.qq.com/n/ryqq/playlist/8522515502
        - 老版URL: https://y.qq.com/n/m/detail/taoge/index.html?id=8522515502
        """
        input_str = input_str.strip()
        
        # 纯数字ID
        if re.match(r'^\d+$', input_str):
            return input_str
        
        # 尝试从URL解析
        try:
            parsed = urlparse(input_str)
            
            # 检查是否是QQ音乐域名
            if 'qq.com' not in parsed.netloc:
                return None
            
            # 从路径提取: /n/ryqq/playlist/8522515502
            path_match = re.search(r'/playlist/(\d+)', parsed.path)
            if path_match:
                return path_match.group(1)
            
            # 从查询参数提取: ?id=8522515502
            query_params = parse_qs(parsed.query)
            if 'id' in query_params:
                return query_params['id'][0]
            
            # 尝试从fragment提取（处理 #/playlist?id=xxx）
            if parsed.fragment:
                fragment_params = parse_qs(parsed.fragment.split('?')[-1])
                if 'id' in fragment_params:
                    return fragment_params['id'][0]
                
                fragment_match = re.search(r'id=(\d+)', parsed.fragment)
                if fragment_match:
                    return fragment_match.group(1)
            
            # 兜底正则
            id_match = re.search(r'[?&/](?:id=|playlist/)(\d+)', input_str)
            if id_match:
                return id_match.group(1)
                
        except Exception as e:
            logger.error(f"解析歌单URL失败: {e}")
        
        return None


class PlaylistDownloader:
    """歌单批量下载器"""
    
    def __init__(self, credential: Optional[Credential] = None):
        self.credential = credential
        self.parser = PlaylistParser()
        self.song_downloader = QQMusicSingleDownloader()
        self.download_semaphore = asyncio.Semaphore(AntiDetectionConfig.MAX_CONCURRENT)
        
    async def get_playlist_info(self, playlist_id: str) -> PlaylistInfo:
        """
        获取歌单详细信息
        
        使用 qqmusic_api 获取歌单信息
        """
        try:
            # 获取歌单详情
            result = await get_song_list(playlist_id, credential=self.credential)
            
            # 解析歌单基本信息
            dirinfo = result.get('dirinfo', {})
            name = dirinfo.get('title', 'Unknown Playlist')
            creator = dirinfo.get('creator', {}).get('name', 'Unknown')
            description = dirinfo.get('desc', '')
            cover_url = dirinfo.get('picurl', '')
            
            # 解析歌曲列表
            songs = []
            song_list = result.get('songlist', [])
            
            for song_data in song_list:
                try:
                    song_info = self._parse_song_data(song_data)
                    if song_info:
                        songs.append(song_info)
                except Exception as e:
                    logger.warning(f"解析歌曲数据失败: {e}")
                    continue
            
            return PlaylistInfo(
                id=playlist_id,
                name=name,
                creator=creator,
                description=description,
                cover_url=cover_url,
                song_count=len(songs),
                songs=songs
            )
            
        except Exception as e:
            logger.error(f"获取歌单信息失败: {e}")
            raise DownloadError(f"获取歌单信息失败: {e}")
    
    def _parse_song_data(self, song_data: Dict) -> Optional[SongInfo]:
        """解析歌曲数据"""
        try:
            # 提取歌曲基本信息
            mid = song_data.get('mid') or song_data.get('songmid', '')
            name = song_data.get('name') or song_data.get('title', 'Unknown')
            
            # 提取歌手信息
            singers = song_data.get('singer', [])
            if singers:
                singer_names = [s.get('name', '') for s in singers]
                singer = '/'.join(filter(None, singer_names))
            else:
                singer = song_data.get('singer_name', 'Unknown')
            
            # 提取专辑信息
            album = song_data.get('album', {})
            album_name = album.get('name') or album.get('title', 'Unknown')
            album_mid = album.get('mid', '')
            
            # 检查是否VIP歌曲
            is_vip = song_data.get('pay', {}).get('pay_play', 0) == 1
            
            return SongInfo(
                name=name,
                singer=singer,
                mid=mid,
                is_vip=is_vip,
                album_name=album_name,
                album_mid=album_mid
            )
            
        except Exception as e:
            logger.warning(f"解析歌曲数据出错: {e}")
            return None
    
    async def download_playlist(
        self,
        playlist_id: str,
        output_dir: Path,
        quality: str = "128",
        progress_callback = None,
        stop_event: Optional[asyncio.Event] = None
    ) -> Dict[str, Any]:
        """
        批量下载歌单中的所有歌曲
        
        Args:
            playlist_id: 歌单ID
            output_dir: 输出目录
            quality: 音质 (128/320/flac/mflac)
            progress_callback: 进度回调函数 (current, total, song_name, status)
            stop_event: 停止事件
            
        Returns:
            下载统计信息
        """
        # 获取歌单信息
        playlist_info = await self.get_playlist_info(playlist_id)
        
        # 创建歌单专属目录
        safe_name = self._sanitize_filename(playlist_info.name)
        playlist_dir = output_dir / f"{safe_name}_{playlist_id}"
        playlist_dir.mkdir(parents=True, exist_ok=True)
        
        total = len(playlist_info.songs)
        success_count = 0
        fail_count = 0
        skip_count = 0
        failed_songs = []
        
        logger.info(f"开始下载歌单: {playlist_info.name} ({total} 首歌曲)")
        
        for index, song in enumerate(playlist_info.songs):
            # 检查停止事件
            if stop_event and stop_event.is_set():
                logger.info("下载已取消")
                break
            
            # 报告进度
            if progress_callback:
                progress_callback(index + 1, total, song.name, "downloading")
            
            try:
                # 使用信号量控制并发
                async with self.download_semaphore:
                    success = await self._download_single_song(
                        song, playlist_dir, quality
                    )
                    
                    if success:
                        success_count += 1
                        if progress_callback:
                            progress_callback(index + 1, total, song.name, "success")
                    else:
                        skip_count += 1
                        if progress_callback:
                            progress_callback(index + 1, total, song.name, "skip")
                
                # 反检测：随机延迟
                if index < total - 1:  # 不是最后一首
                    await self._random_delay()
                    
                    # 批量间隔
                    if (index + 1) % AntiDetectionConfig.BATCH_SIZE == 0:
                        await self._batch_interval()
                        
            except Exception as e:
                logger.error(f"下载歌曲失败 [{song.name}]: {e}")
                fail_count += 1
                failed_songs.append({
                    'name': song.name,
                    'singer': song.singer,
                    'mid': song.mid,
                    'error': str(e)
                })
                if progress_callback:
                    progress_callback(index + 1, total, song.name, "failed")
        
        # 生成下载报告
        result = {
            'playlist_name': playlist_info.name,
            'playlist_id': playlist_id,
            'total': total,
            'success': success_count,
            'failed': fail_count,
            'skipped': skip_count,
            'output_dir': str(playlist_dir),
            'failed_songs': failed_songs
        }
        
        logger.info(f"歌单下载完成: {success_count}/{total} 成功, {fail_count} 失败, {skip_count} 跳过")
        
        return result
    
    async def _download_single_song(
        self,
        song: SongInfo,
        output_dir: Path,
        quality: str
    ) -> bool:
        """下载单首歌曲"""
        try:
            # 检查是否已存在
            safe_name = self._sanitize_filename(f"{song.singer} - {song.name}")
            
            # 检查各种可能的文件扩展名
            for ext in ['.mp3', '.flac', '.m4a']:
                existing_file = output_dir / f"{safe_name}{ext}"
                if existing_file.exists() and existing_file.stat().st_size > 1024:
                    logger.info(f"歌曲已存在，跳过: {song.name}")
                    return False  # 已存在，算作skip
            
            # 构建 song_data 格式供 QQMusicSingleDownloader 使用
            song_data = {
                'title': song.name,
                'mid': song.mid,
                'singer': [{'name': s.strip()} for s in song.singer.split('/')],
                'album': {'name': song.album_name, 'mid': song.album_mid},
                'pay': {'pay_play': 1 if song.is_vip else 0}
            }
            
            # 设置下载目录
            self.song_downloader.download_dir = output_dir
            
            # 设置音质偏好
            self.song_downloader.prefer_flac = (quality in ['flac', 'mflac'])
            
            # 下载
            result = await self.song_downloader.download_song(song_data)
            
            return result
            
        except Exception as e:
            logger.error(f"下载歌曲出错 [{song.name}]: {e}")
            return False
    
    async def _random_delay(self):
        """随机延迟，模拟人类行为"""
        delay = random.uniform(AntiDetectionConfig.MIN_DELAY, AntiDetectionConfig.MAX_DELAY)
        # 偶尔增加更长延迟（模拟被其他事情打断）
        if random.random() < 0.1:  # 10%概率
            delay += random.uniform(2.0, 5.0)
        await asyncio.sleep(delay)
    
    async def _batch_interval(self):
        """批量间隔"""
        delay = AntiDetectionConfig.BATCH_INTERVAL + random.uniform(-1.0, 2.0)
        await asyncio.sleep(max(1.0, delay))
    
    @staticmethod
    def _sanitize_filename(filename: str) -> str:
        """清理文件名中的非法字符"""
        illegal_chars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*']
        for char in illegal_chars:
            filename = filename.replace(char, '_')
        return filename.strip()[:100]  # 限制长度


class StreamingPlaylistDownloader(PlaylistDownloader):
    """支持流式下载的歌单下载器（用于前端实时显示进度）"""
    
    def __init__(self, credential: Optional[Credential] = None):
        super().__init__(credential)
    
    async def download_with_streaming(
        self,
        playlist_id: str,
        output_dir: Path,
        quality: str = "128"
    ):
        """
        流式下载，yield 进度信息
        
        Yields:
            Dict with keys: type, current, total, song_name, status, message
        """
        try:
            # 获取歌单信息
            yield {
                'type': 'info',
                'message': '正在获取歌单信息...'
            }
            
            playlist_info = await self.get_playlist_info(playlist_id)
            total = len(playlist_info.songs)
            
            yield {
                'type': 'playlist_info',
                'name': playlist_info.name,
                'creator': playlist_info.creator,
                'song_count': total,
                'cover_url': playlist_info.cover_url
            }
            
            # 创建输出目录
            safe_name = self._sanitize_filename(playlist_info.name)
            playlist_dir = output_dir / f"{safe_name}_{playlist_id}"
            playlist_dir.mkdir(parents=True, exist_ok=True)
            
            yield {
                'type': 'start',
                'total': total,
                'output_dir': str(playlist_dir)
            }
            
            # 开始下载
            for index, song in enumerate(playlist_info.songs):
                yield {
                    'type': 'progress',
                    'current': index + 1,
                    'total': total,
                    'song_name': song.name,
                    'singer': song.singer,
                    'status': 'downloading'
                }
                
                try:
                    async with self.download_semaphore:
                        success = await self._download_single_song(
                            song, playlist_dir, quality
                        )
                        
                        yield {
                            'type': 'progress',
                            'current': index + 1,
                            'total': total,
                            'song_name': song.name,
                            'singer': song.singer,
                            'status': 'success' if success else 'skip'
                        }
                    
                    # 反检测延迟
                    if index < total - 1:
                        await self._random_delay()
                        if (index + 1) % AntiDetectionConfig.BATCH_SIZE == 0:
                            await self._batch_interval()
                            
                except Exception as e:
                    yield {
                        'type': 'progress',
                        'current': index + 1,
                        'total': total,
                        'song_name': song.name,
                        'singer': song.singer,
                        'status': 'failed',
                        'error': str(e)
                    }
            
            yield {
                'type': 'complete',
                'message': '下载完成'
            }
            
        except Exception as e:
            yield {
                'type': 'error',
                'message': str(e)
            }


# 便捷函数
async def download_qq_playlist(
    playlist_input: str,
    output_dir: str = "./downloads",
    quality: str = "128",
    credential: Optional[Credential] = None
) -> Dict[str, Any]:
    """
    便捷函数：下载QQ音乐歌单
    
    Args:
        playlist_input: 歌单ID或URL
        output_dir: 输出目录
        quality: 音质
        credential: 登录凭证（用于VIP歌曲）
    
    Returns:
        下载结果统计
    """
    parser = PlaylistParser()
    playlist_id = parser.parse_qq_playlist_id(playlist_input)
    
    if not playlist_id:
        raise ValueError(f"无法解析歌单ID: {playlist_input}")
    
    downloader = PlaylistDownloader(credential=credential)
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    return await downloader.download_playlist(
        playlist_id=playlist_id,
        output_dir=output_path,
        quality=quality
    )


if __name__ == "__main__":
    # 测试代码
    async def test():
        # 测试解析
        parser = PlaylistParser()
        
        test_urls = [
            "8522515502",
            "https://y.qq.com/n/ryqq/playlist/8522515502",
            "https://y.qq.com/n/m/detail/taoge/index.html?id=8522515502",
        ]
        
        for url in test_urls:
            playlist_id = parser.parse_qq_playlist_id(url)
            print(f"{url} -> {playlist_id}")
    
    asyncio.run(test())
