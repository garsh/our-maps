import { useEffect, useState, useCallback } from 'react'
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import { apiService } from './services/api'
import type { Pin } from '@shared/interfaces'

function App() {
  const [message, setMessage] = useState('')
  const [pins, setPins] = useState<Pin[]>([])
  const [mapId, setMapId] = useState<string | null>(null);
  const [mapName, setMapName] = useState('My Map');
  const [isSaving, setIsSaving] = useState(false);
  const [showShareTooltip, setShowShareTooltip] = useState(false);
  const [targetLocation, setTargetLocation] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiService.getHello()
      .then(data => setMessage(data.message))
      .catch(err => {
        console.error(err);
        setError('Could not connect to server');
      })

    const params = new URLSearchParams(window.location.search);
    const idFromUrl = params.get('mapId');
    if (idFromUrl) {
      loadMap(idFromUrl);
    }
  }, [])

  const loadMap = async (id: string) => {
    try {
      const data = await apiService.getMap(id);
      setMapId(data.id);
      setMapName(data.name || 'My Map');
      setPins(data.pins);
    } catch (err) {
      console.error('Failed to load map', err);
      setError('Map not found');
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      if (mapId) {
        await apiService.updateMap(mapId, mapName, pins);
      } else {
        const newId = crypto.randomUUID();
        await apiService.createMap({ id: newId, name: mapName, pins });
        setMapId(newId);
        window.history.pushState({}, '', `?mapId=${newId}`);
      }
    } catch (err) {
      console.error('Failed to save map', err);
      setError('Failed to save map');
    } finally {
      setIsSaving(false);
    }
  };

  const handleMapClick = useCallback((lat: number, lng: number) => {
    const newPin: Pin = {
      id: crypto.randomUUID(),
      lat,
      lng,
      label: `Pin ${pins.length + 1}`
    };
    setPins(prev => [...prev, newPin]);
  }, [pins.length]);

  const addPinAtLocation = (lat: number, lng: number, label: string) => {
    const newPin: Pin = {
      id: crypto.randomUUID(),
      lat,
      lng,
      label: label
    };
    setPins(prev => [...prev, newPin]);
    setTargetLocation([lat, lng]);
  };

  const removePin = (id: string) => {
    setPins(prev => prev.filter(p => p.id !== id));
  };

  const updatePin = (id: string, updates: Partial<Pin>) => {
    setPins(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const copyShareLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setShowShareTooltip(true);
    setTimeout(() => setShowShareTooltip(false), 2000);
  };

  return (
    <div className="App" style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'sans-serif' }}>
      <header style={{ padding: '0.8rem 1.5rem', background: '#2c3e50', color: '#ecf0f1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', zIndex: 1000 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Our Maps</h1>
          <small style={{ color: error ? '#e74c3c' : '#bdc3c7' }}>{error || message || 'Connecting...'}</small>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {mapId && (
            <div style={{ position: 'relative' }}>
              <button 
                onClick={copyShareLink}
                style={{ padding: '0.5rem 1rem', cursor: 'pointer', background: '#3498db', color: 'white', border: 'none', borderRadius: '4px' }}
              >
                Copy Share Link
              </button>
              {showShareTooltip && (
                <div style={{ position: 'absolute', top: '110%', left: '50%', transform: 'translateX(-50%)', background: '#333', color: 'white', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>
                  Copied!
                </div>
              )}
            </div>
          )}
          <button 
            onClick={handleSave} 
            disabled={isSaving}
            style={{ padding: '0.5rem 1rem', cursor: 'pointer', background: '#27ae60', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}
          >
            {isSaving ? 'Saving...' : mapId ? 'Update Map' : 'Save Map'}
          </button>
        </div>
      </header>
      
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <Sidebar 
          mapName={mapName}
          onMapNameChange={setMapName}
          pins={pins}
          onResultSelect={(lat, lng) => setTargetLocation([lat, lng])}
          onAddPin={addPinAtLocation}
          onRemovePin={removePin}
          onPinClick={(lat, lng) => setTargetLocation([lat, lng])}
          onUpdatePin={updatePin}
        />

        <main style={{ flex: 1, position: 'relative' }}>
          <MapView pins={pins} onMapClick={handleMapClick} targetLocation={targetLocation} />
        </main>
      </div>
    </div>
  )
}

export default App
