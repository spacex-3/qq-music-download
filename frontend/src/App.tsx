import { useState, useEffect } from 'react'
import { LoginView } from './components/LoginView'
import { SearchPanel } from './components/SearchPanel'
import { Loader2, Terminal, User, RefreshCw } from 'lucide-react'

// Define types locally
interface UserInfo {
  musicid?: string;
  nickname?: string;
  encrypt_uin?: string;
}

function App() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  // Change Password State
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [changePassMsg, setChangePassMsg] = useState('');
  const [refreshingLibrary, setRefreshingLibrary] = useState(false);

  // Use same origin to avoid cross-port/network issues behind reverse proxy/NAT
  const API_BASE = window.location.origin;

  const checkUser = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/user`);
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      } else {
        setUser(null);
      }
    } catch (e) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (res.ok) {
        setIsAuthenticated(true);
        localStorage.setItem('app_auth', 'true');
        checkUser();
      } else {
        setAuthError('INVALID_PASSWORD');
      }
    } catch (e) {
      setAuthError('CONNECTION_ERROR');
    }
  };

  const handleChangePassword = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPass, new_password: newPass })
      });
      if (res.ok) {
        setChangePassMsg('SUCCESS');
        setTimeout(() => {
          setShowPasswordModal(false);
          setChangePassMsg('');
          setCurrentPass('');
          setNewPass('');
        }, 1000);
      } else {
        setChangePassMsg('INVALID_PASSWORD');
      }
    } catch (e) {
      setChangePassMsg('ERROR');
    }
  };

  const handleRefreshEmbyLibrary = async () => {
    setRefreshingLibrary(true);
    try {
      const res = await fetch(`${API_BASE}/api/emby/refresh-music`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`刷新失败: ${data?.detail || 'Unknown error'}`);
        return;
      }
      alert('已发送 Emby 音乐库刷新请求');
    } catch (e) {
      alert('刷新失败: 无法连接后端');
    } finally {
      setRefreshingLibrary(false);
    }
  };

  useEffect(() => {
    const isAuth = localStorage.getItem('app_auth') === 'true';
    if (isAuth) {
      setIsAuthenticated(true);
      checkUser();
    } else {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkUser();
  }, []);

  useEffect(() => {
    document.title = 'QQ Music Download';
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-foreground font-mono flex flex-col relative">
      {/* Background Grid */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#080808_1px,transparent_1px),linear-gradient(to_bottom,#080808_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none opacity-20"></div>

      {/* Navbar */}
      <nav className="border-b border-cyan-900/30 bg-black/40 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <Terminal className="w-6 h-6 text-cyan-400" />
              <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-500 whitespace-nowrap">
                QQ MUSIC DOWNLOADER_
              </span>
            </div>
            {user && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRefreshEmbyLibrary}
                  disabled={refreshingLibrary}
                  className="inline-flex items-center gap-1 px-3 py-1 text-xs border border-cyan-700/50 text-cyan-300 rounded-full hover:bg-cyan-900/30 disabled:opacity-50 transition-colors"
                  title="更新 Emby 音乐库"
                >
                  {refreshingLibrary ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                  <span className="hidden sm:inline">更新音乐库</span>
                </button>
                <div className="flex items-center space-x-2 text-sm text-cyan-300/70 border border-cyan-900/50 rounded-full px-3 py-1">
                  <User className="w-4 h-4" />
                  <span>{user.nickname || user.musicid || 'Unknown User'}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 z-10">
        {!isAuthenticated ? (
          <div className="bg-gray-950 border border-cyan-500/30 rounded-lg p-8 max-w-sm w-full shadow-[0_0_20px_rgba(0,255,255,0.2)]">
            <h2 className="text-xl text-cyan-400 font-mono mb-6 text-center">ACCESS_CONTROL</h2>
            <form onSubmit={handleLogin} className="space-y-4">
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="ENTER PASSWORD"
                className="w-full bg-black/50 border border-cyan-900/50 rounded p-2 text-cyan-100 text-center font-mono focus:border-cyan-400 outline-none"
              />
              {authError && <p className="text-red-500 text-xs text-center">{authError}</p>}
              <button type="submit" className="w-full bg-cyan-900/30 border border-cyan-500/50 text-cyan-400 py-2 rounded font-bold hover:bg-cyan-500/20 transition-all">
                UNLOCK
              </button>
            </form>
          </div>
        ) : !user ? (
          <LoginView onLoginSuccess={checkUser} API_BASE={API_BASE} />
        ) : (
          /* User Dashboard */
          <div className="w-full max-w-6xl flex-1 flex flex-col gap-6 z-10 px-4 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* Header User Info */}
            <header className="flex items-center justify-between p-4 border-b border-cyan-900/30 bg-black/20 backdrop-blur-sm rounded-t-lg">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-cyan-900/20 border border-cyan-500/30 flex items-center justify-center">
                  <User className="w-6 h-6 text-cyan-400" />
                </div>

                <div>
                  <h1 className="text-xl font-bold text-cyan-100 font-mono tracking-tight">COMMANDER // {user.nickname || user.musicid}</h1>
                  <div className="flex items-center gap-2 text-xs text-cyan-600">
                    <span className={`w-2 h-2 rounded-full ${user.musicid ? 'bg-green-500 shadow-[0_0_5px_#22c55e]' : 'bg-red-500'}`}></span>
                    <span>ONLINE_</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowPasswordModal(true)}
                  className="px-3 py-1 text-xs border border-cyan-900/50 text-cyan-400 hover:bg-cyan-900/20 transition-colors uppercase tracking-widest"
                >
                  PASS
                </button>
                <button
                  onClick={() => setUser(null)}
                  className="px-3 py-1 text-xs border border-red-900/50 text-red-400 hover:bg-red-900/20 hover:text-red-300 transition-colors uppercase tracking-widest"
                >
                  Disconnect
                </button>
              </div>
            </header>

            {/* Change Password Modal */}
            {showPasswordModal && (
              <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
                <div className="bg-gray-950 border border-cyan-500/30 rounded-lg p-6 max-w-sm w-full">
                  <h3 className="text-lg text-cyan-400 font-mono mb-4">CHANGE_PASSWORD</h3>
                  <div className="space-y-3">
                    <input
                      type="password"
                      placeholder="CURRENT PASSWORD"
                      value={currentPass}
                      onChange={e => setCurrentPass(e.target.value)}
                      className="w-full bg-black/50 border border-cyan-900/50 rounded p-2 text-cyan-100 font-mono focus:border-cyan-400 outline-none"
                    />
                    <input
                      type="password"
                      placeholder="NEW PASSWORD"
                      value={newPass}
                      onChange={e => setNewPass(e.target.value)}
                      className="w-full bg-black/50 border border-cyan-900/50 rounded p-2 text-cyan-100 font-mono focus:border-cyan-400 outline-none"
                    />
                    {changePassMsg && <p className="text-xs text-center text-cyan-600">{changePassMsg}</p>}
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => setShowPasswordModal(false)}
                        className="flex-1 py-2 border border-gray-700 text-gray-400 rounded hover:bg-gray-800 transition-colors"
                      >
                        CANCEL
                      </button>
                      <button
                        onClick={handleChangePassword}
                        className="flex-1 py-2 bg-cyan-900/30 border border-cyan-500/50 text-cyan-400 rounded hover:bg-cyan-500/20 transition-colors"
                      >
                        CONFIRM
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Main Workspace */}
            <div className="flex-1 bg-black/40 border border-cyan-900/20 rounded-b-lg p-6 backdrop-blur-sm shadow-[0_0_50px_rgba(0,255,255,0.05)] flex flex-col min-h-[600px]">
              <SearchPanel API_BASE={API_BASE} />
            </div>

            {/* API Documentation */}
            <div className="p-4 border border-cyan-900/30 bg-black/20 rounded-lg mb-8">
              <h3 className="text-sm font-bold text-cyan-500 mb-2 font-mono uppercase">API Reference</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono text-cyan-700/80">
                <div className="flex gap-2">
                  <span className="text-cyan-400">GET</span>
                  <span>/api/search?keyword=...&page=1</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-cyan-400">GET</span>
                  <span>/api/song/{'{mid}'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-cyan-400">GET</span>
                  <span>/api/login/qr?type=wx|qq</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-cyan-400">GET</span>
                  <span>/api/user</span>
                </div>
              </div>
            </div>

          </div>
        )}
      </main>

      <footer className="py-6 text-center text-xs text-gray-600 font-mono border-t border-cyan-900/10">
        SYS.VER.2.0.1 // CONNECTED
      </footer>
    </div>
  )
}

export default App
