import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Pin } from '@shared/interfaces';
import { useEffect, useRef, useState } from 'react';
import { getMarkerIcon } from '../utils/mapUtils';
import L from 'leaflet';
import { Locate, Navigation } from 'lucide-react';

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
  hoveredPinId?: string | null;
  onHoverPin?: (id: string | null) => void;
}

const MapEvents = ({ onMapClick, onBoundsChange }: { onMapClick: (lat: number, lng: number) => void, onBoundsChange: (bounds: string) => void }) => {
  const map = useMap();

  useEffect(() => {
    const b = map.getBounds();
    onBoundsChange(`${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}`);
  }, []);

  useMapEvents({
    contextmenu: (e) => {
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
  const lastTarget = useRef<[number, number] | null>(null);
  
  useEffect(() => {
    if (targetLocation && (targetLocation[0] !== lastTarget.current?.[0] || targetLocation[1] !== lastTarget.current?.[1])) {
      map.flyTo(targetLocation, 14, { duration: 1.5 });
      lastTarget.current = targetLocation;
    }
  }, [targetLocation, map]);

  useEffect(() => {
    if (boundsToFit && boundsToFit.isValid()) {
      map.fitBounds(boundsToFit, { padding: [50, 50], maxZoom: 16 });
    }
  }, [boundsToFit, map]);

  return null;
};

const UserLocationMarker = () => {
  const [position, setPosition] = useState<L.LatLng | null>(null);
  const map = useMap();

  useEffect(() => {
    map.locate().on("locationfound", function (e) {
      setPosition(e.latlng);
    });
  }, [map]);

  if (position === null) return null;

  const blueDotIcon = L.divIcon({
    className: 'user-location-dot',
    html: `<div style="width: 16px; height: 16px; background: #4285F4; border: 3px solid white; border-radius: 50%; box-shadow: 0 0 0 2px rgba(66, 133, 244, 0.4); animation: pulse 2s infinite;"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });

  return <Marker position={position} icon={blueDotIcon} />;
}

const MapView = ({ 
  center = [20, 0], 
  zoom = 3, 
  pins, 
  onMapClick, 
  onEditPin, 
  onUpdatePin, 
  onBoundsChange, 
  targetLocation, 
  targetPinId, 
  boundsToFit, 
  userRole = 'owner',
  hoveredPinId,
  onHoverPin
}: MapViewProps) => {
  const markerRefs = useRef<Record<string, L.Marker | null>>({});
  const [editingPopupPinId, setEditingPopupPinId] = useState<string | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const readOnly = userRole === 'view';

  useEffect(() => {
    if (targetPinId && markerRefs.current[targetPinId]) {
      markerRefs.current[targetPinId]?.openPopup();
    }
  }, [targetPinId]);

  const handleMyLocation = () => {
    if (mapRef.current) {
      mapRef.current.locate({ setView: true, maxZoom: 16 });
    }
  };

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <MapContainer 
        center={center} 
        zoom={zoom} 
        style={{ height: '100%', width: '100%' }}
        doubleClickZoom={false}
        ref={mapRef}
        worldCopyJump={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          noWrap={true}
        />
        <MapEvents onMapClick={onMapClick} onBoundsChange={onBoundsChange} />
        <MapController targetLocation={targetLocation} boundsToFit={boundsToFit} />
        <UserLocationMarker />
        {pins.map((pin) => (
          <Marker 
            key={pin.id} 
            position={[pin.lat, pin.lng]} 
            icon={getMarkerIcon(pin.color, pin.icon, hoveredPinId === pin.id)}
            ref={(ref) => { markerRefs.current[pin.id] = ref; }}
            eventHandlers={{
              mouseover: () => onHoverPin?.(pin.id),
              mouseout: () => onHoverPin?.(null)
            }}
          >            <Popup eventHandlers={{ remove: () => setEditingPopupPinId(null) }} className="modern-popup">
              <div style={{ minWidth: '220px', maxWidth: '320px' }}>
                {editingPopupPinId === pin.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '0.5rem 0' }}>
                    <div style={{ fontWeight: '800', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Edit Pin</div>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>NAME</label>
                      <input 
                        value={pin.label || ''} 
                        onChange={(e) => onUpdatePin(pin.id, { label: e.target.value })}
                        className="input-field"
                        style={{ padding: '6px 10px', fontSize: '0.9rem' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>DESCRIPTION</label>
                      <textarea 
                        value={pin.description || ''} 
                        onChange={(e) => onUpdatePin(pin.id, { description: e.target.value })}
                        placeholder="Add some notes about this place..."
                        rows={3}
                        className="input-field"
                        style={{ padding: '6px 10px', fontSize: '0.9rem', minHeight: '60px' }}
                      />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                      <button 
                        onClick={() => onEditPin(pin.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--primary-color)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '700', textDecoration: 'none', padding: 0 }}
                      >
                        Style & Details...
                      </button>
                      <button 
                        onClick={() => setEditingPopupPinId(null)}
                        className="btn-primary"
                        style={{ padding: '6px 16px', fontSize: '0.85rem' }}
                      >
                        Done
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '4px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', gap: '12px' }}>
                      <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '800', color: 'var(--text-primary)' }}>{pin.label}</h3>
                      {!readOnly && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingPopupPinId(pin.id);
                          }}
                          style={{ background: 'var(--bg-color)', color: 'var(--primary-color)', border: '1px solid var(--primary-color)', borderRadius: '6px', padding: '4px 10px', fontSize: '0.7rem', fontWeight: '700', cursor: 'pointer' }}
                        >
                          EDIT
                        </button>
                      )}
                    </div>
                    
                    {pin.imageUrl && (
                      <div style={{ borderRadius: 'var(--radius-sm)', overflow: 'hidden', marginBottom: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
                        <img 
                          src={pin.imageUrl} 
                          alt={pin.label} 
                          style={{ width: '100%', height: 'auto', display: 'block' }} 
                          onError={(e) => (e.currentTarget.parentElement!.style.display = 'none')}
                        />
                      </div>
                    )}
                    
                    {pin.description ? (
                      <p style={{ margin: '0 0 16px 0', fontSize: '0.95rem', color: 'var(--text-secondary)', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                        {pin.description}
                      </p>
                    ) : (
                      <div style={{ fontSize: '0.85rem', color: '#aaa', marginBottom: '16px', fontStyle: 'italic' }}>No description provided.</div>
                    )}

                    <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid #eee', paddingTop: '12px' }}>
                        <a 
                          href={`https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ flex: 1, textDecoration: 'none' }}
                        >
                          <button className="btn-primary" style={{ width: '100%', padding: '8px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                            <Navigation size={16} /> Directions
                          </button>
                        </a>
                    </div>
                  </div>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      <button 
        onClick={handleMyLocation}
        style={{
          position: 'absolute',
          bottom: '24px',
          right: '24px',
          width: '56px',
          height: '56px',
          borderRadius: '16px',
          background: 'white',
          border: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 1000,
          color: 'var(--primary-color)',
          transition: 'all 0.2s'
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#f8f9fa'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
        title="Find my location"
      >
        <Locate size={24} />
      </button>

      <style>{`
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(66, 133, 244, 0.7); }
          70% { box-shadow: 0 0 0 15px rgba(66, 133, 244, 0); }
          100% { box-shadow: 0 0 0 0 rgba(66, 133, 244, 0); }
        }
        .modern-popup .leaflet-popup-content-wrapper {
          border-radius: 16px;
          padding: 8px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.15);
        }
        .modern-popup .leaflet-popup-content {
          margin: 12px;
        }
        .leaflet-container {
          background-color: var(--bg-color);
        }
      `}</style>
    </div>
  );
};

export default MapView;
