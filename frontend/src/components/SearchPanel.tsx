import { useState, useRef, useEffect } from 'react';
import { Search, Play, Pause, Volume2, VolumeX, Download, Tag, Loader2, HardDrive } from 'lucide-react';



interface SearchResult {
    mid: string;
    title: string;
    singer: { name: string }[];
    album: { name: string; mid: string };
    interval: number;
    localPath?: string;
}

interface SongDetail {
    mid: string;
    url: string;
    lyric: string;
    trans: string;
    title: string;
    singer: string;
    cover: string;
    source?: "local" | "remote";
}

interface LyricLine {
    time: number;
    text: string;
}

const parseLyrics = (lyric: string): LyricLine[] => {
    return lyric.split('\n').map(line => {
        const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
        if (match) {
            const min = parseInt(match[1]);
            const sec = parseInt(match[2]);
            const ms = parseInt(match[3].length === 2 ? match[3] + '0' : match[3]);
            return {
                time: min * 60 + sec + ms / 1000,
                text: match[4].trim()
            };
        }
        return null;
    }).filter((item): item is LyricLine => item !== null && item.text.length > 0);
};

interface SearchPanelProps {
    API_BASE: string;
}

interface PlaylistInfo {
    id: string;
    name: string;
    creator: string;
    song_count: number;
    songs: SearchResult[];
}

interface PlaylistTaskStatus {
    status: string;
    progress: number;
    total: number;
    current_song?: string;
    current_status?: string;
    stage?: string;
    download_current?: number;
    download_total?: number;
    zip_current?: number;
    zip_total?: number;
    message?: string;
    result?: {
        success?: number;
        failed?: number;
        skipped?: number;
        output_dir?: string;
    };
    error?: string;
}

