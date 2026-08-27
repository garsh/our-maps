import { useEffect, useState, useCallback, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import ShareDialog from './components/ShareDialog';
import { apiService } from './services/api'
import { reverseGeocode } from './utils/geocoding';
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
import { Loader2, Map as MapIcon, LogOut, RotateCw } from 'lucide-react';
import type { SearchAreaState } from './components/SearchBar';
import { reorderPins, reorderLayers, isSameLayer, comparePinPositions } from './utils/reorderUtils';
import { generateId } from './utils/fileUtils';
import { getManifestStats } from './utils/tileUtils';
import { tileWorkerManager } from './utils/tileWorkerManager';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

export function MapEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  
  const [pins, setPins] = useState<Pin[]>([])
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const [layers, setLayers] = useState<PinLayer[]>([])
  const [mapId, setMapId] = useState<string | null>(id && id !== 'new' ? id : null);
  const [mapName, setMapName] = useState(id === 'new' ? 'My Map' : '');
  const [owner, setOwner] = useState<{ id: string, name?: string, email?: string, picture?: string } | null>(null);
  const [isMapLoading, setIsMapLoading] = useState(!!id && id !== 'new');
  const [userRole, setUserRole] = useState<'owner' | 'edit' | 'view'>('owner');
  const [permissions, setPermissions] = useState<MapPermission[]>([]);
  const [searchAreaState, setSearchAreaState] = useState<SearchAreaState | null>(null);
  
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [showSignOutDialog, setShowSignOutDialog] = useState(false);
  const [targetLocation, setTargetLocation] = useState<[number, number] | null>(null);
  const [targetPinId, setTargetPinId] = useState<string | null>(null);
  const [boundsToFit, setBoundsToFit] = useState<[[number, number], [number, number]] | null>(null);
  const [editingPinId, setEditingPinId] = useState<string | null>(null);
  const [mapBounds, setMapBounds] = useState<string | null>(null);
  const [hasOfflineTiles, setHasOfflineTiles] = useState(false);
  const [previewLocation, setPreviewLocation] = useState<{lat: number, lng: number} | null>(null);
  const DEFAULT_SIDEBAR_WIDTH = 400;
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const isResizerDraggingRef = useRef(false);
  const resizerStartXRef = useRef(0);

  const { theme: mapTheme, setTheme: handleThemeChange } = useTheme();

  const [showHillshade, setShowHillshade] = useState<boolean>(() => {
    const saved = localStorage.getItem('ourmaps_hillshade');
    return saved !== null ? saved === 'true' : true;
  });

  const handleToggleHillshade = (enabled: boolean) => {
    setShowHillshade(enabled);
    localStorage.setItem('ourmaps_hillshade', String(enabled));
  };

  const [show3DTerrain, setShow3DTerrain] = useState<boolean>(() => {
    const saved = localStorage.getItem('ourmaps_3d_terrain');
    if (saved !== null) return saved === 'true';
    const legacy = localStorage.getItem('ourmaps_3d');
    return legacy !== null ? legacy === 'true' : true;
  });

  const handleToggle3DTerrain = (enabled: boolean) => {
    setShow3DTerrain(enabled);
    localStorage.setItem('ourmaps_3d_terrain', String(enabled));
  };

  const [show3DBuildings, setShow3DBuildings] = useState<boolean>(() => {
    const saved = localStorage.getItem('ourmaps_3d_buildings');
    if (saved !== null) return saved === 'true';
    const legacy = localStorage.getItem('ourmaps_3d');
    return legacy !== null ? legacy === 'true' : true;
  });

  const handleToggle3DBuildings = (enabled: boolean) => {
    setShow3DBuildings(enabled);
    localStorage.setItem('ourmaps_3d_buildings', String(enabled));
  };

  const [showSatellite, setShowSatellite] = useState<boolean>(() => {
    const saved = localStorage.getItem('ourmaps_satellite');
    return saved !== null ? saved === 'true' : false;
  });

  const handleToggleSatellite = (enabled: boolean) => {
    setShowSatellite(enabled);
    localStorage.setItem('ourmaps_satellite', String(enabled));
  };

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

  const [isOffline, setIsOffline] = useState(!navigator.onLine);

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
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('resize', handleResize);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const [sheetHeight, setSheetHeight] = useState(300);
  const [isDraggingSheet, setIsDraggingSheet] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const sheetDragStart = useRef<{ y: number; height: number; time: number; moved: boolean }>({ y: 0, height: 300, time: 0, moved: false });
  const currentDragHeight = useRef<number>(300);
  const rafId = useRef<number | null>(null);
  const ignoreMapClickUntil = useRef<number>(0);

  const getSheetBounds = () => {
    const headerHeight = headerRef.current ? headerRef.current.getBoundingClientRect().height : 44;
    const handleHeight = 28;
    const maxH = Math.max(100, window.innerHeight - headerHeight - handleHeight);
    const minH = 0;
    return { minH, maxH };
  };

  const startSheetDrag = (e: React.PointerEvent) => {
    e.stopPropagation();
    ignoreMapClickUntil.current = Date.now() + 450;
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
    const { minH, maxH } = getSheetBounds();
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

    const { minH, maxH } = getSheetBounds();
    let finalH = currentDragHeight.current;

    if (!sheetDragStart.current.moved || (elapsed < 200 && Math.abs(totalDeltaY) < 5)) {
      // Toggle collapsed (0) vs open on tap
      if (sheetHeight < 30) {
        finalH = Math.min(350, Math.round(window.innerHeight * 0.45));
      } else {
        finalH = minH;
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



  const [hoveredPinId, setHoveredPinId] = useState<string | null>(null);
  const [selectedNavIds, setSelectedNavIds] = useState<Set<string>>(new Set());
  const [hiddenLayerIds, setHiddenLayerIds] = useState<Set<string | null>>(() => {
    const mapIdVal = id || null;
    if (mapIdVal) {
      const savedVisibility = localStorage.getItem(`ourmaps_visibility_${mapIdVal}`);
      if (savedVisibility) {
        return new Set(JSON.parse(savedVisibility));
      }
    }
    return new Set();
  });
  const [collapsedLayerIds, setCollapsedLayerIds] = useState<Set<string | null>>(() => {
    const mapIdVal = id || null;
    if (mapIdVal) {
      const savedCollapsed = localStorage.getItem(`ourmaps_collapsed_${mapIdVal}`);
      if (savedCollapsed) {
        return new Set(JSON.parse(savedCollapsed));
      }
    }
    return new Set();
  });
  
  const [customColors, setCustomColors] = useState<string[]>(() => {
    const saved = localStorage.getItem('customColors');
    return saved ? JSON.parse(saved) : [];
  });

  // Load persistent UI state when mapId changes
  useEffect(() => {
    if (mapId) {
      const savedVisibility = localStorage.getItem(`ourmaps_visibility_${mapId}`);
      if (savedVisibility) {
        setHiddenLayerIds(new Set(JSON.parse(savedVisibility)));
      } else {
        setHiddenLayerIds(new Set());
      }

      const savedCollapsed = localStorage.getItem(`ourmaps_collapsed_${mapId}`);
      if (savedCollapsed) {
        setCollapsedLayerIds(new Set(JSON.parse(savedCollapsed)));
      } else {
        setCollapsedLayerIds(new Set()); // All layers expanded by default on a new device
      }
    }
  }, [mapId]);

  // Persist visibility changes
  useEffect(() => {
    if (mapId) {
      localStorage.setItem(`ourmaps_visibility_${mapId}`, JSON.stringify(Array.from(hiddenLayerIds)));
    }
  }, [hiddenLayerIds, mapId]);

  // Persist collapse changes
  useEffect(() => {
    if (mapId) {
      localStorage.setItem(`ourmaps_collapsed_${mapId}`, JSON.stringify(Array.from(collapsedLayerIds)));
    }
  }, [collapsedLayerIds, mapId]);

  useEffect(() => {
    localStorage.setItem('customColors', JSON.stringify(customColors));
  }, [customColors]);

  // Track offline tile status for the currently open map
  useEffect(() => {
    if (!mapId) {
      setHasOfflineTiles(false);
      return;
    }

    getManifestStats(mapId).then((stats) => {
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
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
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

      // Setup Socket
      const socket = io(SOCKET_URL, {
        path: '/socket.io',
        transports: ['websocket', 'polling']
      });
      socketRef.current = socket;

      socket.emit('join-map', id);

      let isInitialConnect = true;

      // Reconnect re-sync handler
      socket.on('connect', () => {
        console.log('[SOCKET] Connected to server, re-syncing map data');
        if (id) {
          socket.emit('join-map', id);
          if (isInitialConnect) {
            isInitialConnect = false;
            return;
          }
          reconcileOnReconnect(id);
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
  }, [id]);

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
      setIsDirty(false);
      return;
    }

    // If socket is disconnected/offline, mark as dirty and debounce HTTP save fallback
    setIsDirty(true);
    const timer = setTimeout(() => {
      handleSave();
    }, 2000);

    return () => clearTimeout(timer);
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
    try {
      const serverData = await apiService.getMap(currentMapId);
      if (!isDirtyRef.current) {
        setOwner({ id: serverData.ownerId, name: serverData.ownerName, email: serverData.ownerEmail, picture: serverData.ownerPicture });
        setLayers(serverData.layers || []);
        setPins(serverData.pins || []);
        setUserRole(serverData.userRole || 'view');
        setPermissions(serverData.permissions || []);
        setIsDirty(false);
        return;
      }

      // Merge offline local edits with server state without resurrecting deleted pins
      setPins(currentLocalPins => {
        const serverPinMap = new Map((serverData.pins || []).map(p => [p.id, p]));
        const localPinMap = new Map(currentLocalPins.map(p => [p.id, p]));
        const mergedPins: Pin[] = [];

        // 1. Keep server pins, applying local updates if modified while offline
        serverPinMap.forEach((serverPin, pinId) => {
          const localPin = localPinMap.get(pinId);
          if (localPin) {
            const isModified = JSON.stringify(localPin) !== JSON.stringify(serverPin);
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
          mergedPins.push(newLocalPin);
          socketRef.current?.emit('pin-create', { 
            mapId: currentMapId, 
            layerId: newLocalPin.layerId === undefined ? null : newLocalPin.layerId, 
            pin: newLocalPin 
          });
        });

        return mergedPins;
      });

      // Merge layers
      setLayers(currentLocalLayers => {
        const serverLayerMap = new Map((serverData.layers || []).map(l => [l.id, l]));
        const localLayerMap = new Map(currentLocalLayers.map(l => [l.id, l]));
        const mergedLayers: PinLayer[] = [];

        serverLayerMap.forEach((serverLayer, layerId) => {
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
          mergedLayers.push(newLocalLayer);
          socketRef.current?.emit('layer-create', { mapId: currentMapId, layer: newLocalLayer });
        });

        return mergedLayers;
      });

      setIsDirty(false);
    } catch (err) {
      console.error('[SOCKET] Reconnect reconciliation failed:', err);
    }
  };

  const loadMap = async (mapId: string, silent = false) => {
    if (!silent) {
      setIsMapLoading(true);
    }
    hasLoadedRef.current = true;
    setSelectedNavIds(new Set());
    try {
      const data = await apiService.getMap(mapId);
      isInitialLoadRef.current = true;
      setMapId(data.id);
      setMapName(data.name || 'My Map');
      setOwner({ id: data.ownerId, name: data.ownerName, email: data.ownerEmail, picture: data.ownerPicture });
      setLayers(data.layers || []);
      setPins(data.pins);
      if (data.pins && data.pins.length > 0 && !silent) {
        const lats = data.pins.map(p => p.lat);
        const lngs = data.pins.map(p => p.lng);
        const bounds: [[number, number], [number, number]] = [
          [Math.min(...lats), Math.min(...lngs)],
          [Math.max(...lats), Math.max(...lngs)]
        ];
        setBoundsToFit(bounds);
        setTimeout(() => setBoundsToFit(null), 3000);
      }
      setUserRole(data.userRole || 'view');
      setPermissions(data.permissions || []);
      setIsDirty(false);
    } catch (err) {
      console.error('Failed to load map', err);
      setError('Map not found or access denied');
      setTimeout(() => navigate('/'), 2000);
    } finally {
      if (!silent) {
        setIsMapLoading(false);
      }
    }
  };

  const handleSave = async () => {
    if (userRole === 'view') return;
    setIsSaving(true);
    setError(null);
    try {
      if (mapId) {
        await apiService.updateMap(mapId, mapName, layers, pins);
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
    } catch (err) {
      console.error('Failed to save map', err);
      setError('Changes NOT synced');
    } finally {
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
    await apiService.shareMap(mapId, email, role);
    const data = await apiService.getMapPermissions(mapId);
    setPermissions(data.permissions || []);
    if (data.owner) setOwner(data.owner);
    if (data.userRole) setUserRole(data.userRole);
  };

  const handleRemoveShare = async (userId: string) => {
    if (!mapId) return;
    await apiService.removeShare(mapId, userId);
    setPermissions(prev => prev.filter(p => p.userId !== userId));
  };

  const handlePinSelect = useCallback((pinId: string) => {
    if (Date.now() < ignoreMapClickUntil.current) return;
    // Clear stuck hover states on mobile/touch, or if a different pin was clicked
    setHoveredPinId(null);

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

    setTargetPinId(prev => prev === pinId ? null : pinId);
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
    handleSetEditingPinId(pin.id);
  }, [handleSetEditingPinId]);

  const handleHoverPin = useCallback((id: string | null, leavingPinId?: string) => {
    if (id === null) {
      if (leavingPinId) {
        setHoveredPinId(prev => (prev === leavingPinId ? null : prev));
      } else {
        setHoveredPinId(null);
      }
      return;
    }
    // If a card is open, don't allow other pins to be highlighted by hover
    if (targetPinId !== null || editingPinId !== null) {
      return;
    }
    setHoveredPinId(id);
  }, [targetPinId, editingPinId]);

  const handleBackgroundClick = useCallback(() => {
    if (Date.now() < ignoreMapClickUntil.current) return;
    setTargetPinId(null);
    setEditingPinId(null);
    setHoveredPinId(null);
  }, []);

  const getNextPinPosition = (allPins: Pin[], targetLayerId?: string): number => {
    const layerPins = allPins.filter(p => isSameLayer(p.layerId, targetLayerId));
    return layerPins.length > 0 ? Math.max(...layerPins.map(p => p.position)) + 1 : 0;
  };

  const addPinAtLocation = useCallback(async (lat: number, lng: number, label?: string, address?: string, autoEdit = false) => {
    if (userRole === 'view' || isOffline) return;
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

    if (!address) {
      const fetchedAddress = await reverseGeocode(lat, lng);
      if (fetchedAddress) {
        setPins(prev => {
          const existing = prev.find(p => p.id === idVal);
          if (!existing || existing.address || existing.lat !== lat || existing.lng !== lng) {
            return prev;
          }
          if (mapId) {
            socketRef.current?.emit('pin-update', { mapId, pinId: idVal, updates: { address: fetchedAddress } });
          }
          return prev.map(p => p.id === idVal ? { ...p, address: fetchedAddress } : p);
        });
      }
    }
  }, [userRole, isOffline, mapId, handleEditPin, handlePinSelect]);

  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (Date.now() < ignoreMapClickUntil.current || userRole === 'view' || isOffline) return;
    addPinAtLocation(lat, lng, undefined, undefined, true);
  }, [userRole, isOffline, addPinAtLocation]);

  const removePin = useCallback((targetId: string) => {
    if (userRole === 'view' || isOffline) return;
    const currentPins = pinsRef.current;

    const remainingPins = currentPins.filter(p => p.id !== targetId);
    setPins(remainingPins);

    if (mapId) {
      socketRef.current?.emit('pin-delete', { mapId, pinId: targetId });
    }
  }, [userRole, isOffline, mapId]);

  const updatePin = useCallback((targetId: string, updates: Partial<Pin>) => {
    if (userRole === 'view' || isOffline) return;
    
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
        
        const destLayerPins = updatedPins.filter(p => isSameLayer(p.layerId, targetLayerId)).sort(comparePinPositions);
        const sourceLayerPins = !isSameLayer(originalLayerId, targetLayerId)
          ? updatedPins.filter(p => isSameLayer(p.layerId, originalLayerId)).sort(comparePinPositions)
          : undefined;

        socketRef.current?.emit('pin-move-layer', {
          mapId,
          pinIds: [targetId],
          targetLayerId: targetLayerId === undefined ? null : targetLayerId,
          destPinOrder: destLayerPins.map(p => p.id),
          sourceLayerId: originalLayerId === undefined ? null : originalLayerId,
          sourcePinOrder: sourceLayerPins?.map(p => p.id),
        });
      } else {
        socketRef.current?.emit('pin-update', { mapId, pinId: targetId, updates: computedUpdates });
      }
    }
  }, [userRole, isOffline, mapId]);

  const addLayer = useCallback((): PinLayer | undefined => {
    if (userRole === 'view' || isOffline) return;
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
  }, [userRole, isOffline, layers.length, mapId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isOffline || userRole === 'view') return;
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
  }, [addLayer, isOffline, userRole]);

  const updateLayer = (targetId: string, updates: Partial<PinLayer>) => {
    if (userRole === 'view' || isOffline) return;
    setLayers(prev => prev.map(g => g.id === targetId ? { ...g, ...updates } : g));
    if (mapId) {
      socketRef.current?.emit('layer-update', { mapId, layerId: targetId, updates });
    }
  };

  const removeLayer = (targetId: string) => {
    if (userRole === 'view' || isOffline) return;
    const remainingLayers = layers.filter(g => g.id !== targetId);
    setLayers(remainingLayers);

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

    if (mapId) {
      socketRef.current?.emit('layer-delete', { mapId, layerId: targetId });
    }
  };

  const handleMapNameChange = (newName: string) => {
    if (userRole === 'view' || isOffline) return;
    setMapName(newName);
    if (mapId) {
      socketRef.current?.emit('map-name-update', { mapId, name: newName });
    }
  };

  const handleDragOver = (event: any) => {
    if (userRole === 'view' || isOffline) return;
    const { active, over } = event;
    if (!over) return;

    if (active.data.current?.type === 'pin') {
      const activeId = active.id as string;
      const overId = over.id as string;
      const overData = over.data.current;

      const activePin = pins.find(p => p.id === activeId);
      if (!activePin) return;

      let newLayerId: string | undefined = activePin.layerId;
      if (overData?.type === 'layer' || overId === 'default') {
        newLayerId = overId === 'default' ? undefined : (overData?.layer?.id || overId);
      } else if (overData?.type === 'pin') {
        newLayerId = overData.pin.layerId;
      }

      // ONLY update state in onDragOver if the layer actually changed (moving between layers)
      // This provides immediate visual feedback of layer changes.
      // We prevent moving into collapsed layers during drag to avoid unmounting the active item.
      if (newLayerId !== activePin.layerId && !collapsedLayerIds.has(newLayerId || null)) {
        setPins((prevPins) => {
          const pinsToMoveIds = selectedNavIds.has(activeId) 
            ? Array.from(selectedNavIds) 
            : [activeId];
          
          const movedPins = pinsToMoveIds.map(id => prevPins.find(p => p.id === id)).filter(Boolean) as Pin[];
          const otherPins = prevPins.filter(p => !pinsToMoveIds.includes(p.id));
          
          // Move the bundle to the new layer (just append to end during hover for visual feedback)
          const updatedMovedPins = movedPins.map(p => ({ ...p, layerId: newLayerId }));
          const result = [...otherPins, ...updatedMovedPins];
          return result.map((p, i) => ({ ...p, position: i }));
        });
      }
    }
  };

  const handleDragStart = (event: any) => {
    if (userRole === 'view' || isOffline) return;
    dragStartPinsRef.current = pins;
    const { active } = event;
    if (active.data.current?.type === 'pin') {
      const activeId = active.id as string;
      const pinsToMoveIds = selectedNavIds.has(activeId) 
        ? Array.from(selectedNavIds) 
        : [activeId];
      
      const startMap = new Map<string, string | undefined>();
      pinsToMoveIds.forEach(id => {
        const p = pins.find(pin => pin.id === id);
        if (p) startMap.set(id, p.layerId);
      });
      dragStartLayersRef.current = startMap;
    }
  };

  const handleDragCancel = () => {
    if (dragStartPinsRef.current) {
      setPins(dragStartPinsRef.current);
      dragStartPinsRef.current = null;
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (userRole === 'view' || isOffline) return;
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
      const overData = over.data.current;
      let targetLayerId = over.id as string;
      
      if (overData?.type === 'pin') {
        if (overData.pin.layerId) {
          targetLayerId = overData.pin.layerId;
        } else {
          return;
        }
      }
      
      setLayers(prev => {
        const next = reorderLayers(prev, active.id as string, targetLayerId);
        if (mapId) {
          socketRef.current?.emit('layers-reorder', { mapId, layerOrder: next.map(l => l.id) });
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

      const pinsToMoveIds = selectedNavIds.has(activeId) 
        ? Array.from(selectedNavIds) 
        : [activeId];

      setPins(prev => {
        const next = reorderPins(
          prev, 
          activeId, 
          over.id as string, 
          overData?.type === 'pin' ? 'pin' : 'layer',
          overLayerId,
          selectedNavIds
        );
        if (mapId) {
          const changedLayerPins = pinsToMoveIds.filter(pId => !isSameLayer(startLayersMap.get(pId), overLayerId));
          const destLayerPins = next.filter(p => isSameLayer(p.layerId, overLayerId));

          if (changedLayerPins.length > 0) {
            const sourceLayerPins = originalLayerId !== undefined && !isSameLayer(originalLayerId, overLayerId)
              ? next.filter(p => isSameLayer(p.layerId, originalLayerId))
              : undefined;

            socketRef.current?.emit('pin-move-layer', {
              mapId,
              pinIds: changedLayerPins,
              targetLayerId: overLayerId === undefined ? null : overLayerId,
              destPinOrder: destLayerPins.map(p => p.id),
              sourceLayerId: originalLayerId === undefined ? null : originalLayerId,
              sourcePinOrder: sourceLayerPins?.map(p => p.id),
            });
          } else {
            // Same-layer reorder only
            socketRef.current?.emit('pins-reorder', { 
              mapId, 
              layerId: overLayerId === undefined ? null : overLayerId, 
              pinOrder: destLayerPins.map(p => p.id) 
            });
          }
        }
        return next;
      });
    }
  };


  const handleImport = (data: Partial<MapData>) => {
    if (userRole === 'view' || isOffline) return;
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
    setSuccessMessage('Map imported! Auto-saving...');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleResize = useCallback((e: MouseEvent) => {
    if (Math.abs(e.clientX - resizerStartXRef.current) > 3) {
      isResizerDraggingRef.current = true;
    }
    const newWidth = e.clientX;
    if (newWidth > 200 && newWidth < window.innerWidth - 50) {
      setSidebarWidth(newWidth);
    }
  }, []);

  const stopResize = useCallback(() => {
    setIsResizing(false);
    window.removeEventListener('mousemove', handleResize);
    window.removeEventListener('mouseup', stopResize);
  }, [handleResize]);

  const startResize = useCallback((e: React.MouseEvent) => {
    isResizerDraggingRef.current = false;
    resizerStartXRef.current = e.clientX;
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
        {userRole !== 'view' && (
          <button 
            onClick={() => {
              if (error) {
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
            color: (isOffline || error) ? '#ffbdad' : (successMessage ? '#b8ffd1' : (mapTheme === 'dark' ? '#cbd5e1' : 'white')),
            fontWeight: '600',
            whiteSpace: 'nowrap',
            cursor: error ? 'pointer' : 'default',
            outline: 'none',
            fontFamily: 'inherit',
            fontSize: '0.65rem'
          }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: (isOffline || error) ? '#ff4d4f' : (isSaving || isDirty ? '#ffcc00' : '#4ade80'), flexShrink: 0 }} />
            <span>
              {isOffline ? 'Offline' : (error || successMessage || (isSaving ? 'Saving changes...' : (isDirty ? 'Pending Updates...' : 'Map Synced')))}
            </span>
          </button>
        )}
        <div id="mobile-header-actions" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '26px', minHeight: '26px', flexShrink: 0 }}></div>
      </div>
    </header>
  );

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', fontFamily: 'inherit', userSelect: isResizing ? 'none' : 'auto' }} className="app-container">
      {isMobile && appHeader}

      <div 
        ref={sheetRef}
        className={isMobile ? `mobile-bottom-sheet ${isDraggingSheet ? 'dragging' : ''}` : ''}
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
              isOffline={isOffline}
            mapId={mapId}
            mapName={mapName}
            onMapNameChange={handleMapNameChange}
            layers={layers}
            onAddLayer={addLayer}
            onUpdateLayer={updateLayer}
            onRemoveLayer={removeLayer}
            pins={pins}
            onResultSelect={(lat, lng) => {
              setTargetLocation([lat, lng]);
              if (isMobile) setSheetHeight(0);
            }}
            onAddPin={addPinAtLocation}
            onSelectPin={handlePinSelect}
            onRemovePin={removePin}
            onPinClick={(pin) => {
              handlePinSelect(pin.id);
            }}
            onUpdatePin={updatePin}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
            onDragOver={handleDragOver}
            onDragStart={handleDragStart}
            userRole={userRole}
            onShare={() => setIsSharing(true)}
            onImport={handleImport}
            mapBounds={mapBounds}
            editingPinId={editingPinId}
            onSetEditingPinId={handleSetEditingPinId}
            hoveredPinId={hoveredPinId}
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
        {!isMobile && (
          <div 
            onClick={() => setShowSignOutDialog(true)}
            style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--surface-color)', padding: '6px 12px', borderRadius: '50px', boxShadow: 'var(--shadow-sm)', cursor: 'pointer', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
          >
            <span style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-primary)' }}>{user?.name}</span>
            {user?.picture && <img src={user.picture} alt={user.name} style={{ width: '28px', height: '28px', borderRadius: '50%', border: '2px solid rgba(0,0,0,0.05)' }} />}
          </div>
        )}
        <MapView 
            pins={pins} 
            onMapClick={handleMapClick} 
            onPinClick={handlePinClick}
            onUpdatePin={updatePin}
            targetLocation={targetLocation} 
            targetPinId={targetPinId}
            editingPinId={editingPinId}
            boundsToFit={boundsToFit}
            onBoundsChange={setMapBounds}
            userRole={userRole}
            isOffline={isOffline}
            hoveredPinId={hoveredPinId}
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

      {showSignOutDialog && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, backdropFilter: 'blur(4px)' }} onClick={() => setShowSignOutDialog(false)}>
          <div style={{ background: 'var(--surface-color)', padding: '2.5rem', borderRadius: 'var(--radius-lg)', maxWidth: '400px', width: '90%', boxShadow: 'var(--shadow-lg)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ background: 'var(--bg-color)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
              <LogOut size={32} color="var(--primary-color)" />
            </div>
            <h3 style={{ marginTop: 0, fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>Sign Out</h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: '1.5', margin: '1rem 0 2rem 0' }}>
              Are you sure you want to sign out of OurMaps?
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={() => setShowSignOutDialog(false)} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'transparent', fontWeight: '600', color: 'var(--text-secondary)' }}>Cancel</button>
              <button onClick={() => { setShowSignOutDialog(false); logout(); }} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--primary-color)', color: 'white', fontWeight: '600' }}>Sign Out</button>
            </div>
          </div>
        </div>
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
