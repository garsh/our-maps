import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Pin } from '@shared/interfaces';
import { useEffect } from 'react';
import { getMarkerIcon } from '../utils/mapUtils';

interface MapViewProps {
  center?: [number, number];
  zoom?: number;
  pins: Pin[];
  onMapClick: (lat: number, lng: number) => void;
  targetLocation?: [number, number] | null;
}

const MapEvents = ({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) => {
  useMapEvents({
    click: (e) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
};

const MapController = ({ targetLocation }: { targetLocation?: [number, number] | null }) => {
  const map = useMap();
  
  useEffect(() => {
    if (targetLocation) {
      map.flyTo(targetLocation, 14);
    }
  }, [targetLocation, map]);

  return null;
};

const MapView = ({ center = [20, 0], zoom = 3, pins, onMapClick, targetLocation }: MapViewProps) => {
  return (
    <MapContainer 
      center={center} 
      zoom={zoom} 
      style={{ height: '100%', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <MapEvents onMapClick={onMapClick} />
      <MapController targetLocation={targetLocation} />
      {pins.map((pin) => (
        <Marker key={pin.id} position={[pin.lat, pin.lng]} icon={getMarkerIcon(pin.color)}>
          <Popup>
            <div style={{ maxWidth: '200px' }}>
              <strong style={{ display: 'block', fontSize: '1.1rem', marginBottom: '5px' }}>{pin.label}</strong>
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
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
};

export default MapView;
