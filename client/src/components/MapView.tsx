import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Pin } from '@shared/interfaces';
import { useEffect, useRef, useState } from 'react';
import { getMarkerIcon } from '../utils/mapUtils';
import L from 'leaflet';

interface MapViewProps {
  center?: [number, number];
  zoom?: number;
  pins: Pin[];
  onMapClick: (lat: number, lng: number) => void;
  onEditPin: (id: string) => void;
  onUpdatePin: (id: string, updates: Partial<Pin>) => void;
  onBoundsChange: (bounds: string) => void;
  targetLocation?: [number, number] | null;
  targetPinId?: string | null;
  boundsToFit?: L.LatLngBounds | null;
  userRole?: 'owner' | 'edit' | 'view';
}

const MapEvents = ({ onMapClick, onBoundsChange }: { onMapClick: (lat: number, lng: number) => void, onBoundsChange: (bounds: string) => void }) => {
  const map = useMap();

  useEffect(() => {
    const b = map.getBounds();
    onBoundsChange(`${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}`);
  }, []);

  useMapEvents({
    dblclick: (e) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
    moveend: () => {
      const b = map.getBounds();
      onBoundsChange(`${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}`);
    }
  });
  return null;
};

const MapController = ({ targetLocation, boundsToFit }: { targetLocation?: [number, number] | null, boundsToFit?: L.LatLngBounds | null }) => {
  const map = useMap();
  
  useEffect(() => {
    if (targetLocation) {
      map.flyTo(targetLocation, 14);
    }
  }, [targetLocation, map]);

  useEffect(() => {
    if (boundsToFit && boundsToFit.isValid()) {
      map.fitBounds(boundsToFit, { padding: [50, 50], maxZoom: 16 });
    }
  }, [boundsToFit, map]);

  return null;
};

const MapView = ({ center = [20, 0], zoom = 3, pins, onMapClick, onEditPin, onUpdatePin, onBoundsChange, targetLocation, targetPinId, boundsToFit, userRole = 'owner' }: MapViewProps) => {
  const markerRefs = useRef<Record<string, L.Marker | null>>({});
  const [editingPopupPinId, setEditingPopupPinId] = useState<string | null>(null);
  const readOnly = userRole === 'view';

  useEffect(() => {
    if (targetPinId && markerRefs.current[targetPinId]) {
      markerRefs.current[targetPinId]?.openPopup();
    }
  }, [targetPinId]);

  return (
    <MapContainer 
      center={center} 
      zoom={zoom} 
      style={{ height: '100%', width: '100%' }}
      doubleClickZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapEvents onMapClick={onMapClick} onBoundsChange={onBoundsChange} />
      <MapController targetLocation={targetLocation} boundsToFit={boundsToFit} />
      {pins.map((pin) => (
        <Marker 
          key={pin.id} 
          position={[pin.lat, pin.lng]} 
          icon={getMarkerIcon(pin.color, pin.icon)}
          ref={(ref) => { markerRefs.current[pin.id] = ref; }}
        >
          <Popup eventHandlers={{ remove: () => setEditingPopupPinId(null) }}>
            <div style={{ minWidth: '200px', maxWidth: '300px', padding: '5px 0' }}>
              {editingPopupPinId === pin.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#666', display: 'block', marginBottom: '2px' }}>Name</label>
                    <input 
                      value={pin.label || ''} 
                      onChange={(e) => onUpdatePin(pin.id, { label: e.target.value })}
                      placeholder="Title"
                      style={{ width: '100%', padding: '6px', boxSizing: 'border-box', borderRadius: '4px', border: '1px solid #ccc' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#666', display: 'block', marginBottom: '2px' }}>DESCRIPTION</label>
                    <textarea 
                      value={pin.description || ''} 
                      onChange={(e) => onUpdatePin(pin.id, { description: e.target.value })}
                      placeholder="Description"
                      rows={3}
                      style={{ width: '100%', padding: '6px', boxSizing: 'border-box', borderRadius: '4px', border: '1px solid #ccc', fontFamily: 'inherit', resize: 'vertical' }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button 
                      onClick={() => onEditPin(pin.id)}
                      style={{ background: 'none', border: 'none', color: '#9b59b6', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 'bold', textDecoration: 'underline', padding: 0 }}
                    >
                      More options...
                    </button>
                    <button 
                      onClick={() => setEditingPopupPinId(null)}
                      style={{ padding: '5px 15px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '5px', gap: '10px' }}>
                    <strong style={{ fontSize: '1.1rem' }}>{pin.label}</strong>
                    {!readOnly && (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingPopupPinId(pin.id);
                          }}
                          style={{ background: '#3498db', color: 'white', border: 'none', borderRadius: '3px', padding: '2px 6px', fontSize: '0.7rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                  {pin.imageUrl && (
                    <img 
                      src={pin.imageUrl} 
                      alt={pin.label} 
                      style={{ width: '100%', height: 'auto', borderRadius: '4px', marginBottom: '8px' }} 
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                    />
                  )}
                  {pin.description && (
                    <p style={{ margin: 0, fontSize: '0.9rem', color: '#333', whiteSpace: 'pre-wrap' }}>
                      {pin.description}
                    </p>
                  )}
                  {!pin.description && !pin.imageUrl && (
                    <small style={{ color: '#666' }}>
                      Pin at {pin.lat.toFixed(4)}, {pin.lng.toFixed(4)}
                    </small>
                  )}
                </>
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
};

export default MapView;
