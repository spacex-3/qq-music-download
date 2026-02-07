"""
Auto-tagging module for QQ Music downloads.
Fetches metadata from QQ Music API and writes to audio files using mutagen.
"""

import aiohttp
import os
from typing import Optional, Dict, Any
from mutagen.flac import FLAC, Picture
from mutagen.mp3 import MP3
from mutagen.id3 import ID3, TIT2, TPE1, TPE2, TALB, TDRC, USLT, APIC

# QQ Music album cover URL template
QQMUSIC_COVER_URL = "http://y.qq.com/music/photo_new/T002R300x300M000{album_mid}.jpg"


async def get_song_detail(mid: str) -> Optional[Dict[str, Any]]:
    """
    Fetch song detail from QQ Music API.
    
    Args:
        mid: Song MID (e.g., "002QMDR1VzSsx")
        
    Returns:
        Dict with song metadata or None if failed
    """
    url = "https://u.y.qq.com/cgi-bin/musicu.fcg"
    
    # Determine if mid is numeric (song_id) or string (song_mid)
    try:
        song_id = int(mid)
        song_mid = ""
    except ValueError:
        song_id = 0
        song_mid = mid
    
    data = {
        "get_song_detail": {
            "module": "music.pf_song_detail_svr",
            "method": "get_song_detail",
            "param": {
                "song_id": song_id,
                "song_mid": song_mid,
                "song_type": 0
            }
        },
        "comm": {
            "g_tk": 0,
            "uin": "",
            "format": "json",
            "ct": 6,
            "cv": 80600,
            "platform": "wk_v17",
            "uid": "",
            "guid": ""
        }
    }
    
    headers = {
        "User-Agent": "QQ音乐/73222 CFNetwork/1406.0.2 Darwin/22.4.0",
        "Content-Type": "application/json; charset=UTF-8",
        "Referer": "http://y.qq.com"
    }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=data, headers=headers) as response:
                if response.status != 200:
                    print(f"Failed to fetch song detail: HTTP {response.status}")
                    return None
                    
                import json
                text = await response.text()
                result = json.loads(text)
                detail = result.get("get_song_detail", {})
                
                if detail.get("code") != 0:
                    print(f"API error: {detail.get('code')}")
                    return None
                
                track_info = detail.get("data", {}).get("track_info", {})
                if not track_info:
                    return None
                
                # Extract metadata
                singers = track_info.get("singer", [])
                artist = ", ".join([s.get("name", "") for s in singers])
                album_artist = singers[0].get("name", "") if singers else ""
                
                album = track_info.get("album", {})
                time_public = track_info.get("time_public", "")
                year = time_public[:4] if len(time_public) >= 4 else ""
                
                return {
                    "title": track_info.get("title", ""),
                    "artist": artist,
                    "album_artist": album_artist,
                    "album": album.get("title", "") or album.get("name", ""),
                    "album_mid": album.get("mid", ""),
                    "year": year,
                    "mid": track_info.get("mid", mid)
                }
                
    except Exception as e:
        print(f"Error fetching song detail: {e}")
        return None


async def get_album_cover(album_mid: str) -> Optional[bytes]:
    """
    Download album cover image from QQ Music.
    
    Args:
        album_mid: Album MID
        
    Returns:
        Image bytes or None if failed
    """
    if not album_mid:
        return None
        
    url = QQMUSIC_COVER_URL.format(album_mid=album_mid)
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status == 200:
                    return await response.read()
                else:
                    print(f"Failed to fetch album cover: HTTP {response.status}")
                    return None
    except Exception as e:
        print(f"Error fetching album cover: {e}")
        return None


def write_tags_to_flac(file_path: str, metadata: Dict[str, Any], 
                       cover_data: Optional[bytes] = None,
                       lyrics: Optional[str] = None) -> bool:
    """
    Write metadata tags to FLAC file.
    
    Args:
        file_path: Path to the FLAC file
        metadata: Dict containing title, artist, album, etc.
        cover_data: Album cover image bytes
        lyrics: LRC lyrics string
        
    Returns:
        True if successful, False otherwise
    """
    try:
        audio = FLAC(file_path)
        
        # Basic tags
        if metadata.get("title"):
            audio["TITLE"] = metadata["title"]
        if metadata.get("artist"):
            audio["ARTIST"] = metadata["artist"]
        if metadata.get("album_artist"):
            audio["ALBUMARTIST"] = metadata["album_artist"]
        if metadata.get("album"):
            audio["ALBUM"] = metadata["album"]
        if metadata.get("year"):
            audio["DATE"] = metadata["year"]
        
        # Lyrics
        if lyrics:
            audio["LYRICS"] = lyrics
        
        # Album cover
        if cover_data:
            picture = Picture()
            picture.type = 3  # Cover (front)
            picture.mime = "image/jpeg"
            picture.desc = "Cover"
            picture.data = cover_data
            
            # Remove existing pictures
            audio.clear_pictures()
            audio.add_picture(picture)
        
        audio.save()
        return True
        
    except Exception as e:
        print(f"Error writing FLAC tags: {e}")
        return False


