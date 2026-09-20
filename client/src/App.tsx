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
  MapNameUpdatePayload,
  CustomColorsUpdatePayload
} from '@shared/interfaces'

import type { DragEndEvent } from '@dnd-kit/core'
import { Loader2, Map as MapIcon, RotateCw } from 'lucide-react';
import type { SearchAreaState } from './components/SearchBar';
import { reorderPins, reorderLayers, isSameLayer, emitPinMoveOrReorderEvents, applyRemotePinsReorder, applyRemotePinMoveLayer } from './utils/reorderUtils';
import { generateId, mergeImportedMapData } from './utils/fileUtils';
import { getOfflineMap, isMapDownloaded, touchMapCacheAccess, saveMapToViewCache, clearMapMetadataCache } from './utils/tileUtils';
import { preloadExtract, setActiveOfflineMapId } from './utils/offlineExtract';
import { getStoredJson, setStoredJson, getStoredBoolean, setStoredBoolean } from './utils/storageUtils';
import { AUTO_VIEW_SESSION_KEY, OFFLINE_SESSION_KEY, readSessionFlag, writeSessionFlag } from './utils/offlineSession';

import { clearHoveredPin, getHoveredPinId, setHoveredPin, hasFinePointer, syncCoLocatedPins } from './utils/pinHover';
import { PIN_COLORS, nextTargetPinIdAfterClick } from './utils/mapUtils';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

export function clampSidebarWidth(width: number, viewportWidth: number, min = 200, maxMargin = 50): number {
  return Math.max(min, Math.min(viewportWidth - maxMargin, width));
}

const MOBILE_LAYOUT_MAX_WIDTH = 768;

function viewportIsMobile() {
  return window.innerWidth <= MOBILE_LAYOUT_MAX_WIDTH;
}

function viewportOrientation(): 'portrait' | 'landscape' {
  return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
}

function standardSheetHeight() {
  if (typeof window === 'undefined') return 300;
  return Math.min(350, Math.round(window.innerHeight * 0.45));
}

/** Returns the next available position value for a pin in the given layer. Single-pass, no spread. */
function getNextPinPosition(allPins: Pin[], targetLayerId?: string): number {
  let max = -1;
  for (const p of allPins) {
    if (isSameLayer(p.layerId, targetLayerId) && p.position > max) max = p.position;
  }
  return max + 1;
}

