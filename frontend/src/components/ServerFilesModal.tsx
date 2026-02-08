import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Pause, Play, Search, Volume2, VolumeX, X } from "lucide-react";

interface ServerFile {
  name: string;
  path: string;
  size: number;
  mtime: number;
}

interface FileInfo {
  name: string;
  path: string;
  title: string;
  artist: string;
  album: string;
  lyric: string;
  cover: string;
}

interface LyricLine {
  time: number;
  text: string;
}

interface ServerFilesModalProps {
  open: boolean;
  onClose: () => void;
  API_BASE: string;
}

const parseLyrics = (lyric: string): LyricLine[] => {
  return lyric
    .split("\n")
    .map((line) => {
      const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
      if (!match) return null;
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const ms = parseInt(match[3].length === 2 ? `${match[3]}0` : match[3], 10);
      return { time: min * 60 + sec + ms / 1000, text: match[4].trim() };
    })
    .filter((item): item is LyricLine => item !== null && item.text.length > 0);
};

export function ServerFilesModal({ open, onClose, API_BASE }: ServerFilesModalProps) {
  const [files, setFiles] = useState<ServerFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [currentInfo, setCurrentInfo] = useState<FileInfo | null>(null);
  const [streamUrl, setStreamUrl] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [sliderValue, setSliderValue] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [isMuted, setIsMuted] = useState(false);
  const [activeLyricIndex, setActiveLyricIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lyricContainerRef = useRef<HTMLDivElement>(null);

  const parsedLyrics = useMemo(() => parseLyrics(currentInfo?.lyric || ""), [currentInfo?.lyric]);

  const loadFiles = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/library/files?limit=500&q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setFiles(data.list || []);
    } catch (e) {
      console.error(e);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) loadFiles();
  }, [open]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.muted = isMuted;
  }, [isMuted]);

  useEffect(() => {
    if (!parsedLyrics.length) return;
    const index = parsedLyrics.findIndex((line) => line.time > currentTime);
    const next = index === -1 ? parsedLyrics.length - 1 : Math.max(0, index - 1);
    setActiveLyricIndex(next);
    if (!lyricContainerRef.current) return;
    const activeEl = lyricContainerRef.current.children[next] as HTMLElement;
    if (!activeEl) return;
    lyricContainerRef.current.scrollTo({
      top: activeEl.offsetTop - lyricContainerRef.current.clientHeight / 2 + activeEl.clientHeight / 2,
      behavior: "smooth",
    });
  }, [currentTime, parsedLyrics]);

  const playFile = async (file: ServerFile) => {
    try {
      const res = await fetch(`${API_BASE}/api/library/file-info?path=${encodeURIComponent(file.path)}`);
      const data = await res.json();
      if (!res.ok || !data.info) {
        alert(`加载文件失败: ${data?.detail || "Unknown error"}`);
        return;
      }
      setCurrentInfo(data.info);
      setStreamUrl(`${API_BASE}${data.streamUrl}`);
      setIsPlaying(true);
      setCurrentTime(0);
      setSliderValue(0);
      if (audioRef.current) {
        audioRef.current.src = `${API_BASE}${data.streamUrl}`;
        audioRef.current.play().catch(() => setIsPlaying(false));
      }
    } catch (e) {
      console.error(e);
      alert("加载文件失败");
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play();
    setIsPlaying(!isPlaying);
  };

  const onTimeUpdate = () => {
    if (!audioRef.current || isSeeking) return;
    setCurrentTime(audioRef.current.currentTime);
    setSliderValue(audioRef.current.currentTime);
    setDuration(audioRef.current.duration || 0);
  };

  const formatTime = (time: number) => {
    const min = Math.floor(time / 60);
    const sec = Math.floor(time % 60);
    return `${min}:${sec < 10 ? "0" : ""}${sec}`;
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-6xl h-[85vh] bg-gray-950 border border-cyan-500/30 rounded-xl p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-cyan-300 font-bold">SERVER_LIBRARY</h2>
          <button onClick={onClose} className="p-2 text-cyan-500 hover:text-cyan-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-cyan-700 w-4 h-4" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadFiles()}
              placeholder="Search local files..."
              className="w-full bg-black/40 border border-cyan-700/40 rounded-lg py-2 pl-9 pr-3 text-cyan-100 text-sm"
            />
          </div>
          <button
            onClick={loadFiles}
            className="px-3 py-2 border border-cyan-600/50 text-cyan-300 rounded-lg hover:bg-cyan-900/20"
          >
            搜索
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-4">
          <div className="md:w-1/2 border border-cyan-700/30 rounded-lg p-2 overflow-y-auto custom-scrollbar">
            {loading && <div className="text-cyan-500 text-sm">加载中...</div>}
            {!loading &&
              files.map((file) => (
                <div
                  key={file.path}
                  className="flex items-center justify-between gap-2 p-2 mb-2 bg-black/40 border border-cyan-900/30 rounded hover:border-cyan-500/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-cyan-100 text-sm truncate">{file.name}</div>
                    <div className="text-cyan-700 text-xs truncate">{file.path}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => playFile(file)}
                      className="p-2 text-cyan-500 hover:text-cyan-300"
                      title="播放"
                    >
                      <Play className="w-4 h-4" />
                    </button>
                    <a
                      href={`${API_BASE}/api/library/download?path=${encodeURIComponent(file.path)}`}
                      className="p-2 text-cyan-500 hover:text-cyan-300"
                      title="下载"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              ))}
          </div>

          <div className="md:w-1/2 border border-cyan-700/30 rounded-lg p-4 flex flex-col relative overflow-hidden">
            {currentInfo ? (
              <>
                {currentInfo.cover && (
                  <div
                    className="absolute inset-0 opacity-20 blur-xl bg-cover bg-center"
                    style={{ backgroundImage: `url(${currentInfo.cover})` }}
                  />
                )}
                <div className="relative z-10 mb-2">
                  <div className="text-cyan-100 font-semibold truncate">{currentInfo.title || currentInfo.name}</div>
                  <div className="text-cyan-700 text-xs truncate">
                    {currentInfo.artist || "Unknown"} {currentInfo.album ? `· ${currentInfo.album}` : ""}
                  </div>
                </div>
                <div
                  ref={lyricContainerRef}
                  className="relative z-10 flex-1 overflow-y-auto text-center space-y-4 custom-scrollbar"
                >
                  {parsedLyrics.length ? (
                    parsedLyrics.map((line, idx) => (
                      <p
                        key={`${idx}-${line.time}`}
                        className={
                          idx === activeLyricIndex
                            ? "text-cyan-300 text-sm font-bold"
                            : "text-gray-500 text-xs"
                        }
                      >
                        {line.text}
                      </p>
                    ))
                  ) : (
                    <div className="h-full flex items-center justify-center text-cyan-700 text-sm">无歌词</div>
                  )}
                </div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-cyan-700">选择文件播放</div>
            )}
          </div>
        </div>

        {currentInfo && (
          <div className="p-3 bg-gray-950/90 border border-cyan-500/30 rounded-lg">
            <div className="flex flex-col md:flex-row gap-3 md:items-center">
              <div className="flex items-center gap-3">
                <button
                  onClick={togglePlay}
                  className="p-3 bg-cyan-900/20 rounded-full border border-cyan-500/50 text-cyan-300"
                >
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                </button>
                <div className="text-xs text-cyan-600 font-mono">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={() => setIsMuted(!isMuted)}
                    className="p-1 rounded border border-cyan-700/40 text-cyan-500"
                  >
                    {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={volume}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setVolume(val);
                      if (val > 0 && isMuted) setIsMuted(false);
                    }}
                    className="w-16 md:w-20 h-1 bg-cyan-900/30 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              </div>
              <div className="flex-1 w-full">
                <input
                  type="range"
                  min="0"
                  max={duration || 100}
                  value={sliderValue}
                  onChange={(e) => setSliderValue(Number(e.target.value))}
                  onMouseDown={() => setIsSeeking(true)}
                  onTouchStart={() => setIsSeeking(true)}
                  onMouseUp={(e) => {
                    if (audioRef.current) audioRef.current.currentTime = Number(e.currentTarget.value);
                    setIsSeeking(false);
                  }}
                  onTouchEnd={(e) => {
                    if (audioRef.current) audioRef.current.currentTime = Number(e.currentTarget.value);
                    setIsSeeking(false);
                  }}
                  className="w-full h-2 bg-cyan-900/30 rounded-lg appearance-none cursor-pointer"
                />
              </div>
            </div>
            <audio
              ref={audioRef}
              src={streamUrl}
              onTimeUpdate={onTimeUpdate}
              onEnded={() => setIsPlaying(false)}
              preload="auto"
              playsInline
            />
          </div>
        )}
      </div>
    </div>
  );
}
