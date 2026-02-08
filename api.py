from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
from typing import Optional
import base64
from io import BytesIO
import uvicorn
from contextlib import asynccontextmanager
import uuid
import os
import mimetypes
import re

# Import from existing modules
import sys
print("API Starting up...", file=sys.stderr)
from credential import CredentialManager
print("Imported CredentialManager", file=sys.stderr)
from qqmusic_api import search
print("Imported search", file=sys.stderr)
from qqmusic_api.song import get_song_urls, SongFileType
print("Imported song", file=sys.stderr)
from qqmusic_api.lyric import get_lyric
print("Imported lyric", file=sys.stderr)
from qqmusic_api.login import QRLoginType, QRCodeLoginEvents, check_qrcode, get_qrcode, check_expired
print("Imported login", file=sys.stderr)
from qqmusic_api import user
print("Imported user", file=sys.stderr)

# Global state
class GlobalState:
    def __init__(self):
        print("GlobalState init", file=sys.stderr)
        self.manager = CredentialManager()
        print("GlobalState init done", file=sys.stderr)

print("Creating state...", file=sys.stderr)
state = GlobalState()
print("State created", file=sys.stderr)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    state.manager.load_credential()
    yield
    # Shutdown

app = FastAPI(lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class QRResponse(BaseModel):
    qr_image_base64: str
    key: str

# Store active QR login sessions
qr_sessions = {}

@app.get("/api/login/qr")
async def get_qr(type: str = "wx"):
    login_type = QRLoginType.WX if type == "wx" else QRLoginType.QQ
    qr = await get_qrcode(login_type)
    
    # Convert bytes to base64
    qr_b64 = base64.b64encode(qr.data).decode('utf-8')
    img_src = f"data:image/png;base64,{qr_b64}"
    
    key = str(uuid.uuid4())
    qr_sessions[key] = {
        "qr": qr,
        "status": "WAITING"
    }
    
    return QRResponse(qr_image_base64=img_src, key=key)

@app.get("/api/login/status")
async def check_login_status(key: str):
    if key not in qr_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = qr_sessions[key]
    qr = session["qr"]
    
    # Check status
    try:
        event, credential = await check_qrcode(qr)
        
        if event == QRCodeLoginEvents.DONE:
            session["status"] = "DONE"
            state.manager.credential = credential
            state.manager.save_credential()
            return {"status": "DONE", "message": "Login successful"}
            
        elif event == QRCodeLoginEvents.TIMEOUT:
            session["status"] = "TIMEOUT"
            return {"status": "TIMEOUT", "message": "QR code expired"}
            
        elif event == QRCodeLoginEvents.REFUSE:
            session["status"] = "REFUSED"
            return {"status": "REFUSED", "message": "Login refused"}
            
        else:
            session["status"] = "WAITING"
            return {"status": "WAITING", "message": "Waiting for scan"}
            
    except Exception as e:
        print(f"Error checking status: {e}")
        return {"status": "ERROR", "message": str(e)}

@app.get("/api/user")
async def get_user_info():
    if not state.manager.credential:
         if not state.manager.load_credential():
            raise HTTPException(status_code=401, detail="Not logged in")
    
    cred = state.manager.credential
    
    # Check if expired
    try:
        is_expired = await check_expired(cred)
        if is_expired:
             # Try refresh
            if await cred.can_refresh():
                await cred.refresh()
                state.manager.save_credential()
            else:
                raise HTTPException(status_code=401, detail="Token expired")
    except Exception as e:
        print(f"Check expired error: {e}")

    # Debug: Print credential attributes
    print(f"DEBUG: Credential attrs: {dir(cred)}", file=sys.stderr)
    
    nickname = getattr(cred, "nickname", "")
    musicid = getattr(cred, "musicid", "")

    # If nickname is empty, try to fetch from homepage
    if not nickname and musicid:
        try:
            print(f"Fetching profile for musicid: {musicid}", file=sys.stderr)
            profile = await user.get_homepage(str(musicid))
            # The structure of profile might vary, safe get
            # profile usually has 'creator' or similar? Or just 'nick'?
            # Let's inspect profile in logs if possible, but for now try generic keys
            # Based on library, get_homepage returns dict.
            print(f"DEBUG: Profile response keys: {profile.keys()}", file=sys.stderr)
            print(f"DEBUG: Full Profile: {profile}", file=sys.stderr)
            
            # Try to find nickname in 'Info' or 'creator'
            info = profile.get("Info", {})
            base_info = info.get("BaseInfo", {})
            creator = profile.get("creator", {})
            
            nickname = base_info.get("Name", "") or info.get("Nick", "") or creator.get("nick", "") or profile.get("nick", "")
            
            # Update credential if possible (in memory)
            if nickname:
                 setattr(cred, "nickname", nickname)
        except Exception as e:
            print(f"Failed to fetch profile: {e}", file=sys.stderr)

    return {
        "musicid": musicid,
        "nickname": nickname,
        "encrypt_uin": getattr(cred, "encrypt_uin", ""),
    }

@app.get("/api/search")
async def search_songs(keyword: str, page: int = 1, limit: int = 10):
    if not keyword:
        raise HTTPException(status_code=400, detail="Keyword is required")
    
    MAX_RETRIES = 5
    for attempt in range(MAX_RETRIES):
        try:
            print(f"Searching for: {keyword}, page: {page}, limit: {limit}, attempt: {attempt+1}", file=sys.stderr)
            results = await search.search_by_type(keyword, page=page, num=limit)
            print(f"Found {len(results)} results", file=sys.stderr)
            return {"list": results}
        except Exception as e:
            # Check for API Response Code Error 2001 (or generic Exception matching it)
            error_str = str(e)
            if "[2001]" in error_str and attempt < MAX_RETRIES - 1:
                print(f"Attempt {attempt+1} failed with 2001 error, retrying...", file=sys.stderr)
                await asyncio.sleep(1) # Wait 1s before retry
                continue
            
            print(f"Search error details: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
            return {"list": []}

@app.get("/api/song/{mid}")
async def get_song_detail(mid: str, quality: str = "128"):
    try:
        # Get URLs
        credential = state.manager.credential
        
        # Map quality to SongFileType
        file_type = SongFileType.MP3_128
        if quality == "320":
            file_type = SongFileType.MP3_320
        elif quality == "flac":
            file_type = SongFileType.FLAC
        elif quality == "mflac":
            file_type = SongFileType.MASTER
            
        urls_map = await get_song_urls([mid], file_type=file_type, credential=credential)
        play_url = urls_map.get(mid, "")
        
        # Get Lyrics
        lyrics_data = {}
        try:
             lyrics_data = await get_lyric(mid)
        except Exception as e:
             print(f"Lyrics error: {e}")

        return {
            "mid": mid,
            "url": play_url,
            "lyric": lyrics_data.get("lyric", ""),
            "trans": lyrics_data.get("trans", "")
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

from fastapi.responses import StreamingResponse
from fastapi import Body
import aiohttp
from fastapi import Request
import tempfile
from urllib.parse import quote
from mutagen import File as MutagenFile

# Password management
CONFIG_DIR = os.getenv("CONFIG_DIR", ".")
PASSWORD_FILE = os.path.join(CONFIG_DIR, "password.txt")

def load_password():
    if os.path.exists(PASSWORD_FILE):
        with open(PASSWORD_FILE, "r") as f:
            return f.read().strip()
    return "admin"  # Default password

def save_password(password):
    # Ensure config dir exists
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(PASSWORD_FILE, "w") as f:
        f.write(password)

APP_PASSWORD = load_password()

@app.post("/api/auth/login")
async def login(password: str = Body(..., embed=True)):
    if password == APP_PASSWORD:
        return {"status": "ok"}
    raise HTTPException(status_code=401, detail="Invalid password")


# Emby refresh configuration
EMBY_URL = os.getenv("EMBY_URL", "").strip().rstrip("/")
EMBY_TOKEN = os.getenv("EMBY_TOKEN", "").strip()
EMBY_MUSIC_LIBRARY_ID = os.getenv("EMBY_MUSIC_LIBRARY_ID", "").strip()


@app.post("/api/emby/refresh-music")
async def refresh_emby_music_library():
    """
    Refresh Emby music library.
    Prefer item/library id refresh, fallback to full library refresh.
    """
    if not EMBY_URL or not EMBY_TOKEN:
        raise HTTPException(
            status_code=400,
            detail="Emby not configured. Please set EMBY_URL and EMBY_TOKEN."
        )

    headers = {
        "X-Emby-Token": EMBY_TOKEN,
        "Accept": "application/json",
    }

    # Try music library refresh first (if id is configured), then fallback.
    candidates = []
    if EMBY_MUSIC_LIBRARY_ID:
        candidates.extend([
            ("POST", f"{EMBY_URL}/Items/{EMBY_MUSIC_LIBRARY_ID}/Refresh"),
            ("POST", f"{EMBY_URL}/emby/Items/{EMBY_MUSIC_LIBRARY_ID}/Refresh"),
        ])
    candidates.extend([
        ("POST", f"{EMBY_URL}/Library/Refresh"),
        ("POST", f"{EMBY_URL}/emby/Library/Refresh"),
    ])

    timeout = aiohttp.ClientTimeout(total=20)
    last_error = None

    async with aiohttp.ClientSession(timeout=timeout) as session:
        for method, url in candidates:
            try:
                # Send token in both header and query for broader Emby compatibility.
                sep = "&" if "?" in url else "?"
                url_with_key = f"{url}{sep}api_key={EMBY_TOKEN}"
                async with session.request(method, url_with_key, headers=headers) as resp:
                    text = await resp.text()
                    if 200 <= resp.status < 300:
                        return {
                            "success": True,
                            "strategy": "music_library" if "/Items/" in url else "full_library",
                            "endpoint": url,
                            "status": resp.status,
                            "message": "Emby refresh requested successfully."
                        }
                    last_error = f"{url} -> HTTP {resp.status} {text[:200]}"
            except Exception as e:
                last_error = f"{url} -> {e}"

    raise HTTPException(status_code=502, detail=f"Failed to refresh Emby: {last_error}")

@app.post("/api/auth/password")
async def change_password(
    current_password: str = Body(..., embed=True),
    new_password: str = Body(..., embed=True)
):
    global APP_PASSWORD
    if current_password != APP_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid current password")
    
    APP_PASSWORD = new_password
    save_password(new_password)
    return {"status": "ok", "message": "Password updated"}

# Ensure downloads directory exists
DOWNLOAD_DIR = os.getenv("DOWNLOAD_DIR", os.path.join(os.path.dirname(__file__), "downloads"))
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

AUDIO_EXTENSIONS = {".mp3", ".flac", ".m4a", ".aac", ".wav", ".ogg", ".opus"}


def _normalize_text(value: str) -> str:
    # Keep unicode letters/numbers (including CJK), strip separators.
    return re.sub(r"[\s\-_.,，。·:：()（）\[\]【】]+", "", (value or "").lower())


def _safe_rel_to_abs(rel_path: str) -> str:
    if not rel_path:
        raise HTTPException(status_code=400, detail="path is required")
    base = os.path.realpath(DOWNLOAD_DIR)
    target = os.path.realpath(os.path.join(base, rel_path))
    if not target.startswith(base + os.sep) and target != base:
        raise HTTPException(status_code=400, detail="invalid path")
    if not os.path.isfile(target):
        raise HTTPException(status_code=404, detail="file not found")
    return target


def _extract_lyrics(audio) -> str:
    if not audio or not getattr(audio, "tags", None):
        return ""
    tags = audio.tags
    # FLAC/Vorbis style
    for key in ("LYRICS", "UNSYNCEDLYRICS", "USLT"):
        value = tags.get(key)
        if value:
            if isinstance(value, list):
                return str(value[0])
            return str(value)
    # ID3 style
    for key in tags.keys():
        if key.startswith("USLT"):
            frame = tags.get(key)
            text = getattr(frame, "text", "")
            if isinstance(text, list):
                return str(text[0]) if text else ""
            return str(text)
    return ""


def _extract_cover_data_url(audio, ext: str) -> str:
    if not audio:
        return ""
    image_data = None
    mime = "image/jpeg"
    if ext == ".flac":
        pictures = getattr(audio, "pictures", None) or []
        if pictures:
            image_data = pictures[0].data
            mime = pictures[0].mime or mime
    else:
        tags = getattr(audio, "tags", None)
        if tags:
            for key in tags.keys():
                if key.startswith("APIC"):
                    frame = tags.get(key)
                    image_data = getattr(frame, "data", None)
                    mime = getattr(frame, "mime", mime) or mime
                    if image_data:
                        break
    if not image_data:
        return ""
    return f"data:{mime};base64,{base64.b64encode(image_data).decode('utf-8')}"


def _extract_audio_info(abs_path: str, rel_path: str):
    name = os.path.basename(abs_path)
    ext = os.path.splitext(name)[1].lower()
    stat = os.stat(abs_path)
    info = {
        "name": name,
        "path": rel_path,
        "size": stat.st_size,
        "mtime": int(stat.st_mtime),
        "title": os.path.splitext(name)[0],
        "artist": "",
        "album": "",
        "lyric": "",
        "cover": "",
    }
    try:
        audio = MutagenFile(abs_path)
        if audio and getattr(audio, "tags", None):
            tags = audio.tags
            title = tags.get("TIT2") or tags.get("TITLE")
            artist = tags.get("TPE1") or tags.get("ARTIST")
            album = tags.get("TALB") or tags.get("ALBUM")
            if title:
                info["title"] = str(title[0] if isinstance(title, list) else getattr(title, "text", [info["title"]])[0])
            if artist:
                info["artist"] = str(artist[0] if isinstance(artist, list) else getattr(artist, "text", [""])[0])
            if album:
                info["album"] = str(album[0] if isinstance(album, list) else getattr(album, "text", [""])[0])
            info["lyric"] = _extract_lyrics(audio)
            info["cover"] = _extract_cover_data_url(audio, ext)
    except Exception as e:
        print(f"read audio metadata failed for {abs_path}: {e}", file=sys.stderr)
    return info


def _iter_audio_files():
    for root, _, files in os.walk(DOWNLOAD_DIR):
        for filename in files:
            ext = os.path.splitext(filename)[1].lower()
            if ext not in AUDIO_EXTENSIONS:
                continue
            abs_path = os.path.join(root, filename)
            rel_path = os.path.relpath(abs_path, DOWNLOAD_DIR)
            yield abs_path, rel_path


def _strict_filename_match(basename: str, title: str, singer: str, album: str) -> bool:
    """
    Strictly match filename in pattern: title_singer_album.ext
    Supports ambiguous underscores by trying all split positions.
    """
    target_title = _normalize_text(title)
    target_singer = _normalize_text(singer)
    target_album = _normalize_text(album)
    if not target_title or not target_singer or not target_album:
        return False

    stem = os.path.splitext(basename)[0]
    parts = stem.split("_")
    if len(parts) < 3:
        return False

    # Try all partitions: [0:i] [i:j] [j:n]
    n = len(parts)
    for i in range(1, n - 1):
        for j in range(i + 1, n):
            p_title = _normalize_text("_".join(parts[:i]))
            p_singer = _normalize_text("_".join(parts[i:j]))
            p_album = _normalize_text("_".join(parts[j:]))
            if p_title == target_title and p_singer == target_singer and p_album == target_album:
                return True
    return False


@app.get("/api/library/files")
async def list_library_files(q: str = "", limit: int = 200):
    limit = max(1, min(limit, 1000))
    q_raw = (q or "").strip().lower()
    q_norm = _normalize_text(q)
    files = []
    for abs_path, rel_path in _iter_audio_files():
        name = os.path.basename(abs_path)
        name_raw = name.lower()
        name_norm = _normalize_text(name)
        if q_raw and q_raw not in name_raw and (not q_norm or q_norm not in name_norm):
            continue
        st = os.stat(abs_path)
        files.append({
            "name": name,
            "path": rel_path,
            "size": st.st_size,
            "mtime": int(st.st_mtime),
        })
    files.sort(key=lambda x: x["mtime"], reverse=True)
    return {"list": files[:limit], "total": len(files)}


class MatchSong(BaseModel):
    mid: str
    title: str
    singer: str = ""
    album: str = ""


class MatchRequest(BaseModel):
    songs: list[MatchSong]


@app.post("/api/library/find-matches")
async def find_library_matches(req: MatchRequest):
    result = {}
    for song in req.songs:
        if not song.title or not song.singer or not song.album:
            continue

        for abs_path, rel_path in _iter_audio_files():
            basename = os.path.basename(abs_path)
            if _strict_filename_match(
                basename=basename,
                title=song.title,
                singer=song.singer,
                album=song.album,
            ):
                result[song.mid] = {"path": rel_path}
                break
    return {"matches": result}


@app.get("/api/library/file-info")
async def library_file_info(path: str):
    abs_path = _safe_rel_to_abs(path)
    rel_path = os.path.relpath(abs_path, DOWNLOAD_DIR)
    info = _extract_audio_info(abs_path, rel_path)
    stream_url = f"/api/library/stream?path={quote(rel_path)}"
    download_url = f"/api/library/download?path={quote(rel_path)}"
    return {
        "success": True,
        "info": info,
        "streamUrl": stream_url,
        "downloadUrl": download_url,
    }


def _guess_media_type(path: str):
    media_type = mimetypes.guess_type(path)[0]
    if media_type:
        return media_type
    ext = os.path.splitext(path)[1].lower()
    if ext == ".flac":
        return "audio/flac"
    if ext == ".mp3":
        return "audio/mpeg"
    return "application/octet-stream"


@app.get("/api/library/stream")
async def stream_library_file(path: str):
    abs_path = _safe_rel_to_abs(path)
    return FileResponse(
        abs_path,
        media_type=_guess_media_type(abs_path),
        headers={"Accept-Ranges": "bytes"},
    )


@app.get("/api/library/download")
async def download_library_file(path: str):
    abs_path = _safe_rel_to_abs(path)
    filename = os.path.basename(abs_path)
    return FileResponse(
        abs_path,
        media_type=_guess_media_type(abs_path),
        filename=filename,
        headers={
            "Accept-Ranges": "bytes",
        },
    )

class SaveRequest(BaseModel):
    mid: str
    quality: str = "flac"
    
@app.post("/api/save")
async def save_song(req: SaveRequest):
    """
    Download song to server filesystem and auto-tag it.
    Useful for Docker volume mounting.
    """
    print(f"Saving song to server: {req.mid}, quality={req.quality}", file=sys.stderr)
    try:
        # 1. Get song URL
        credential = state.manager.credential
        
        file_type = SongFileType.MP3_128
        file_ext = ".mp3"
        if req.quality == "320":
            file_type = SongFileType.MP3_320
            file_ext = ".mp3"
        elif req.quality == "flac":
            file_type = SongFileType.FLAC
            file_ext = ".flac"
        elif req.quality == "mflac":
            file_type = SongFileType.MASTER
            file_ext = ".flac"
            
        urls_map = await get_song_urls([req.mid], file_type=file_type, credential=credential)
        song_url = urls_map.get(req.mid, "")
        
        if not song_url:
            raise HTTPException(status_code=404, detail="Song URL not found")

        # 2. Get Metadata & Lyrics for tagging
        from auto_tag import get_song_detail, auto_tag_song
        metadata = await get_song_detail(req.mid)
        
        lyrics_text = ""
        try:
            lyrics_data = await get_lyric(req.mid)
            lyrics_text = lyrics_data.get("lyric", "")
        except:
            pass

        # 3. Determine Filename
        # Match client-side format: Title_Singer_Album.ext
        if metadata:
            safe_title = "".join(c for c in metadata.get("title", "") if c.isalnum() or c in " -_").strip()
            safe_artist = "".join(c for c in metadata.get("artist", "") if c.isalnum() or c in " -_,").strip()
            safe_album = "".join(c for c in metadata.get("album", "") if c.isalnum() or c in " -_").strip()
            
            # Fallback if empty
            if not safe_artist: safe_artist = "Unknown"
            if not safe_album: safe_album = "Unknown"
            
            filename = f"{safe_title}_{safe_artist}_{safe_album}{file_ext}"
        else:
            filename = f"{req.mid}{file_ext}"
            
        file_path = os.path.join(DOWNLOAD_DIR, filename)
        
        # 4. Download file
        download_headers = {
            "Referer": "https://y.qq.com/",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.get(song_url, headers=download_headers) as response:
                if response.status != 200:
                    raise HTTPException(status_code=500, detail=f"Download failed: HTTP {response.status}")
                
                with open(file_path, "wb") as f:
                    async for chunk in response.content.iter_chunked(64 * 1024):
                        f.write(chunk)
                        
        # 5. Apply Tags
        tag_result = await auto_tag_song(file_path, req.mid, lyrics_text)
        
        return {
            "success": True,
            "filePath": file_path,
            "fileName": filename,
            "tagging": tag_result
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Save error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/proxy")
async def proxy_stream(
    request: Request, 
    url: str, 
    download: bool = False, 
    name: str = "song.mp3",
    mid: str = "",  # Song MID for auto-tagging
    autoTag: bool = False  # Enable auto-tagging
):
    if not url:
        raise HTTPException(status_code=400, detail="URL required")
    
    upstream_headers = {
        "Referer": "https://y.qq.com/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    # Forward Range header from client if present (but not for auto-tag downloads)
    range_header = request.headers.get("Range")
    if range_header and not (download and autoTag):
        upstream_headers["Range"] = range_header

    # Determine Content-Type based on extension
    if name.endswith('.flac'):
        media_type = 'audio/flac'
    elif name.endswith('.mp3'):
        media_type = 'audio/mpeg'
    else:
        media_type = 'application/octet-stream'
            
    print(f"Proxying: {name} as {media_type}, autoTag: {autoTag}, mid: {mid}", file=sys.stderr)

    # If auto-tagging is enabled for download, download to temp, tag, then serve
    if download and autoTag and mid:
        from auto_tag import auto_tag_song
        
        # Download to temp file
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=upstream_headers) as response:
                if response.status != 200:
                    raise HTTPException(status_code=500, detail=f"Download failed: {response.status}")
                
                # Create temp file with correct extension
                ext = '.flac' if name.endswith('.flac') else '.mp3'
                with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
                    tmp_path = tmp.name
                    async for chunk in response.content.iter_chunked(64 * 1024):
                        tmp.write(chunk)
        
        # Get lyrics and tag the file
        try:
            lyrics_text = ""
            try:
                lyrics_data = await get_lyric(mid)
                lyrics_text = lyrics_data.get("lyric", "")
            except:
                pass
            
            tag_result = await auto_tag_song(tmp_path, mid, lyrics_text)
            print(f"Auto-tag result: {tag_result}", file=sys.stderr)
        except Exception as e:
            print(f"Auto-tag error: {e}", file=sys.stderr)
        
        # Serve the tagged file
        from urllib.parse import quote
        encoded_name = quote(name)
        
        # Read and return the file
        import os
        file_size = os.path.getsize(tmp_path)
        
        async def iter_file():
            try:
                with open(tmp_path, 'rb') as f:
                    while chunk := f.read(64 * 1024):
                        yield chunk
            finally:
                os.unlink(tmp_path)  # Clean up temp file
        
        return StreamingResponse(
            iter_file(),
            headers={
                "Content-Length": str(file_size),
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}"
            },
            media_type=media_type
        )
    
    # Original streaming logic (no auto-tag)
    session = aiohttp.ClientSession()
    upstream_response = await session.get(url, headers=upstream_headers)
    
    content_length = upstream_response.headers.get("Content-Length")
    content_range = upstream_response.headers.get("Content-Range")
    
    response_headers = {}
    
    # Forward essential headers for seeking
    if content_length:
        response_headers["Content-Length"] = content_length
    if content_range:
        response_headers["Content-Range"] = content_range
    
    # Always indicate Range support
    response_headers["Accept-Ranges"] = "bytes"
    
    if download:
        from urllib.parse import quote
        encoded_name = quote(name)
        response_headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{encoded_name}"

    # Determine status code (206 for partial, 200 for full)
    status_code = upstream_response.status if upstream_response.status in [200, 206] else 200

    async def iter_content():
        try:
            async for chunk in upstream_response.content.iter_chunked(64 * 1024):
                yield chunk
        finally:
            await upstream_response.release()
            await session.close()

    return StreamingResponse(
        iter_content(), 
        headers=response_headers, 
        media_type=media_type,
        status_code=status_code
    )


# Serve static files (Frontend)
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Determine frontend dist path:
# In Docker, it will be ./frontend/dist relative to app root
# Locally, it might be ./frontend/dist if built
FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "frontend", "dist")

if os.path.exists(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")
    
    @app.get("/")
    async def read_index():
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))

    # Catch-all for React Router (SPA) - EXCEPT /api routes
    # Note: This must be the last route definition
    @app.exception_handler(404)
    async def not_found_handler(request: Request, exc: HTTPException):
        # If API request, return 404 JSON
        if request.url.path.startswith("/api/"):
            return {"detail": "Not Found"}
        # Otherwise serve index.html for SPA routing
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))

if __name__ == "__main__":
    import uvicorn
    # Use 0.0.0.0 for Docker
    uvicorn.run(app, host="0.0.0.0", port=8001)

if __name__ == "__main__":
    uvicorn.run("api:app", host="0.0.0.0", port=8001, reload=True)
