import { useState, useRef, useEffect } from 'react';
import { Search, Play, Pause, Volume2, Download, Tag, Loader2, HardDrive } from 'lucide-react';



interface SearchResult {
    mid: string;
    title: string;
    singer: { name: string }[];
    album: { name: string; mid: string };
    interval: number;
}

interface SongDetail {
    mid: string;
    url: string;
    lyric: string;
    trans: string;
    title: string;
    singer: string;
    cover: string;
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

export function SearchPanel({ API_BASE }: SearchPanelProps) {
    const [keyword, setKeyword] = useState('');
    const [allResults, setAllResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [currentSong, setCurrentSong] = useState<SongDetail | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [volume, setVolume] = useState(0.5);
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

    // Persist autoTag to localStorage
    useEffect(() => {
        localStorage.setItem('autoTag', autoTag.toString());
    }, [autoTag]);

    const audioRef = useRef<HTMLAudioElement | null>(null);

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
            setAllResults(data.list || []);
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
            const newResults = data.list || [];

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

    const playSong = async (mid: string, title: string, singer: string) => {
        try {
            // Get song details (url + lyrics)
            const res = await fetch(`${API_BASE}/api/song/${mid}?quality=${quality}`);
            const data = await res.json();

            if (!data.url) {
                alert("Playback failed: VIP or restricted song.");
                return;
            }

            // Determine extension based on quality for correct MIME type
            const ext = (quality === 'flac' || quality === 'mflac') ? 'flac' : 'mp3';
            const proxyName = `${title}.${ext}`;

            // Use proxy to avoid CORS/Referer issues
            const proxyUrl = `${API_BASE}/api/proxy?url=${encodeURIComponent(data.url)}&name=${encodeURIComponent(proxyName)}`;

            setCurrentSong({
                mid: data.mid,
                url: proxyUrl, // data.url replaced by proxy
                lyric: data.lyric,
                trans: data.trans,
                title: title,
                singer: singer,
                cover: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${data.mid}.jpg`
            });

            // If we have search result context, try to use album image
            const foundAction = allResults.find(r => r.mid === mid);
            if (foundAction && foundAction.album?.mid) {
                setCurrentSong(prev => prev ? ({ ...prev, cover: `https://y.gtimg.cn/music/photo_new/T002R300x300M000${foundAction.album.mid}.jpg` }) : null);
            }

            setIsPlaying(true);
        } catch (error) {
            console.error(error);
            alert("Failed to load song.");
        }
    };

    const downloadSong = async (e: React.MouseEvent, song: SearchResult) => {
        e.stopPropagation(); // Prevent playing when clicking download

        if (autoTag) {
            setDownloadingMid(song.mid);
        }

        try {
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
            alert("Failed to download song.");
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
                    quality: quality
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

    useEffect(() => {
        if (currentSong && audioRef.current) {
            audioRef.current.src = currentSong.url;
            audioRef.current.play().catch(e => console.error("Auto-play blocked", e));

            // Parse Lyrics
            if (currentSong.lyric) {
                setParsedLyrics(parseLyrics(currentSong.lyric));
            } else {
                setParsedLyrics([]);
            }
        }
    }, [currentSong]);

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
                    <span className="hidden sm:inline">Auto-Tag</span>
                </button>
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
                                onClick={() => playSong(song.mid, song.title, song.singer?.[0]?.name || 'Unknown')}
                            >
                                <div className="flex flex-col overflow-hidden min-w-0 mr-4">
                                    <span className="text-cyan-100 font-medium truncate group-hover:text-cyan-400 transition-colors">
                                        {song.title}
                                    </span>
                                    <span className="text-xs text-cyan-600 truncate">
                                        {song.singer?.[0]?.name} · {song.album?.name}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button className="p-2 text-cyan-700 hover:text-cyan-400 transition-colors">
                                        <Play className="w-4 h-4" />
                                    </button>
                                    <button
                                        className={`p-2 transition-colors ${downloadingMid === song.mid ? 'text-cyan-400 animate-pulse' : 'text-cyan-700 hover:text-cyan-400'}`}
                                        onClick={(e) => downloadSong(e, song)}
                                        disabled={downloadingMid === song.mid}
                                    >
                                        {downloadingMid === song.mid ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <Download className="w-4 h-4" />
                                        )}
                                    </button>
                                    <button
                                        className={`p-2 transition-colors ${savingMid === song.mid ? 'text-green-400 animate-pulse' : 'text-cyan-700 hover:text-green-400'}`}
                                        onClick={(e) => saveToServer(e, song)}
                                        disabled={savingMid === song.mid}
                                        title="Download to Server"
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
                                {/* Volume control - desktop only */}
                                <div className="hidden md:flex items-center gap-2 ml-auto">
                                    <Volume2 className="w-4 h-4 text-cyan-600" />
                                    <input
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.1"
                                        value={volume}
                                        onChange={(e) => {
                                            const val = Number(e.target.value);
                                            setVolume(val);
                                            if (audioRef.current) audioRef.current.volume = val;
                                        }}
                                        className="w-20 h-1 bg-cyan-900/30 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-cyan-600 [&::-webkit-slider-thumb]:rounded-full"
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
                                alert(`Playback Error: ${audioRef.current?.error?.message || 'Unknown code ' + audioRef.current?.error?.code}`);
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