def write_tags_to_mp3(file_path: str, metadata: Dict[str, Any],
                      cover_data: Optional[bytes] = None,
                      lyrics: Optional[str] = None) -> bool:
    """
    Write metadata tags to MP3 file using ID3v2.
    
    Args:
        file_path: Path to the MP3 file
        metadata: Dict containing title, artist, album, etc.
        cover_data: Album cover image bytes
        lyrics: LRC lyrics string
        
    Returns:
        True if successful, False otherwise
    """
    try:
        try:
            audio = MP3(file_path, ID3=ID3)
        except:
            audio = MP3(file_path)
        
        # Ensure ID3 tags exist
        if audio.tags is None:
            audio.add_tags()
        
        # Basic tags
        if metadata.get("title"):
            audio.tags["TIT2"] = TIT2(encoding=3, text=metadata["title"])
        if metadata.get("artist"):
            audio.tags["TPE1"] = TPE1(encoding=3, text=metadata["artist"])
        if metadata.get("album_artist"):
            audio.tags["TPE2"] = TPE2(encoding=3, text=metadata["album_artist"])
        if metadata.get("album"):
            audio.tags["TALB"] = TALB(encoding=3, text=metadata["album"])
        if metadata.get("year"):
            audio.tags["TDRC"] = TDRC(encoding=3, text=metadata["year"])
        
        # Lyrics
        if lyrics:
            audio.tags["USLT"] = USLT(encoding=3, lang="chi", desc="Lyrics", text=lyrics)
        
        # Album cover
        if cover_data:
            audio.tags["APIC"] = APIC(
                encoding=3,
                mime="image/jpeg",
                type=3,  # Cover (front)
                desc="Cover",
                data=cover_data
            )
        
        audio.save()
        return True
        
    except Exception as e:
        print(f"Error writing MP3 tags: {e}")
        return False


def write_tags(file_path: str, metadata: Dict[str, Any],
               cover_data: Optional[bytes] = None,
               lyrics: Optional[str] = None) -> bool:
    """
    Write metadata tags to audio file (auto-detect format).
    
    Args:
        file_path: Path to the audio file
        metadata: Dict containing title, artist, album, etc.
        cover_data: Album cover image bytes
        lyrics: LRC lyrics string
        
    Returns:
        True if successful, False otherwise
    """
    ext = os.path.splitext(file_path)[1].lower()
    
    if ext == ".flac":
        return write_tags_to_flac(file_path, metadata, cover_data, lyrics)
    elif ext == ".mp3":
        return write_tags_to_mp3(file_path, metadata, cover_data, lyrics)
    else:
        print(f"Unsupported file format: {ext}")
        return False


async def auto_tag_song(file_path: str, mid: str, lyrics: Optional[str] = None) -> Dict[str, Any]:
    """
    Main function to auto-tag a downloaded song.
    Fetches metadata, cover, and writes tags to the file.
    
    Args:
        file_path: Path to the downloaded audio file
        mid: Song MID
        lyrics: Optional pre-fetched lyrics (from download process)
        
    Returns:
        Dict with success status and details
    """
    result = {
        "success": False,
        "metadata_fetched": False,
        "cover_fetched": False,
        "tags_written": False,
        "error": None
    }
    
    # Step 1: Fetch song metadata
    metadata = await get_song_detail(mid)
    if not metadata:
        result["error"] = "Failed to fetch song metadata"
        return result
    result["metadata_fetched"] = True
    
    # Step 2: Fetch album cover
    cover_data = None
    if metadata.get("album_mid"):
        cover_data = await get_album_cover(metadata["album_mid"])
        if cover_data:
            result["cover_fetched"] = True
    
    # Step 3: Write tags to file
    success = write_tags(file_path, metadata, cover_data, lyrics)
    if success:
        result["tags_written"] = True
        result["success"] = True
        result["metadata"] = metadata
    else:
        result["error"] = "Failed to write tags to file"
    
    return result
