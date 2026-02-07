
import { useState, useEffect } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

interface LoginViewProps {
    onLoginSuccess: () => void;
    API_BASE: string;
}

export function LoginView({ onLoginSuccess, API_BASE }: LoginViewProps) {
    const [qrImage, setQrImage] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string>('Initializing...');
    const [retryCount, setRetryCount] = useState(0);

    const [loginType, setLoginType] = useState<'wx' | 'qq'>('wx');

    useEffect(() => {
        let key: string | null = null;
        let pollInterval: ReturnType<typeof setInterval>;

        const fetchQR = async () => {
            try {
                setLoading(true);
                setStatus('Fetching QR Code...');
                const res = await fetch(`${API_BASE}/api/login/qr?type=${loginType}`);
                const data = await res.json();
                setQrImage(data.qr_image_base64);
                key = data.key;
                setLoading(false);
                setStatus('Waiting for scan...');

                // Start polling
                pollInterval = setInterval(async () => {
                    if (!key) return;
                    try {
                        const statusRes = await fetch(`${API_BASE}/api/login/status?key=${key}`);
                        const statusData = await statusRes.json();

                        if (statusData.status === 'DONE') {
                            setStatus('Login Successful!');
                            clearInterval(pollInterval);
                            onLoginSuccess();
                        } else if (statusData.status === 'TIMEOUT') {
                            setStatus('QR Code Expired');
                            clearInterval(pollInterval);
                            setError('QR Code Expired');
                        } else if (statusData.status === 'REFUSED') {
                            setStatus('Login Refused');
                            clearInterval(pollInterval);
                            setError('Login Refused');
                        } else {
                            // Waiting
                        }
                    } catch (e) {
                        console.error(e);
                    }
                }, 2000);

            } catch (e) {
                setError('Failed to load QR Code');
                setLoading(false);
            }
        };

        fetchQR();

        return () => {
            if (pollInterval) clearInterval(pollInterval);
        };
    }, [retryCount, onLoginSuccess, loginType]);

    return (
        <div className="flex flex-col items-center justify-center p-8 bg-gray-950 border border-cyan-400/30 rounded-lg shadow-[0_0_20px_rgba(0,255,255,0.3)] max-w-md w-full mx-auto relative overflow-hidden group">
            {/* Decorative Scanner Line */}
            <div className="absolute top-0 left-0 w-full h-1 bg-cyan-400/50 shadow-[0_0_10px_rgba(0,255,255,0.8)] animate-scan opacity-50 pointer-events-none"></div>

            <h2 className="text-2xl font-bold text-cyan-400 mb-6 font-mono tracking-wider uppercase drop-shadow-[0_0_5px_rgba(0,255,255,0.8)]">
                System Login
            </h2>

            {/* Login Type Toggle */}
            <div className="flex space-x-4 mb-6">
                <button
                    onClick={() => setLoginType('wx')}
                    className={`px-4 py-2 rounded font-mono transition-colors border ${loginType === 'wx' ? 'bg-cyan-900/40 border-cyan-400 text-cyan-300' : 'border-gray-700 text-gray-500 hover:text-cyan-400/70'}`}
                >
                    WeChat
                </button>
                <button
                    onClick={() => setLoginType('qq')}
                    className={`px-4 py-2 rounded font-mono transition-colors border ${loginType === 'qq' ? 'bg-cyan-900/40 border-cyan-400 text-cyan-300' : 'border-gray-700 text-gray-500 hover:text-cyan-400/70'}`}
                >
                    QQ
                </button>
            </div>

            <div className="relative w-64 h-64 bg-black/50 border-2 border-cyan-500/50 rounded-lg flex items-center justify-center mb-6 overflow-hidden">
                {loading ? (
                    <Loader2 className="w-12 h-12 text-cyan-400 animate-spin" />
                ) : error ? (
                    <div className="flex flex-col items-center text-red-500 gap-4">
                        <span>{error}</span>
                        <button
                            onClick={() => { setError(null); setRetryCount(c => c + 1); }}
                            className="px-4 py-2 bg-red-900/20 border border-red-500 rounded hover:bg-red-900/40"
                        >
                            <RefreshCw className="w-4 h-4 mr-2 inline" /> Retry
                        </button>
                    </div>
                ) : qrImage ? (
                    <img src={qrImage} alt="QR Code" className="w-full h-full object-contain p-2" />
                ) : null}

                {/* Corner Accents */}
                <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-cyan-400"></div>
                <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cyan-400"></div>
                <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-cyan-400"></div>
                <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-cyan-400"></div>
            </div>

            <div className="font-mono text-cyan-300/80 text-sm mb-4 animate-pulse">
                [{status}]
            </div>

            <p className="text-xs text-cyan-500/50 font-mono">
                SECURE CONNECTION ESTABLISHED
            </p>
        </div>
    );
}
