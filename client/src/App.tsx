import { useEffect, useState, useCallback } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import ShareDialog from './components/ShareDialog';
import { apiService } from './services/api'
import { AuthProvider, useAuth } from './contexts/AuthContext';
import type { Pin, PinGroup, MapPermission } from '@shared/interfaces'
import { arrayMove } from '@dnd-kit/sortable'
import type { DragEndEvent } from '@dnd-kit/core'
import { Loader2 } from 'lucide-react';

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

  const loadMap = async (mapId: string) => {
    setIsMapLoading(true);
    try {
      const data = await apiService.getMap(mapId);
      setMapId(data.id);
      setMapName(data.name || 'My Map');
      setGroups(data.groups || []);
      setPins(data.pins);
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
      if (mapId) {
        await apiService.updateMap(mapId, mapName, groups, pins);
      } else {
        const newId = crypto.randomUUID();
        await apiService.createMap({ 
          id: newId, 
          name: mapName, 
          groups, 
          pins,
          ownerId: user?.id || '', // Will be set by server mostly
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
    // Reload permissions
    const data = await apiService.getMap(mapId);
    setPermissions(data.permissions || []);
  };

  const handleRemoveShare = async (userId: string) => {
    if (!mapId) return;
    await apiService.removeShare(mapId, userId);
    setPermissions(prev => prev.filter(p => p.userId !== userId));
  };

  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (userRole === 'view') return;
    const newPin: Pin = {
      id: crypto.randomUUID(),
      lat,
      lng,
      label: `Pin ${pins.length + 1}`,
      position: pins.length
    };
    setPins(prev => [...prev, newPin]);
  }, [pins.length, userRole]);

  const addPinAtLocation = (lat: number, lng: number, label: string) => {
    if (userRole === 'view') return;
    const newPin: Pin = {
      id: crypto.randomUUID(),
      lat,
      lng,
      label: label,
      position: pins.length
    };
    setPins(prev => [...prev, newPin]);
    setTargetLocation([lat, lng]);
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

  const handleDragEnd = (event: DragEndEvent) => {
    if (userRole === 'view') return;
    const { active, over } = event;
    if (!over) return;

    if (active.data.current?.type === 'group') {
      if (active.id !== over.id) {
        setGroups((items) => {
          const oldIndex = items.findIndex((i) => i.id === active.id);
          const newIndex = items.findIndex((i) => i.id === over.id);
          const newItems = arrayMove(items, oldIndex, newIndex);
          return newItems.map((item, index) => ({ ...item, position: index }));
        });
      }
      return;
    }

    if (active.data.current?.type === 'pin') {
      const activePin = pins.find(p => p.id === active.id);
      if (!activePin) return;

      const overId = over.id;
      const overData = over.data.current;

      setPins((prevPins) => {
        const activeIndex = prevPins.findIndex((p) => p.id === active.id);
        let newPins = [...prevPins];
        let newGroupId = activePin.groupId;

        if (overData?.type === 'group') {
          newGroupId = overId as string;
        } else if (overData?.type === 'pin') {
          const overPin = prevPins.find(p => p.id === overId);
          newGroupId = overPin?.groupId;
        }

        if (newGroupId !== activePin.groupId) {
          newPins[activeIndex] = { ...newPins[activeIndex], groupId: newGroupId };
        }

        if (active.id !== overId && overData?.type === 'pin') {
          const overIndex = prevPins.findIndex((p) => p.id === overId);
          newPins = arrayMove(newPins, activeIndex, overIndex);
        }

        return newPins.map((p, index) => ({ ...p, position: index }));
      });
    }
  };

  const handleImport = (data: Partial<MapData>) => {
    if (data.name) setMapName(data.name);
    if (data.pins) setPins(data.pins);
    if (data.groups) setGroups(data.groups);
    setSuccessMessage('Map imported! Don\'t forget to save.');
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  if (isMapLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f8f9fa' }}>
        <Loader2 size={48} className="animate-spin" style={{ color: '#3498db', marginBottom: '1rem' }} />
        <h2 style={{ color: '#2c3e50' }}>Loading map...</h2>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif' }}>
      <header style={{ padding: '0.8rem 1.5rem', background: '#2c3e50', color: '#ecf0f1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', zIndex: 1000 }}>
        <div style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Our Maps</h1>
          <small style={{ color: error ? '#e74c3c' : (successMessage ? '#2ecc71' : '#bdc3c7') }}>
            {error || successMessage || (isSaving ? 'Saving...' : 'Ready')}
          </small>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {userRole !== 'view' && (
            <button 
              onClick={handleSave} 
              disabled={isSaving}
              style={{ padding: '0.5rem 1rem', cursor: 'pointer', background: '#27ae60', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}
            >
              {isSaving ? 'Saving...' : 'Save Map'}
            </button>
          )}
        </div>
      </header>
      
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Sidebar 
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
          onPinClick={(lat, lng) => setTargetLocation([lat, lng])}
          onUpdatePin={updatePin}
          onDragEnd={handleDragEnd}
          userRole={userRole}
          onShare={() => setIsSharing(true)}
          onImport={handleImport}
        />

        <main style={{ flex: 1, position: 'relative' }}>
          <MapView pins={pins} onMapClick={handleMapClick} targetLocation={targetLocation} />
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
