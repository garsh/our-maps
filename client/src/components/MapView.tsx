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
  hiddenLayerIds?: Set<string | null>;
  previewLocation?: {lat: number, lng: number} | null;
  bottomPadding?: number;
  editingPinId?: string | null;
  onBackgroundClick?: () => void;
}

const MapEvents = ({ onMapClick, onBoundsChange, onBackgroundClick, bottomPadding = 0 }: { onMapClick: (lat: number, lng: number) => void, onBoundsChange: (bounds: string) => void, onBackgroundClick?: () => void, bottomPadding?: number }) => {
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
    click: () => {
      onBackgroundClick?.();
    },
    moveend: updateBounds,
    zoomend: updateBounds
  });
  return null;
};

const MapController = ({ targetLocation, boundsToFit, targetPinId, pins, bottomPadding = 0 }: { targetLocation?: [number, number] | null, boundsToFit?: L.LatLngBounds | null, targetPinId?: string | null, pins?: Pin[], bottomPadding?: number }) => {
  const map = useMap();
  const lastTarget = useRef<[number, number] | null>(null);
  const lastTargetPinId = useRef<string | null>(null);
  
  useEffect(() => {
    if (targetLocation && (targetLocation[0] !== lastTarget.current?.[0] || targetLocation[1] !== lastTarget.current?.[1])) {
      map.flyTo(targetLocation, 14, { duration: 1.5 });
      lastTarget.current = targetLocation;
    }
  }, [targetLocation, map]);

  useEffect(() => {
    if (!targetPinId || targetPinId === lastTargetPinId.current) return;
    lastTargetPinId.current = targetPinId;
    const pin = pins?.find(p => p.id === targetPinId);
    if (!pin) return;
    const bounds = map.getBounds();
    if (!bounds.contains([pin.lat, pin.lng])) {
      map.flyTo([pin.lat, pin.lng], map.getZoom(), { duration: 1.2 });
    }
  }, [targetPinId, pins, map]);

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
  editingPinId,
  readOnly,
  setMarkerRef
}: { 
  pin: Pin, 
  onUpdatePin: (id: string, updates: Partial<Pin>) => void, 
  onHoverPin?: (id: string | null) => void, 
  onPinClick?: (pin: Pin) => void,
  hoveredPinId?: string | null, 
  targetPinId?: string | null,
  editingPinId?: string | null,
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
      icon={getMarkerIcon(pin.color, pin.icon, hoveredPinId === pin.id || targetPinId === pin.id || editingPinId === pin.id)}
      zIndexOffset={hoveredPinId === pin.id || targetPinId === pin.id || editingPinId === pin.id ? 1000 : 0}
      ref={(ref) => setMarkerRef(pin.id, ref)}
      draggable={!readOnly && editingPinId === pin.id}
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
  hiddenLayerIds,
  previewLocation,
  bottomPadding = 0,
  editingPinId,
  onBackgroundClick
}: MapViewProps) => {
  const markerRefs = useRef<Record<string, L.Marker | null>>({});
  const mapRef = useRef<L.Map | null>(null);
  const readOnly = userRole === 'view';

  // Filter pins based on hiddenLayerIds
  const visiblePins = pins.filter(pin => !hiddenLayerIds?.has(pin.layerId || null));

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
          attribution='&copy; <a href="https://stadiamaps.com/">Stadia Maps</a>, &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors'
          url={`https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}{r}.png?api_key=${import.meta.env.VITE_STADIA_API_KEY}`}
          noWrap={true}
        />
        <MapEvents onMapClick={onMapClick} onBoundsChange={onBoundsChange} onBackgroundClick={onBackgroundClick} bottomPadding={bottomPadding} />
        <MapController targetLocation={targetLocation} boundsToFit={boundsToFit} targetPinId={targetPinId} pins={pins} bottomPadding={bottomPadding} />
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
            editingPinId={editingPinId}
            readOnly={readOnly}
            setMarkerRef={(id, ref) => { markerRefs.current[id] = ref; }}
          />
        ))}
        {previewLocation && (
          <Marker 
            position={[previewLocation.lat, previewLocation.lng]} 
            icon={getPreviewMarkerIcon()}
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
