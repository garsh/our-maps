import { useEffect, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { apiService } from '../services/api';
import { Map as MapIcon, LogOut, WifiOff, CloudSync, Loader2, Trash2, Download, Upload, Sun, Moon, Eye } from 'lucide-react';
import { getMapDownloadStatuses, type MapDownloadStatus } from '../utils/tileUtils';
import { tileWorkerManager } from '../utils/tileWorkerManager';
import { getStoredJson, setStoredJson } from '../utils/storageUtils';
import { isForcedOffline, setForcedOffline } from '../utils/offlineSession';
import { deleteUnrecognizedStorage, findUnrecognizedStorage, type LeftoverStorageItem } from '../utils/legacyStorage';

interface MapSummary {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  lastAccessedAt?: string;
}

interface TouchTooltipState {
  text: string;
  x: number;
  y: number;
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
  const [isOffline, setIsOffline] = useState(() => isForcedOffline());
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showSignOutDialog, setShowSignOutDialog] = useState(false);
  const [showRemoveAllDialog, setShowRemoveAllDialog] = useState(false);
  const [isRemovingAll, setIsRemovingAll] = useState(false);
  const [leftoverItems, setLeftoverItems] = useState<LeftoverStorageItem[]>([]);
  const [showLeftoverDialog, setShowLeftoverDialog] = useState(false);
  const [isRemovingLeftovers, setIsRemovingLeftovers] = useState(false);
  const [showOfflineInterstitial, setShowOfflineInterstitial] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [touchTooltip, setTouchTooltip] = useState<TouchTooltipState | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef<boolean>(false);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleTouchStart = (text: string, e: React.TouchEvent | React.MouseEvent) => {
    clearLongPress();
    longPressTriggeredRef.current = false;
    const targetElement = e.currentTarget as HTMLElement;
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      const rect = targetElement.getBoundingClientRect();
      setTouchTooltip({
        text,
        x: rect.left + rect.width / 2,
        y: rect.top - 6
      });
      // Auto-dismiss after 2.5s
      setTimeout(() => {
        setTouchTooltip(prev => (prev?.text === text ? null : prev));
      }, 2500);
    }, 450);
  };

  const handleTouchEnd = () => {
    clearLongPress();
  };

  const handleRemoveAllDownloads = async () => {
    setIsRemovingAll(true);
    try {
      await tileWorkerManager.removeAllDownloads();
      setDownloadStatuses(new Map());
      setStoredJson('cached_download_statuses', {});
      let leftovers: LeftoverStorageItem[] = [];
      try {
        leftovers = await findUnrecognizedStorage();
      } catch (scanErr) {
        console.warn('Failed to scan for leftover storage:', scanErr);
      }
      setShowRemoveAllDialog(false);
      if (leftovers.length > 0) {
        setLeftoverItems(leftovers);
        setShowLeftoverDialog(true);
      }
    } catch (err) {
      console.error('Failed to remove all downloads:', err);
      alert('Failed to remove all downloads: ' + (err instanceof Error ? err.message : String(err)));
      setShowRemoveAllDialog(false);
    } finally {
      setIsRemovingAll(false);
    }
  };

  const handleKeepLeftovers = () => {
    setShowLeftoverDialog(false);
    setLeftoverItems([]);
  };

  const handleDeleteLeftovers = async () => {
    setIsRemovingLeftovers(true);
    try {
      await deleteUnrecognizedStorage(leftoverItems);
      setShowLeftoverDialog(false);
      setLeftoverItems([]);
    } catch (err) {
      console.error('Failed to delete leftover storage:', err);
      alert('Failed to delete leftover data: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsRemovingLeftovers(false);
    }
  };

  const handleMapClick = (mapId: string, viewMode = false) => {
    const currentlyOffline = isOffline || (typeof navigator !== 'undefined' && !navigator.onLine);
    if (currentlyOffline) {
      const status = downloadStatuses.get(mapId);
      if (!status || !status.isComplete) {
        setShowOfflineInterstitial(true);
        return;
      }
    }
    // Offline still opens as editor intent (no ?mode=view) so coming back
    // online restores edit mode. The map editor forces view-only while offline.
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
      statusMap.forEach((status, id) => {
        if (status.isPartial) {
          void tileWorkerManager.resumeIfNeeded(id);
        }
      });
    } catch (err) {
      console.error('Failed to load downloaded map statuses', err);
    }
  };

  const applyCachedMaps = () => {
    const cachedData = getStoredJson<MapSummary[] | null>('cached_maps', null);
    if (cachedData) {
      setMaps(cachedData);
      fetchDownloadedMapStatuses(cachedData);
    } else {
      fetchDownloadedMapStatuses();
    }
  };

  const fetchMaps = async (opts?: { force?: boolean }) => {
    const browserOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    // SessionStorage can still say offline after a reconnect (it survives
    // refresh). Only skip the network when the browser itself reports offline.
    if (!opts?.force && browserOffline) {
      setForcedOffline(true);
      setIsOffline(true);
      applyCachedMaps();
      setLoading(false);
      return;
    }

    try {
      const data = await apiService.getMaps();
      setForcedOffline(false);
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
      setForcedOffline(true);
      setIsOffline(true);
      applyCachedMaps();
    } finally {
      setLoading(false);
    }
  };

  const fetchMapsRef = useRef(fetchMaps);
  useEffect(() => {
    fetchMapsRef.current = fetchMaps;
  });

  useEffect(() => {
    fetchDownloadedMapStatuses();
    fetchMaps();
    
    const handleOnline = () => {
      setForcedOffline(false);
      setIsOffline(false);
      fetchMapsRef.current({ force: true });
    };
    const handleOffline = () => {
      setForcedOffline(true);
      setIsOffline(true);
    };
    
    const handleVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchDownloadedMapStatuses();
      }
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisible);
    
    if (isForcedOffline()) {
      setForcedOffline(true);
      setIsOffline(true);
    }

    const unsubscribe = tileWorkerManager.subscribe((state) => {
      setDownloadStatuses((prev) => {
        let newStatus: MapDownloadStatus | undefined;
        if (state.isDownloading || state.hasPartialDownload) {
          newStatus = { isComplete: false, isPartial: true };
        } else if (state.isDownloaded) {
          newStatus = { isComplete: true, isPartial: false };
        }

        const current = prev.get(state.mapId);
        if (!newStatus && !current) return prev;
        if (current && newStatus && current.isComplete === newStatus.isComplete && current.isPartial === newStatus.isPartial) {
          return prev;
        }

        const next = new Map(prev);
        if (newStatus) {
          next.set(state.mapId, newStatus);
        } else {
          next.delete(state.mapId);
        }
        const obj: Record<string, MapDownloadStatus> = {};
        next.forEach((v, k) => { obj[k] = v; });
        setStoredJson('cached_download_statuses', obj);
        return next;
      });
    });

    const handleDismissTooltip = () => {
      setTouchTooltip(null);
      clearLongPress();
    };

    window.addEventListener('scroll', handleDismissTooltip, { passive: true });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('scroll', handleDismissTooltip);
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
      <header className="landing-header">
        <h1 className="landing-header-title" style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0, fontWeight: 'bold', color: theme === 'dark' ? '#cbd5e1' : 'white', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}>
          <MapIcon size={24} color={theme === 'dark' ? '#cbd5e1' : 'white'} /> OurMaps
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

      <main className="landing-container">
        <div className="landing-toolbar">
          <div className="landing-search-wrapper">
            <input 
              type="text" 
              placeholder="Search maps..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field"
              style={{ paddingLeft: '38px', height: '40px', paddingRight: '12px' }}
            />
            <div style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', display: 'flex', pointerEvents: 'none' }}>
              <MapIcon size={18} />
            </div>
          </div>
          {!isOffline && (
            <button 
              onClick={handleCreateMap}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '40px', padding: '0 16px', whiteSpace: 'nowrap', flexShrink: 0, boxShadow: '0 2px 8px rgba(72, 61, 139, 0.2)' }}
            >
              New Map
            </button>
          )}
          {isOffline && (
            <button 
              onClick={() => fetchMaps({ force: true })}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '40px', padding: '0 16px', whiteSpace: 'nowrap', flexShrink: 0, background: 'var(--text-secondary)' }}
            >
              <CloudSync size={18} /> Retry Sync
            </button>
          )}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '6rem 0', color: 'var(--text-secondary)', userSelect: 'none', WebkitUserSelect: 'none' }}>
            <Loader2 className="animate-spin" size={36} style={{ margin: '0 auto 1rem auto', color: 'var(--primary-color)' }} />
            <p style={{ margin: 0, fontSize: '0.95rem' }}>Loading your maps...</p>
          </div>
        ) : maps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '5rem 1.5rem', background: 'var(--surface-color)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-color)' }}>
            <div style={{ background: 'var(--bg-color)', width: '70px', height: '70px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem auto' }}>
              <MapIcon size={34} color="var(--primary-color)" />
            </div>
            <h3 style={{ color: 'var(--text-primary)', fontSize: '1.3rem', marginBottom: '0.5rem' }}>No maps yet</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', maxWidth: '400px', margin: '0 auto 2rem auto', fontSize: '0.95rem' }}>Start creating your personal map collections or import KML files to get started!</p>
            <button 
              onClick={handleCreateMap}
              className="btn-primary"
              disabled={isOffline}
            >
              Create Your First Map
            </button>
          </div>
        ) : filteredMaps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', background: 'var(--surface-color)', borderRadius: 'var(--radius-lg)', color: 'var(--text-secondary)', border: '1px dashed var(--border-color)', fontSize: '0.95rem' }}>
            No maps found matching "{searchQuery}"
          </div>
        ) : (
          <div className="landing-maps-grid">
            {filteredMaps.map(map => (
              <div 
                key={map.id}
                className="card map-card-compact"
                onClick={() => handleMapClick(map.id)}
              >
                {/* Map info section */}
                <div className="map-card-info">
                  <h3 className="map-card-title" title={map.name}>{map.name}</h3>
                  <div className="map-card-meta">
                    <span 
                      style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, cursor: 'default' }}
                      title="Map Owner"
                      onTouchStart={(e) => handleTouchStart('Map Owner', e)}
                      onTouchEnd={handleTouchEnd}
                      onTouchCancel={handleTouchEnd}
                    >
                      <span>{map.ownerId === user?.id ? (user?.name || map.ownerName || 'You') : (map.ownerName || 'Shared')}</span>
                    </span>
                    <span style={{ opacity: 0.5 }}>•</span>
                    <span 
                      style={{ flexShrink: 0, opacity: 0.85, cursor: 'default' }}
                      title="Last Accessed Date"
                      onTouchStart={(e) => handleTouchStart('Last Accessed Date', e)}
                      onTouchEnd={handleTouchEnd}
                      onTouchCancel={handleTouchEnd}
                    >
                      {formatDate(map.lastAccessedAt)}
                    </span>
                    {(() => {
                      const status = downloadStatuses.get(map.id);
                      if (status?.isComplete) {
                        return (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.7rem', color: '#27ae60', background: 'rgba(39, 174, 96, 0.12)', padding: '1px 6px', borderRadius: '10px', fontWeight: '700', marginLeft: 'auto', flexShrink: 0 }}>
                            <Download size={11} /> Downloaded
                          </span>
                        );
                      }
                      if (status?.isPartial) {
                        return (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.7rem', color: '#3b82f6', background: 'rgba(59, 130, 246, 0.12)', padding: '1px 6px', borderRadius: '10px', fontWeight: '700', marginLeft: 'auto', flexShrink: 0 }}>
                            <Download size={11} className="animated-download-icon" /> Downloading
                          </span>
                        );
                      }
                      if (isOffline) {
                        return (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.7rem', color: '#e74c3c', background: 'rgba(231, 76, 60, 0.12)', padding: '1px 6px', borderRadius: '10px', fontWeight: '700', marginLeft: 'auto', flexShrink: 0 }}>
                            <WifiOff size={11} /> Offline
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>

                {/* Right button actions with generous touch targets */}
                <div className="map-card-actions">
                  <button
                    type="button"
                    className="map-card-action-btn view-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (longPressTriggeredRef.current) {
                        longPressTriggeredRef.current = false;
                        return;
                      }
                      handleMapClick(map.id, true);
                    }}
                    onTouchStart={(e) => handleTouchStart('Open in view mode', e)}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={handleTouchEnd}
                    title="Open in view mode"
                    aria-label="Open in view mode"
                  >
                    <Eye size={18} />
                  </button>
                  {!isOffline && (
                    <button 
                      type="button"
                      className="map-card-action-btn delete-btn"
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        if (longPressTriggeredRef.current) {
                          longPressTriggeredRef.current = false;
                          return;
                        }
                        setDeleteConfirm(map.id); 
                      }}
                      onTouchStart={(e) => handleTouchStart(map.ownerId === user?.id ? 'Delete Map' : 'Leave Map', e)}
                      onTouchEnd={handleTouchEnd}
                      onTouchCancel={handleTouchEnd}
                      title={map.ownerId === user?.id ? "Delete Map" : "Leave Map"}
                      aria-label={map.ownerId === user?.id ? "Delete Map" : "Leave Map"}
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {touchTooltip && (
        <div 
          className="touch-tooltip-bubble"
          style={{
            left: `${touchTooltip.x}px`,
            top: `${touchTooltip.y}px`
          }}
        >
          {touchTooltip.text}
        </div>
      )}

      {deleteConfirm && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, backdropFilter: 'blur(4px)' }} onClick={() => setDeleteConfirm(null)}>
          <div style={{ background: 'var(--surface-color)', padding: '2.5rem', borderRadius: 'var(--radius-lg)', maxWidth: '450px', width: '90%', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>
              {maps.find(m => m.id === deleteConfirm)?.ownerId === user?.id ? 'Delete Map?' : 'Leave Map?'}
            </h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '2rem' }}>
              {maps.find(m => m.id === deleteConfirm)?.ownerId === user?.id 
                ? <>Are you sure you want to delete <strong>{maps.find(m => m.id === deleteConfirm)?.name}</strong>? This action is permanent and cannot be reversed. Collaborators will lose access to the map.  Consider giving someone else Onwership instead.</>
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

      {showLeftoverDialog && (
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
          onClick={() => !isRemovingLeftovers && handleKeepLeftovers()}
        >
          <div style={{ background: 'var(--surface-color)', padding: '2.5rem', borderRadius: 'var(--radius-lg)', maxWidth: '460px', width: '90%', boxShadow: 'var(--shadow-lg)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            {isRemovingLeftovers ? (
              <>
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
                  <Upload size={32} className="animated-download-icon" color="var(--error-color)" />
                </div>
                <h3 style={{ marginTop: 0, fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>Removing Leftovers...</h3>
                <p style={{ color: 'var(--text-secondary)', lineHeight: '1.5', margin: '1rem 0 0 0' }}>
                  Deleting leftover data from older versions of Our Maps. Please wait...
                </p>
              </>
            ) : (
              <>
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
                  <Trash2 size={32} color="var(--error-color)" />
                </div>
                <h3 style={{ marginTop: 0, fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>Leftover data found</h3>
                <p style={{ color: 'var(--text-secondary)', lineHeight: '1.5', margin: '1rem 0' }}>
                  This browser still has data from an older version of Our Maps that the current app no longer uses. Delete it as well?
                </p>
                <ul style={{ textAlign: 'left', color: 'var(--text-primary)', lineHeight: 1.5, margin: '0 0 2rem 0', padding: '0.75rem 0.75rem 0.75rem 1.75rem', maxHeight: '180px', overflowY: 'auto', background: 'var(--bg-color)', borderRadius: 'var(--radius-sm)' }}>
                  {leftoverItems.map((item) => (
                    <li key={item.id} style={{ marginBottom: '0.35rem' }}>{item.detail}</li>
                  ))}
                </ul>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button onClick={handleKeepLeftovers} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'transparent', fontWeight: '600', color: 'var(--text-secondary)', cursor: 'pointer' }}>Keep</button>
                  <button onClick={handleDeleteLeftovers} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--error-color)', color: 'white', fontWeight: '600', cursor: 'pointer' }}>Delete leftovers</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
