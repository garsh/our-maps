import { useEffect, useState, useCallback } from 'react'
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
import type { Pin, PinGroup, MapPermission, MapData } from '@shared/interfaces'
import type { DragEndEvent } from '@dnd-kit/core'
import { Loader2, Map as MapIcon } from 'lucide-react';
import L from 'leaflet';
import { reorderPins, reorderGroups } from './utils/reorderUtils';

export function MapEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [pins, setPins] = useState<Pin[]>([])
  const [groups, setGroups] = useState<PinGroup[]>([])
  const [mapId, setMapId] = useState<string | null>(id || null);
  const [mapName, setMapName] = useState('');
  const [isMapLoading, setIsMapLoading] = useState(!!id && id !== 'new');
  const [userRole, setUserRole] = useState<'owner' | 'edit' | 'view'>('owner');
  const [permissions, setPermissions] = useState<MapPermission[]>([]);
  
  const [isSaving, setIsSaving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [targetLocation, setTargetLocation] = useState<[number, number] | null>(null);
  const [targetPinId, setTargetPinId] = useState<string | null>(null);
  const [boundsToFit, setBoundsToFit] = useState<L.LatLngBounds | null>(null);
  const [editingPinId, setEditingPinId] = useState<string | null>(null);
  const [mapBounds, setMapBounds] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [isResizing, setIsResizing] = useState(false);
  const [hoveredPinId, setHoveredPinId] = useState<string | null>(null);
  const [selectedNavIds, setSelectedNavIds] = useState<Set<string>>(new Set());
  const [hiddenGroupIds, setHiddenGroupIds] = useState<Set<string | null>>(new Set());
  const [customColors, setCustomColors] = useState<string[]>(() => {
    const saved = localStorage.getItem('customColors');
    return saved ? JSON.parse(saved) : [];
  });

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

  useEffect(() => {
    if (id && id !== 'new') {
      loadMap(id);
    } else {
      // New map defaults
      setMapId(null);
      setMapName('My Map');
      setPins([]);
      setGroups([]);
      setUserRole('owner');
      setIsMapLoading(false);
    }
  }, [id]);

  // Auto-save logic
  useEffect(() => {
    if (userRole === 'view' || isMapLoading) return;
    // Don't auto-save empty new maps
    if (!mapId && pins.length === 0 && mapName === 'My Map') return;
    
    const timer = setTimeout(() => {
      handleSave();
    }, 2000); // 2 second debounce for auto-save

    return () => clearTimeout(timer);
  }, [mapName, pins, groups]);

  const loadMap = async (mapId: string) => {
    setIsMapLoading(true);
    setSelectedNavIds(new Set());
    try {
      const data = await apiService.getMap(mapId);
      setMapId(data.id);
      setMapName(data.name || 'My Map');
      setGroups(data.groups || []);
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
        await apiService.updateMap(mapId, mapName, groups, pins);
      } else {
        const newId = crypto.randomUUID();
        await apiService.createMap({ 
          id: newId, 
          name: mapName, 
          groups, 
          pins,
          ownerId: user?.id || '',
        });
        setMapId(newId);
        navigate(`/map/${newId}`, { replace: true });
      }
    } catch (err) {
      console.error('Failed to save map', err);
      setError('Failed to save map');
    } finally {
      setIsSaving(false);
    }
  };

  const handleShare = async (email: string, role: 'view' | 'edit') => {
    if (!mapId) return;
    await apiService.shareMap(mapId, email, role);
    const data = await apiService.getMap(mapId);
    setPermissions(data.permissions || []);
  };

  const handleRemoveShare = async (userId: string) => {
    if (!mapId) return;
    await apiService.removeShare(mapId, userId);
    setPermissions(prev => prev.filter(p => p.userId !== userId));
  };

  const handlePinSelect = (pin: Pin) => {
    setTargetPinId(pin.id);
    // Reset targetPinId after a short delay so it can be re-triggered
    setTimeout(() => setTargetPinId(null), 500);
  };

  const handleEditPin = (pin: Pin) => {
    setEditingPinId(pin.id);
    // Scroll sidebar to the pin
    setTimeout(() => {
      const element = document.getElementById(`pin-${pin.id}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  const handleMapClick = useCallback(async (lat: number, lng: number) => {
    if (userRole === 'view') return;
    const id = crypto.randomUUID();
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
    const id = crypto.randomUUID();
    const newPin: Pin = {
      id,
      lat,
      lng,
      label: label,
      address: address, // Use provided address if available
      position: pins.length
    };
    setPins(prev => [...prev, newPin]);
    handleEditPin(newPin);

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
    setPins(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const addGroup = () => {
    if (userRole === 'view') return;
    const newGroup: PinGroup = {
      id: crypto.randomUUID(),
      name: `Group ${groups.length + 1}`,
      position: groups.length
    };
    setGroups(prev => [...prev, newGroup]);
  };

  const updateGroup = (id: string, updates: Partial<PinGroup>) => {
    if (userRole === 'view') return;
    setGroups(prev => prev.map(g => g.id === id ? { ...g, ...updates } : g));
  };

  const removeGroup = (id: string) => {
    if (userRole === 'view') return;
    setGroups(prev => prev.filter(g => g.id !== id));
    setPins(prev => prev.map(p => p.groupId === id ? { ...p, groupId: undefined } : p));
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

      let newGroupId: string | undefined = activePin.groupId;
      if (overData?.type === 'group' || overId === 'default') {
        newGroupId = overId === 'default' ? undefined : (overData?.group?.id || overId);
      } else if (overData?.type === 'pin') {
        newGroupId = overData.pin.groupId;
      }

      // ONLY update state in onDragOver if the group actually changed (moving between layers)
      // This provides immediate visual feedback of layer changes.
      // We perform NO intra-group reordering here to prevent jitter.
      if (newGroupId !== activePin.groupId) {
        setPins((prevPins) => {
          const pinsToMoveIds = selectedNavIds.has(activeId) 
            ? Array.from(selectedNavIds) 
            : [activeId];
          
          const movedPins = pinsToMoveIds.map(id => prevPins.find(p => p.id === id)).filter(Boolean) as Pin[];
          const otherPins = prevPins.filter(p => !pinsToMoveIds.includes(p.id));
          
          // Move the bundle to the new group (just append to end during hover for visual feedback)
          const updatedMovedPins = movedPins.map(p => ({ ...p, groupId: newGroupId }));
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

    if (active.data.current?.type === 'group') {
      setGroups(prev => reorderGroups(prev, active.id as string, over.id as string));
      return;
    }

    // Handle final reorder for pins
    if (active.data.current?.type === 'pin') {
      const overData = over.data.current;
      const overGroupId = overData?.type === 'pin' ? overData.pin.groupId : (over.id === 'default' ? undefined : over.id as string);
      
      setPins(prev => reorderPins(
        prev, 
        active.id as string, 
        over.id as string, 
        overData?.type === 'pin' ? 'pin' : 'group',
        overGroupId,
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
    if (data.groups) setGroups(data.groups);
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
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-color)' }}>
        <Loader2 size={64} className="animate-spin" style={{ color: 'var(--primary-color)', marginBottom: '1.5rem' }} />
        <h2 style={{ color: 'var(--primary-color)', fontWeight: '700' }}>Loading your map...</h2>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'inherit', userSelect: isResizing ? 'none' : 'auto' }}>
      <header style={{ 
        padding: '0.75rem 1.5rem', 
        background: 'var(--primary-color)', 
        color: 'white', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        boxShadow: 'var(--shadow-md)', 
        zIndex: 1000 
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer' }} onClick={() => navigate('/')}>
          <div style={{ background: 'rgba(255,255,255,0.2)', padding: '8px', borderRadius: '12px', display: 'flex' }}>
            <MapIcon size={24} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '800', lineHeight: 1.1 }}>Our Maps</h1>
            <small style={{ color: error ? '#ffbdad' : (successMessage ? '#b8ffd1' : 'rgba(255,255,255,0.7)'), fontWeight: '600', fontSize: '0.75rem' }}>
              {error || successMessage || (isSaving ? 'Syncing...' : 'All changes saved')}
            </small>
          </div>
        </div>
        
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          {userRole !== 'view' && (
            <div style={{ 
              fontSize: '0.75rem', 
              background: 'rgba(255,255,255,0.1)', 
              padding: '4px 12px', 
              borderRadius: '50px',
              border: '1px solid rgba(255,255,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: isSaving ? '#ffcc00' : '#4ade80' }} />
              {isSaving ? 'Saving changes...' : 'Cloud Sync Enabled'}
            </div>
          )}
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>{user?.name}</span>
            {user?.picture && <img src={user.picture} alt={user.name} style={{ width: '28px', height: '28px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.2)' }} />}
          </div>
        </div>
      </header>
      
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: 'var(--bg-color)' }}>
        <div style={{ width: `${sidebarWidth}px`, flexShrink: 0, display: 'flex', position: 'relative', zIndex: 10 }}>
          <Sidebar 
            mapId={mapId}
            mapName={mapName}
            onMapNameChange={setMapName}
            groups={groups}
            onAddGroup={addGroup}
            onUpdateGroup={updateGroup}
            onRemoveGroup={removeGroup}
            pins={pins}
            onResultSelect={(lat, lng) => setTargetLocation([lat, lng])}
            onAddPin={addPinAtLocation}
            onRemovePin={removePin}
            onPinClick={handlePinSelect}
            onUpdatePin={updatePin}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            userRole={userRole}
            onShare={() => setIsSharing(true)}
            onImport={handleImport}
            mapBounds={mapBounds}
            editingPinId={editingPinId}
            onSetEditingPinId={setEditingPinId}
            hoveredPinId={hoveredPinId}
            onHoverPin={setHoveredPinId}
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
            hiddenGroupIds={hiddenGroupIds}
            onToggleGroupVisibility={(id) => {
              setHiddenGroupIds(prev => {
                const newSet = new Set(prev);
                if (newSet.has(id)) newSet.delete(id);
                else newSet.add(id);
                return newSet;
              });
            }}
          />
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
        </div>

        <main style={{ flex: 1, position: 'relative' }}>
          <MapView 
            pins={pins} 
            onMapClick={handleMapClick} 
            onEditPin={(id) => {
              const pin = pins.find(p => p.id === id);
              if (pin) handleEditPin(pin);
            }}
            onUpdatePin={updatePin}
            targetLocation={targetLocation} 
            targetPinId={targetPinId}
            boundsToFit={boundsToFit}
            onBoundsChange={setMapBounds}
            userRole={userRole}
            hoveredPinId={hoveredPinId}
            onHoverPin={setHoveredPinId}
            hiddenGroupIds={hiddenGroupIds}
          />
        </main>
      </div>

      <ShareDialog 
        isOpen={isSharing}
        onClose={() => setIsSharing(false)}
        onShare={handleShare}
        onRemoveShare={handleRemoveShare}
        permissions={permissions}
        ownerId={user?.id || ''}
        currentUserId={user?.id || ''}
      />
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
