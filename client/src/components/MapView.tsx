import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Pin } from '@shared/interfaces';
import { useEffect, useRef, useState } from 'react';
import { getMarkerIcon, getPreviewMarkerIcon } from '../utils/mapUtils';
import L from 'leaflet';
import { Locate } from 'lucide-react';
import { reverseGeocode } from '../utils/geocoding';

interface MapViewProps {
  center?: [number, number];
  zoom?: number;
  pins: Pin[];
  onMapClick: (lat: number, lng: number) => void;
  onPinClick?: (pin: Pin) => void;
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
  bottomPadding?: number;
}

const MapEvents = ({ onMapClick, onBoundsChange, bottomPadding = 0 }: { onMapClick: (lat: number, lng: number) => void, onBoundsChange: (bounds: string) => void, bottomPadding?: number }) => {
  const map = useMap();

  const updateBounds = () => {
    const size = map.getSize();
    const paddingPx = bottomPadding;
    
    // Get visible bounds by translating the container points
    const nw = map.containerPointToLatLng([0, 0]);
    const se = map.containerPointToLatLng([size.x, size.y - paddingPx]);
    
    onBoundsChange(`${nw.lng},${nw.lat},${se.lng},${se.lat}`);
  };

  useEffect(() => {
    updateBounds();
  }, [bottomPadding, map]);

  useMapEvents({
    contextmenu: (e) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
    moveend: updateBounds,
    zoomend: updateBounds
  });
  return null;
};

const MapController = ({ targetLocation, boundsToFit, bottomPadding = 0 }: { targetLocation?: [number, number] | null, boundsToFit?: L.LatLngBounds | null, bottomPadding?: number }) => {
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
      const paddingPx = bottomPadding;
      map.fitBounds(boundsToFit, { 
        paddingTopLeft: [50, 50],
        paddingBottomRight: [50, 50 + paddingPx],
        maxZoom: 16 
      });
    }
  }, [boundsToFit, map, bottomPadding]);

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
  onUpdatePin, 
  onHoverPin, 
  onPinClick,
  hoveredPinId, 
  targetPinId,
  readOnly,
  setMarkerRef
}: { 
  pin: Pin, 
  onUpdatePin: (id: string, updates: Partial<Pin>) => void, 
  onHoverPin?: (id: string | null) => void, 
  onPinClick?: (pin: Pin) => void,
  hoveredPinId?: string | null, 
  targetPinId?: string | null,
  readOnly: boolean,
  setMarkerRef: (id: string, marker: L.Marker | null) => void
}) => {
  const handleDragEnd = async (e: L.DragEndEvent) => {
    const marker = e.target;
    const position = marker.getLatLng();
    const newLat = position.lat;
    const newLng = position.lng;

    const newAddress = await reverseGeocode(newLat, newLng);
    
    onUpdatePin(pin.id, { 
        lat: newLat, 
        lng: newLng, 
        address: newAddress || undefined 
    });
  };

  return (
    <Marker 
      position={[pin.lat, pin.lng]} 
      icon={getMarkerIcon(pin.color, pin.icon, hoveredPinId === pin.id || targetPinId === pin.id)}
      zIndexOffset={hoveredPinId === pin.id || targetPinId === pin.id ? 1000 : 0}
      ref={(ref) => setMarkerRef(pin.id, ref)}
      draggable={!readOnly}
      eventHandlers={{
        click: () => onPinClick?.(pin),
        mouseover: () => onHoverPin?.(pin.id),
        mouseout: () => onHoverPin?.(null),
        dragend: handleDragEnd
      }}
    />
  );
}

const MapView = ({ 
  center = [20, 0], 
  zoom = 3, 
  pins, 
  onMapClick, 
  onPinClick,
  onUpdatePin, 
  onBoundsChange, 
  targetLocation, 
  targetPinId, 
  boundsToFit, 
  userRole = 'owner',
  hoveredPinId,
  onHoverPin,
  hiddenGroupIds,
  previewLocation,
  bottomPadding = 0
}: MapViewProps) => {
  const markerRefs = useRef<Record<string, L.Marker | null>>({});
  const mapRef = useRef<L.Map | null>(null);
  const readOnly = userRole === 'view';

  // Filter pins based on hiddenGroupIds
  const visiblePins = pins.filter(pin => !hiddenGroupIds?.has(pin.groupId || null));

  // Removed popup open logic

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
        <MapEvents onMapClick={onMapClick} onBoundsChange={onBoundsChange} bottomPadding={bottomPadding} />
        <MapController targetLocation={targetLocation} boundsToFit={boundsToFit} bottomPadding={bottomPadding} />
        <UserLocationMarker />
        {visiblePins.map((pin) => (
          <PinMarker 
            key={pin.id} 
            pin={pin}
            onUpdatePin={onUpdatePin}
            onHoverPin={onHoverPin}
            onPinClick={onPinClick}
            hoveredPinId={hoveredPinId}
            targetPinId={targetPinId}
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
