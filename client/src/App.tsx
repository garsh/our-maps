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
import type { Pin, PinLayer, MapPermission, MapData } from '@shared/interfaces'
import type { DragEndEvent } from '@dnd-kit/core'
import { Loader2, Map as MapIcon, LogOut } from 'lucide-react';
import L from 'leaflet';
import { reorderPins, reorderLayers } from './utils/reorderUtils';
import { generateId } from './utils/fileUtils';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

export function MapEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  
  const [pins, setPins] = useState<Pin[]>([])
  const [layers, setLayers] = useState<PinLayer[]>([])
  const [mapId, setMapId] = useState<string | null>(id && id !== 'new' ? id : null);
  const [mapName, setMapName] = useState(id === 'new' ? 'My Map' : '');
  const [owner, setOwner] = useState<{ id: string, name?: string, email?: string, picture?: string } | null>(null);
  const [isMapLoading, setIsMapLoading] = useState(!!id && id !== 'new');
  const [userRole, setUserRole] = useState<'owner' | 'edit' | 'view'>('owner');
  const [permissions, setPermissions] = useState<MapPermission[]>([]);
  
  const [isSaving, setIsSaving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [showSignOutDialog, setShowSignOutDialog] = useState(false);
  const [targetLocation, setTargetLocation] = useState<[number, number] | null>(null);
  const [targetPinId, setTargetPinId] = useState<string | null>(null);
  const [boundsToFit, setBoundsToFit] = useState<L.LatLngBounds | null>(null);
  const [editingPinId, setEditingPinId] = useState<string | null>(null);
  const [mapBounds, setMapBounds] = useState<string | null>(null);
  const [previewLocation, setPreviewLocation] = useState<{lat: number, lng: number} | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizing, setIsResizing] = useState(false);

  // Mobile layout states
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  // Dynamic mobile scale: calibrated so DPR ~2.75 (e.g. Pixel 10a) gives scale 1.5.
  // Higher-DPR devices (e.g. Pixel 10 Pro) automatically get a larger scale so the
  // UI stays a comfortable physical size regardless of screen resolution.
  const computeMobileScale = () => {
    const dpr = window.devicePixelRatio || 1;
    const BASELINE_DPR = 2.75; // DPR at which 1.5× feels right
    const BASELINE_SCALE = 1.5;
    return Math.max(1.0, Math.min(2.5, (dpr / BASELINE_DPR) * BASELINE_SCALE));
  };
  const [mobileScale, setMobileScale] = useState(computeMobileScale);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
      setMobileScale(computeMobileScale());
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [sheetHeight, setSheetHeight] = useState(300);
  const [isDraggingSheet, setIsDraggingSheet] = useState(false);
  const sheetDragStart = useRef({ y: 0, height: 0 });

  const startSheetDrag = (e: React.PointerEvent) => {
    setIsDraggingSheet(true);
    sheetDragStart.current = { y: e.clientY, height: sheetHeight };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  
  const onSheetDrag = (e: React.PointerEvent) => {
    if (!isDraggingSheet) return;
    const deltaY = sheetDragStart.current.y - e.clientY;
    setSheetHeight(Math.max(0, Math.min(window.innerHeight - 55, sheetDragStart.current.height + deltaY)));
  };
  
  const endSheetDrag = (e: React.PointerEvent) => {
    setIsDraggingSheet(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
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

  const addCustomColor = (color: string) => {
    if (!customColors.includes(color)) {
      setCustomColors(prev => [color, ...prev].slice(0, 10)); // Keep last 10
    }
  };

  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const isRemoteUpdateRef = useRef(false);
  const hasLoadedRef = useRef(false);

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

      socket.on('map-remote-updated', (data: { pins: Pin[], layers: PinLayer[], name: string }) => {
        if (!data || !data.pins || !data.layers) {
          console.warn('[SOCKET] Received malformed remote update');
          return;
        }
        
        console.log('[SOCKET] Received remote update for pins:', data.pins.length);
        isRemoteUpdateRef.current = true;
        setPins(data.pins);
        setLayers(data.layers);
        setMapName(data.name || '');

        // Use a timeout to reset the flag to ensure all batched state updates 
        // and subsequent useEffects see the flag as true.
        setTimeout(() => {
            isRemoteUpdateRef.current = false;
        }, 1000);
      });

      return () => {
        socket.disconnect();
        socketRef.current = null;
      };
    } else {
      hasLoadedRef.current = false;
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
        return;
    }

    // Don't auto-save empty new maps
    if (!mapId && pins.length === 0 && mapName === 'My Map') return;
    
    const timer = setTimeout(() => {
      handleSave();
    }, 2000); // 2 second debounce for auto-save

    return () => clearTimeout(timer);
  }, [mapName, pins, layers]);

  const loadMap = async (mapId: string) => {
    setIsMapLoading(true);
    hasLoadedRef.current = true;
    setSelectedNavIds(new Set());
    try {
      const data = await apiService.getMap(mapId);
      setMapId(data.id);
      setMapName(data.name || 'My Map');
      setOwner({ id: data.ownerId, name: data.ownerName, email: data.ownerEmail, picture: data.ownerPicture });
      setLayers(data.layers || []);
      setPins(data.pins);
      if (data.pins && data.pins.length > 0) {
        const bounds = L.latLngBounds(data.pins.map(p => [p.lat, p.lng]));
        setBoundsToFit(bounds);
        setTimeout(() => setBoundsToFit(null), 1000);
      }
      setUserRole(data.userRole || 'view');
      setPermissions(data.permissions || []);
    } catch (err) {
      console.error('Failed to load map', err);
      setError('Map not found or access denied');
      setTimeout(() => navigate('/'), 2000);
    } finally {
      setIsMapLoading(false);
    }
  };

  const handleSave = async () => {
    if (userRole === 'view') return;
    setIsSaving(true);
    setError(null);
    try {
      // Add a small artificial delay so the UI state is detectable
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (mapId) {
        await apiService.updateMap(mapId, mapName, layers, pins);
        
        // Notify others via socket
        socketRef.current?.emit('map-updated', {
            mapId,
            pins,
            layers,
            name: mapName
        });
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
      apiService.getMap(mapId)
        .then(data => {
          setPermissions(data.permissions || []);
          setOwner({ id: data.ownerId, name: data.ownerName, email: data.ownerEmail, picture: data.ownerPicture });
          if (data.userRole) setUserRole(data.userRole);
        })
        .catch(err => console.error('Failed to refresh permissions', err));
    }
  }, [isSharing, mapId]);

  const handleShare = async (email: string, role: 'view' | 'edit' | 'owner') => {
    if (!mapId) return;
    await apiService.shareMap(mapId, email, role);
    const data = await apiService.getMap(mapId);
    setPermissions(data.permissions || []);
    setOwner({ id: data.ownerId, name: data.ownerName, email: data.ownerEmail, picture: data.ownerPicture });
    if (data.userRole) setUserRole(data.userRole);
  };

  const handleRemoveShare = async (userId: string) => {
    if (!mapId) return;
    await apiService.removeShare(mapId, userId);
    setPermissions(prev => prev.filter(p => p.userId !== userId));
  };

  const handlePinSelect = (pinId: string) => {
    // Clear stuck hover states on mobile/touch, or if a different pin was clicked
    if (window.matchMedia('(hover: none)').matches || (hoveredPinId && hoveredPinId !== pinId)) {
      setHoveredPinId(null);
    }
    setHoveredPinId(null);

    // Expand the collapsed layer containing this pin so the pin element is in the DOM
    const pin = pins.find(p => p.id === pinId);
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
  };

  const handleSetEditingPinId = (id: string | null) => {
    setEditingPinId(id);
    if (id !== null) {
      setTargetPinId(id);
    } else {
      setTargetPinId(null);
    }
  };

  const handleEditPin = (pin: Pin) => {
    handleSetEditingPinId(pin.id);
  };

  const handleHoverPin = useCallback((id: string | null) => {
    // If a card is open, don't allow other pins to be highlighted by hover
    if (targetPinId !== null || editingPinId !== null) {
      return;
    }
    setHoveredPinId(id);
  }, [targetPinId, editingPinId]);

  const handleBackgroundClick = useCallback(() => {
    setTargetPinId(null);
    setEditingPinId(null);
    setHoveredPinId(null);
  }, []);

  const handleMapClick = useCallback(async (lat: number, lng: number) => {
    if (userRole === 'view') return;
    const id = generateId();
    const newPin: Pin = {
      id,
      lat,
      lng,
      label: `Pin ${pins.length + 1}`,
      position: pins.length
    };
    setPins(prev => [...prev, newPin]);
    handleEditPin(newPin);

    // Geocode once on creation
    const address = await reverseGeocode(lat, lng);
    if (address) {
      setPins(prev => prev.map(p => p.id === id ? { ...p, address } : p));
    }
  }, [pins.length, userRole]);

  const addPinAtLocation = async (lat: number, lng: number, label: string, address?: string) => {
    if (userRole === 'view') return;
    const id = generateId();
    const newPin: Pin = {
      id,
      lat,
      lng,
      label: label,
      address, // Use provided address if available
      position: pins.length
    };
    setPins(prev => [...prev, newPin]);
    handlePinSelect(id); // Highlight the new pin without opening edit mode

    // Geocode only if address is missing
    if (!address) {
      const fetchedAddress = await reverseGeocode(lat, lng);
      if (fetchedAddress) {
        setPins(prev => prev.map(p => p.id === id ? { ...p, address: fetchedAddress } : p));
      }
    }
  };

  const removePin = (id: string) => {
    if (userRole === 'view') return;
    setPins(prev => prev.filter(p => p.id !== id));
  };

  const updatePin = (id: string, updates: Partial<Pin>) => {
    if (userRole === 'view') return;
    setPins(prev => {
      // When the layer changes, move the pin to the end of the target layer
      if ('layerId' in updates) {
        const targetLayerId = updates.layerId; // undefined = Default Layer
        const pinsInTargetLayer = prev.filter(p => p.id !== id && p.layerId === targetLayerId);
        const endPosition = pinsInTargetLayer.length > 0
          ? Math.max(...pinsInTargetLayer.map(p => p.position)) + 1
          : 0;
        return prev.map(p => p.id === id ? { ...p, ...updates, position: endPosition } : p);
      }
      return prev.map(p => p.id === id ? { ...p, ...updates } : p);
    });
  };

  const addLayer = () => {
    if (userRole === 'view') return;
    const newGroup: PinLayer = {
      id: generateId(),
      name: `Layer ${layers.length + 1}`,
      position: layers.length
    };
    setLayers(prev => [...prev, newGroup]);
  };

  const updateLayer = (id: string, updates: Partial<PinLayer>) => {
    if (userRole === 'view') return;
    setLayers(prev => prev.map(g => g.id === id ? { ...g, ...updates } : g));
  };

  const removeLayer = (id: string) => {
    if (userRole === 'view') return;
    setLayers(prev => prev.filter(g => g.id !== id));
    setPins(prev => prev.map(p => p.layerId === id ? { ...p, layerId: undefined } : p));
  };

  const handleDragOver = (event: any) => {
    if (userRole === 'view') return;
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

  const handleDragEnd = (event: DragEndEvent) => {
    if (userRole === 'view') return;
    const { active, over } = event;
    
    if (!over) return;

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
      
      setLayers(prev => reorderLayers(prev, active.id as string, targetLayerId));
      return;
    }

    // Handle final reorder for pins
    if (active.data.current?.type === 'pin') {
      const overData = over.data.current;
      const overLayerId = overData?.type === 'pin' ? overData.pin.layerId : (over.id === 'default' ? undefined : over.id as string);
      
      setPins(prev => reorderPins(
        prev, 
        active.id as string, 
        over.id as string, 
        overData?.type === 'pin' ? 'pin' : 'layer',
        overLayerId,
        selectedNavIds
      ));
    }
  };

  const handleImport = (data: Partial<MapData>) => {
    if (data.name) setMapName(data.name);
    if (data.pins) {
      setPins(data.pins);
      if (data.pins.length > 0) {
        const bounds = L.latLngBounds(data.pins.map(p => [p.lat, p.lng]));
        setBoundsToFit(bounds);
        setTimeout(() => setBoundsToFit(null), 1000);
      }
    }
    if (data.layers) setLayers(data.layers);
    setSuccessMessage('Map imported! Auto-saving...');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const handleResize = useCallback((e: MouseEvent) => {
    const newWidth = e.clientX;
    if (newWidth > 200 && newWidth < 600) {
      setSidebarWidth(newWidth);
    }
  }, []);

  const stopResize = useCallback(() => {
    setIsResizing(false);
    window.removeEventListener('mousemove', handleResize);
    window.removeEventListener('mouseup', stopResize);
  }, [handleResize]);

  const startResize = useCallback(() => {
    setIsResizing(true);
    window.addEventListener('mousemove', handleResize);
    window.addEventListener('mouseup', stopResize);
  }, [handleResize, stopResize]);

  if (isMapLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-color)', userSelect: 'none', WebkitUserSelect: 'none' }}>
        <Loader2 size={64} className="animate-spin" style={{ color: 'var(--primary-color)', marginBottom: '1.5rem' }} />
        <h2 style={{ color: 'var(--primary-color)', fontWeight: '700' }}>Loading your map...</h2>
      </div>
    );
  }

  const appHeader = (
    <header style={{ 
      padding: '0.4rem 1rem', 
      background: 'var(--primary-color)', 
      color: 'white', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'space-between',
      boxShadow: 'var(--shadow-md)', 
      zIndex: 1000,
      flexShrink: 0
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', minWidth: 0, flexShrink: 1, userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }} onClick={() => navigate('/')}>
        <div style={{ display: 'flex', flexShrink: 0 }}>
          <MapIcon size={18} />
        </div>
        <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '800', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1 }}>{isMobile ? mapName || 'Untitled Map' : 'OurMaps'}</h1>
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
            color: error ? '#ffbdad' : (successMessage ? '#b8ffd1' : 'white'),
            fontWeight: '600',
            whiteSpace: 'nowrap',
            cursor: error ? 'pointer' : 'default',
            outline: 'none',
            fontFamily: 'inherit',
            fontSize: '0.65rem'
          }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: error ? '#ff4d4f' : (isSaving ? '#ffcc00' : '#4ade80'), flexShrink: 0 }} />
            <span>
              {error || successMessage || (isSaving ? 'Saving changes...' : 'Map Synced')}
            </span>
          </button>
        )}
        <div id="mobile-header-actions" style={{ display: 'flex', alignItems: 'center' }}></div>
      </div>
    </header>
  );

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'inherit', userSelect: isResizing ? 'none' : 'auto' }} className="app-container">
      {isMobile && appHeader}

      <div 
        className={isMobile ? `mobile-bottom-sheet ${isDraggingSheet ? 'dragging' : ''}` : ''}
        style={isMobile ? { 
          height: `${sheetHeight}px`,
          background: 'var(--bg-color)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'visible'
        } : { width: `${sidebarWidth}px`, flexShrink: 0, display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 10, background: 'var(--bg-color)' }}
      >
        {isMobile && (
          <div 
            className="bottom-sheet-drag-handle" 
            onPointerDown={startSheetDrag}
            onPointerMove={onSheetDrag}
            onPointerUp={endSheetDrag}
            onPointerCancel={endSheetDrag}
            style={{ zIndex: 10 }}
          >
            <div className="drag-pill" />
          </div>
        )}

        {!isMobile && appHeader}

        <div style={isMobile ? { 
          transform: `scale(${mobileScale})`, 
          transformOrigin: 'top left', 
          width: `${(1 / mobileScale) * 100}%`, 
          height: `${(1 / mobileScale) * 100}%`,
          flex: 'none',
          display: 'flex',
          flexDirection: 'column'
        } : { display: 'flex', flex: 1, overflow: 'hidden' }}>
          <Sidebar 
            isMobile={isMobile}
            mapId={mapId}
            mapName={mapName}
            onMapNameChange={setMapName}
            layers={layers}
            onAddLayer={addLayer}
            onUpdateLayer={updateLayer}
            onRemoveLayer={removeLayer}
            pins={pins}
            onResultSelect={(lat, lng) => {
              setTargetLocation([lat, lng]);
              if (isMobile) setSheetHeight(40);
            }}
            onAddPin={addPinAtLocation}
            onSelectPin={handlePinSelect}
            onRemovePin={removePin}
            onPinClick={(pin) => {
              handlePinSelect(pin.id);
            }}
            onUpdatePin={updatePin}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
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
            onToggleNavId={(id) => {
              setSelectedNavIds(prev => {
                const newSet = new Set(prev);
                if (newSet.has(id)) newSet.delete(id);
                else newSet.add(id);
                return newSet;
              });
            }}
            onToggleNavIds={(ids, force) => {
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
            }}
            hiddenLayerIds={hiddenLayerIds}
            onToggleLayerVisibility={(id) => {
              setHiddenLayerIds(prev => {
                const newSet = new Set(prev);
                if (newSet.has(id)) newSet.delete(id);
                else newSet.add(id);
                return newSet;
              });
            }}
            collapsedLayerIds={collapsedLayerIds}
            onToggleExpand={(id) => {
              setCollapsedLayerIds(prev => {
                const newSet = new Set(prev);
                if (newSet.has(id)) newSet.delete(id);
                else newSet.add(id);
                return newSet;
              });
            }}
            onHoverSearchResult={(lat, lng) => {
              setPreviewLocation(lat !== null && lng !== null ? { lat, lng } : null);
            }}
          />
        </div>
      </div>

      <div 
        onMouseDown={startResize}
        style={{ 
          width: '1px', 
          cursor: 'col-resize', 
          background: 'var(--border-color)', 
          position: 'relative',
          zIndex: 100
        }}
      >
        <div style={{
           position: 'absolute',
           left: '-2px',
           width: '5px',
           height: '100%',
           background: isResizing ? 'var(--primary-color)' : 'transparent',
           transition: 'background 0.2s'
        }} />
      </div>

      <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {!isMobile && (
          <div 
            onClick={() => setShowSignOutDialog(true)}
            style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '10px', background: 'white', padding: '6px 12px', borderRadius: '50px', boxShadow: 'var(--shadow-sm)', cursor: 'pointer', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
          >
            <span style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-primary)' }}>{user?.name}</span>
            {user?.picture && <img src={user.picture} alt={user.name} style={{ width: '28px', height: '28px', borderRadius: '50%', border: '2px solid rgba(0,0,0,0.05)' }} />}
          </div>
        )}
        <MapView 
            pins={pins} 
            onMapClick={handleMapClick} 
            onPinClick={(pin) => handlePinSelect(pin.id)}
            onUpdatePin={updatePin}
            targetLocation={targetLocation} 
            targetPinId={targetPinId}
            editingPinId={editingPinId}
            boundsToFit={boundsToFit}
            onBoundsChange={setMapBounds}
            userRole={userRole}
            hoveredPinId={hoveredPinId}
            onHoverPin={handleHoverPin}
            onBackgroundClick={handleBackgroundClick}
            hiddenLayerIds={hiddenLayerIds}
            previewLocation={previewLocation}
            bottomPadding={isMobile ? sheetHeight : 0}
          />
        </main>

      <ShareDialog 
        isOpen={isSharing}
        onClose={() => setIsSharing(false)}
        onShare={handleShare}
        onRemoveShare={handleRemoveShare}
        permissions={permissions}
        owner={owner}
        currentUserId={user?.id || ''}
      />

      {showSignOutDialog && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, backdropFilter: 'blur(4px)' }} onClick={() => setShowSignOutDialog(false)}>
          <div style={{ background: 'white', padding: '2.5rem', borderRadius: 'var(--radius-lg)', maxWidth: '400px', width: '90%', boxShadow: 'var(--shadow-lg)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
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
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<PrivateRoute><LandingPage /></PrivateRoute>} />
            <Route path="/map/:id" element={<PrivateRoute><MapEditor /></PrivateRoute>} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </GoogleOAuthProvider>
  )
}

export default App
