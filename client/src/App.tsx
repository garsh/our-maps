import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import ShareDialog from './components/ShareDialog';
import { apiService } from './services/api'
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import type {
  Pin,
  PinLayer,
  MapPermission,
  MapData,
  PinCreatePayload,
  PinUpdatePayload,
  PinDeletePayload,
  PinsReorderPayload,
  PinMoveLayerPayload,
  LayerCreatePayload,
  LayerUpdatePayload,
  LayerDeletePayload,
  LayersReorderPayload,
  MapNameUpdatePayload
} from '@shared/interfaces'

import type { DragEndEvent } from '@dnd-kit/core'
import { Loader2, Map as MapIcon, RotateCw } from 'lucide-react';
import type { SearchAreaState } from './components/SearchBar';
import { reorderPins, reorderLayers, isSameLayer, emitPinMoveOrReorderEvents } from './utils/reorderUtils';
import { generateId } from './utils/fileUtils';
import { getDownloadStats, getOfflineMap, isMapDownloaded, type MapDownloadStatus } from './utils/tileUtils';
import { preloadExtract, setActiveOfflineMapId } from './utils/offlineExtract';
import { getStoredJson, setStoredJson, getStoredBoolean, setStoredBoolean } from './utils/storageUtils';
import { AUTO_VIEW_SESSION_KEY, OFFLINE_SESSION_KEY, readSessionFlag, writeSessionFlag } from './utils/offlineSession';
import { tileWorkerManager } from './utils/tileWorkerManager';
import { clearHoveredPin, getHoveredPinId, setHoveredPin, hasFinePointer } from './utils/pinHover';
import { arePinsEqual } from './utils/mapUtils';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

export function clampSidebarWidth(width: number, viewportWidth: number, min = 200, maxMargin = 50): number {
  return Math.max(min, Math.min(viewportWidth - maxMargin, width));
}

