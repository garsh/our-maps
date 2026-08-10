import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Pin, PinGroup } from '@shared/interfaces';
import { useEffect, useRef, useState } from 'react';
import { getMarkerIcon, getPreviewMarkerIcon } from '../utils/mapUtils';
import L from 'leaflet';
import { Locate, Navigation } from 'lucide-react';
import { reverseGeocode } from '../utils/geocoding';

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
  hiddenGroupIds?: Set<string | null>;
  previewLocation?: {lat: number, lng: number} | null;
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

const PinMarker = ({ 
  pin, 
  onEditPin, 
  onUpdatePin, 
  onHoverPin, 
  hoveredPinId, 
  readOnly,
  setMarkerRef
}: { 
  pin: Pin, 
  onEditPin: (id: string) => void, 
  onUpdatePin: (id: string, updates: Partial<Pin>) => void, 
  onHoverPin?: (id: string | null) => void, 
  hoveredPinId?: string | null, 
  readOnly: boolean,
  setMarkerRef: (id: string, marker: L.Marker | null) => void
}) => {
  const [address, setAddress] = useState<string | null>(pin.address || null);
  const [isFetching, setIsFetching] = useState(false);
  const map = useMap();
  const fetchAddress = async () => {
    if (address || isFetching) return;
    setIsFetching(true);
    try {
      const addr = await reverseGeocode(pin.lat, pin.lng);
      if (addr) {
        setAddress(addr);
        if (!pin.address) {
            onUpdatePin(pin.id, { address: addr });
        }
      }
    } finally {
      setIsFetching(false);
    }
  };

  const handleDragEnd = async (e: L.DragEndEvent) => {
    const marker = e.target;
    const position = marker.getLatLng();
    const newLat = position.lat;
    const newLng = position.lng;
    
    // Optimistically update address UI
    setIsFetching(true);
    setAddress(null);

    const newAddress = await reverseGeocode(newLat, newLng);
    setIsFetching(false);
    setAddress(newAddress);
    
    onUpdatePin(pin.id, { 
        lat: newLat, 
        lng: newLng, 
        address: newAddress || undefined 
    });
  };

  return (
    <Marker 
      position={[pin.lat, pin.lng]} 
      icon={getMarkerIcon(pin.color, pin.icon, hoveredPinId === pin.id)}
      zIndexOffset={hoveredPinId === pin.id ? 1000 : 0}
      ref={(ref) => setMarkerRef(pin.id, ref)}
      draggable={!readOnly}
      eventHandlers={{
        click: () => fetchAddress(),
        mouseover: () => onHoverPin?.(pin.id),
        mouseout: () => onHoverPin?.(null),
        popupopen: () => {
          fetchAddress();
        },
        dragend: handleDragEnd
      }}
    >
      <Popup className="modern-popup">
        <div style={{ minWidth: '220px', maxWidth: '320px' }}>
          <div style={{ padding: '4px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px', gap: '12px' }}>
              <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '800', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pin.label}</h3>
                  {(address || isFetching) && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: '1.2' }}>
                        {isFetching ? 'Fetching address...' : address}
                      </div>
                  )}
              </div>
              {!readOnly && (
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    map.closePopup();
                    onEditPin(pin.id);
                  }}
                  style={{ background: 'var(--bg-color)', color: 'var(--primary-color)', border: '1px solid var(--primary-color)', borderRadius: '6px', padding: '4px 10px', fontSize: '0.7rem', fontWeight: '700', cursor: 'pointer', flexShrink: 0 }}
                >
                  EDIT
                </button>
              )}
            </div>
            
            {pin.imageUrl && (
              <div style={{ borderRadius: 'var(--radius-sm)', overflow: 'hidden', margin: '12px 0', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
                <img 
                  src={pin.imageUrl} 
                  alt={pin.label} 
                  style={{ width: '100%', height: 'auto', display: 'block' }} 
                  onError={(e) => (e.currentTarget.parentElement!.style.display = 'none')}
                />
              </div>
            )}
            
            {pin.description && (
              <p style={{ margin: '8px 0 16px 0', fontSize: '0.95rem', color: 'var(--text-secondary)', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                {pin.description}
              </p>
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
        </div>
      </Popup>
    </Marker>
  );
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
  onHoverPin,
  hiddenGroupIds,
  previewLocation
}: MapViewProps) => {
  const markerRefs = useRef<Record<string, L.Marker | null>>({});
  const mapRef = useRef<L.Map | null>(null);
  const readOnly = userRole === 'view';

  // Filter pins based on hiddenGroupIds
  const visiblePins = pins.filter(pin => !hiddenGroupIds?.has(pin.groupId || null));

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
        {visiblePins.map((pin) => (
          <PinMarker 
            key={pin.id} 
            pin={pin}
            onEditPin={onEditPin}
            onUpdatePin={onUpdatePin}
            onHoverPin={onHoverPin}
            hoveredPinId={hoveredPinId}
            readOnly={readOnly}
            setMarkerRef={(id, marker) => { markerRefs.current[id] = marker; }}
          />
        ))}
        {previewLocation && (
          <Marker 
            position={[previewLocation.lat, previewLocation.lng]} 
            icon={getPreviewMarkerIcon('#ef4444')}
            interactive={false}
            zIndexOffset={1000}
          />
        )}
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
