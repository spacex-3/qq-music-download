import { useEffect, useState } from "react";
import { Download, Search, X } from "lucide-react";

interface BatchFile {
  name: string;
  path: string;
  size: number;
  mtime: number;
}

interface BatchFilesModalProps {
  open: boolean;
  onClose: () => void;
  API_BASE: string;
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

export function BatchFilesModal({ open, onClose, API_BASE }: BatchFilesModalProps) {
  const [files, setFiles] = useState<BatchFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [ttlSeconds, setTtlSeconds] = useState<number>(7200);

  const loadFiles = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/batch-files?limit=2000&q=${encodeURIComponent(query)}`);
      const data = await res.json();
      setFiles(data.list || []);
      setTtlSeconds(data.ttlSeconds || 7200);
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

  const downloadFile = async (file: BatchFile) => {
    setDownloadingPath(file.path);
    try {
      const res = await fetch(`${API_BASE}/api/batch-files/download?path=${encodeURIComponent(file.path)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = file.name || "batch-file";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error(e);
      alert("下载失败，文件可能已过期被清理。");
    } finally {
      setDownloadingPath(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-5xl h-[82vh] bg-gray-950 border border-cyan-500/30 rounded-xl p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-cyan-300 font-bold">BATCH_DOWNLOAD_FILES</h2>
          <button onClick={onClose} className="p-2 text-cyan-500 hover:text-cyan-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="text-xs text-cyan-600">临时文件自动保留 {Math.floor(ttlSeconds / 3600)} 小时（默认 2h）</div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-cyan-700 w-4 h-4" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadFiles()}
              placeholder="Search temp zip/audio files..."
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

        <div className="flex-1 min-h-0 border border-cyan-700/30 rounded-lg p-2 overflow-y-auto custom-scrollbar">
          {loading && <div className="text-cyan-500 text-sm">加载中...</div>}
          {!loading && files.length === 0 && <div className="text-cyan-700 text-sm">暂无文件</div>}
          {!loading && files.map((file) => (
            <div
              key={`${file.path}-${file.mtime}`}
              className="flex items-center justify-between gap-2 p-2 mb-2 bg-black/40 border border-cyan-900/30 rounded hover:border-cyan-500/40"
            >
              <div className="min-w-0 flex-1">
                <div className="text-cyan-100 text-sm truncate">{file.name}</div>
                <div className="text-cyan-700 text-xs truncate">{file.path}</div>
                <div className="text-cyan-700 text-xs">{formatBytes(file.size)} · {new Date(file.mtime * 1000).toLocaleString()}</div>
              </div>
              <button
                type="button"
                onClick={() => downloadFile(file)}
                className="p-2 text-cyan-500 hover:text-cyan-300 disabled:opacity-40"
                title="下载"
                disabled={downloadingPath === file.path}
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
