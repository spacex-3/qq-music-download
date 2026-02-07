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

APP_PASSWORD = "admin"

@app.post("/api/auth/login")
async def login(password: str = Body(..., embed=True)):
    if password == APP_PASSWORD:
        return {"status": "ok"}
    raise HTTPException(status_code=401, detail="Invalid password")

@app.post("/api/auth/password")
async def change_password(
    current_password: str = Body(..., embed=True),
    new_password: str = Body(..., embed=True)
):
    global APP_PASSWORD
    if current_password != APP_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid current password")
    
    APP_PASSWORD = new_password
    return {"status": "ok", "message": "Password updated"}

import aiohttp
from fastapi import Request

@app.get("/api/proxy")
async def proxy_stream(request: Request, url: str, download: bool = False, name: str = "song.mp3"):
    if not url:
        raise HTTPException(status_code=400, detail="URL required")
    
    upstream_headers = {
        "Referer": "https://y.qq.com/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    # Forward Range header from client if present
    range_header = request.headers.get("Range")
    if range_header:
        upstream_headers["Range"] = range_header

    # Determine Content-Type based on extension
    if name.endswith('.flac'):
        media_type = 'audio/flac'
    elif name.endswith('.mp3'):
        media_type = 'audio/mpeg'
    else:
        media_type = 'application/octet-stream'
            
    print(f"Proxying: {name} as {media_type}, Range: {range_header}", file=sys.stderr)

    # First, make a HEAD request to get content info without downloading
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

if __name__ == "__main__":
    uvicorn.run("api:app", host="0.0.0.0", port=8001, reload=True)

