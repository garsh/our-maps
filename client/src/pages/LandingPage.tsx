import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { apiService } from '../services/api';
import { Map as MapIcon, LogOut, WifiOff, CloudSync, Loader2, Trash2, Download, Upload, Sun, Moon, Eye } from 'lucide-react';
import { getMapDownloadStatuses, type MapDownloadStatus } from '../utils/tileUtils';
import { tileWorkerManager } from '../utils/tileWorkerManager';
import { getStoredJson, setStoredJson } from '../utils/storageUtils';

interface MapSummary {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  lastAccessedAt?: string;
}

export default function LandingPage() {
  const { user, logout, logoutEverywhere } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [maps, setMaps] = useState<MapSummary[]>(() => getStoredJson<MapSummary[]>('cached_maps', []));
  const [downloadStatuses, setDownloadStatuses] = useState<Map<string, MapDownloadStatus>>(() => {
    const cachedStatuses = getStoredJson<Record<string, MapDownloadStatus> | null>('cached_download_statuses', null);
    if (cachedStatuses) {
      return new Map(Object.entries(cachedStatuses));
    }
    return new Map();
  });
  const [loading, setLoading] = useState(() => {
    const cached = getStoredJson<MapSummary[] | null>('cached_maps', null);
    return !cached || cached.length === 0;
  });
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' ? !navigator.onLine : false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showSignOutDialog, setShowSignOutDialog] = useState(false);
  const [showRemoveAllDialog, setShowRemoveAllDialog] = useState(false);
  const [isRemovingAll, setIsRemovingAll] = useState(false);
  const [showOfflineInterstitial, setShowOfflineInterstitial] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const handleRemoveAllDownloads = async () => {
    setIsRemovingAll(true);
    try {
      await tileWorkerManager.removeAllDownloads();
      setDownloadStatuses(new Map());
      setStoredJson('cached_download_statuses', {});
    } catch (err) {
      console.error('Failed to remove all downloads:', err);
      alert('Failed to remove all downloads: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsRemovingAll(false);
      setShowRemoveAllDialog(false);
    }
  };

  const handleMapClick = (mapId: string, viewMode = false) => {
    const currentlyOffline = isOffline || (typeof navigator !== 'undefined' && !navigator.onLine);
    if (currentlyOffline) {
      const status = downloadStatuses.get(mapId);
      if (!status || (!status.isComplete && !status.isPartial)) {
        setShowOfflineInterstitial(true);
        return;
      }
    }
    navigate(viewMode ? `/map/${mapId}?mode=view` : `/map/${mapId}`);
  };

  const fetchDownloadedMapStatuses = async (mapList?: { id: string }[]) => {
    try {
      const mapIds = mapList ? mapList.map(m => m.id) : (maps.length > 0 ? maps.map(m => m.id) : undefined);
      const statusMap = await getMapDownloadStatuses(mapIds);

      // Immediately reflect any active or in-flight downloads from the worker manager
      const targetIds = mapList ? mapList.map(m => m.id) : maps.map(m => m.id);
      targetIds.forEach(id => {
        const activeStatus = tileWorkerManager.getStatus(id);
        if (activeStatus) {
          if (activeStatus.isDownloading || activeStatus.hasPartialDownload) {
            statusMap.set(id, { isComplete: false, isPartial: true });
          } else if (activeStatus.isDownloaded) {
            statusMap.set(id, { isComplete: true, isPartial: false });
          }
        }
      });

      setDownloadStatuses(statusMap);
      const obj: Record<string, MapDownloadStatus> = {};
      statusMap.forEach((v, k) => { obj[k] = v; });
      setStoredJson('cached_download_statuses', obj);
    } catch (err) {
      console.error('Failed to load downloaded map statuses', err);
    }
  };

  const fetchMaps = async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOffline(true);
      const cachedData = getStoredJson<MapSummary[] | null>('cached_maps', null);
      if (cachedData) {
        setMaps(cachedData);
        fetchDownloadedMapStatuses(cachedData);
      } else {
        fetchDownloadedMapStatuses();
      }
      setLoading(false);
      return;
    }

    try {
      const data = await apiService.getMaps();
      setMaps(data);
      setIsOffline(false);
      setStoredJson('cached_maps', data);
      fetchDownloadedMapStatuses(data);
    } catch (error: any) {
      console.error('Failed to fetch maps', error);
      if (error?.message?.includes('Unauthorized')) {
        logout();
        return;
      }
      setIsOffline(true);
      const cachedData = getStoredJson<MapSummary[] | null>('cached_maps', null);
      if (cachedData) {
        setMaps(cachedData);
        fetchDownloadedMapStatuses(cachedData);
      } else {
        fetchDownloadedMapStatuses();
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDownloadedMapStatuses();
    fetchMaps();
    
    const handleOnline = () => {
      setIsOffline(false);
      fetchMaps();
    };
    const handleOffline = () => {
      setIsOffline(true);
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    if (!navigator.onLine) setIsOffline(true);

    const unsubscribe = tileWorkerManager.subscribe((state) => {
      setDownloadStatuses((prev) => {
        const current = prev.get(state.mapId);
        let newStatus: MapDownloadStatus | undefined;
        if (state.isDownloading || state.hasPartialDownload) {
          newStatus = { isComplete: false, isPartial: true };
        } else if (state.isDownloaded) {
          newStatus = { isComplete: true, isPartial: false };
        }

        if (!newStatus) {
          if (!current) return prev;
          const next = new Map(prev);
          next.delete(state.mapId);
          return next;
        }

        if (current && current.isComplete === newStatus.isComplete && current.isPartial === newStatus.isPartial) {
          return prev;
        }

        const next = new Map(prev);
        next.set(state.mapId, newStatus);
        return next;
      });
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
    };
  }, []);


  const handleDelete = async (id: string) => {
    if (isOffline) {
      alert('Cannot modify maps while offline.');
      return;
    }
    
    const map = maps.find(m => m.id === id);
    if (!map) return;

    try {
      if (map.ownerId === user?.id) {
        await apiService.deleteMap(id);
      } else {
        await apiService.removeShare(id, user!.id);
      }
      const updatedMaps = maps.filter(m => m.id !== id);
      setMaps(updatedMaps);
      setStoredJson('cached_maps', updatedMaps);
    } catch (error) {
      console.error('Failed to perform action on map', error);
      alert('Failed to perform action on map');
    } finally {
      setDeleteConfirm(null);
    }
  };

  const handleCreateMap = () => {
    if (isOffline) {
      alert('Cannot create maps while offline.');
      return;
    }
    navigate('/map/new');
  };

  const filteredMaps = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return maps.filter(map => 
      map.name.toLowerCase().includes(q) ||
      (map.ownerName || '').toLowerCase().includes(q)
    ).sort((a, b) => {
      // Unaccessed maps are placed at the top so newly shared maps are immediately visible to the user
      if (!a.lastAccessedAt && b.lastAccessedAt) return -1;
      if (a.lastAccessedAt && !b.lastAccessedAt) return 1;
      if (a.lastAccessedAt && b.lastAccessedAt) {
        return b.lastAccessedAt.localeCompare(a.lastAccessedAt);
      }
      return a.name.localeCompare(b.name);
    });
  }, [maps, searchQuery]);

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString(undefined, { 
      month: 'short', day: 'numeric', year: 'numeric' 
    });
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-color)', paddingBottom: '4rem' }}>
      <header style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        padding: '1rem 2rem', 
        background: 'var(--primary-color)', 
        color: 'white',
        boxShadow: 'var(--shadow-md)',
        marginBottom: '1rem'
      }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 0, fontSize: '1.5rem', fontWeight: 'bold', color: theme === 'dark' ? '#cbd5e1' : 'white', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}>
          <MapIcon size={28} color={theme === 'dark' ? '#cbd5e1' : 'white'} /> OurMaps
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ position: 'relative' }}>
            <div 
              onClick={() => setShowUserMenu(!showUserMenu)}
              style={{ 
                width: '36px', 
                height: '36px', 
                borderRadius: '50%', 
                cursor: 'pointer', 
                overflow: 'hidden', 
                border: '2px solid rgba(255,255,255,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255,255,255,0.2)',
                fontWeight: 'bold',
                color: 'white',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitTouchCallout: 'none'
              }}
              title={user?.name}
            >
              {user?.picture ? (
                <img src={user.picture} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span>{user?.name?.[0]?.toUpperCase() || 'U'}</span>
              )}
            </div>

            {showUserMenu && (
              <>
                <div 
                  style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }} 
                  onClick={() => setShowUserMenu(false)} 
                />
                <div style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  width: '200px',
                  background: 'var(--surface-color)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 1001,
                  overflow: 'hidden',
                  padding: '4px 0'
                }}>
                  {/* Light/Dark mode toggle */}
                  <div
                    onClick={() => {
                      toggleTheme();
                    }}
                    style={{
                      padding: '10px 16px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      borderBottom: '1px solid var(--border-color)'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {theme === 'dark' ? <Moon size={16} color="#3b82f6" /> : <Sun size={16} color="#64748b" />}
                      <span>Dark Mode</span>
                    </div>
                    <div
                      style={{
                        width: '34px',
                        height: '18px',
                        borderRadius: '10px',
                        background: theme === 'dark' ? '#3b82f6' : '#e2e8f0',
                        position: 'relative',
                        transition: 'background 0.2s ease',
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '50%',
                          background: 'white',
                          position: 'absolute',
                          top: '2px',
                          left: theme === 'dark' ? '18px' : '2px',
                          transition: 'left 0.2s ease',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                        }}
                      />
                    </div>
                  </div>

                  {/* Remove All Downloads */}
                  <div
                    onClick={() => {
                      setShowUserMenu(false);
                      setShowRemoveAllDialog(true);
                    }}
                    style={{
                      padding: '10px 16px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      borderBottom: '1px solid var(--border-color)'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <Trash2 size={16} color="var(--text-secondary)" />
                    <span>Remove All Downloads</span>
                  </div>

                  {/* Sign Out */}
                  <div
                    onClick={() => {
                      setShowUserMenu(false);
                      setShowSignOutDialog(true);
                    }}
                    style={{
                      padding: '10px 16px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      color: 'var(--error-color)'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <LogOut size={16} />
                    <span>Sign Out</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '0 2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ display: 'flex', gap: '1rem', flex: 1, justifyContent: 'flex-start', minWidth: '300px' }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: '400px' }}>
              <input 
                type="text" 
                placeholder="Search maps..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-field"
                style={{ paddingLeft: '40px' }}
              />
              <div style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#aaa' }}>
                <MapIcon size={18} />
              </div>
            </div>
            {!isOffline && (
              <button 
                onClick={handleCreateMap}
                className="btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', boxShadow: '0 4px 12px rgba(72, 61, 139, 0.2)' }}
              >
                New Map
              </button>
            )}
            {isOffline && (
              <button 
                onClick={fetchMaps}
                className="btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--text-secondary)' }}
              >
                <CloudSync size={20} /> Retry Sync
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '8rem 0', color: 'var(--text-secondary)', userSelect: 'none', WebkitUserSelect: 'none' }}>
            <Loader2 className="animate-spin" size={40} style={{ margin: '0 auto 1rem auto', color: 'var(--primary-color)' }} />
            <p>Loading your maps...</p>
          </div>
        ) : maps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '6rem 2rem', background: 'var(--surface-color)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-color)' }}>
            <div style={{ background: 'var(--bg-color)', width: '80px', height: '80px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
              <MapIcon size={40} color="var(--primary-color)" />
            </div>
            <h3 style={{ color: 'var(--text-primary)', fontSize: '1.5rem', marginBottom: '0.5rem' }}>No maps yet</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2.5rem', maxWidth: '400px', margin: '0 auto 2.5rem auto' }}>Start creating your personal map collections or import KML files to get started!</p>
            <button 
              onClick={handleCreateMap}
              className="btn-primary"
              disabled={isOffline}
            >
              Create Your First Map
            </button>
          </div>
        ) : filteredMaps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', background: 'var(--surface-color)', borderRadius: 'var(--radius-lg)', color: 'var(--text-secondary)', border: '1px dashed var(--border-color)' }}>
            No maps found matching "{searchQuery}"
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
            {filteredMaps.map(map => (
              <div 
                key={map.id}
                className="card"
                style={{ 
                  padding: '1rem 1.25rem', 
                  cursor: 'pointer', 
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)', 
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
                onClick={() => handleMapClick(map.id)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-lg)';
                  e.currentTarget.style.borderColor = 'var(--primary-color)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                }}
              >
                <div style={{ 
                  position: 'absolute', 
                  top: 0, 
                  left: 0, 
                  width: '4px', 
                  height: '100%', 
                  background: map.ownerId === user?.id ? 'var(--primary-color)' : 'var(--success-color)' 
                }} />
                
                <div style={{ flex: 1, paddingRight: '16px' }}>
                  <h3 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-primary)', fontSize: '1.1rem', fontWeight: '700', paddingRight: '0' }}>{map.name}</h3>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.72rem', padding: '2px 0' }}>
                      <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: map.ownerId === user?.id ? 'var(--primary-color)' : 'var(--success-color)' }}></div>
                      {map.ownerId === user?.id ? 'Owner' : map.ownerName}
                    </div>
                    {(() => {
                      const status = downloadStatuses.get(map.id);
                      if (status?.isComplete) {
                        return (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', color: '#27ae60', background: 'rgba(39, 174, 96, 0.12)', padding: '2px 8px', borderRadius: '12px', fontWeight: '700', marginLeft: 'auto' }}>
                            <Download size={12} /> Downloaded
                          </span>
                        );
                      }
                      if (status?.isPartial) {
                        return (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', color: '#3b82f6', background: 'rgba(59, 130, 246, 0.12)', padding: '2px 8px', borderRadius: '12px', fontWeight: '700', marginLeft: 'auto' }}>
                            <Download size={12} className="animated-download-icon" /> Downloading
                          </span>
                        );
                      }
                      if (isOffline) {
                        return (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.72rem', color: '#e74c3c', background: 'rgba(231, 76, 60, 0.12)', padding: '2px 8px', borderRadius: '12px', fontWeight: '700', marginLeft: 'auto' }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            </svg>
                            Offline
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', gap: '4px', borderTop: 'none', paddingTop: '0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMapClick(map.id, true);
                      }}
                      style={{
                        background: 'rgba(72, 61, 139, 0.1)',
                        border: 'none',
                        color: 'var(--primary-color)',
                        padding: '2px',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '1.1rem',
                        width: '2.2rem',
                      }}
                      title="Open in view mode"
                      aria-label="Open in view mode"
                    >
                      <Eye size={12} />
                    </button>
                    <button 
                      onClick={(e) => { 
                        if (isOffline) return;
                        e.stopPropagation(); 
                        setDeleteConfirm(map.id); 
                      }}
                      disabled={isOffline}
                      style={{ 
                        background: 'rgba(231, 76, 60, 0.1)', 
                        border: 'none', 
                        color: 'var(--error-color)', 
                        padding: '2px', 
                        borderRadius: '12px', 
                        cursor: isOffline ? 'default' : 'pointer', 
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '1.1rem',
                        width: '2.2rem',
                        visibility: isOffline ? 'hidden' : 'visible'
                      }}
                      title={map.ownerId === user?.id ? "Delete Map" : "Leave Map"}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', fontSize: '0.75rem', color: '#999' }}>
                    <span>{formatDate(map.lastAccessedAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {deleteConfirm && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, backdropFilter: 'blur(4px)' }} onClick={() => setDeleteConfirm(null)}>
          <div style={{ background: 'var(--surface-color)', padding: '2.5rem', borderRadius: 'var(--radius-lg)', maxWidth: '450px', width: '90%', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>
              {maps.find(m => m.id === deleteConfirm)?.ownerId === user?.id ? 'Delete Map?' : 'Leave Map?'}
            </h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '2rem' }}>
              {maps.find(m => m.id === deleteConfirm)?.ownerId === user?.id 
                ? <>Are you sure you want to delete <strong>{maps.find(m => m.id === deleteConfirm)?.name}</strong>? This action is permanent and cannot be reversed.</>
                : <>Are you sure you want to leave <strong>{maps.find(m => m.id === deleteConfirm)?.name}</strong>? You will be removed as a collaborator and it will no longer appear in your list of maps.</>
              }
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'transparent', fontWeight: '600', color: 'var(--text-secondary)' }}>Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--error-color)', color: 'white', fontWeight: '600' }}>
                {maps.find(m => m.id === deleteConfirm)?.ownerId === user?.id ? 'Delete Map' : 'Leave Map'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showOfflineInterstitial && (
        <div 
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, backdropFilter: 'blur(4px)' }} 
          onClick={() => setShowOfflineInterstitial(false)}
        >
          <div 
            style={{ background: 'var(--surface-color)', padding: '2.5rem', borderRadius: 'var(--radius-lg)', maxWidth: '400px', width: '90%', boxShadow: 'var(--shadow-lg)', textAlign: 'center' }} 
            onClick={e => e.stopPropagation()}
          >
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
              <WifiOff size={32} color="var(--error-color)" />
            </div>
            <h3 style={{ marginTop: 0, fontSize: '1.4rem', fontWeight: '800', color: 'var(--text-primary)' }}>Offline Mode</h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: '1.5', margin: '1rem 0 2rem 0' }}>
              This map is not available in offline mode
            </p>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button 
                onClick={() => setShowOfflineInterstitial(false)} 
                style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--primary-color)', color: 'white', fontWeight: '600', cursor: 'pointer' }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {showSignOutDialog && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, backdropFilter: 'blur(4px)' }} onClick={() => setShowSignOutDialog(false)}>
          <div style={{ background: 'var(--surface-color)', padding: '2.5rem', borderRadius: 'var(--radius-lg)', maxWidth: '400px', width: '90%', boxShadow: 'var(--shadow-lg)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ background: 'var(--bg-color)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
              <LogOut size={32} color="var(--primary-color)" />
            </div>
            <h3 style={{ marginTop: 0, fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>Sign Out</h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: '1.5', margin: '1rem 0 2rem 0' }}>
              Sign out of this browser, or end every signed-in session on all devices.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button onClick={() => setShowSignOutDialog(false)} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'transparent', fontWeight: '600', color: 'var(--text-secondary)' }}>Cancel</button>
                <button onClick={() => { setShowSignOutDialog(false); logout(); }} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--primary-color)', color: 'white', fontWeight: '600' }}>Sign Out</button>
              </div>
              <button onClick={() => { setShowSignOutDialog(false); logoutEverywhere(); }} style={{ padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'transparent', fontWeight: '600', color: 'var(--text-secondary)' }}>Sign out everywhere</button>
            </div>
          </div>
        </div>
      )}

      {showRemoveAllDialog && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            backdropFilter: 'blur(4px)'
          }}
          onClick={() => !isRemovingAll && setShowRemoveAllDialog(false)}
        >
          <div style={{ background: 'var(--surface-color)', padding: '2.5rem', borderRadius: 'var(--radius-lg)', maxWidth: '420px', width: '90%', boxShadow: 'var(--shadow-lg)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            {isRemovingAll ? (
              <>
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
                  <Upload size={32} className="animated-download-icon" color="var(--error-color)" />
                </div>
                <h3 style={{ marginTop: 0, fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>Removing Downloads...</h3>
                <p style={{ color: 'var(--text-secondary)', lineHeight: '1.5', margin: '1rem 0 0 0' }}>
                  Removing all offline map data and map tiles from this device. Please wait...
                </p>
              </>
            ) : (
              <>
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
                  <Trash2 size={32} color="var(--error-color)" />
                </div>
                <h3 style={{ marginTop: 0, fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>Remove All Downloads?</h3>
                <p style={{ color: 'var(--text-secondary)', lineHeight: '1.5', margin: '1rem 0 2rem 0' }}>
                  This will remove all offline map data and map tiles stored on this device.
                </p>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button onClick={() => setShowRemoveAllDialog(false)} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'transparent', fontWeight: '600', color: 'var(--text-secondary)', cursor: 'pointer' }}>Cancel</button>
                  <button onClick={handleRemoveAllDownloads} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--error-color)', color: 'white', fontWeight: '600', cursor: 'pointer' }}>Remove All</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