export function MapEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  
  const [pins, setPins] = useState<Pin[]>([])
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const [layers, setLayers] = useState<PinLayer[]>([])
  const [mapId, setMapId] = useState<string | null>(id && id !== 'new' ? id : null);


  useLayoutEffect(() => {
    if (id && id !== 'new') {
      setActiveOfflineMapId(id);
      void preloadExtract(id);
    }
  }, [id]);
  const [mapName, setMapName] = useState(id === 'new' ? 'My Map' : '');
  const [owner, setOwner] = useState<{ id: string, name?: string, email?: string, picture?: string } | null>(null);
  const [isMapLoading, setIsMapLoading] = useState(!!id && id !== 'new');
  const [userRole, setUserRole] = useState<'owner' | 'edit' | 'view'>('owner');
  const canEditMap = userRole !== 'view';
  const [permissions, setPermissions] = useState<MapPermission[]>([]);
  const [searchAreaState, setSearchAreaState] = useState<SearchAreaState | null>(null);
  
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [targetPinId, setTargetPinId] = useState<string | null>(null);
  const [boundsToFit, setBoundsToFit] = useState<[[number, number], [number, number]] | null>(null);
  const [editingPinId, setEditingPinId] = useState<string | null>(null);
  const [hasOfflineTiles, setHasOfflineTiles] = useState(() => {
    const cachedStatuses = getStoredJson<Record<string, MapDownloadStatus> | null>('cached_download_statuses', null);
    const currentId = id || null;
    if (currentId && cachedStatuses && cachedStatuses[currentId]) {
      const st = cachedStatuses[currentId];
      return st.isComplete || st.isPartial;
    }
    return false;
  });
  const [previewLocation, setPreviewLocation] = useState<{lat: number, lng: number} | null>(null);
  const DEFAULT_SIDEBAR_WIDTH = 400;
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const isResizerDraggingRef = useRef(false);
  const resizerStartXRef = useRef(0);

  const { theme: mapTheme, setTheme: handleThemeChange } = useTheme();

  const [showHillshade, setShowHillshade] = useState<boolean>(() => {
    return getStoredBoolean('ourmaps_hillshade', true);
  });

  const handleToggleHillshade = useCallback((enabled: boolean) => {
    setShowHillshade(enabled);
    setStoredBoolean('ourmaps_hillshade', enabled);
  }, []);

  const [show3DTerrain, setShow3DTerrain] = useState<boolean>(() => {
    return getStoredBoolean('ourmaps_3d_terrain', getStoredBoolean('ourmaps_3d', true));
  });

  const handleToggle3DTerrain = useCallback((enabled: boolean) => {
    setShow3DTerrain(enabled);
    setStoredBoolean('ourmaps_3d_terrain', enabled);
  }, []);

  const [show3DBuildings, setShow3DBuildings] = useState<boolean>(() => {
    return getStoredBoolean('ourmaps_3d_buildings', getStoredBoolean('ourmaps_3d', true));
  });

  const handleToggle3DBuildings = useCallback((enabled: boolean) => {
    setShow3DBuildings(enabled);
    setStoredBoolean('ourmaps_3d_buildings', enabled);
  }, []);

  const [showSatellite, setShowSatellite] = useState<boolean>(() => {
    return getStoredBoolean('ourmaps_satellite', false);
  });

  const handleToggleSatellite = useCallback((enabled: boolean) => {
    setShowSatellite(enabled);
    setStoredBoolean('ourmaps_satellite', enabled);
  }, []);

  // Mobile layout states
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // Dynamic mobile scale: calibrated so DPR ~2.75 gives scale 1.5.
  const computeMobileScale = () => {
    const dpr = window.devicePixelRatio || 1;
    const BASELINE_DPR = 2.75;
    const BASELINE_SCALE = 1.5;
    return Math.max(1.0, Math.min(2.5, (dpr / BASELINE_DPR) * BASELINE_SCALE));
  };
  const [mobileScale, setMobileScale] = useState(computeMobileScale);

  const [isOffline, setIsOffline] = useState(
    () => (typeof navigator !== 'undefined' && !navigator.onLine) || readSessionFlag(OFFLINE_SESSION_KEY)
  );
  const [isSyncing, setIsSyncing] = useState(
    () => id !== 'new' && !((typeof navigator !== 'undefined' && !navigator.onLine) || readSessionFlag(OFFLINE_SESSION_KEY))
  );
  const editMode = canEditMap && !isOffline && searchParams.get('mode') !== 'view';

  const applyOffline = useCallback((offline: boolean, immediate = false) => {
    if (pendingTransitionTimerRef.current) {
      clearTimeout(pendingTransitionTimerRef.current);
      pendingTransitionTimerRef.current = null;
    }

    const performTransition = () => {
      pendingTransitionTimerRef.current = null;
      // Skip if the transition direction hasn't changed since the last commit.
      // Prevents double state updates when socket connect + window online both
      // fire applyOffline(false, true) in the same tick.
      if (lastAppliedOfflineRef.current === offline) return;
      lastAppliedOfflineRef.current = offline;
      writeSessionFlag(OFFLINE_SESSION_KEY, offline);
      setIsOffline(offline);
      setIsSyncing(false);
      if (offline) {
        setSearchParams((prev) => {
          if (prev.get('mode') === 'view') return prev;
          writeSessionFlag(AUTO_VIEW_SESSION_KEY, true);
          const next = new URLSearchParams(prev);
          next.set('mode', 'view');
          return next;
        }, { replace: true });
        return;
      }
      if (!readSessionFlag(AUTO_VIEW_SESSION_KEY)) return;
      writeSessionFlag(AUTO_VIEW_SESSION_KEY, false);
      setSearchParams((prev) => {
        if (prev.get('mode') !== 'view') return prev;
        const next = new URLSearchParams(prev);
        next.delete('mode');
        return next;
      }, { replace: true });
    };

    if (immediate) {
      performTransition();
    } else {
      // 300ms stability debounce to avoid rapid ping-ponging between states
      pendingTransitionTimerRef.current = setTimeout(performTransition, 300);
    }
  }, [setSearchParams]);

  useEffect(() => {
    let resizeRaf: number | null = null;
    const handleResize = () => {
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        setIsMobile(window.innerWidth <= 768);
        setMobileScale(computeMobileScale());
        resizeRaf = null;
      });
    };
    const handleOnline = () => applyOffline(false, true);
    const handleOffline = () => applyOffline(true, true);

    window.addEventListener('resize', handleResize);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      if (pendingTransitionTimerRef.current) {
        clearTimeout(pendingTransitionTimerRef.current);
        pendingTransitionTimerRef.current = null;
      }
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [applyOffline]);

  const getStandardSheetHeight = () => {
    if (typeof window === 'undefined') return 300;
    return Math.min(350, Math.round(window.innerHeight * 0.45));
  };

  const [sheetHeight, setSheetHeight] = useState(getStandardSheetHeight);
  const [isDraggingSheet, setIsDraggingSheet] = useState(false);
  const [isHoverBlocked, setIsHoverBlocked] = useState(false);
  const isHoverBlockedRef = useRef(false);
  isHoverBlockedRef.current = isHoverBlocked;
  const sheetRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const sheetBoundsRef = useRef<{ minH: number; maxH: number }>({ minH: 0, maxH: 600 });
  const sheetDragStart = useRef<{ y: number; height: number; time: number; moved: boolean }>({ y: 0, height: 300, time: 0, moved: false });
  const currentDragHeight = useRef<number>(300);
  const rafId = useRef<number | null>(null);
  const ignoreMapClickUntil = useRef<number>(0);

  const calculateSheetBounds = () => {
    const headerHeight = headerRef.current ? headerRef.current.getBoundingClientRect().height : 44;
    const handleHeight = 28;
    const maxH = Math.max(100, window.innerHeight - headerHeight - handleHeight);
    return { minH: 0, maxH };
  };

  const startSheetDrag = (e: React.PointerEvent) => {
    e.stopPropagation();
    ignoreMapClickUntil.current = Date.now() + 450;
    sheetBoundsRef.current = calculateSheetBounds();
    setIsDraggingSheet(true);
    sheetDragStart.current = { y: e.clientY, height: sheetHeight, time: Date.now(), moved: false };
    currentDragHeight.current = sheetHeight;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore in environments where pointer capture is unsupported
    }
  };
  
  const onSheetDrag = (e: React.PointerEvent) => {
    if (!isDraggingSheet) return;
    e.stopPropagation();
    ignoreMapClickUntil.current = Date.now() + 450;
    const deltaY = sheetDragStart.current.y - e.clientY;
    if (Math.abs(deltaY) > 3) {
      sheetDragStart.current.moved = true;
    }
    const { minH, maxH } = sheetBoundsRef.current;
    const newH = Math.max(minH, Math.min(maxH, sheetDragStart.current.height + deltaY));
    currentDragHeight.current = newH;

    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
    }
    rafId.current = requestAnimationFrame(() => {
      if (sheetRef.current) {
        sheetRef.current.style.height = `${newH}px`;
      }
    });
  };
  
  const endSheetDrag = (e: React.PointerEvent) => {
    if (!isDraggingSheet) return;
    e.stopPropagation();
    ignoreMapClickUntil.current = Date.now() + 450;
    setIsDraggingSheet(false);
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }

    const totalDeltaY = sheetDragStart.current.y - e.clientY; // positive = dragged UP, negative = dragged DOWN
    const elapsed = Math.max(1, Date.now() - sheetDragStart.current.time);
    const velocity = totalDeltaY / elapsed; // px per ms

    const { minH, maxH } = sheetBoundsRef.current;
    const standardHeight = getStandardSheetHeight();
    const isAtStandardHeight = Math.abs(sheetHeight - standardHeight) <= 5;
    let finalH = currentDragHeight.current;

    if (!sheetDragStart.current.moved || (elapsed < 200 && Math.abs(totalDeltaY) < 5)) {
      // Tap on handle: clear hover and block hover highlight until cursor intentionally moves
      clearHoveredPin();
      setIsHoverBlocked(true);
      isHoverBlockedRef.current = true;
      const tapX = e.clientX;
      const tapY = e.clientY;
      let timeoutId: number;
      const onMove = (moveEvt: MouseEvent) => {
        if (Math.abs(moveEvt.clientX - tapX) > 4 || Math.abs(moveEvt.clientY - tapY) > 4) {
          setIsHoverBlocked(false);
          isHoverBlockedRef.current = false;
          window.removeEventListener('mousemove', onMove);
          clearTimeout(timeoutId);
        }
      };
      window.addEventListener('mousemove', onMove);
      timeoutId = window.setTimeout(() => {
        setIsHoverBlocked(false);
        isHoverBlockedRef.current = false;
        window.removeEventListener('mousemove', onMove);
      }, 500);

      // Close if already standard size, otherwise resize to standard size
      if (isAtStandardHeight) {
        finalH = minH;
      } else {
        finalH = standardHeight;
      }
    } else if (velocity > 0.4) {
      // Fast flick UP -> raise all the way so handle touches title bar
      finalH = maxH;
    } else if (velocity < -0.4) {
      // Fast flick DOWN -> hide panel completely
      finalH = minH;
    } else {
      // Normal drag release: keep exact custom height where user released
      finalH = Math.max(minH, Math.min(maxH, currentDragHeight.current));
    }

    if (sheetRef.current) {
      sheetRef.current.style.height = `${finalH}px`;
    }
    setSheetHeight(finalH);
  };



  const [selectedNavIds, setSelectedNavIds] = useState<Set<string>>(new Set());
  const [hiddenLayerIds, setHiddenLayerIds] = useState<Set<string | null>>(() => {
    const mapIdVal = id || null;
    if (mapIdVal) {
      const savedVisibility = getStoredJson<string[] | null>(`ourmaps_visibility_${mapIdVal}`, null);
      if (savedVisibility) {
        return new Set(savedVisibility);
      }
    }
    return new Set();
  });
  const [collapsedLayerIds, setCollapsedLayerIds] = useState<Set<string | null>>(() => {
    const mapIdVal = id || null;
    if (mapIdVal) {
      const savedCollapsed = getStoredJson<string[] | null>(`ourmaps_collapsed_${mapIdVal}`, null);
      if (savedCollapsed) {
        return new Set(savedCollapsed);
      }
    }
    return new Set();
  });
  
  const [customColors, setCustomColors] = useState<string[]>(() => {
    return getStoredJson<string[]>('customColors', []);
  });

  const selectedNavIdsRef = useRef(selectedNavIds);
  selectedNavIdsRef.current = selectedNavIds;
  const collapsedLayerIdsRef = useRef(collapsedLayerIds);
  collapsedLayerIdsRef.current = collapsedLayerIds;
  const userRoleRef = useRef(userRole);
  userRoleRef.current = userRole;
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;
  const isOfflineRef = useRef(isOffline);
  isOfflineRef.current = isOffline;
  const mapIdRef = useRef(mapId);
  mapIdRef.current = mapId;
  const targetPinIdRef = useRef(targetPinId);
  targetPinIdRef.current = targetPinId;
  const editingPinIdRef = useRef(editingPinId);
  editingPinIdRef.current = editingPinId;

  // Track offline-deleted entity IDs to prevent resurrection on reconnect
  const pendingDeletedPinIdsRef = useRef<Set<string>>(new Set());
  const pendingDeletedLayerIdsRef = useRef<Set<string>>(new Set());

  // Prevent auto-save HTTP PUT from racing against socket reconnection
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveAbortRef = useRef<AbortController | null>(null);

  // Request epoch to prevent stale loadMap or reconcileOnReconnect responses from overwriting fresh state
  const loadEpochRef = useRef(0);

  // Debounce transition between offline and online to prevent rapid flip-flopping
  const pendingTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track last applied value so duplicate applyOffline(same) calls skip re-rendering.
  const lastAppliedOfflineRef = useRef<boolean | null>(null);

  // Load persistent UI state when mapId changes
  useEffect(() => {
    if (mapId) {
      const savedVisibility = getStoredJson<string[] | null>(`ourmaps_visibility_${mapId}`, null);
      if (savedVisibility) {
        setHiddenLayerIds(new Set(savedVisibility));
      } else {
        setHiddenLayerIds(new Set());
      }

      const savedCollapsed = getStoredJson<string[] | null>(`ourmaps_collapsed_${mapId}`, null);
      if (savedCollapsed) {
        setCollapsedLayerIds(new Set(savedCollapsed));
      } else {
        setCollapsedLayerIds(new Set()); // All layers expanded by default on a new device
      }
    }
  }, [mapId]);

  // Persist visibility changes
  useEffect(() => {
    if (mapId) {
      setStoredJson(`ourmaps_visibility_${mapId}`, Array.from(hiddenLayerIds));
    }
  }, [hiddenLayerIds, mapId]);

  // Persist collapse changes
  useEffect(() => {
    if (mapId) {
      setStoredJson(`ourmaps_collapsed_${mapId}`, Array.from(collapsedLayerIds));
    }
  }, [collapsedLayerIds, mapId]);

  useEffect(() => {
    setStoredJson('customColors', customColors);
  }, [customColors]);

  // Track offline tile status for the currently open map
  useEffect(() => {
    if (!mapId) {
      setHasOfflineTiles(false);
      return;
    }

    const cachedStatuses = getStoredJson<Record<string, MapDownloadStatus> | null>('cached_download_statuses', null);
    if (cachedStatuses && cachedStatuses[mapId]) {
      const st = cachedStatuses[mapId];
      setHasOfflineTiles(st.isComplete || st.isPartial);
    }

    getDownloadStats(mapId).then((stats) => {
      setHasOfflineTiles(stats.completed > 0);
    });

    const unsubscribe = tileWorkerManager.subscribe((state) => {
      if (state.mapId === mapId) {
        setHasOfflineTiles(state.isDownloaded || state.hasPartialDownload || (state.tileStats?.completed || 0) > 0);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [mapId]);

  const addCustomColor = useCallback((color: string) => {
    setCustomColors(prev => {
      if (prev.includes(color)) return prev;
      return [color, ...prev].slice(0, 10);
    });
  }, []);

  const handleToggleNavId = useCallback((id: string) => {
    setSelectedNavIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  }, []);

  const handleToggleNavIds = useCallback((ids: string[], force?: boolean) => {
    setSelectedNavIds(prev => {
      const newSet = new Set(prev);
      ids.forEach(id => {
        if (force === true) newSet.add(id);
        else if (force === false) newSet.delete(id);
        else {
          if (newSet.has(id)) newSet.delete(id);
          else newSet.add(id);
        }
      });
      return newSet;
    });
  }, []);

  const handleToggleLayerVisibility = useCallback((id: string | null) => {
    setHiddenLayerIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  }, []);

  const handleToggleExpand = useCallback((id: string | null) => {
    setCollapsedLayerIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  }, []);

  const handleHoverSearchResult = useCallback((lat: number | null, lng: number | null) => {
    setPreviewLocation(lat !== null && lng !== null ? { lat, lng } : null);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const isRemoteUpdateRef = useRef(false);
  const isInitialLoadRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const dragStartLayersRef = useRef<Map<string, string | undefined>>(new Map());
  const dragStartPinsRef = useRef<Pin[] | null>(null);

  useEffect(() => {
    if (id && id !== 'new') {
      if (mapId !== id || !hasLoadedRef.current) {
        loadMap(id);
      }

      if (!user) {
        return;
      }

      // Setup Socket
      const socket = io(SOCKET_URL, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        withCredentials: true
      });
      socketRef.current = socket;

      socket.emit('join-map', id);

      let isInitialConnect = true;

      // Reconnect re-sync handler
      socket.on('connect', () => {
        console.log('[SOCKET] Connected to server, re-syncing map data');
        // Cancel any pending HTTP PUT auto-save and abort in-flight saves to avoid collision with delta sync
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
          autoSaveTimerRef.current = null;
        }
        if (autoSaveAbortRef.current) {
          autoSaveAbortRef.current.abort();
          autoSaveAbortRef.current = null;
        }
        applyOffline(false, true);
        if (id) {
          socket.emit('join-map', id);
          if (isInitialConnect) {
            isInitialConnect = false;
            return;
          }
          reconcileOnReconnect(id);
        }
      });

      socket.on('connect_error', () => {
        applyOffline(true, true);
      });

      socket.on('disconnect', (reason: string) => {
        // 'io client disconnect' is intentional (unmount/logout); ignore to avoid spurious offline flicker
        if (reason !== 'io client disconnect') {
          applyOffline(true, true);
        }
      });

      // Granular Delta Listeners
      socket.on('pin-create', (data: PinCreatePayload) => {
        if (data.mapId !== id) return;
        isRemoteUpdateRef.current = true;
        setPins(prev => {
          if (prev.some(p => p.id === data.pin.id)) return prev;
          return [...prev, data.pin];
        });
        setIsDirty(false);
      });

      socket.on('pin-update', (data: PinUpdatePayload) => {
        if (data.mapId !== id) return;
        isRemoteUpdateRef.current = true;
        setPins(prev => prev.map(p => {
          if (p.id !== data.pinId) return p;
          const updatedLayerId = data.updates.layerId === null ? undefined : ('layerId' in data.updates ? data.updates.layerId : p.layerId);
          return { ...p, ...data.updates, layerId: updatedLayerId };
        }));
        setIsDirty(false);
      });

      socket.on('pin-delete', (data: PinDeletePayload) => {
        if (data.mapId !== id) return;
        isRemoteUpdateRef.current = true;
        setPins(prev => prev.filter(p => p.id !== data.pinId));
        if (getHoveredPinId() === data.pinId) clearHoveredPin();
        setTargetPinId(prev => (prev === data.pinId ? null : prev));
        setEditingPinId(prev => (prev === data.pinId ? null : prev));
        setSelectedNavIds(prev => {
          if (prev.has(data.pinId)) {
            const next = new Set(prev);
            next.delete(data.pinId);
            return next;
          }
          return prev;
        });
        setIsDirty(false);
      });

      socket.on('pins-reorder', (data: PinsReorderPayload) => {
        if (data.mapId !== id) return;
        isRemoteUpdateRef.current = true;
        const targetLayerId = data.layerId === null ? undefined : data.layerId;
        setPins(prev => {
          const pinMap = new Map(prev.map(p => [p.id, p]));
          const reordered: Pin[] = [];
          data.pinOrder.forEach((pId, idx) => {
            const pin = pinMap.get(pId);
            if (pin) {
              reordered.push({
                ...pin,
                layerId: targetLayerId !== undefined ? targetLayerId : pin.layerId,
                position: idx
              });
              pinMap.delete(pId);
            }
          });
          return [...reordered, ...Array.from(pinMap.values())];
        });
        setIsDirty(false);
      });

      socket.on('pin-move-layer', (data: PinMoveLayerPayload) => {
        if (data.mapId !== id) return;
        isRemoteUpdateRef.current = true;
        const targetLayerId = data.targetLayerId === null ? undefined : data.targetLayerId;
        const sourceLayerId = data.sourceLayerId === null ? undefined : data.sourceLayerId;

        setPins(prev => {
          const pinMap = new Map(prev.map(p => [p.id, p]));
          // 1. Move the pins
          data.pinIds.forEach(pId => {
            const pin = pinMap.get(pId);
            if (pin) {
              pinMap.set(pId, { ...pin, layerId: targetLayerId });
            }
          });

          // 2. Apply destination ordering
          if (Array.isArray(data.destPinOrder)) {
            data.destPinOrder.forEach((pId, idx) => {
              const pin = pinMap.get(pId);
              if (pin) {
                pinMap.set(pId, { ...pin, layerId: targetLayerId, position: idx });
              }
            });
          }

          // 3. Apply source ordering
          if (Array.isArray(data.sourcePinOrder)) {
            data.sourcePinOrder.forEach((pId, idx) => {
              const pin = pinMap.get(pId);
              if (pin) {
                pinMap.set(pId, { ...pin, layerId: sourceLayerId, position: idx });
              }
            });
          }

          return Array.from(pinMap.values());
        });
        setIsDirty(false);
      });

      socket.on('layer-create', (data: LayerCreatePayload) => {
        if (data.mapId !== id) return;
        isRemoteUpdateRef.current = true;
        setLayers(prev => {
          if (prev.some(l => l.id === data.layer.id)) return prev;
          return [...prev, data.layer];
        });
        setIsDirty(false);
      });

      socket.on('layer-update', (data: LayerUpdatePayload) => {
        if (data.mapId !== id) return;
        isRemoteUpdateRef.current = true;
        setLayers(prev => prev.map(l => l.id === data.layerId ? { ...l, ...data.updates } : l));
        setIsDirty(false);
      });

      socket.on('layer-delete', (data: LayerDeletePayload) => {
        if (data.mapId !== id) return;
        isRemoteUpdateRef.current = true;
        setLayers(prev => prev.filter(l => l.id !== data.layerId));
        setSelectedNavIds(prev => {
          if (prev.has(data.layerId)) {
            const next = new Set(prev);
            next.delete(data.layerId);
            return next;
          }
          return prev;
        });
        setPins(prev => {
          const defaultPins = prev.filter(p => isSameLayer(p.layerId, undefined));
          let currentMaxPos = defaultPins.length > 0
            ? Math.max(...defaultPins.map(p => p.position))
            : -1;
          return prev.map(p => {
            if (p.layerId === data.layerId) {
              currentMaxPos += 1;
              return { ...p, layerId: undefined, position: currentMaxPos };
            }
            return p;
          });
        });
        setIsDirty(false);
      });

      socket.on('layers-reorder', (data: LayersReorderPayload) => {
        if (data.mapId !== id) return;
        isRemoteUpdateRef.current = true;
        setLayers(prev => {
          const layerMap = new Map(prev.map(l => [l.id, l]));
          const reordered: PinLayer[] = [];
          data.layerOrder.forEach((lId, idx) => {
            const layer = layerMap.get(lId);
            if (layer) {
              reordered.push({ ...layer, position: idx });
              layerMap.delete(lId);
            }
          });
          return [...reordered, ...Array.from(layerMap.values())];
        });
        setIsDirty(false);
      });

      socket.on('map-name-update', (data: MapNameUpdatePayload) => {
        if (data.mapId !== id) return;
        isRemoteUpdateRef.current = true;
        setMapName(data.name);
        setIsDirty(false);
      });

      socket.on('map-reloaded', (data: { mapId: string }) => {
        if (data.mapId !== id) return;
        loadMap(id, true);
      });

      socket.on('map-deleted', (data: { mapId: string }) => {
        if (data.mapId !== id) return;
        navigate('/', { replace: true });
      });

      return () => {
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
          autoSaveTimerRef.current = null;
        }
        if (autoSaveAbortRef.current) {
          autoSaveAbortRef.current.abort();
          autoSaveAbortRef.current = null;
        }
        if (pendingTransitionTimerRef.current) {
          clearTimeout(pendingTransitionTimerRef.current);
          pendingTransitionTimerRef.current = null;
        }
        socket.disconnect();
        socketRef.current = null;
      };
    } else {
      hasLoadedRef.current = false;
      isInitialLoadRef.current = false;
      // New map defaults
      setMapId(null);
      setMapName('My Map');
      setPins([]);
      setLayers([]);
      setUserRole('owner');
      setIsMapLoading(false);
    }
  }, [id, user]);

  // Auto-save logic
  useEffect(() => {
    if (userRole === 'view' || isMapLoading) return;
    
    if (isRemoteUpdateRef.current) {
      isRemoteUpdateRef.current = false;
      return;
    }

    if (isInitialLoadRef.current) {
        isInitialLoadRef.current = false;
        return;
    }

    // Don't auto-save empty new maps
    if (!mapId && pins.length === 0 && mapName === 'My Map') return;

    // For brand new maps without an ID, create the initial map via POST /api/maps
    if (!mapId) {
      setIsDirty(true);
      const timer = setTimeout(() => {
        handleSave();
      }, 1000);
      return () => clearTimeout(timer);
    }

    // When WebSocket is connected, mutations are already saved atomically to SQLite via realtime delta events.
    // We avoid triggering full-array HTTP PUT requests to prevent collaborative overwrites.
    const isSocketConnected = socketRef.current?.connected;
    if (isSocketConnected) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      setIsDirty(false);
      return;
    }

    // If socket is disconnected/offline, mark as dirty and debounce HTTP save fallback
    setIsDirty(true);
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      handleSave();
    }, 2000);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [mapName, pins, layers]);

  // Warn on browser-level navigation (tab close, refresh, address bar) when dirty
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Keep refs pointing at the latest values so the unmount cleanup isn't stale
  const isDirtyRef = useRef(false);
  const handleSaveRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);
  useEffect(() => { handleSaveRef.current = handleSave; });

  // Flush pending save when the component unmounts (e.g. user hits the back button)
  useEffect(() => {
    return () => {
      if (isDirtyRef.current) {
        handleSaveRef.current();
      }
    };
  }, []); // empty deps — cleanup only runs on unmount

  const reconcileOnReconnect = async (currentMapId: string) => {
    const epoch = ++loadEpochRef.current;
    try {
      const serverData = await apiService.getMap(currentMapId);
      if (epoch !== loadEpochRef.current) return;

      if (!isDirtyRef.current) {
        setOwner({ id: serverData.ownerId, name: serverData.ownerName, email: serverData.ownerEmail, picture: serverData.ownerPicture });
        setLayers(serverData.layers || []);
        setPins(serverData.pins || []);
        setUserRole(serverData.userRole || 'view');
        setPermissions(serverData.permissions || []);
        setIsDirty(false);
        pendingDeletedPinIdsRef.current.clear();
        pendingDeletedLayerIdsRef.current.clear();
        return;
      }

      // Merge offline local edits with server state without resurrecting deleted pins
      setPins(currentLocalPins => {
        const serverPinMap = new Map((serverData.pins || []).map(p => [p.id, p]));
        const localPinMap = new Map(currentLocalPins.map(p => [p.id, p]));
        const mergedPins: Pin[] = [];
        const deletedPinIds = pendingDeletedPinIdsRef.current;

        // 1. Keep server pins, applying local updates if modified while offline, unless locally deleted
        serverPinMap.forEach((serverPin, pinId) => {
          if (deletedPinIds.has(pinId)) {
            // Deleted locally while disconnected; inform server and do not resurrect
            socketRef.current?.emit('pin-delete', { mapId: currentMapId, pinId });
            return;
          }

          const localPin = localPinMap.get(pinId);
          if (localPin) {
            const isModified = !arePinsEqual(localPin, serverPin);
            if (isModified) {
              mergedPins.push(localPin);
              socketRef.current?.emit('pin-update', { mapId: currentMapId, pinId, updates: localPin });
            } else {
              mergedPins.push(serverPin);
            }
            localPinMap.delete(pinId);
          } else {
            // Pin added by collaborator while offline
            mergedPins.push(serverPin);
          }
        });

        // 2. Any remaining pins in localPinMap were created locally while offline
        localPinMap.forEach((newLocalPin) => {
          if (deletedPinIds.has(newLocalPin.id)) return;
          mergedPins.push(newLocalPin);
          socketRef.current?.emit('pin-create', { 
            mapId: currentMapId, 
            layerId: newLocalPin.layerId === undefined ? null : newLocalPin.layerId, 
            pin: newLocalPin 
          });
        });

        deletedPinIds.clear();
        return mergedPins;
      });

      // Merge layers
      setLayers(currentLocalLayers => {
        const serverLayerMap = new Map((serverData.layers || []).map(l => [l.id, l]));
        const localLayerMap = new Map(currentLocalLayers.map(l => [l.id, l]));
        const mergedLayers: PinLayer[] = [];
        const deletedLayerIds = pendingDeletedLayerIdsRef.current;

        serverLayerMap.forEach((serverLayer, layerId) => {
          if (deletedLayerIds.has(layerId)) {
            socketRef.current?.emit('layer-delete', { mapId: currentMapId, layerId });
            return;
          }

          const localLayer = localLayerMap.get(layerId);
          if (localLayer) {
            if (localLayer.name !== serverLayer.name || localLayer.position !== serverLayer.position) {
              mergedLayers.push(localLayer);
              socketRef.current?.emit('layer-update', { mapId: currentMapId, layerId, updates: localLayer });
            } else {
              mergedLayers.push(serverLayer);
            }
            localLayerMap.delete(layerId);
          } else {
            mergedLayers.push(serverLayer);
          }
        });

        localLayerMap.forEach((newLocalLayer) => {
          if (deletedLayerIds.has(newLocalLayer.id)) return;
          mergedLayers.push(newLocalLayer);
          socketRef.current?.emit('layer-create', { mapId: currentMapId, layer: newLocalLayer });
        });

        deletedLayerIds.clear();
        return mergedLayers;
      });

      setIsDirty(false);
    } catch (err) {
      console.error('[SOCKET] Reconnect reconciliation failed:', err);
    }
  };

  const loadMap = async (mapId: string, silent = false) => {
    const epoch = ++loadEpochRef.current;
    hasLoadedRef.current = true;
    setSelectedNavIds(new Set());
    setActiveOfflineMapId(mapId);
    void preloadExtract(mapId);

    // CRITICAL FOR OFFLINE MODE:
    // 1. Instant Offline Hydration: If an offline version of this map exists in IndexedDB,
    // immediately populate state and set isMapLoading(false) so the map, pins, layers, and bounds render instantly.
    // NEVER delay or block this behind online network calls (apiService.getMap), as offline users must get
    // interactive map rendering on frame 1 even if the network is disconnected or server is offline.
    let hasHydratedLocally = false;
    try {
      const cached = await getOfflineMap(mapId);
      if (epoch !== loadEpochRef.current) return;
      if (cached) {
        // If offline, only allow opening if the map is completely downloaded
        const currentlyOffline = isOfflineRef.current || (typeof navigator !== 'undefined' && !navigator.onLine) || readSessionFlag(OFFLINE_SESSION_KEY);
        const downloaded = await isMapDownloaded(mapId);
        if (epoch !== loadEpochRef.current) return;

        if (!currentlyOffline || downloaded) {
          hasHydratedLocally = true;
          isInitialLoadRef.current = true;
          setMapId(cached.id);
          setMapName(cached.name || 'My Map');
          setOwner({ id: cached.ownerId, name: cached.ownerName, email: cached.ownerEmail, picture: cached.ownerPicture });
          setLayers(cached.layers || []);
          setPins(cached.pins || []);
          setUserRole(cached.userRole || 'view');
          setPermissions(cached.permissions || []);
          if (cached.pins && cached.pins.length > 0) {
            if (!silent) {
              const lats = cached.pins.map(p => p.lat);
              const lngs = cached.pins.map(p => p.lng);
              const bounds: [[number, number], [number, number]] = [
                [Math.min(...lats), Math.min(...lngs)],
                [Math.max(...lats), Math.max(...lngs)]
              ];
              setBoundsToFit(bounds);
              setTimeout(() => setBoundsToFit(null), 3000);
            }
          }
          setIsMapLoading(false);
          if (!isOfflineRef.current) {
            setIsSyncing(true);
          }
        }
      }
    } catch (cacheErr) {
      console.warn('[APP] Instant offline cache hydration check error:', cacheErr);
    }

    if (!hasHydratedLocally && !silent) {
      setIsMapLoading(true);
    }

    // 2. Fetch latest map from network / revalidate
    try {
      const data = await apiService.getMap(mapId);
      if (epoch !== loadEpochRef.current) return;

      isInitialLoadRef.current = true;
      setMapId(data.id);
      setMapName(data.name || 'My Map');
      setOwner({ id: data.ownerId, name: data.ownerName, email: data.ownerEmail, picture: data.ownerPicture });
      setLayers(data.layers || []);
      setPins(data.pins);
      if (data.pins && data.pins.length > 0) {
        if (!hasHydratedLocally && !silent) {
          const lats = data.pins.map(p => p.lat);
          const lngs = data.pins.map(p => p.lng);
          const bounds: [[number, number], [number, number]] = [
            [Math.min(...lats), Math.min(...lngs)],
            [Math.max(...lats), Math.max(...lngs)]
          ];
          setBoundsToFit(bounds);
          setTimeout(() => setBoundsToFit(null), 3000);
        }
      }
      setUserRole(data.userRole || 'view');
      setPermissions(data.permissions || []);
      setIsDirty(false);
      setIsSyncing(false);
      // Item D: Successful network response exits offline mode if trapped by sessionStorage
      if (isOfflineRef.current) {
        applyOffline(false);
      }
    } catch (err) {
      if (epoch !== loadEpochRef.current) return;
      setIsSyncing(false);
      if (hasHydratedLocally) {
        applyOffline(true, true);
      } else {
        console.error('Failed to load map', err);
        setError('No Data');
        setTimeout(() => navigate('/'), 2000);
      }
    } finally {
      if (epoch === loadEpochRef.current) {
        setIsMapLoading(false);
      }
    }
  };

  const handleSave = async () => {
    if (userRole === 'view') return;
    setIsSaving(true);
    setError(null);

    // Cancel any previous in-flight save
    if (autoSaveAbortRef.current) {
      autoSaveAbortRef.current.abort();
    }
    const abortController = new AbortController();
    autoSaveAbortRef.current = abortController;

    try {
      if (mapId) {
        await apiService.updateMap(mapId, mapName, layers, pins, abortController.signal);
        setIsDirty(false);
      } else {
        const newId = generateId();
        hasLoadedRef.current = true;
        await apiService.createMap({ 
          id: newId, 
          name: mapName, 
          layers, 
          pins,
          ownerId: user?.id || '',
        });
        setIsDirty(false);
        setMapId(newId);
        navigate(`/map/${newId}`, { replace: true });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // Aborted because socket reconnected or newer save started; ignore
        return;
      }
      console.error('Failed to save map', err);
      setError('NOT Synced');
    } finally {
      if (autoSaveAbortRef.current === abortController) {
        autoSaveAbortRef.current = null;
      }
      setIsSaving(false);
    }
  };

  // Refresh permissions when opening the share dialog to ensure we have the latest list
  useEffect(() => {
    if (isSharing && mapId) {
      apiService.getMapPermissions(mapId)
        .then(data => {
          setPermissions(data.permissions || []);
          if (data.owner) setOwner(data.owner);
          if (data.userRole) setUserRole(data.userRole);
        })
        .catch(err => console.error('Failed to refresh permissions', err));
    }
  }, [isSharing, mapId]);

  const handleShare = async (email: string, role: 'view' | 'edit' | 'owner') => {
    if (!mapId) return;
    const res = await apiService.shareMap(mapId, email, role);
    if (role === 'owner') {
      const data = await apiService.getMapPermissions(mapId);
      setPermissions(data.permissions || []);
      if (data.owner) setOwner(data.owner);
      if (data.userRole) setUserRole(data.userRole);
    } else if (res?.userId) {
      setPermissions(prev => {
        const filtered = prev.filter(p => p.userId !== res.userId);
        return [...filtered, {
          userId: res.userId,
          userEmail: res.email || email,
          userName: res.userName || email,
          userPicture: res.userPicture,
          role: res.role || role
        }];
      });
    } else {
      const data = await apiService.getMapPermissions(mapId);
      setPermissions(data.permissions || []);
    }
  };

  const handleRemoveShare = async (userId: string) => {
    if (!mapId) return;
    await apiService.removeShare(mapId, userId);
    setPermissions(prev => prev.filter(p => p.userId !== userId));
  };

  const handlePinSelect = useCallback((pinId: string) => {
    if (Date.now() < ignoreMapClickUntil.current) return;
    // Clear stuck hover states on mobile/touch, or if a different pin was clicked
    clearHoveredPin();

    // Expand the collapsed layer containing this pin so the pin element is in the DOM
    const pin = pinsRef.current.find(p => p.id === pinId);
    if (pin) {
      const layerKey = pin.layerId || null;
      setCollapsedLayerIds(prev => {
        if (prev.has(layerKey)) {
          const next = new Set(prev);
          next.delete(layerKey);
          return next;
        }
        return prev;
      });
    }

    setTargetPinId(prev => {
      if (prev === pinId) {
        if (!isHoverBlockedRef.current && hasFinePointer()) {
          setHoveredPin(pinId);
        }
        return null;
      }
      return pinId;
    });
  }, []);

  const handlePinClick = useCallback((pin: Pin) => {
    handlePinSelect(pin.id);
  }, [handlePinSelect]);

  const handleSetEditingPinId = useCallback((id: string | null) => {
    setEditingPinId(id);
    if (id !== null) {
      setTargetPinId(id);
    } else {
      setTargetPinId(null);
    }
  }, []);

  const handleEditPin = useCallback((pin: Pin) => {
    const layerKey = pin.layerId || null;
    setCollapsedLayerIds(prev => {
      if (prev.has(layerKey)) {
        const next = new Set(prev);
        next.delete(layerKey);
        return next;
      }
      return prev;
    });
    handleSetEditingPinId(pin.id);
  }, [handleSetEditingPinId]);

  const handleHoverPin = useCallback((id: string | null, leavingPinId?: string) => {
    if (isHoverBlockedRef.current && id !== null) return;
    if (id !== null) {
      if (!hasFinePointer()) return;
      const target = targetPinIdRef.current;
      const editing = editingPinIdRef.current;
      if (target && pinsRef.current.some(p => p.id === target)) return;
      if (editing && pinsRef.current.some(p => p.id === editing)) return;
    }
    setHoveredPin(id, leavingPinId);
  }, []);

  const handleBackgroundClick = useCallback(() => {
    if (Date.now() < ignoreMapClickUntil.current) return;
    setTargetPinId(null);
    setEditingPinId(null);
    clearHoveredPin();
  }, []);

  const handleOpenShare = useCallback(() => setIsSharing(true), []);

  const handleToggleEditMode = useCallback((enabled: boolean) => {
    if (!canEditMap || isOffline) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (enabled) {
        next.delete('mode');
      } else {
        next.set('mode', 'view');
      }
      return next;
    }, { replace: true });
    if (!enabled) {
      setEditingPinId(null);
    }
  }, [canEditMap, isOffline, setSearchParams]);

  const getNextPinPosition = (allPins: Pin[], targetLayerId?: string): number => {
    const layerPins = allPins.filter(p => isSameLayer(p.layerId, targetLayerId));
    return layerPins.length > 0 ? Math.max(...layerPins.map(p => p.position)) + 1 : 0;
  };

  const addPinAtLocation = useCallback((lat: number, lng: number, label?: string, address?: string, autoEdit = false) => {
    if (!editMode || isOffline) return;
    const currentPins = pinsRef.current;
    const idVal = generateId();
    const nextPosition = getNextPinPosition(currentPins, undefined);
    const pinLabel = label || `Pin ${currentPins.length + 1}`;
    const newPin: Pin = {
      id: idVal,
      lat,
      lng,
      label: pinLabel,
      address,
      position: nextPosition
    };
    setPins(prev => [...prev, newPin]);
    if (autoEdit) {
      handleEditPin(newPin);
    } else {
      handlePinSelect(idVal);
    }

    if (mapId) {
      socketRef.current?.emit('pin-create', { mapId, layerId: newPin.layerId === undefined ? null : newPin.layerId, pin: newPin });
    }
  }, [editMode, isOffline, mapId, handleEditPin, handlePinSelect]);

  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (Date.now() < ignoreMapClickUntil.current || !editMode || isOffline) return;
    addPinAtLocation(lat, lng, undefined, undefined, true);
  }, [editMode, isOffline, addPinAtLocation]);

  const removePin = useCallback((targetId: string) => {
    if (!editMode || isOffline) return;
    const currentPins = pinsRef.current;

    const remainingPins = currentPins.filter(p => p.id !== targetId);
    setPins(remainingPins);

    if (getHoveredPinId() === targetId) clearHoveredPin();
    setTargetPinId(prev => (prev === targetId ? null : prev));
    setEditingPinId(prev => (prev === targetId ? null : prev));
    setSelectedNavIds(prev => {
      if (prev.has(targetId)) {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      }
      return prev;
    });

    const isSocketConnected = socketRef.current?.connected;
    if (mapId && isSocketConnected) {
      socketRef.current?.emit('pin-delete', { mapId, pinId: targetId });
    } else {
      pendingDeletedPinIdsRef.current.add(targetId);
    }
  }, [editMode, isOffline, mapId]);

  const updatePin = useCallback((targetId: string, updates: Partial<Pin>) => {
    if (!editMode || isOffline) return;
    
    const currentPins = pinsRef.current;
    const targetPin = currentPins.find(p => p.id === targetId);
    const originalLayerId = targetPin?.layerId;
    let computedUpdates = { ...updates };

    if ('layerId' in updates) {
      const targetLayerId = updates.layerId; // undefined = Default Layer
      const pinsInTargetLayer = currentPins.filter(p => p.id !== targetId && isSameLayer(p.layerId, targetLayerId));
      const endPosition = getNextPinPosition(pinsInTargetLayer, targetLayerId);
      computedUpdates = { ...updates, position: endPosition };
    }

    setPins(prev => prev.map(p => p.id === targetId ? { ...p, ...computedUpdates } : p));

    if (mapId) {
      if ('layerId' in updates) {
        const targetLayerId = updates.layerId;
        const updatedPins = currentPins.map(p => p.id === targetId ? { ...p, ...computedUpdates } : p);
        const startMap = new Map<string, string | undefined>([[targetId, originalLayerId]]);
        emitPinMoveOrReorderEvents(
          socketRef.current,
          mapId,
          updatedPins,
          [targetId],
          startMap,
          targetLayerId,
          originalLayerId
        );
      } else {
        socketRef.current?.emit('pin-update', { mapId, pinId: targetId, updates: computedUpdates });
      }
    }
  }, [editMode, isOffline, mapId]);

  const movePinsToLayer = useCallback((pinIds: string[], targetLayerId?: string) => {
    if (!editMode || isOffline || pinIds.length === 0) return;

    const currentPins = pinsRef.current;
    const pinIdSet = new Set(pinIds);
    const pinsToMove = currentPins.filter(p => pinIdSet.has(p.id));
    if (pinsToMove.length === 0) return;

    const startLayersMap = new Map<string, string | undefined>();
    pinsToMove.forEach(p => startLayersMap.set(p.id, p.layerId));

    const pinsInTargetLayer = currentPins.filter(p => !pinIdSet.has(p.id) && isSameLayer(p.layerId, targetLayerId));
    let nextPos = getNextPinPosition(pinsInTargetLayer, targetLayerId);

    const updatedPins = currentPins.map(p => {
      if (pinIdSet.has(p.id)) {
        const assignedPos = nextPos++;
        return { ...p, layerId: targetLayerId, position: assignedPos };
      }
      return p;
    });

    setPins(updatedPins);

    if (mapId) {
      emitPinMoveOrReorderEvents(
        socketRef.current,
        mapId,
        updatedPins,
        pinIds,
        startLayersMap,
        targetLayerId
      );
    }
  }, [editMode, isOffline, mapId]);

  const addLayer = useCallback((): PinLayer | undefined => {
    if (!editMode || isOffline) return;
    const newGroup: PinLayer = {
      id: generateId(),
      name: `Layer ${layers.length + 1}`,
      position: layers.length
    };
    setLayers(prev => [...prev, newGroup]);
    if (mapId) {
      socketRef.current?.emit('layer-create', { mapId, layer: newGroup });
    }
    return newGroup;
  }, [editMode, isOffline, layers.length, mapId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isOffline || !editMode) return;
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return;
        }
        e.preventDefault();
        const newLayer = addLayer();
        if (newLayer) {
          window.dispatchEvent(new CustomEvent('ourmaps:edit-layer', { detail: { layerId: newLayer.id } }));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [addLayer, isOffline, editMode]);

  const updateLayer = useCallback((targetId: string, updates: Partial<PinLayer>) => {
    if (!editModeRef.current || isOfflineRef.current) return;
    setLayers(prev => prev.map(g => g.id === targetId ? { ...g, ...updates } : g));
    const currentMapId = mapIdRef.current;
    if (currentMapId) {
      socketRef.current?.emit('layer-update', { mapId: currentMapId, layerId: targetId, updates });
    }
  }, []);

  const removeLayer = useCallback((targetId: string) => {
    if (!editModeRef.current || isOfflineRef.current) return;
    setLayers(prev => prev.filter(g => g.id !== targetId));

    setPins(prev => {
      const defaultPins = prev.filter(p => isSameLayer(p.layerId, undefined));
      let currentMaxPos = defaultPins.length > 0
        ? Math.max(...defaultPins.map(p => p.position))
        : -1;

      return prev.map(p => {
        if (p.layerId === targetId) {
          currentMaxPos += 1;
          return { ...p, layerId: undefined, position: currentMaxPos };
        }
        return p;
      });
    });

    const currentMapId = mapIdRef.current;
    const isSocketConnected = socketRef.current?.connected;
    if (currentMapId && isSocketConnected) {
      socketRef.current?.emit('layer-delete', { mapId: currentMapId, layerId: targetId });
    } else {
      pendingDeletedLayerIdsRef.current.add(targetId);
    }
  }, []);

  const handleMapNameChange = useCallback((newName: string) => {
    if (!editModeRef.current || isOfflineRef.current) return;
    setMapName(newName);
    const currentMapId = mapIdRef.current;
    if (currentMapId) {
      socketRef.current?.emit('map-name-update', { mapId: currentMapId, name: newName });
    }
  }, []);

  const handleDragStart = useCallback((event: any) => {
    if (!editModeRef.current || isOfflineRef.current) return;
    const currentPins = pinsRef.current;
    dragStartPinsRef.current = currentPins;
    const { active } = event;
    if (active.data.current?.type === 'pin') {
      const activeId = active.id as string;
      const selected = selectedNavIdsRef.current;
      const pinsToMoveIds = selected.has(activeId) 
        ? Array.from(selected) 
        : [activeId];
      
      const startMap = new Map<string, string | undefined>();
      pinsToMoveIds.forEach(id => {
        const p = currentPins.find(pin => pin.id === id);
        if (p) startMap.set(id, p.layerId);
      });
      dragStartLayersRef.current = startMap;
    }
  }, []);

  const handleDragCancel = useCallback(() => {
    if (dragStartPinsRef.current) {
      setPins(dragStartPinsRef.current);
      dragStartPinsRef.current = null;
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    if (!editModeRef.current || isOfflineRef.current) return;
    const { active, over } = event;
    
    if (!over) {
      if (dragStartPinsRef.current) {
        setPins(dragStartPinsRef.current);
        dragStartPinsRef.current = null;
      }
      return;
    }
    dragStartPinsRef.current = null;

    if (active.data.current?.type === 'layer') {
      const targetLayerId = over.id as string;
      if (targetLayerId === 'default') return;
      
      setLayers(prev => {
        const next = reorderLayers(prev, active.id as string, targetLayerId);
        const currentMapId = mapIdRef.current;
        if (currentMapId) {
          socketRef.current?.emit('layers-reorder', { mapId: currentMapId, layerOrder: next.map(l => l.id) });
        }
        return next;
      });
      return;
    }

    // Handle final reorder for pins
    if (active.data.current?.type === 'pin') {
      const activeId = active.id as string;
      const overData = over.data.current;
      const overLayerId = overData?.type === 'pin' ? overData.pin.layerId : (over.id === 'default' ? undefined : over.id as string);
      
      const startLayersMap = dragStartLayersRef.current;
      dragStartLayersRef.current = new Map();

      const originalLayerId = startLayersMap.get(activeId);

      const selected = selectedNavIdsRef.current;
      const pinsToMoveIds = selected.has(activeId) 
        ? Array.from(selected) 
        : [activeId];
      const currentMapId = mapIdRef.current;

      const next = reorderPins(
        pinsRef.current, 
        activeId, 
        over.id as string, 
        overData?.type === 'pin' ? 'pin' : 'layer',
        overLayerId,
        selected,
        collapsedLayerIdsRef.current
      );

      setPins(next);

      if (currentMapId) {
        emitPinMoveOrReorderEvents(
          socketRef.current,
          currentMapId,
          next,
          pinsToMoveIds,
          startLayersMap,
          overLayerId,
          originalLayerId
        );
      }
    }
  }, []);


  const handleImport = useCallback((data: Partial<MapData>) => {
    if (!editModeRef.current || isOfflineRef.current) return;
    if (data.name) setMapName(data.name);
    if (data.pins) {
      setPins(data.pins);
      if (data.pins.length > 0) {
        const lats = data.pins.map(p => p.lat);
        const lngs = data.pins.map(p => p.lng);
        const bounds: [[number, number], [number, number]] = [
          [Math.min(...lats), Math.min(...lngs)],
          [Math.max(...lats), Math.max(...lngs)]
        ];
        setBoundsToFit(bounds);
        setTimeout(() => setBoundsToFit(null), 1000);
      }
    }
    if (data.layers) setLayers(data.layers);
  }, []);

  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  const handleResize = useCallback((e: MouseEvent) => {
    if (Math.abs(e.clientX - resizerStartXRef.current) > 3) {
      isResizerDraggingRef.current = true;
    }
    const newWidth = clampSidebarWidth(e.clientX, window.innerWidth);
    sidebarWidthRef.current = newWidth;
    if (sheetRef.current) {
      sheetRef.current.style.width = `${newWidth}px`;
    }
  }, []);

  const stopResize = useCallback(() => {
    sheetRef.current?.classList.remove('sidebar-resizing');
    setSidebarWidth(sidebarWidthRef.current);
    setIsResizing(false);
    window.removeEventListener('mousemove', handleResize);
    window.removeEventListener('mouseup', stopResize);
  }, [handleResize]);

  const startResize = useCallback((e: React.MouseEvent) => {
    isResizerDraggingRef.current = false;
    resizerStartXRef.current = e.clientX;
    clearHoveredPin();
    sheetRef.current?.classList.add('sidebar-resizing');
    setIsResizing(true);
    window.addEventListener('mousemove', handleResize);
    window.addEventListener('mouseup', stopResize);
  }, [handleResize, stopResize]);

  const handleResizerClick = useCallback(() => {
    if (!isResizerDraggingRef.current) {
      setSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    }
  }, []);

  if (isMapLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-color)', userSelect: 'none', WebkitUserSelect: 'none' }}>
        <Loader2 size={64} className="animate-spin" style={{ color: 'var(--primary-color)', marginBottom: '1.5rem' }} />
        <h2 style={{ color: 'var(--primary-color)', fontWeight: '700' }}>Loading your map...</h2>
      </div>
    );
  }

  if (error === 'No Data') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-color)', color: 'var(--text-primary)' }}>
        <h2 style={{ color: 'var(--primary-color)', fontWeight: '700', marginBottom: '0.5rem' }}>No Data</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Unable to load map offline. Redirecting...</p>
      </div>
    );
  }

  const appHeader = (
    <header 
      ref={headerRef}
      style={{ 
        padding: '0.4rem 1rem', 
        background: 'var(--primary-color)', 
        color: 'white', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        boxShadow: 'var(--shadow-md)', 
        zIndex: 2500,
        flexShrink: 0
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', minWidth: 0, flexShrink: 1, userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }} onClick={() => navigate('/')}>
        <div style={{ display: 'flex', flexShrink: 0 }}>
          <MapIcon size={18} color={mapTheme === 'dark' ? '#cbd5e1' : 'white'} />
        </div>
        <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '800', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1, color: mapTheme === 'dark' ? '#cbd5e1' : 'white' }}>{mapName || 'Untitled Map'}</h1>
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto', flexShrink: 0 }}>
        <div id="download-pill-container" style={{ display: 'flex', alignItems: 'center' }}></div>
        <button 
            onClick={() => {
              if (editMode && error && !isOffline) {
                handleSave();
              }
            }}
            style={{ 
            background: 'rgba(255,255,255,0.1)', 
            padding: '3px 8px', 
            borderRadius: '50px',
            border: '1px solid rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: (isOffline || error) ? '#ffbdad' : (mapTheme === 'dark' ? '#cbd5e1' : 'white'),
            fontWeight: '600',
            whiteSpace: 'nowrap',
            cursor: (editMode && error && !isOffline) ? 'pointer' : 'default',
            outline: 'none',
            fontFamily: 'inherit',
            fontSize: '0.65rem'
          }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: (isOffline || error) ? '#ff4d4f' : (isSyncing || (editMode && (isSaving || isDirty)) ? '#ffcc00' : '#4ade80'), flexShrink: 0 }} />
            <span>
              {error ? error : (isOffline ? 'Offline' : (isSyncing ? 'Syncing' : (editMode && isSaving ? 'Saving' : (editMode && isDirty ? 'Pending' : 'Synced'))))}
            </span>
          </button>
        <div id="mobile-header-actions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '26px', minHeight: '26px', flexShrink: 0 }}></div>
      </div>
    </header>
  );

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', fontFamily: 'inherit', userSelect: isResizing ? 'none' : 'auto' }} className="app-container">
      {isMobile && appHeader}

      <div 
        ref={sheetRef}
        className={`${isMobile ? `mobile-bottom-sheet ${isDraggingSheet ? 'dragging' : ''}` : ''}${!isMobile && isResizing ? ' sidebar-resizing' : ''}`.trim()}
        style={isMobile ? { 
          height: `${sheetHeight}px`,
          background: 'var(--bg-color)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'visible'
        } : { width: `${sidebarWidth}px`, flexShrink: 0, display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 1000, background: 'var(--bg-color)', overflow: 'visible' }}
      >
        {isMobile && (
          <div 
            className="bottom-sheet-drag-handle" 
            onPointerDown={startSheetDrag}
            onPointerMove={onSheetDrag}
            onPointerUp={endSheetDrag}
            onPointerCancel={endSheetDrag}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              ignoreMapClickUntil.current = Date.now() + 450;
            }}
            style={{ zIndex: 10 }}
          >
            <div className="drag-pill" />
          </div>
        )}

        {!isMobile && appHeader}

        {!isMobile && (
          <div
            className={`resizer-handle ${isResizing ? 'resizing' : ''}`}
            onMouseDown={startResize}
            onClick={handleResizerClick}
            title="Drag to resize, click to reset"
          >
            <div className="drag-pill-vertical" />
          </div>
        )}

        <div style={{ 
          flex: 1, 
          minHeight: 0, 
          display: 'flex', 
          flexDirection: 'column', 
          overflow: 'hidden' 
        }}>
          <div style={(isMobile ? {
            zoom: mobileScale,
            flex: 1,
            minHeight: 0,
            height: `${(1 / mobileScale) * 100}%`,
            display: 'flex',
            flexDirection: 'column'
          } : {
            transform: 'scale(1.25)',
            transformOrigin: 'top left',
            width: `${(1 / 1.25) * 100}%`,
            height: `${(1 / 1.25) * 100}%`,
            flex: 'none',
            display: 'flex',
            flexDirection: 'column'
          }) as React.CSSProperties}>
            <Sidebar 
              isMobile={isMobile}
              mobileScale={mobileScale}
              isHoverBlocked={isHoverBlocked}
              isOffline={isOffline}
            mapId={mapId}
            mapName={mapName}
            onMapNameChange={handleMapNameChange}
            layers={layers}
            onAddLayer={addLayer}
            onUpdateLayer={updateLayer}
            onRemoveLayer={removeLayer}
            pins={pins}
            onAddPin={addPinAtLocation}
            onRemovePin={removePin}
            onPinClick={handlePinClick}
            onUpdatePin={updatePin}
            onMovePinsToLayer={movePinsToLayer}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
            onDragStart={handleDragStart}
            userRole={userRole}
            editMode={editMode}
            onToggleEditMode={handleToggleEditMode}
            onShare={handleOpenShare}
            onImport={handleImport}
            editingPinId={editingPinId}
            onSetEditingPinId={handleSetEditingPinId}
            onHoverPin={handleHoverPin}
            targetPinId={targetPinId}
            customColors={customColors}
            onAddCustomColor={addCustomColor}
            selectedNavIds={selectedNavIds}
            onToggleNavId={handleToggleNavId}
            onToggleNavIds={handleToggleNavIds}
            hiddenLayerIds={hiddenLayerIds}
            onToggleLayerVisibility={handleToggleLayerVisibility}
            collapsedLayerIds={collapsedLayerIds}
            onToggleExpand={handleToggleExpand}
            onHoverSearchResult={handleHoverSearchResult}
            mapTheme={mapTheme}
            onThemeChange={handleThemeChange}
            showSatellite={showSatellite}
            onToggleSatellite={handleToggleSatellite}
            showHillshade={showHillshade}
            onToggleHillshade={handleToggleHillshade}
            show3DTerrain={show3DTerrain}
            onToggle3DTerrain={handleToggle3DTerrain}
            show3DBuildings={show3DBuildings}
            onToggle3DBuildings={handleToggle3DBuildings}
            onSearchAreaStateChange={setSearchAreaState}
          />
        </div>
      </div>
    </div>



      <main style={{ flex: 1, position: 'relative', overflow: 'hidden', zIndex: 1 }}>
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: '100vw', minWidth: '100%' }}>
        {searchAreaState?.showPill && (
          <div
            style={{
              position: 'absolute',
              top: '16px',
              left: isMobile ? '50%' : `calc(${sidebarWidth}px + (100vw - ${sidebarWidth}px) / 2)`,
              transform: 'translateX(-50%)',
              zIndex: 1100,
              pointerEvents: 'auto',
            }}
          >
            <button
              onClick={searchAreaState.onSearchThisArea}
              disabled={searchAreaState.isSearching}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'var(--surface-color)',
                color: 'var(--primary-color)',
                border: '1px solid var(--border-color)',
                borderRadius: '50px',
                padding: '8px 18px',
                fontSize: '0.85rem',
                fontWeight: '600',
                boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              {searchAreaState.isSearching ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RotateCw size={14} />
              )}
              Search this area
            </button>
          </div>
        )}
        <MapView 
            mapId={mapId}
            pins={pins} 
            onMapClick={handleMapClick} 
            onPinClick={handlePinClick}
            onUpdatePin={updatePin}
            targetPinId={targetPinId}
            editingPinId={editingPinId}
            boundsToFit={boundsToFit}
            userRole={editMode ? userRole : 'view'}
            isOffline={isOffline}
            onHoverPin={handleHoverPin}
            onBackgroundClick={handleBackgroundClick}
            hiddenLayerIds={hiddenLayerIds}
            previewLocation={previewLocation}
            bottomPadding={isMobile ? sheetHeight : 0}
            leftPadding={isMobile ? 0 : sidebarWidth}
            mapTheme={mapTheme}
            showSatellite={showSatellite}
            showHillshade={showHillshade}
            show3DTerrain={show3DTerrain}
            show3DBuildings={show3DBuildings}
            hasOfflineTiles={hasOfflineTiles}
          />
        </div>
      </main>

      {isSharing && (
        <ShareDialog 
          isOpen={isSharing}
          onClose={() => setIsSharing(false)}
          onShare={handleShare}
          onRemoveShare={handleRemoveShare}
          permissions={permissions}
          owner={owner}
          currentUserId={user?.id || ''}
        />
      )}

    </div>
  );
}

const PrivateRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>Loading...</div>;
  }
  
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
};

function App() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || 'MOCK_CLIENT_ID';
  
  return (
    <GoogleOAuthProvider clientId={clientId}>
      <AuthProvider>
        <ThemeProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<PrivateRoute><LandingPage /></PrivateRoute>} />
              <Route path="/map/:id" element={<PrivateRoute><MapEditor /></PrivateRoute>} />
            </Routes>
          </BrowserRouter>
        </ThemeProvider>
      </AuthProvider>
    </GoogleOAuthProvider>
  )
}

export default App