export function MapEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isLoading: isAuthLoading } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  
  const [pins, setPins] = useState<Pin[]>([])
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  syncCoLocatedPins(pins);
  const [layers, setLayers] = useState<PinLayer[]>([])
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const [mapId, setMapId] = useState<string | null>(id && id !== 'new' ? id : null);

  useEffect(() => {
    if (id === 'new' && !isAuthLoading && !user) {
      navigate('/login');
    }
  }, [id, isAuthLoading, user, navigate]);

  useLayoutEffect(() => {
    if (id && id !== 'new') {
      setActiveOfflineMapId(id);
      void preloadExtract(id);
    }
  }, [id]);
  const [mapName, setMapName] = useState(id === 'new' ? 'Unnamed Map' : '');
  const mapNameRef = useRef(mapName);
  mapNameRef.current = mapName;
  const [showTitleTooltip, setShowTitleTooltip] = useState(false);
  const [titleTooltipPos, setTitleTooltipPos] = useState({ top: 0, left: 0 });
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const titleLongPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleLongPressTriggeredRef = useRef(false);
  const titleTooltipTriggerRef = useRef<'hover' | 'touch' | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const [owner, setOwner] = useState<{ id: string, name?: string, email?: string, picture?: string } | null>(null);
  const [isMapLoading, setIsMapLoading] = useState(!!id && id !== 'new');
  const [userRole, setUserRole] = useState<'owner' | 'edit' | 'view'>('owner');
  const canEditMap = userRole !== 'view';
  const [isPublic, setIsPublic] = useState(false);
  const [permissions, setPermissions] = useState<MapPermission[]>([]);
  const [searchAreaState, setSearchAreaState] = useState<SearchAreaState | null>(null);
  
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const inFlightDeltaCountRef = useRef(0);
  const [isSharing, setIsSharing] = useState(false);
  const [targetPinId, setTargetPinId] = useState<string | null>(null);
  const [boundsToFit, setBoundsToFit] = useState<[[number, number], [number, number]] | null>(null);
  const [editingPinId, setEditingPinId] = useState<string | null>(null);

  const [previewLocation, setPreviewLocation] = useState<{lat: number, lng: number} | null>(null);
  const DEFAULT_SIDEBAR_WIDTH = 400;
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const isResizerDraggingRef = useRef(false);
  const resizerStartXRef = useRef(0);
  const resizerStartWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const resizerDragStartRef = useRef<{ x: number; width: number; time: number; moved: boolean }>({ x: 0, width: DEFAULT_SIDEBAR_WIDTH, time: 0, moved: false });

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
  const [isMobile, setIsMobile] = useState(viewportIsMobile);

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
  const [isInitialCreating, setIsInitialCreating] = useState(false);
  const editMode = canEditMap && !isOffline && searchParams.get('mode') !== 'view' && !isInitialCreating;

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
      // Cache only needed offline — clear on going online to keep memory bounded.
      clearMapMetadataCache();
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
    let lastOrientation = viewportOrientation();
    const syncViewportLayout = () => {
      const mobile = viewportIsMobile();
      const orientation = viewportOrientation();
      setIsMobile(mobile);
      setMobileScale(computeMobileScale());
      if (orientation !== lastOrientation) {
        lastOrientation = orientation;
        if (mobile) setSheetHeight(standardSheetHeight());
      }
    };
    const handleResize = () => {
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        syncViewportLayout();
        resizeRaf = null;
      });
    };
    const handleOrientation = () => {
      syncViewportLayout();
    };
    const handleOnline = () => applyOffline(false, true);
    const handleOffline = () => applyOffline(true, true);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          const s = socketRef.current;
          if (s && !s.connected) {
            setIsSyncing(true);
            s.connect();
          } else {
            // Socket still reports connected: MapView restores the canvas on
            // visibility/pageshow. A real drop reconnects and GETs via `connect`.
            setIsSyncing(false);
          }
        } else {
          setIsSyncing(false);
          applyOffline(true, true);
        }
      }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientation);
    window.screen?.orientation?.addEventListener?.('change', handleOrientation);
    window.visualViewport?.addEventListener('resize', handleResize);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      if (pendingTransitionTimerRef.current) {
        clearTimeout(pendingTransitionTimerRef.current);
        pendingTransitionTimerRef.current = null;
      }
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientation);
      window.screen?.orientation?.removeEventListener?.('change', handleOrientation);
      window.visualViewport?.removeEventListener('resize', handleResize);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [applyOffline]);

  const getStandardSheetHeight = standardSheetHeight;

  const [sheetHeight, setSheetHeight] = useState(standardSheetHeight);
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
  const [mobileControlsTarget, setMobileControlsTarget] = useState<HTMLDivElement | null>(null);
  const [isTrackingLocation, setIsTrackingLocation] = useState(false);
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
  
  const [customColors, setCustomColors] = useState<string[]>([]);
  const customColorsRef = useRef(customColors);
  customColorsRef.current = customColors;

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

  const emitDelta = useCallback((eventName: string, payload: any) => {
    if (!socketRef.current) return;
    inFlightDeltaCountRef.current++;
    setIsSaving(true);
    let resolved = false;

    const ackTimeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      inFlightDeltaCountRef.current = Math.max(0, inFlightDeltaCountRef.current - 1);
      if (inFlightDeltaCountRef.current === 0) {
        setIsSaving(false);
      }
    }, 3000);

    socketRef.current.emit(eventName, payload, (res?: any) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(ackTimeout);
      inFlightDeltaCountRef.current = Math.max(0, inFlightDeltaCountRef.current - 1);
      if (inFlightDeltaCountRef.current === 0) {
        setIsSaving(false);
      }
      if (res?.error) {
        console.error(`[SOCKET] Error acknowledging ${eventName}:`, res.error);
        setError('Sync error');
      }
    });
  }, []);

  const emitReorderDelta = useCallback((
    targetPins: Pin[],
    targetIds: string[],
    startMap: Map<string, string | undefined>,
    targetLayerId: string | undefined
  ) => {
    const currentMapId = mapIdRef.current;
    if (!currentMapId || !socketRef.current) return;

    inFlightDeltaCountRef.current++;
    setIsSaving(true);
    let resolved = false;
    const ackTimeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      inFlightDeltaCountRef.current = Math.max(0, inFlightDeltaCountRef.current - 1);
      if (inFlightDeltaCountRef.current === 0) setIsSaving(false);
    }, 3000);

    emitPinMoveOrReorderEvents(
      socketRef.current,
      currentMapId,
      targetPins,
      targetIds,
      startMap,
      targetLayerId,
      (res?: any) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(ackTimeout);
        inFlightDeltaCountRef.current = Math.max(0, inFlightDeltaCountRef.current - 1);
        if (inFlightDeltaCountRef.current === 0) setIsSaving(false);
        if (res?.error) {
          console.error(`[SOCKET] Error acknowledging pin reorder:`, res.error);
          setError('Sync error');
        }
      }
    );
  }, []);

  // Debounced POST /api/maps for brand-new maps that do not have an id yet
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createInFlightRef = useRef(false);

  // Request epoch to prevent stale loadMap or reconcileOnReconnect responses from overwriting fresh state
  const loadEpochRef = useRef(0);

  // Debounce transition between offline and online to prevent rapid flip-flopping
  const pendingTransitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track last applied value so duplicate applyOffline(same) calls skip re-rendering.
  const lastAppliedOfflineRef = useRef<boolean | null>(null);

  // Timer to clear boundsToFit after animation, cancellable on map change / unmount
  const boundsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerBoundsToFit = useCallback((bounds: [[number, number], [number, number]], delay = 3000) => {
    if (boundsTimerRef.current) {
      clearTimeout(boundsTimerRef.current);
      boundsTimerRef.current = null;
    }
    setBoundsToFit(bounds);
    boundsTimerRef.current = setTimeout(() => {
      setBoundsToFit(null);
      boundsTimerRef.current = null;
    }, delay);
  }, []);

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

  const addCustomColor = useCallback((color: string) => {
    const normalized = color.toLowerCase().trim();
    if (!normalized.startsWith('#')) return;
    if (PIN_COLORS.some(c => c.value.toLowerCase() === normalized)) return;

    setCustomColors(prev => {
      if (prev.some(c => c.toLowerCase() === normalized)) return prev;
      const next = [normalized, ...prev].slice(0, 10);
      const currentMapId = mapIdRef.current;
      if (currentMapId && userRoleRef.current !== 'view') {
        emitDelta('custom-colors-update', { mapId: currentMapId, customColors: next });
      }
      if (currentMapId) {
        getOfflineMap(currentMapId).then(cached => {
          if (cached) {
            saveMapToViewCache({ ...cached, customColors: next }).catch(() => {});
          }
        }).catch(() => {});
      }
      return next;
    });
  }, [emitDelta]);

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

      let isInitialConnect = true;

      // Reconnect re-sync handler
      socket.on('connect', () => {
        // Reset the in-flight delta counter: any deltas emitted before this
        // connect (or during a prior disconnected period) will never receive
        // their server acks, so the counter must be zeroed to prevent
        // isSaving from getting stuck true indefinitely.
        inFlightDeltaCountRef.current = 0;
        setIsInitialCreating(false);
        setIsSaving(false);
        applyOffline(false, true);
        if (id) {
          socket.emit('join-map', id);
          if (isInitialConnect) {
            isInitialConnect = false;
            setIsSyncing(false);
            return;
          }
          reconcileOnReconnect(id);
        } else {
          setIsSyncing(false);
        }
      });

      socket.on('connect_error', () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          return;
        }
        setIsSyncing(false);
        applyOffline(true, true);
      });

      socket.on('disconnect', (reason: string) => {
        // 'io client disconnect' is intentional (unmount/logout); ignore to avoid spurious offline flicker
        if (reason !== 'io client disconnect') {
          // If the page is hidden in the background (e.g. mobile lock or tab switch),
          // socket disconnect is standard OS power-saving behavior, not a network failure.
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
            return;
          }
          setIsSyncing(false);
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
        setPins(prev => applyRemotePinsReorder(prev, targetLayerId, data.pinIds || [], data.insertIndex));
        setIsDirty(false);
      });

      socket.on('pin-move-layer', (data: PinMoveLayerPayload) => {
        if (data.mapId !== id) return;
        isRemoteUpdateRef.current = true;
        const targetLayerId = data.targetLayerId === null ? undefined : data.targetLayerId;
        setPins(prev => applyRemotePinMoveLayer(prev, data.pinIds || [], targetLayerId, data.destInsertIndex));
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
          let currentMaxPos = defaultPins.reduce((m, p) => p.position > m ? p.position : m, -1);
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

      socket.on('custom-colors-update', (data: CustomColorsUpdatePayload) => {
        if (data.mapId !== id) return;
        isRemoteUpdateRef.current = true;
        setCustomColors(data.customColors || []);
        setIsDirty(false);
      });

      socket.on('map-deleted', (data: { mapId: string }) => {
        if (data.mapId !== id) return;
        navigate('/', { replace: true });
      });

      socket.on('map-access-revoked', (data: { mapId: string }) => {
        if (data.mapId !== id) return;
        alert('Your access to this map has been revoked.');
        navigate('/', { replace: true });
      });

      socket.on('map-role-updated', (data: { mapId: string; role: 'owner' | 'edit' | 'view' }) => {
        if (data.mapId !== id) return;
        setUserRole(data.role);
      });

      socket.on('map-public-updated', (data: { mapId: string; isPublic: boolean }) => {
        if (data.mapId !== id) return;
        setIsPublic(Boolean(data.isPublic));
      });

      return () => {
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
          autoSaveTimerRef.current = null;
        }
        if (pendingTransitionTimerRef.current) {
          clearTimeout(pendingTransitionTimerRef.current);
          pendingTransitionTimerRef.current = null;
        }
        socket.disconnect();
        socketRef.current = null;
      };
    } else {
      if (boundsTimerRef.current) {
        clearTimeout(boundsTimerRef.current);
        boundsTimerRef.current = null;
      }
      setBoundsToFit(null);
      hasLoadedRef.current = false;
      isInitialLoadRef.current = false;
      // New map defaults
      setMapId(null);
      setMapName('Unnamed Map');
      setPins([]);
      setLayers([]);
      setCustomColors([]);
      setUserRole('owner');
      setIsMapLoading(false);
    }
  }, [id, user]);

  // Create brand-new maps via POST /api/maps. Existing maps persist through socket deltas.
  useEffect(() => {
    if (!editMode || isMapLoading || mapId) return;

    if (isRemoteUpdateRef.current) {
      isRemoteUpdateRef.current = false;
      return;
    }

    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      return;
    }

    if (pins.length === 0 && layers.length === 0 && mapName === 'Unnamed Map') return;

    setIsDirty(true);
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    const debounceDuration = (pins.length > 0 || layers.length > 0) ? 50 : 1000;
    autoSaveTimerRef.current = setTimeout(() => {
      autoSaveTimerRef.current = null;
      handleSave();
    }, debounceDuration);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode, isMapLoading, mapId, mapName, pins, layers, customColors]);

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
      if (boundsTimerRef.current) {
        clearTimeout(boundsTimerRef.current);
        boundsTimerRef.current = null;
      }
      if (isDirtyRef.current) {
        handleSaveRef.current();
      }
    };
  }, []); // empty deps — cleanup only runs on unmount

  const reconcileOnReconnect = async (currentMapId: string) => {
    const epoch = ++loadEpochRef.current;
    setIsSyncing(true);
    try {
      const serverData = await apiService.getMap(currentMapId);
      if (epoch !== loadEpochRef.current) return;
      setLayers(serverData.layers || []);
      setPins(serverData.pins || []);
      setCustomColors(serverData.customColors || []);
      setUserRole(serverData.userRole || 'view');
      if (typeof serverData.isPublic === 'boolean') setIsPublic(serverData.isPublic);
    } catch (err) {
      console.error('[SOCKET] Reconnect reconciliation failed:', err);
    } finally {
      if (epoch === loadEpochRef.current) {
        setIsSyncing(false);
      }
    }
  };

  const loadMap = async (mapId: string, silent = false) => {
    const epoch = ++loadEpochRef.current;
    let redirectedToLogin = false;
    if (boundsTimerRef.current) {
      clearTimeout(boundsTimerRef.current);
      boundsTimerRef.current = null;
    }
    setBoundsToFit(null);
    hasLoadedRef.current = true;
    setSelectedNavIds(new Set());
    setActiveOfflineMapId(mapId);
    // Await preloadExtract before the Promise.all below so that extractCache is populated
    // before isMapDownloaded calls getExtractFile. Without this, isMapDownloaded and the
    // useLayoutEffect's preloadExtract both hit OPFS simultaneously (getExtractFile has no
    // inflight dedup), potentially delaying PMTiles readiness and causing zoom stutter.
    await preloadExtract(mapId);

    // CRITICAL FOR OFFLINE MODE:
    // 1. Instant Offline Hydration: If an offline version of this map exists in IndexedDB,
    // immediately populate state and set isMapLoading(false) so the map, pins, layers, and bounds render instantly.
    // NEVER delay or block this behind online network calls (apiService.getMap), as offline users must get
    // interactive map rendering on frame 1 even if the network is disconnected or server is offline.
    let hasHydratedLocally = false;
    try {
      // Compute offline status before the async fan-out so both branches see the same snapshot.
      const currentlyOffline = isOfflineRef.current || (typeof navigator !== 'undefined' && !navigator.onLine) || readSessionFlag(OFFLINE_SESSION_KEY);
      // Fetch cached map metadata and OPFS extract status in parallel — they are independent.
      const [cached, downloaded] = await Promise.all([
        getOfflineMap(mapId),
        isMapDownloaded(mapId),
      ]);
      if (epoch !== loadEpochRef.current) return;

      if (cached && (!currentlyOffline || downloaded)) {
        hasHydratedLocally = true;
        isInitialLoadRef.current = true;
        setMapId(cached.id);
        setMapName(cached.name || 'Unnamed Map');
        setLayers(cached.layers || []);
        setPins(cached.pins || []);
        setCustomColors(cached.customColors || []);
        setUserRole(cached.userRole || 'view');
        setIsPublic(Boolean(cached.isPublic));
        if (cached.pins && cached.pins.length > 0) {
          if (!silent) {
            let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
            for (const p of cached.pins) {
              if (p.lat < minLat) minLat = p.lat;
              if (p.lat > maxLat) maxLat = p.lat;
              if (p.lng < minLng) minLng = p.lng;
              if (p.lng > maxLng) maxLng = p.lng;
            }
            triggerBoundsToFit([[minLat, minLng], [maxLat, maxLng]], 3000);
          }
        }
        setIsMapLoading(false);
        if (!isOfflineRef.current) {
          setIsSyncing(true);
        }
        // Update LRU timestamp so this map isn't evicted from view cache prematurely
        touchMapCacheAccess(mapId).catch(() => {});
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
      setMapName(data.name || 'Unnamed Map');
      setLayers(data.layers || []);
      setPins(data.pins);
      setCustomColors(data.customColors || []);
      if (data.pins && data.pins.length > 0) {
        if (!hasHydratedLocally && !silent) {
          let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
          for (const p of data.pins) {
            if (p.lat < minLat) minLat = p.lat;
            if (p.lat > maxLat) maxLat = p.lat;
            if (p.lng < minLng) minLng = p.lng;
            if (p.lng > maxLng) maxLng = p.lng;
          }
          triggerBoundsToFit([[minLat, minLng], [maxLat, maxLng]], 3000);
        }
      }
      setUserRole(data.userRole || 'view');
      setIsPublic(Boolean(data.isPublic));
      setIsDirty(false);
      setIsSyncing(false);
      // Item D: Successful network response exits offline mode if trapped by sessionStorage
      if (isOfflineRef.current) {
        applyOffline(false);
      }
    } catch (err: any) {
      if (epoch !== loadEpochRef.current) return;
      setIsSyncing(false);
      const isAuthError = err?.message?.includes('Authentication required') || err?.message?.includes('Unauthorized');
      if (isAuthError || (!hasHydratedLocally && !user)) {
        redirectedToLogin = true;
        navigate('/login', { replace: true });
        return;
      }
      if (hasHydratedLocally) {
        applyOffline(true, true);
      } else {
        console.error('Failed to load map', err);
        setError('No Data');
        setTimeout(() => navigate('/'), 2000);
      }
    } finally {
      if (epoch === loadEpochRef.current && !redirectedToLogin) {
        setIsMapLoading(false);
      }
    }
  };

  const handleSave = async () => {
    if (userRoleRef.current === 'view') return;
    if (mapIdRef.current) return;
    if (createInFlightRef.current) return;

    createInFlightRef.current = true;
    setIsInitialCreating(true);
    setIsSaving(true);
    setError(null);

    try {
      const newId = generateId();
      hasLoadedRef.current = true;
      await apiService.createMap({
        id: newId,
        name: mapNameRef.current || 'Unnamed Map',
        layers: layersRef.current,
        pins: pinsRef.current,
        customColors: customColorsRef.current,
        ownerId: user?.id || '',
      });
      setIsDirty(false);
      setMapId(newId);
      navigate(`/map/${newId}`, { replace: true });
      setTimeout(() => {
        setIsInitialCreating(false);
        setIsSaving(false);
      }, 3000);
    } catch (err: any) {
      console.error('Failed to save map', err);
      setError('NOT Synced');
      setIsInitialCreating(false);
      setIsSaving(false);
    } finally {
      createInFlightRef.current = false;
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
          if (typeof data.isPublic === 'boolean') setIsPublic(data.isPublic);
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
        const exists = prev.some(p => p.userId === res.userId);
        if (exists) {
          return prev.map(p => p.userId === res.userId ? {
            ...p,
            userEmail: res.email || email,
            userName: res.userName || p.userName || email,
            userPicture: res.userPicture ?? p.userPicture,
            role: res.role || role
          } : p);
        }
        return [...prev, {
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

  const handleTogglePublic = async (newPublic: boolean) => {
    if (!mapId) return;
    const res = await apiService.updateMapPublic(mapId, newPublic);
    setIsPublic(Boolean(res.isPublic));
  };

  const handlePinSelect = useCallback((pinId: string, options?: { toggleSameLocation?: boolean }) => {
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
      const next = nextTargetPinIdAfterClick(prev, pinId, pinsRef.current, options);
      if (next === null && prev !== null) {
        if (!isHoverBlockedRef.current && hasFinePointer()) {
          setHoveredPin(pinId);
        }
      }
      return next;
    });
  }, []);

  const handlePinClick = useCallback((pin: Pin) => {
    handlePinSelect(pin.id, { toggleSameLocation: true });
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
      emitDelta('pin-create', { mapId, layerId: newPin.layerId === undefined ? null : newPin.layerId, pin: newPin });
    }
  }, [editMode, isOffline, mapId, handleEditPin, handlePinSelect, emitDelta]);

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

    if (mapId) {
      emitDelta('pin-delete', { mapId, pinId: targetId });
    }
  }, [editMode, isOffline, mapId, emitDelta]);

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
        emitReorderDelta(updatedPins, [targetId], startMap, targetLayerId);
      } else {
        emitDelta('pin-update', { mapId, pinId: targetId, updates: computedUpdates });
      }
    }
  }, [editMode, isOffline, mapId, emitDelta, emitReorderDelta]);

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
      emitReorderDelta(
        currentPins,
        pinIds,
        startLayersMap,
        targetLayerId
      );
    }
  }, [editMode, isOffline, mapId, emitReorderDelta]);

  const addLayer = useCallback((): PinLayer | undefined => {
    if (!editMode || isOffline) return;
    const newGroup: PinLayer = {
      id: generateId(),
      name: `Layer ${layers.length + 1}`,
      position: layers.length
    };
    setLayers(prev => [...prev, newGroup]);
    if (mapId) {
      emitDelta('layer-create', { mapId, layer: newGroup });
    }
    return newGroup;
  }, [editMode, isOffline, layers.length, mapId, emitDelta]);

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
      emitDelta('layer-update', { mapId: currentMapId, layerId: targetId, updates });
    }
  }, [emitDelta]);

  const removeLayer = useCallback((targetId: string) => {
    if (!editModeRef.current || isOfflineRef.current) return;
    setLayers(prev => prev.filter(g => g.id !== targetId));

    setPins(prev => {
      const defaultPins = prev.filter(p => isSameLayer(p.layerId, undefined));
      let currentMaxPos = defaultPins.reduce((m, p) => p.position > m ? p.position : m, -1);

      return prev.map(p => {
        if (p.layerId === targetId) {
          currentMaxPos += 1;
          return { ...p, layerId: undefined, position: currentMaxPos };
        }
        return p;
      });
    });

    const currentMapId = mapIdRef.current;
    if (currentMapId) {
      emitDelta('layer-delete', { mapId: currentMapId, layerId: targetId });
    }
  }, [emitDelta]);

  const handleMapNameChange = useCallback((newName: string) => {
    if (!editModeRef.current || isOfflineRef.current) return;
    setMapName(newName);
    const currentMapId = mapIdRef.current;
    if (currentMapId) {
      emitDelta('map-name-update', { mapId: currentMapId, name: newName });
    }
  }, [emitDelta]);

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
          emitDelta('layers-reorder', { mapId: currentMapId, layerOrder: next.map(l => l.id) });
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
        emitReorderDelta(
          next,
          pinsToMoveIds,
          startLayersMap,
          overLayerId
        );
      }
    }
  }, [emitDelta, emitReorderDelta]);


  const handleImport = useCallback((data: Partial<MapData>) => {
    if (!editModeRef.current || isOfflineRef.current) return;
    if (pinsRef.current.length > 0 || layersRef.current.length > 0) return;

    const merged = mergeImportedMapData(layersRef.current, pinsRef.current, data);
    if (merged.addedLayers.length === 0 && merged.addedPins.length === 0) {
      if (merged.skippedPins > 0 || merged.skippedLayers > 0) {
        alert('This map is full. Remove some pins or layers before importing.');
      }
      return;
    }

    setLayers(merged.layers);
    setPins(merged.pins);

    const currentName = mapNameRef.current;
    if (data.name && currentName === 'Unnamed Map') {
      setMapName(data.name);
    }

    const currentMapId = mapIdRef.current;
    if (currentMapId) {
      if (data.name && currentName === 'Unnamed Map') {
        emitDelta('map-name-update', { mapId: currentMapId, name: data.name });
      }
      merged.addedLayers.forEach(layer => {
        emitDelta('layer-create', { mapId: currentMapId, layer });
      });
      merged.addedPins.forEach(pin => {
        emitDelta('pin-create', {
          mapId: currentMapId,
          layerId: pin.layerId === undefined ? null : pin.layerId,
          pin,
        });
      });
    }

    if (merged.addedPins.length > 0) {
      let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
      for (const p of merged.addedPins) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLng) minLng = p.lng;
        if (p.lng > maxLng) maxLng = p.lng;
      }
      triggerBoundsToFit([[minLat, minLng], [maxLat, maxLng]], 1000);
    }

    if (merged.skippedPins > 0 || merged.skippedLayers > 0) {
      alert(`Imported ${merged.addedPins.length} pin(s). ${merged.skippedPins} pin(s) and ${merged.skippedLayers} layer(s) were skipped because of map size limits.`);
    }
  }, [triggerBoundsToFit, emitDelta]);

  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  const handleResize = useCallback((e: PointerEvent) => {
    const deltaX = e.clientX - resizerStartXRef.current;
    if (Math.abs(deltaX) > 3) {
      isResizerDraggingRef.current = true;
      resizerDragStartRef.current.moved = true;
    }
    // Delta-based: no jump regardless of where on the handle the user grabbed
    const newWidth = clampSidebarWidth(resizerStartWidthRef.current + deltaX, window.innerWidth, 0);
    sidebarWidthRef.current = newWidth;
    if (sheetRef.current) {
      sheetRef.current.style.width = `${newWidth}px`;
    }
  }, []);

  const stopResize = useCallback((e?: PointerEvent) => {
    sheetRef.current?.classList.remove('sidebar-resizing');

    const { x: startX, time: startTime, moved } = resizerDragStartRef.current;
    const endX = e?.clientX ?? startX;
    const elapsed = Math.max(1, Date.now() - startTime);
    const totalDeltaX = endX - startX; // positive = dragged RIGHT (wider), negative = dragged LEFT (narrower)
    const velocity = totalDeltaX / elapsed; // px per ms

    const maxW = clampSidebarWidth(window.innerWidth - 50, window.innerWidth, 0);

    let finalWidth: number;
    if (!moved || (elapsed < 200 && Math.abs(totalDeltaX) < 5)) {
      // Tap — handled by handleResizerClick; just keep current width
      finalWidth = sidebarWidthRef.current;
    } else if (elapsed >= 50 && velocity > 0.4) {
      // Fast flick RIGHT → maximize to fill available space
      finalWidth = maxW;
    } else if (elapsed >= 50 && velocity < -0.4) {
      // Fast flick LEFT → collapse completely
      finalWidth = 0;
    } else if (sidebarWidthRef.current < 60) {
      // Dragged to near-zero: snap closed
      finalWidth = 0;
    } else {
      finalWidth = sidebarWidthRef.current;
    }

    sidebarWidthRef.current = finalWidth;
    if (sheetRef.current) {
      sheetRef.current.style.width = `${finalWidth}px`;
    }
    setSidebarWidth(finalWidth);
    setIsResizing(false);
    window.removeEventListener('pointermove', handleResize);
    window.removeEventListener('pointerup', stopResize);
  }, [handleResize]);

  const startResize = useCallback((e: React.PointerEvent) => {
    isResizerDraggingRef.current = false;
    resizerStartXRef.current = e.clientX;
    resizerStartWidthRef.current = sidebarWidthRef.current;
    resizerDragStartRef.current = { x: e.clientX, width: sidebarWidthRef.current, time: Date.now(), moved: false };
    clearHoveredPin();
    sheetRef.current?.classList.add('sidebar-resizing');
    setIsResizing(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore in environments where pointer capture is unsupported
    }
    window.addEventListener('pointermove', handleResize);
    window.addEventListener('pointerup', stopResize);
  }, [handleResize, stopResize]);

  const handleResizerClick = useCallback(() => {
    if (!isResizerDraggingRef.current) {
      // Mirror portrait tap logic: collapse only if already at default width, else restore
      const isAtDefault = Math.abs(sidebarWidthRef.current - DEFAULT_SIDEBAR_WIDTH) <= 5;
      const newWidth = isAtDefault ? 0 : DEFAULT_SIDEBAR_WIDTH;
      sidebarWidthRef.current = newWidth;
      if (sheetRef.current) {
        sheetRef.current.style.width = `${newWidth}px`;
      }
      setSidebarWidth(newWidth);
    }
  }, []);

  const isTitleTruncated = useCallback(() => {
    const el = titleRef.current;
    if (!el) return false;
    return el.scrollWidth > el.clientWidth;
  }, []);

  const updateTitleTooltipPosition = useCallback(() => {
    const el = titleRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxTooltipWidth = Math.min(window.innerWidth - 32, 480);
    const left = Math.max(16, Math.min(rect.left, window.innerWidth - maxTooltipWidth - 16));
    const top = rect.bottom + 6;
    setTitleTooltipPos({ top, left });
  }, []);

  const clearTitleLongPress = useCallback(() => {
    if (titleLongPressTimerRef.current) {
      clearTimeout(titleLongPressTimerRef.current);
      titleLongPressTimerRef.current = null;
    }
  }, []);

  const handleTitleMouseEnter = useCallback(() => {
    if (!isTitleTruncated()) return;
    updateTitleTooltipPosition();
    titleTooltipTriggerRef.current = 'hover';
    setShowTitleTooltip(true);
  }, [isTitleTruncated, updateTitleTooltipPosition]);

  const handleTitleMouseLeave = useCallback(() => {
    if (titleTooltipTriggerRef.current === 'hover') {
      setShowTitleTooltip(false);
      titleTooltipTriggerRef.current = null;
    }
  }, []);

  const handleTitleTouchStart = useCallback((e: React.TouchEvent) => {
    clearTitleLongPress();
    titleLongPressTriggeredRef.current = false;
    if (!isTitleTruncated()) return;

    const touch = e.touches[0];
    if (touch) {
      touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };
    }

    titleLongPressTimerRef.current = setTimeout(() => {
      titleLongPressTriggeredRef.current = true;
      updateTitleTooltipPosition();
      titleTooltipTriggerRef.current = 'touch';
      setShowTitleTooltip(true);
    }, 450);
  }, [clearTitleLongPress, isTitleTruncated, updateTitleTooltipPosition]);

  const handleTitleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!titleLongPressTimerRef.current || !touchStartPosRef.current) return;
    const touch = e.touches[0];
    if (touch) {
      const dx = touch.clientX - touchStartPosRef.current.x;
      const dy = touch.clientY - touchStartPosRef.current.y;
      if (Math.hypot(dx, dy) > 10) {
        clearTitleLongPress();
      }
    }
  }, [clearTitleLongPress]);

  const handleTitleTouchEnd = useCallback(() => {
    clearTitleLongPress();
  }, [clearTitleLongPress]);

  const handleTitleClick = useCallback(() => {
    if (titleLongPressTriggeredRef.current) {
      titleLongPressTriggeredRef.current = false;
      return;
    }
    navigate('/');
  }, [navigate]);

  useEffect(() => {
    if (!showTitleTooltip) return;

    let autoDismissTimer: ReturnType<typeof setTimeout> | null = null;
    if (titleTooltipTriggerRef.current === 'touch') {
      autoDismissTimer = setTimeout(() => {
        setShowTitleTooltip(false);
        titleTooltipTriggerRef.current = null;
      }, 3500);
    }

    const handleDismiss = (e: Event) => {
      if (titleTooltipTriggerRef.current === 'hover' && e.type !== 'scroll') {
        return;
      }
      setShowTitleTooltip(false);
      titleTooltipTriggerRef.current = null;
    };

    window.addEventListener('pointerdown', handleDismiss);
    window.addEventListener('scroll', handleDismiss, true);
    window.addEventListener('resize', handleDismiss);

    return () => {
      if (autoDismissTimer) clearTimeout(autoDismissTimer);
      window.removeEventListener('pointerdown', handleDismiss);
      window.removeEventListener('scroll', handleDismiss, true);
      window.removeEventListener('resize', handleDismiss);
    };
  }, [showTitleTooltip]);

  useEffect(() => {
    return () => {
      clearTitleLongPress();
    };
  }, [clearTitleLongPress]);

  if (isMapLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: 'var(--bg-color)', userSelect: 'none', WebkitUserSelect: 'none' }}>
        <Loader2 size={64} className="animate-spin" style={{ color: 'var(--primary-color)', marginBottom: '1.5rem' }} />
        <h2 style={{ color: 'var(--primary-color)', fontWeight: '700' }}>Loading your map...</h2>
      </div>
    );
  }

  if (error === 'No Data') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100dvh', background: 'var(--bg-color)', color: 'var(--text-primary)' }}>
        <h2 style={{ color: 'var(--primary-color)', fontWeight: '700', marginBottom: '0.5rem' }}>No Data</h2>
        <p style={{ color: 'var(--text-secondary)' }}>Unable to load map offline. Redirecting...</p>
      </div>
    );
  }

  const appHeader = (
    <header 
      ref={headerRef}
      style={{ 
        position: 'relative',
        padding: '0.4rem 1rem', 
        background: 'var(--primary-color, #483D8B)', 
        color: 'white', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        boxShadow: 'var(--shadow-md)', 
        zIndex: 2500,
        flexShrink: 0
      }}>
      <div 
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', minWidth: 0, flexShrink: 1, overflow: 'hidden', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }} 
        onClick={handleTitleClick}
        onMouseEnter={handleTitleMouseEnter}
        onMouseLeave={handleTitleMouseLeave}
        onTouchStart={handleTitleTouchStart}
        onTouchEnd={handleTitleTouchEnd}
        onTouchCancel={handleTitleTouchEnd}
        onTouchMove={handleTitleTouchMove}
        onContextMenu={(e) => {
          if (titleLongPressTriggeredRef.current) {
            e.preventDefault();
          }
        }}
      >
        <div style={{ display: 'flex', flexShrink: 0 }}>
          <MapIcon size={18} color={mapTheme === 'dark' ? '#cbd5e1' : 'white'} />
        </div>
        <h1 
          ref={titleRef}
          style={{ margin: 0, fontSize: '1.1rem', fontWeight: '800', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1, color: mapTheme === 'dark' ? '#cbd5e1' : 'white' }}
        >
          {mapName || 'Untitled Map'}
        </h1>
      </div>

      {showTitleTooltip && (
        <div 
          className="map-title-tooltip"
          role="tooltip"
          style={{
            top: `${titleTooltipPos.top}px`,
            left: `${titleTooltipPos.left}px`,
          }}
        >
          {mapName || 'Untitled Map'}
        </div>
      )}
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto', flexShrink: 2, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 2, minWidth: 0, overflow: 'hidden' }}>
          <div id="download-pill-container" style={{ display: 'flex', alignItems: 'center', flexShrink: 1, minWidth: 0, overflow: 'hidden' }}></div>
          {Boolean(user) && (() => {
            const isDirtyOnNewMap = !mapId && (isDirty || pins.length > 0 || layers.length > 0 || (mapName && mapName !== 'Unnamed Map'));
            const syncStatus = error
              ? 'error'
              : isOffline
              ? 'offline'
              : (isSaving || isInitialCreating)
              ? 'saving'
              : isSyncing
              ? 'syncing'
              : isDirtyOnNewMap
              ? 'pending'
              : 'synced';

            const syncLabel = error
              ? error
              : isOffline
              ? 'Offline'
              : (isSaving || isInitialCreating)
              ? 'Saving'
              : isSyncing
              ? 'Syncing'
              : isDirtyOnNewMap
              ? 'Pending'
              : 'Synced';

            const dotColor = (isOffline || error)
              ? '#ff4d4f'
              : (syncStatus === 'saving' || syncStatus === 'syncing' || syncStatus === 'pending')
              ? '#ffcc00'
              : '#4ade80';

            return (
              <div style={{ flexShrink: 2, minWidth: 0, overflow: 'hidden' }}>
                <button 
                  data-testid="sync-status"
                  data-status={syncStatus}
                  data-edit-mode={editMode ? 'true' : 'false'}
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
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                  <span>{syncLabel}</span>
                </button>
              </div>
            );
          })()}
        </div>
        <div id="mobile-header-actions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '26px', minHeight: '26px', flexShrink: 0 }}></div>
      </div>
    </header>
  );

  return (
    <div style={{ display: 'flex', height: '100dvh', width: '100vw', overflow: 'hidden', fontFamily: 'inherit', userSelect: isResizing ? 'none' : 'auto' }} className="app-container">
      {isMobile && appHeader}

      <div 
        ref={sheetRef}
        className={`${isMobile ? `mobile-bottom-sheet ${isDraggingSheet ? 'dragging' : ''}` : `${isResizing ? 'sidebar-resizing' : 'sidebar-width-transition'}`}`.trim()}
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

        {isMobile && (
          <div 
            id="mobile-map-controls" 
            ref={setMobileControlsTarget}
            className="mobile-map-controls"
          />
        )}

        {/* Desktop: resizer handle protrudes at any sidebar width via position:absolute */}
        {!isMobile && (
          <div
            className={`resizer-handle ${isResizing ? 'resizing' : ''}`}
            onPointerDown={startResize}
            onClick={handleResizerClick}
            title="Drag to resize, click to reset"
          >
            <div className="drag-pill-vertical" />
          </div>
        )}

        {/* Desktop: header is a direct flex-column child of sheetRef; its width = sidebarWidth,
            so overflow:hidden clips all content automatically when sidebar collapses to 0 */}
        {!isMobile && appHeader}

        {/* Sidebar content */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={isMobile ? ({
            zoom: mobileScale,
            flex: 1,
            minHeight: 0,
            height: `${(1 / mobileScale) * 100}%`,
            display: 'flex',
            flexDirection: 'column'
          } as React.CSSProperties) : ({
            transform: 'scale(1.25)',
            transformOrigin: 'top left',
            width: `${(1 / 1.25) * 100}%`,
            height: `${(1 / 1.25) * 100}%`,
            flex: 'none',
            display: 'flex',
            flexDirection: 'column'
          } as React.CSSProperties)}>
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
              isAuthenticated={Boolean(user)}
              onSignIn={() => navigate('/login')}
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
              isTrackingLocation={isTrackingLocation}
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

      </div>{/* end sheetRef */}

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
            isMobile={isMobile}
            mobileControlsTarget={mobileControlsTarget}
            mapTheme={mapTheme}
            showSatellite={showSatellite}
            showHillshade={showHillshade}
            show3DTerrain={show3DTerrain}
            show3DBuildings={show3DBuildings}
            onLocationTrackingChange={setIsTrackingLocation}
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
          userRole={userRole}
          isPublic={isPublic}
          onTogglePublic={handleTogglePublic}
          mapId={mapId}
        />
      )}

    </div>
  );
}

const PrivateRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh' }}>Loading...</div>;
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
              <Route path="/map/:id" element={<MapEditor />} />
            </Routes>
          </BrowserRouter>
        </ThemeProvider>
      </AuthProvider>
    </GoogleOAuthProvider>
  )
}

export default App