export function SearchPanel({ API_BASE }: SearchPanelProps) {
    const [keyword, setKeyword] = useState('');
    const [allResults, setAllResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [currentSong, setCurrentSong] = useState<SongDetail | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [volume, setVolume] = useState(0.5);
    const [isMuted, setIsMuted] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [page, setPage] = useState(1); // UI Page (1, 2, 3...)
    const [apiPage, setApiPage] = useState(1); // API Page Batch (1 = items 0-20, 2 = items 21-40)
    const [quality, setQuality] = useState('flac');
    const [autoTag, setAutoTag] = useState(() => {
        // Load from localStorage on init
        const saved = localStorage.getItem('autoTag');
        return saved === 'true';
    });
    const [downloadingMid, setDownloadingMid] = useState<string | null>(null);
    const [savingMid, setSavingMid] = useState<string | null>(null);
    const [parsedLyrics, setParsedLyrics] = useState<LyricLine[]>([]);
    const [activeLyricIndex, setActiveLyricIndex] = useState(0);
    const isSeekingRef = useRef(false);
    const [sliderValue, setSliderValue] = useState(0);
    const lyricContainerRef = useRef<HTMLDivElement>(null);

    // Playlist states
    const [playlistInput, setPlaylistInput] = useState('');
    const [playlistInfo, setPlaylistInfo] = useState<PlaylistInfo | null>(null);
    const [playlistLoading, setPlaylistLoading] = useState(false);
    const [playlistTaskId, setPlaylistTaskId] = useState<string | null>(null);
    const [playlistTaskStatus, setPlaylistTaskStatus] = useState<PlaylistTaskStatus | null>(null);
    const [playlistError, setPlaylistError] = useState('');
    const [playlistPage, setPlaylistPage] = useState(1);
    const [playlistDownloadTarget, setPlaylistDownloadTarget] = useState<'browser' | 'server'>('browser');
    const [playlistQuality, setPlaylistQuality] = useState('flac');
    const [playlistAutoTag, setPlaylistAutoTag] = useState(true);

    // Persist autoTag to localStorage
    useEffect(() => {
        localStorage.setItem('autoTag', autoTag.toString());
    }, [autoTag]);

    const audioRef = useRef<HTMLAudioElement | null>(null);

    const canPlayLocalPath = (path: string): boolean => {
        const ext = path.split('.').pop()?.toLowerCase() || "";
        const mimeByExt: Record<string, string> = {
            mp3: "audio/mpeg",
            m4a: "audio/mp4",
            aac: "audio/aac",
            wav: "audio/wav",
            ogg: "audio/ogg",
            opus: "audio/ogg; codecs=opus",
            flac: "audio/flac",
        };
        const mime = mimeByExt[ext];
        if (!mime) return false;
        const audio = document.createElement("audio");
        return !!audio.canPlayType(mime);
    };

    const annotateLocalMatches = async (songs: SearchResult[]): Promise<SearchResult[]> => {
        if (!songs.length) return songs;
        try {
            const payload = {
                songs: songs.map((song) => ({
                    mid: song.mid,
                    title: song.title,
                    singer: song.singer?.[0]?.name || "",
                    album: song.album?.name || "",
                })),
            };
            const res = await fetch(`${API_BASE}/api/library/find-matches`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) return songs;
            const data = await res.json();
            const matches = data?.matches || {};
            return songs.map((song) => ({
                ...song,
                localPath: matches[song.mid]?.path || undefined,
            }));
        } catch (e) {
            console.error("match local files failed", e);
            return songs;
        }
    };

    const handleSearchStart = async () => {
        if (!keyword.trim()) return;
        setLoading(true);
        setPage(1);
        setApiPage(1);
        setAllResults([]);
        try {
            // Fetch first 20 items
            const res = await fetch(`${API_BASE}/api/search?keyword=${encodeURIComponent(keyword)}&limit=20&page=1`);
            const data = await res.json();
            const withLocal = await annotateLocalMatches(data.list || []);
            setAllResults(withLocal);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const loadMoreResults = async () => {
        const nextApiPage = apiPage + 1;
        setLoading(true);
        try {
            console.log(`Fetching more results batch ${nextApiPage}...`);
            const res = await fetch(`${API_BASE}/api/search?keyword=${encodeURIComponent(keyword)}&limit=20&page=${nextApiPage}`);
            const data = await res.json();
            const newResults = await annotateLocalMatches(data.list || []);

            if (newResults.length > 0) {
                setAllResults(prev => [...prev, ...newResults]);
                setApiPage(nextApiPage);
                setPage(page + 1); // Move to next UI page
            } else {
                console.log("No more results found.");
            }
        } catch (error) {
            console.error("Failed to load more results", error);
        } finally {
            setLoading(false);
        }
    };

    const handleNextPage = () => {
        const totalItems = allResults.length;
        const currentMaxPage = Math.ceil(totalItems / 5);

        if (page < currentMaxPage) {
            // Simply next page if valid
            setPage(page + 1);
        } else {
            // Need to fetch more
            loadMoreResults();
        }
    };

    // Calculate displayed results based on page
    const displayedResults = allResults.slice((page - 1) * 5, page * 5);

    const playRemoteSong = async (song: SearchResult) => {
        const mid = song.mid;
        const title = song.title;
        const singer = song.singer?.[0]?.name || "Unknown";
        try {
            const res = await fetch(`${API_BASE}/api/song/${mid}?quality=${quality}`);
            const data = await res.json();

            if (!data.url) {
                alert("Playback failed: VIP or restricted song.");
                return false;
            }

            const ext = (quality === 'flac' || quality === 'mflac') ? 'flac' : 'mp3';
            const proxyName = `${title}.${ext}`;
            const proxyUrl = `${API_BASE}/api/proxy?url=${encodeURIComponent(data.url)}&name=${encodeURIComponent(proxyName)}`;

            setCurrentSong({
                mid: data.mid,
                url: proxyUrl,
                lyric: data.lyric,
                trans: data.trans,
                title: title,
                singer: singer,
                cover: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${data.mid}.jpg`,
                source: "remote",
            });

            const foundAction = allResults.find(r => r.mid === mid);
            if (foundAction && foundAction.album?.mid) {
                setCurrentSong(prev => prev ? ({ ...prev, cover: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${foundAction.album.mid}.jpg` }) : null);
            }
            setIsPlaying(true);
            return true;
        } catch (error) {
            console.error(error);
            alert("Failed to load song.");
            return false;
        }
    };

    const playLocalFile = async (song: SearchResult) => {
        if (!song.localPath) return false;
        try {
            const res = await fetch(`${API_BASE}/api/library/file-info?path=${encodeURIComponent(song.localPath)}`);
            if (!res.ok) return false;
            const data = await res.json();
            const info = data?.info;
            if (!info) return false;
            setCurrentSong({
                mid: song.mid,
                url: `${API_BASE}${data.streamUrl}`,
                lyric: info.lyric || "",
                trans: "",
                title: info.title || song.title,
                singer: info.artist || song.singer?.[0]?.name || "Unknown",
                cover: info.cover || `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.album?.mid || song.mid}.jpg`,
                source: "local",
            });
            setIsPlaying(true);
            return true;
        } catch (e) {
            console.error("play local file failed", e);
            return false;
        }
    };

    const playSong = async (song: SearchResult) => {
        if (song.localPath && canPlayLocalPath(song.localPath)) {
            const usedLocal = await playLocalFile(song);
            if (usedLocal) return;
        }
        await playRemoteSong(song);
    };

    const downloadSong = async (e: React.MouseEvent, song: SearchResult) => {
        e.stopPropagation(); // Prevent playing when clicking download

        if (autoTag) {
            setDownloadingMid(song.mid);
        }

        try {
            if (song.localPath) {
                const dlRes = await fetch(`${API_BASE}/api/library/download?path=${encodeURIComponent(song.localPath)}`);
                if (!dlRes.ok) {
                    throw new Error(`Local download failed: HTTP ${dlRes.status}`);
                }
                const blob = await dlRes.blob();
                const blobUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = blobUrl;
                link.download = song.localPath.split('/').pop() || `${song.title}.flac`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(blobUrl);
                return;
            }

            const res = await fetch(`${API_BASE}/api/song/${song.mid}?quality=${quality}`);
            const data = await res.json();

            if (!data.url) {
                alert("Download failed: URL not available.");
                return;
            }

            // Use Proxy for Download to handle CORS headers
            const ext = quality === 'flac' || quality === 'mflac' ? 'flac' : 'mp3';
            const singerName = song.singer?.[0]?.name || 'Unknown';
            const albumName = song.album?.name || 'Unknown';
            const filename = `${song.title}_${singerName}_${albumName}.${ext}`;

            // Build proxy URL with optional autoTag params
            let proxyUrl = `${API_BASE}/api/proxy?url=${encodeURIComponent(data.url)}&download=true&name=${encodeURIComponent(filename)}`;

            if (autoTag) {
                proxyUrl += `&mid=${song.mid}&autoTag=true`;
            }

            // Trigger download via native anchor click
            const link = document.createElement('a');
            link.href = proxyUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error(error);
            console.error("downloadSong failed:", error);
            alert(`Failed to download song: ${error instanceof Error ? error.message : "Unknown error"}`);
        } finally {
            setDownloadingMid(null);
        }
    };

    const saveToServer = async (e: React.MouseEvent, song: SearchResult) => {
        e.stopPropagation();
        setSavingMid(song.mid);
        try {
            const res = await fetch(`${API_BASE}/api/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mid: song.mid,
                    quality: quality,
                    auto_tag: autoTag,
                })
            });
            const result = await res.json();

            if (result.success) {
                alert(`✅ Saved to Server: ${result.fileName}\nPath: ${result.filePath}`);
            } else {
                alert(`❌ Save failed: ${result.detail || 'Unknown error'}`);
            }
        } catch (error) {
            console.error(error);
            alert("Failed to save song to server.");
        } finally {
            setSavingMid(null);
        }
    };

    const playlistDownloadSong = async (e: React.MouseEvent, song: SearchResult) => {
        e.stopPropagation();
        setDownloadingMid(song.mid);
        try {
            if (song.localPath) {
                const dlRes = await fetch(`${API_BASE}/api/library/download?path=${encodeURIComponent(song.localPath)}`);
                if (!dlRes.ok) throw new Error(`Local download failed: HTTP ${dlRes.status}`);
                const blob = await dlRes.blob();
                const blobUrl = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = blobUrl;
                link.download = song.localPath.split('/').pop() || `${song.title}.flac`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(blobUrl);
                return;
            }

            const res = await fetch(`${API_BASE}/api/song/${song.mid}?quality=${playlistQuality}`);
            const data = await res.json();
            if (!data.url) {
                alert("Download failed: URL not available.");
                return;
            }

            const ext = playlistQuality === 'flac' || playlistQuality === 'mflac' ? 'flac' : 'mp3';
            const singerName = song.singer?.[0]?.name || 'Unknown';
            const albumName = song.album?.name || 'Unknown';
            const filename = `${song.title}_${singerName}_${albumName}.${ext}`;

            let proxyUrl = `${API_BASE}/api/proxy?url=${encodeURIComponent(data.url)}&download=true&name=${encodeURIComponent(filename)}`;
            if (playlistAutoTag) {
                proxyUrl += `&mid=${song.mid}&autoTag=true`;
            }

            const link = document.createElement('a');
            link.href = proxyUrl;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error(error);
            alert(`Failed to download song: ${error instanceof Error ? error.message : "Unknown error"}`);
        } finally {
            setDownloadingMid(null);
        }
    };

    const playlistSaveToServer = async (e: React.MouseEvent, song: SearchResult) => {
        e.stopPropagation();
        setSavingMid(song.mid);
        try {
            const res = await fetch(`${API_BASE}/api/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mid: song.mid,
                    quality: playlistQuality,
                    auto_tag: playlistAutoTag,
                })
            });
            const result = await res.json();
            if (result.success) {
                alert(`✅ Saved to Server: ${result.fileName}\nPath: ${result.filePath}`);
            } else {
                alert(`❌ Save failed: ${result.detail || 'Unknown error'}`);
            }
        } catch (error) {
            console.error(error);
            alert("Failed to save song to server.");
        } finally {
            setSavingMid(null);
        }
    };

    const parsePlaylist = async () => {
        if (!playlistInput.trim()) return;
        setPlaylistLoading(true);
        setPlaylistError('');
        setPlaylistInfo(null);
        setPlaylistTaskId(null);
        setPlaylistTaskStatus(null);
        try {
            const parseRes = await fetch(`${API_BASE}/api/playlist/parse`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: playlistInput.trim() })
            });
            const parseData = await parseRes.json();
            if (!parseRes.ok || !parseData.success || !parseData.playlist_id) {
                setPlaylistError(parseData?.message || '无法解析歌单链接');
                return;
            }

            const infoRes = await fetch(`${API_BASE}/api/playlist/${parseData.playlist_id}/info`);
            const infoData = await infoRes.json();
            if (!infoRes.ok || !infoData.success) {
                setPlaylistError(infoData?.detail || '获取歌单信息失败');
                return;
            }

            const songsRaw = infoData.songs || [];
            const adaptedSongs: SearchResult[] = songsRaw.map((s: any) => ({
                mid: s.mid,
                title: s.name,
                singer: [{ name: s.singer || 'Unknown' }],
                album: { name: s.album_name || 'Unknown', mid: '' },
                interval: 0,
            }));
            const withLocal = await annotateLocalMatches(adaptedSongs);

            setPlaylistInfo({
                id: infoData.id,
                name: infoData.name,
                creator: infoData.creator,
                song_count: infoData.song_count,
                songs: withLocal,
            });
            setPlaylistPage(1);
        } catch (e) {
            console.error(e);
            setPlaylistError('请求失败，请检查后端状态');
        } finally {
            setPlaylistLoading(false);
        }
    };

    const startPlaylistDownload = async () => {
        if (!playlistInfo?.id) return;
        setPlaylistLoading(true);
        setPlaylistError('');
        setPlaylistTaskStatus(null);
        try {
            const midsToDownload = (playlistInfo.songs || []).map(s => s.mid);

            if (!midsToDownload.length) {
                setPlaylistError('歌单无可下载歌曲');
                return;
            }

            // 浏览器下载：按 5 首/包 打 zip，逐包弹出下载（显示下载+压缩双状态）
            if (playlistDownloadTarget === 'browser') {
                setPlaylistTaskStatus({
                    status: 'running',
                    progress: 0,
                    total: midsToDownload.length,
                    stage: 'queued',
                    current_status: '排队中'
                });

                const prepStartRes = await fetch(`${API_BASE}/api/playlist/browser-chunks/prepare-async`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        mids: midsToDownload,
                        quality: playlistQuality,
                        auto_tag: playlistAutoTag,
                        playlist_name: playlistInfo.name,
                        chunk_size: 5,
                    })
                });
                const prepStartData = await prepStartRes.json();
                if (!prepStartRes.ok || !prepStartData?.taskId) {
                    throw new Error(prepStartData?.detail || '分包准备启动失败');
                }

                const prepTaskId = prepStartData.taskId as string;

                const delivered = new Set<number>();
                let finalManifest: any = null;
                let deliveredSongs = 0;

                for (let poll = 0; poll < 1200; poll++) { // up to ~20 minutes
                    const stRes = await fetch(`${API_BASE}/api/playlist/browser-chunks/task/${prepTaskId}`);
                    const st = await stRes.json();

                    if (!stRes.ok) throw new Error(st?.detail || '获取分包状态失败');

                    const downloadCurrent = Number(st.download_current || 0);
                    const downloadTotal = Number(st.download_total || midsToDownload.length);
                    const zipCurrent = Number(st.zip_current || 0);
                    const zipTotal = Number(st.zip_total || 0);
                    const stage = st.stage || 'running';
                    const readyChunks = (st.ready_chunks || st.manifest?.chunks || []) as any[];

                    // deliver new ready chunks immediately (while backend may still be downloading/compressing)
                    const newChunks = readyChunks
                        .filter(c => !delivered.has(Number(c.index)))
                        .sort((a, b) => Number(a.index) - Number(b.index));

                    for (const chunk of newChunks) {
                        const href = `${API_BASE}${chunk.downloadUrl}`;
                        const a = document.createElement('a');
                        a.href = href;
                        a.download = chunk.zipName || `playlist_part_${chunk.index}.zip`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        delivered.add(Number(chunk.index));
                        deliveredSongs += Number(chunk.count || 0);

                        setPlaylistTaskStatus({
                            status: 'running',
                            progress: downloadCurrent,
                            total: downloadTotal,
                            stage: 'delivering',
                            download_current: downloadCurrent,
                            download_total: downloadTotal,
                            zip_current: zipCurrent,
                            zip_total: zipTotal,
                            current_status: `已下发分包 ${delivered.size}/${Math.max(zipTotal, readyChunks.length)}（歌曲约 ${deliveredSongs} 首）`,
                        });

                        // avoid browser popup blocking
                        await new Promise(r => setTimeout(r, 500));
                    }

                    setPlaylistTaskStatus({
                        status: st.status || 'running',
                        progress: downloadCurrent,
                        total: downloadTotal,
                        stage,
                        download_current: downloadCurrent,
                        download_total: downloadTotal,
                        zip_current: zipCurrent,
                        zip_total: zipTotal,
                        current_status: st.message || stage,
                    });

                    if (st.status === 'completed' && st.manifest) {
                        finalManifest = st.manifest;
                        // make sure all chunks have been delivered
                        const allChunks = (finalManifest.chunks || []) as any[];
                        const remaining = allChunks
                            .filter(c => !delivered.has(Number(c.index)))
                            .sort((a, b) => Number(a.index) - Number(b.index));
                        for (const chunk of remaining) {
                            const href = `${API_BASE}${chunk.downloadUrl}`;
                            const a = document.createElement('a');
                            a.href = href;
                            a.download = chunk.zipName || `playlist_part_${chunk.index}.zip`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            delivered.add(Number(chunk.index));
                            deliveredSongs += Number(chunk.count || 0);
                            await new Promise(r => setTimeout(r, 500));
                        }
                        break;
                    }
                    if (st.status === 'failed') {
                        throw new Error(st.error || '分包准备失败');
                    }

                    await new Promise(r => setTimeout(r, 1000));
                }

                if (!finalManifest) {
                    throw new Error('分包准备超时，请重试');
                }

                setPlaylistTaskStatus({
                    status: 'completed',
                    progress: Number(finalManifest.totalSuccess || deliveredSongs),
                    total: midsToDownload.length,
                    stage: 'completed',
                    download_current: Number(finalManifest.totalSuccess || deliveredSongs),
                    download_total: midsToDownload.length,
                    zip_current: delivered.size,
                    zip_total: Number((finalManifest.chunks || []).length || delivered.size),
                    current_status: '已完成（分包2小时有效）',
                    result: {
                        success: Number(finalManifest.totalSuccess || deliveredSongs),
                        failed: Number(finalManifest.totalFailed || 0),
                        skipped: 0,
                    }
                });
                return;
            }

            // 服务器下载：逐首保存到服务器目录
            const taskId = `bulk-${Date.now()}`;
            setPlaylistTaskId(taskId);
            setPlaylistTaskStatus({
                status: 'running',
                progress: 0,
                total: midsToDownload.length,
                current_song: '',
                current_status: ''
            });

            let ok = 0;
            let failed = 0;
            for (let i = 0; i < midsToDownload.length; i++) {
                const mid = midsToDownload[i];
                const song = (playlistInfo.songs || []).find(s => s.mid === mid);
                setPlaylistTaskStatus({
                    status: 'running',
                    progress: i,
                    total: midsToDownload.length,
                    current_song: song ? `${song.title} - ${song.singer?.[0]?.name || 'Unknown'}` : mid,
                    current_status: 'downloading',
                });

                try {
                    const saveRes = await fetch(`${API_BASE}/api/save`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            mid,
                            quality: playlistQuality,
                            auto_tag: playlistAutoTag
                        })
                    });
                    if (saveRes.ok) ok += 1;
                    else failed += 1;
                } catch (e) {
                    failed += 1;
                }
            }

            setPlaylistTaskStatus({
                status: 'completed',
                progress: midsToDownload.length,
                total: midsToDownload.length,
                result: {
                    success: ok,
                    failed,
                    skipped: 0,
                }
            });
        } catch (e) {
            console.error(e);
            setPlaylistError('启动下载失败');
            setPlaylistTaskStatus({
                status: 'failed',
                progress: 0,
                total: 0,
                error: e instanceof Error ? e.message : '批量下载失败'
            });
        } finally {
            setPlaylistLoading(false);
        }
    };

    useEffect(() => {
        if (currentSong && audioRef.current) {
            audioRef.current.src = currentSong.url;
            audioRef.current.volume = volume;
            audioRef.current.muted = isMuted;
            audioRef.current.play().catch(e => console.error("Auto-play blocked", e));

            // Parse Lyrics
            if (currentSong.lyric) {
                setParsedLyrics(parseLyrics(currentSong.lyric));
            } else {
                setParsedLyrics([]);
            }
        }
    }, [currentSong]);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = volume;
        }
    }, [volume]);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.muted = isMuted;
        }
    }, [isMuted]);

    useEffect(() => {
        if (!playlistTaskId || playlistTaskId.startsWith('bulk-')) return;
        const timer = setInterval(async () => {
            try {
                const res = await fetch(`${API_BASE}/api/playlist/download/${playlistTaskId}/status`);
                const data = await res.json();
                setPlaylistTaskStatus(data);
                if (data.status === 'completed' || data.status === 'failed') {
                    clearInterval(timer);
                }
            } catch (e) {
                console.error('poll playlist status failed', e);
            }
        }, 1500);

        return () => clearInterval(timer);
    }, [playlistTaskId, API_BASE]);

    // Sync Lyrics
    useEffect(() => {
        if (!parsedLyrics.length) return;
        const index = parsedLyrics.findIndex(l => l.time > currentTime);
        const activeIndex = index === -1 ? parsedLyrics.length - 1 : Math.max(0, index - 1);
        setActiveLyricIndex(activeIndex);

        // Auto scroll container only
        if (lyricContainerRef.current) {
            const container = lyricContainerRef.current;
            const activeEl = container.children[activeIndex] as HTMLElement;
            if (activeEl) {
                const containerHeight = container.clientHeight;
                const scrollOffset = activeEl.offsetTop - containerHeight / 2 + activeEl.clientHeight / 2;
                container.scrollTo({ top: scrollOffset, behavior: 'smooth' });
            }
        }
    }, [currentTime, parsedLyrics]);

    const togglePlay = () => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
            } else {
                audioRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const onTimeUpdate = () => {
        if (audioRef.current && !isSeekingRef.current) {
            const time = audioRef.current.currentTime;
            setCurrentTime(time);
            setSliderValue(time);
            setDuration(audioRef.current.duration || 0);
        }
    };

    // Helper to format time
    const formatTime = (time: number) => {
        const min = Math.floor(time / 60);
        const sec = Math.floor(time % 60);
        return `${min}:${sec < 10 ? '0' : ''}${sec}`;
    };

    const playlistPageSize = 5;
    const playlistSongs = playlistInfo?.songs || [];
    const playlistTotalPages = Math.max(1, Math.ceil(playlistSongs.length / playlistPageSize));
    const currentPlaylistSongs = playlistSongs.slice(
        (playlistPage - 1) * playlistPageSize,
        playlistPage * playlistPageSize
    );

    // playlist uses same row actions as search results; no checkbox selection


    return (
        <div className="flex flex-col h-full w-full max-w-5xl mx-auto">
            {/* Search Bar */}
            <div className="flex flex-col md:flex-row gap-2 mb-6">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-cyan-500/50 w-5 h-5" />
                    <input
                        type="text"
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearchStart()}
                        placeholder="Search for songs, artists..."
                        className="w-full bg-black/40 border border-cyan-500/30 rounded-lg py-3 pl-10 pr-4 text-cyan-100 placeholder:text-cyan-900 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/50 transition-all font-mono"
                    />
                </div>
                <button
                    onClick={handleSearchStart}
                    disabled={loading}
                    className="px-6 py-2 bg-cyan-900/30 border border-cyan-500/50 text-cyan-400 font-bold rounded-lg hover:bg-cyan-500/20 hover:border-cyan-400 transition-all disabled:opacity-50"
                >
                    {loading ? 'SEARCHING...' : 'SEARCH'}
                </button>

                {/* Quality Selector */}
                <select
                    value={quality}
                    onChange={(e) => setQuality(e.target.value)}
                    className="bg-black/40 border border-cyan-500/30 rounded-lg px-4 py-2 text-cyan-400 font-mono focus:outline-none focus:border-cyan-400"
                >
                    <option value="128">128K</option>
                    <option value="320">320K</option>
                    <option value="flac">FLAC</option>
                    <option value="mflac">MASTER</option>
                </select>

                {/* Auto-Tag Toggle */}
                <button
                    onClick={() => setAutoTag(!autoTag)}
                    className={`flex items-center gap-2 px-4 py-2 border rounded-lg font-mono transition-all ${autoTag
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-400 shadow-[0_0_10px_rgba(0,255,255,0.3)]'
                        : 'bg-black/40 border-cyan-500/30 text-cyan-600 hover:border-cyan-500/50'
                        }`}
                    title="Auto-tag downloaded files with metadata"
                >
                    <Tag className="w-4 h-4" />
                    <span className="inline text-xs sm:text-sm whitespace-nowrap">Auto-Tag</span>
                </button>
            </div>

            {/* Playlist Download Panel */}
            <div className="mb-6 p-4 bg-black/30 border border-cyan-500/20 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-cyan-300 font-mono text-sm tracking-wide">QQ_PLAYLIST_BATCH_DOWNLOAD</h3>
                    <span className="text-xs text-cyan-700">支持输入歌单链接或ID</span>
                </div>

                <div className="flex flex-col md:flex-row gap-2">
                    <input
                        type="text"
                        value={playlistInput}
                        onChange={(e) => setPlaylistInput(e.target.value)}
                        placeholder="例如: https://y.qq.com/n/ryqq/playlist/8522515502"
                        className="flex-1 bg-black/40 border border-cyan-500/30 rounded-lg py-2 px-3 text-cyan-100 placeholder:text-cyan-900 focus:outline-none focus:border-cyan-400"
                    />
                    <button
                        onClick={parsePlaylist}
                        disabled={playlistLoading}
                        className="px-4 py-2 bg-cyan-900/20 border border-cyan-500/40 text-cyan-300 rounded-lg hover:bg-cyan-500/20 disabled:opacity-50"
                    >
                        {playlistLoading ? '解析中...' : '解析歌单'}
                    </button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-cyan-300">
                    <label className="inline-flex items-center gap-2">
                        <input
                            type="radio"
                            name="playlistTarget"
                            checked={playlistDownloadTarget === 'browser'}
                            onChange={() => setPlaylistDownloadTarget('browser')}
                        />
                        下载到浏览器（每5首一个ZIP，2小时有效）
                    </label>
                    <label className="inline-flex items-center gap-2">
                        <input
                            type="radio"
                            name="playlistTarget"
                            checked={playlistDownloadTarget === 'server'}
                            onChange={() => setPlaylistDownloadTarget('server')}
                        />
                        下载到服务器
                    </label>

                    <select
                        value={playlistQuality}
                        onChange={(e) => setPlaylistQuality(e.target.value)}
                        className="bg-black/40 border border-cyan-500/30 rounded px-2 py-1 text-cyan-300"
                    >
                        <option value="128">歌单128K</option>
                        <option value="320">歌单320K</option>
                        <option value="flac">歌单FLAC</option>
                        <option value="mflac">歌单MASTER</option>
                    </select>

                    <button
                        onClick={() => setPlaylistAutoTag(!playlistAutoTag)}
                        className={`inline-flex items-center gap-1 px-2 py-1 border rounded ${playlistAutoTag
                            ? 'border-cyan-400 text-cyan-300 bg-cyan-500/10'
                            : 'border-cyan-700/40 text-cyan-600'
                            }`}
                    >
                        <Tag className="w-3 h-3" />
                        歌单 Auto-Tag
                    </button>

                    <button
                        onClick={startPlaylistDownload}
                        disabled={!playlistInfo || playlistLoading || (!!playlistTaskId && playlistTaskStatus?.status === 'running')}
                        className="ml-auto px-4 py-2 bg-green-900/20 border border-green-500/40 text-green-300 rounded-lg hover:bg-green-500/20 disabled:opacity-50"
                    >
                        开始批量下载
                    </button>
                </div>

                {playlistError && (
                    <div className="mt-2 text-xs text-red-400">{playlistError}</div>
                )}

                {playlistInfo && (
                    <div className="mt-3 p-3 border border-cyan-900/40 rounded bg-black/20 text-sm text-cyan-200 space-y-3">
                        <div>歌单：<span className="text-cyan-100">{playlistInfo.name}</span></div>
                        <div>作者：{playlistInfo.creator} · 共 {playlistInfo.song_count} 首</div>
                        <div className="text-cyan-700 text-xs">ID: {playlistInfo.id}</div>

                        <div className="border border-cyan-900/30 rounded p-2 bg-black/30">
                            <div className="space-y-2">
                                {currentPlaylistSongs.map((song) => (
                                    <div
                                        key={song.mid}
                                        className="group flex items-center justify-between p-3 mb-2 bg-black/40 border border-cyan-900/30 rounded hover:bg-cyan-900/20 hover:border-cyan-500/50 transition-all cursor-pointer"
                                        onClick={() => playSong(song)}
                                    >
                                        <div className="flex flex-col overflow-hidden min-w-0 mr-4">
                                            <span className="text-cyan-100 font-medium truncate group-hover:text-cyan-400 transition-colors">
                                                {song.title}
                                            </span>
                                            <span className="text-xs text-cyan-600 truncate">
                                                {song.singer?.[0]?.name} · {song.album?.name}{song.localPath ? " · LOCAL" : ""}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <button className="p-2 text-cyan-700 hover:text-cyan-400 transition-colors">
                                                <Play className="w-4 h-4" />
                                            </button>
                                            <button
                                                className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${downloadingMid === song.mid
                                                    ? 'border-cyan-400 text-cyan-300 bg-cyan-500/10'
                                                    : 'border-cyan-700/40 text-cyan-500 hover:text-cyan-300 hover:border-cyan-400/70'
                                                    }`}
                                                onClick={(e) => playlistDownloadSong(e, song)}
                                                disabled={downloadingMid === song.mid}
                                                title="下载到当前设备"
                                            >
                                                {downloadingMid === song.mid ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <Download className="w-4 h-4" />
                                                )}
                                            </button>
                                            <button
                                                className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${savingMid === song.mid
                                                    ? 'border-green-400 text-green-300 bg-green-500/10'
                                                    : 'border-cyan-700/40 text-cyan-500 hover:text-green-300 hover:border-green-400/70'
                                                    }`}
                                                onClick={(e) => playlistSaveToServer(e, song)}
                                                disabled={savingMid === song.mid}
                                                title="下载到服务器"
                                            >
                                                {savingMid === song.mid ? (
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                ) : (
                                                    <HardDrive className="w-4 h-4" />
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {currentPlaylistSongs.length === 0 && (
                                    <div className="text-xs text-cyan-700">当前页无歌曲</div>
                                )}
                            </div>

                            <div className="flex items-center justify-center gap-3 mt-3">
                                <button
                                    onClick={() => setPlaylistPage(p => Math.max(1, p - 1))}
                                    disabled={playlistPage <= 1}
                                    className="px-2 py-1 text-xs border border-cyan-700/40 rounded disabled:opacity-30"
                                >
                                    PREV
                                </button>
                                <span className="text-xs text-cyan-600">PAGE {playlistPage}/{playlistTotalPages}</span>
                                <button
                                    onClick={() => setPlaylistPage(p => Math.min(playlistTotalPages, p + 1))}
                                    disabled={playlistPage >= playlistTotalPages}
                                    className="px-2 py-1 text-xs border border-cyan-700/40 rounded disabled:opacity-30"
                                >
                                    NEXT
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {playlistTaskStatus && (
                    <div className="mt-3 p-3 border border-green-900/40 rounded bg-black/20 text-sm space-y-1">
                        <div className="text-green-300">任务状态：{playlistTaskStatus.status}</div>
                        <div className="text-cyan-200">
                            总进度：{playlistTaskStatus.progress || 0}/{playlistTaskStatus.total || 0}
                            {playlistTaskStatus.current_song ? ` · ${playlistTaskStatus.current_song}` : ''}
                        </div>
                        {playlistDownloadTarget === 'browser' && (
                            <>
                                <div className="text-cyan-300 text-xs">
                                    下载阶段：{playlistTaskStatus.download_current || 0}/{playlistTaskStatus.download_total || 0}
                                </div>
                                <div className="text-cyan-300 text-xs">
                                    压缩阶段：{playlistTaskStatus.zip_current || 0}/{playlistTaskStatus.zip_total || 0}
                                </div>
                                <div className="text-cyan-500 text-xs">
                                    当前阶段：{playlistTaskStatus.stage || 'running'} {playlistTaskStatus.current_status ? `· ${playlistTaskStatus.current_status}` : ''}
                                </div>
                            </>
                        )}
                        {playlistTaskStatus.status === 'completed' && playlistTaskStatus.result && (
                            <div className="text-xs text-green-200 mt-1">
                                成功 {playlistTaskStatus.result.success || 0} 首，失败 {playlistTaskStatus.result.failed || 0} 首，跳过 {playlistTaskStatus.result.skipped || 0} 首
                            </div>
                        )}
                        {playlistTaskStatus.error && (
                            <div className="text-xs text-red-300 mt-1">错误：{playlistTaskStatus.error}</div>
                        )}
                    </div>
                )}
            </div>

            {/* Main Content Area: Results + Lyrics Side-by-Side with Unified Height */}
            <div className="flex flex-col md:flex-row gap-6 shrink-0 md:h-[420px]">
                {/* Results List */}
                <div className="w-full md:flex-1 flex flex-col min-w-0 md:h-auto h-[400px] shrink-0">
                    <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar bg-black/20 border border-cyan-500/10 rounded-lg p-2">
                        {displayedResults.map((song) => (
                            <div
                                key={song.mid}
                                className="group flex items-center justify-between p-3 mb-2 bg-black/40 border border-cyan-900/30 rounded hover:bg-cyan-900/20 hover:border-cyan-500/50 transition-all cursor-pointer"
                                onClick={() => playSong(song)}
                            >
                                <div className="flex flex-col overflow-hidden min-w-0 mr-4">
                                    <span className="text-cyan-100 font-medium truncate group-hover:text-cyan-400 transition-colors">
                                        {song.title}
                                    </span>
                                    <span className="text-xs text-cyan-600 truncate">
                                        {song.singer?.[0]?.name} · {song.album?.name}{song.localPath ? " · LOCAL" : ""}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button className="p-2 text-cyan-700 hover:text-cyan-400 transition-colors">
                                        <Play className="w-4 h-4" />
                                    </button>
                                    <button
                                        className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${downloadingMid === song.mid
                                            ? 'border-cyan-400 text-cyan-300 bg-cyan-500/10'
                                            : 'border-cyan-700/40 text-cyan-500 hover:text-cyan-300 hover:border-cyan-400/70'
                                            }`}
                                        onClick={(e) => downloadSong(e, song)}
                                        disabled={downloadingMid === song.mid}
                                        title="下载到当前设备"
                                    >
                                        {downloadingMid === song.mid ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <Download className="w-4 h-4" />
                                        )}
                                    </button>
                                    <button
                                        className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors ${savingMid === song.mid
                                            ? 'border-green-400 text-green-300 bg-green-500/10'
                                            : 'border-cyan-700/40 text-cyan-500 hover:text-green-300 hover:border-green-400/70'
                                            }`}
                                        onClick={(e) => saveToServer(e, song)}
                                        disabled={savingMid === song.mid}
                                        title="下载到服务器"
                                    >
                                        {savingMid === song.mid ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <HardDrive className="w-4 h-4" />
                                        )}
                                    </button>
                                </div>
                            </div>

                        ))}
                        {displayedResults.length === 0 && !loading && (
                            <div className="flex items-center justify-center h-full text-cyan-900/50 font-mono">
                                NO DATA_ FOUND
                            </div>
                        )}
                    </div>

                    {/* Pagination */}
                    {allResults.length > 0 && (
                        <div className="flex justify-center items-center gap-4 mt-2">
                            <button
                                onClick={() => setPage(page - 1)}
                                disabled={page <= 1 || loading}
                                className="px-3 py-1 bg-cyan-900/20 text-cyan-400 text-sm border border-cyan-500/30 rounded hover:bg-cyan-500/20 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                            >
                                PREV
                            </button>
                            <span className="text-cyan-600 font-mono text-sm">PAGE {page}</span>
                            <button
                                onClick={handleNextPage}
                                disabled={loading}
                                className="px-3 py-1 bg-cyan-900/20 text-cyan-400 text-sm border border-cyan-500/30 rounded hover:bg-cyan-500/20 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
                            >
                                NEXT
                            </button>
                        </div>
                    )}
                </div>

                {/* Lyrics Panel */}
                <div className="w-full md:w-96 flex flex-col bg-transparent border border-cyan-500/20 rounded-lg p-6 relative overflow-hidden shrink-0 h-[300px] md:h-auto">
                    {currentSong ? (
                        <>
                            {/* Album Cover Background Blur */}
                            <div
                                className="absolute inset-0 bg-cover bg-center opacity-20 blur-xl transition-all duration-1000"
                                style={{ backgroundImage: `url(${currentSong.cover})` }}
                            />

                            {/* Lyrics Area */}
                            <div
                                ref={lyricContainerRef}
                                className="flex-1 overflow-y-auto text-center space-y-6 pr-1 custom-scrollbar z-10 relative mask-image-b-fade"
                            >
                                {parsedLyrics.length > 0 ? (
                                    parsedLyrics.map((line, idx) => (
                                        <p
                                            key={idx}
                                            className={`transition-all duration-300 px-2 ${idx === activeLyricIndex
                                                ? 'text-cyan-300 text-base font-bold scale-105 drop-shadow-[0_0_5px_rgba(34,211,238,0.8)]'
                                                : 'text-gray-500 text-sm'
                                                }`}
                                        >
                                            {line.text}
                                        </p>
                                    ))
                                ) : (
                                    <div className="flex items-center justify-center h-full text-cyan-800/50 font-mono">
                                        LYRICS_LOADING
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="flex items-center justify-center h-full text-cyan-900/30 font-mono text-sm">
                            WAITING_FOR_TRACK...
                        </div>
                    )}
                </div>
            </div>

            {/* Spacer to push content up if needed */}
            <div className="flex-1"></div>

            {/* Bottom Player Bar */}
            {
                currentSong && (
                    <div className="mt-4 p-4 bg-gray-950/90 border border-cyan-500/40 rounded-lg shadow-[0_0_15px_rgba(0,255,255,0.1)]">
                        {/* Mobile: stacked layout, Desktop: row layout */}
                        <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
                            {/* Play button + Time display row */}
                            <div className="flex items-center gap-3">
                                <button onClick={togglePlay} className="p-3 bg-cyan-900/20 rounded-full border border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/20 transition-all shrink-0">
                                    {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                                </button>
                                <div className="flex text-xs text-cyan-600 font-mono gap-1">
                                    <span>{formatTime(currentTime)}</span>
                                    <span>/</span>
                                    <span>{formatTime(duration)}</span>
                                </div>
                                {/* Volume control */}
                                <div className="flex items-center gap-2 ml-auto">
                                    <button
                                        type="button"
                                        onClick={() => setIsMuted(!isMuted)}
                                        className="p-1 rounded border border-cyan-700/40 text-cyan-500 hover:text-cyan-300 hover:border-cyan-400/70"
                                        title={isMuted ? "取消静音" : "静音"}
                                    >
                                        {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                                    </button>
                                    <Volume2 className="w-4 h-4 text-cyan-600" />
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.05"
                                        value={volume}
                                        onChange={(e) => {
                                            const val = Number(e.target.value);
                                            setVolume(val);
                                            if (val > 0 && isMuted) {
                                                setIsMuted(false);
                                            }
                                        }}
                                        className="w-16 md:w-20 h-1 bg-cyan-900/30 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-cyan-600 [&::-webkit-slider-thumb]:rounded-full"
                                    />
                                </div>
                            </div>

                            {/* Progress bar - full width on mobile */}
                            <div className="flex-1 w-full">
                                <input
                                    type="range"
                                    min="0"
                                    max={duration || 100}
                                    value={sliderValue}
                                    onChange={(e) => {
                                        const val = Number(e.target.value);
                                        setSliderValue(val);
                                    }}
                                    onMouseDown={() => { isSeekingRef.current = true; }}
                                    onTouchStart={() => { isSeekingRef.current = true; }}
                                    onMouseUp={(e) => {
                                        const val = Number(e.currentTarget.value);
                                        if (audioRef.current) audioRef.current.currentTime = val;
                                        isSeekingRef.current = false;
                                    }}
                                    onTouchEnd={(e) => {
                                        const val = Number(e.currentTarget.value);
                                        if (audioRef.current) audioRef.current.currentTime = val;
                                        isSeekingRef.current = false;
                                    }}
                                    className="w-full h-2 bg-cyan-900/30 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-cyan-400 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(0,255,255,0.8)]"
                                />
                            </div>
                        </div>

                        <audio
                            ref={audioRef}
                            onTimeUpdate={onTimeUpdate}
                            onEnded={() => setIsPlaying(false)}
                            onError={(e) => {
                                console.error("Audio Playback Error:", e);
                                const code = audioRef.current?.error?.code;
                                const msg = audioRef.current?.error?.message || 'Unknown code ' + code;
                                if (currentSong?.source === "local") {
                                    const fallbackSong = allResults.find(r => r.mid === currentSong.mid);
                                    if (fallbackSong) {
                                        console.warn("Local playback failed, fallback to remote source.", msg);
                                        playRemoteSong(fallbackSong);
                                        return;
                                    }
                                }
                                alert(`Playback Error: ${msg}`);
                                setIsPlaying(false);
                            }}
                            preload="auto"
                            playsInline
                        />
                    </div>
                )
            }
        </div >
    );
}
