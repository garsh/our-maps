import { useState } from 'react';
import SearchBar from './SearchBar';
import type { Pin, PinColor, PinIcon } from '@shared/interfaces';
import { 
  Bed, 
  Utensils, 
  Plane, 
  Trees, 
  Landmark, 
  ShoppingBag, 
  Camera, 
  MapPin,
  type LucideIcon
} from 'lucide-react';

interface SidebarProps {
  mapName: string;
  onMapNameChange: (name: string) => void;
  pins: Pin[];
  onResultSelect: (lat: number, lng: number) => void;
  onAddPin: (lat: number, lng: number, label: string) => void;
  onRemovePin: (id: string) => void;
  onPinClick: (lat: number, lng: number) => void;
  onUpdatePin: (id: string, updates: Partial<Pin>) => void;
}

const COLORS: PinColor[] = ['blue', 'red', 'green', 'orange', 'violet'];
const ICONS: { type: PinIcon; Icon: LucideIcon }[] = [
  { type: 'default', Icon: MapPin },
  { type: 'hotel', Icon: Bed },
  { type: 'restaurant', Icon: Utensils },
  { type: 'airport', Icon: Plane },
  { type: 'park', Icon: Trees },
  { type: 'museum', Icon: Landmark },
  { type: 'shopping', Icon: ShoppingBag },
  { type: 'camera', Icon: Camera },
];

const Sidebar = ({
  mapName,
  onMapNameChange,
  pins,
  onResultSelect,
  onAddPin,
  onRemovePin,
  onPinClick,
  onUpdatePin
}: SidebarProps) => {
  const [editingPinId, setEditingPinId] = useState<string | null>(null);

  return (
    <aside style={{ width: '300px', background: '#f8f9fa', borderRight: '1px solid #dee2e6', display: 'flex', flexDirection: 'column', padding: '1.5rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <label htmlFor="map-name" style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>Map Name</label>
        <input 
          id="map-name"
          type="text" 
          value={mapName} 
          onChange={(e) => onMapNameChange(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ced4da', boxSizing: 'border-box' }}
        />
      </div>

      <SearchBar onResultSelect={onResultSelect} onAddPin={onAddPin} />

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <h3 style={{ borderBottom: '1px solid #dee2e6', paddingBottom: '0.5rem' }}>Pins ({pins.length})</h3>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {pins.map((pin) => (
            <li key={pin.id} style={{ padding: '0.8rem', borderBottom: '1px solid #eee' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: editingPinId === pin.id ? '10px' : '0' }}>
                <div 
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '10px', cursor: 'pointer', flex: 1 }}
                  onClick={() => onPinClick(pin.lat, pin.lng)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div data-color={pin.color || 'blue'} style={{ width: '16px', height: '16px', borderRadius: '50%', background: pin.color || 'blue', border: '1px solid #999', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {pin.icon && pin.icon !== 'default' && (
                        (() => {
                          const iconObj = ICONS.find(i => i.type === pin.icon);
                          if (iconObj) {
                            const { Icon } = iconObj;
                            return <Icon size={10} color="white" />;
                          }
                          return null;
                        })()
                      )}
                    </div>
                    <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{pin.label}</div>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>{pin.lat.toFixed(3)}, {pin.lng.toFixed(3)}</div>
                </div>
                <div style={{ display: 'flex', gap: '5px' }}>
                  <button 
                    onClick={() => setEditingPinId(editingPinId === pin.id ? null : pin.id)}
                    style={{ background: '#3498db', color: 'white', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '0.8rem' }}
                  >
                    {editingPinId === pin.id ? 'Close' : 'Edit'}
                  </button>
                  <button 
                    onClick={() => onRemovePin(pin.id)}
                    style={{ background: '#e74c3c', color: 'white', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontSize: '0.8rem' }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {editingPinId === pin.id && (
                <div style={{ padding: '10px', background: '#fff', borderRadius: '4px', border: '1px solid #ddd', marginTop: '10px' }}>
                  <div style={{ marginBottom: '8px' }}>
                    <label htmlFor={`label-${pin.id}`} style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Label</label>
                    <input 
                      id={`label-${pin.id}`}
                      type="text" 
                      value={pin.label} 
                      onChange={(e) => onUpdatePin(pin.id, { label: e.target.value })}
                      style={{ width: '100%', padding: '4px', fontSize: '0.85rem' }}
                    />
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Color</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {COLORS.map(color => (
                        <button
                          key={color}
                          aria-label={`color-${color}`}
                          onClick={() => onUpdatePin(pin.id, { color })}
                          style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '50%',
                            background: color,
                            border: pin.color === color || (!pin.color && color === 'blue') ? '2px solid #333' : '1px solid #ccc',
                            cursor: 'pointer',
                            padding: 0
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Icon</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                      {ICONS.map(({ type, Icon }) => (
                        <button
                          key={type}
                          aria-label={`icon-${type}`}
                          onClick={() => onUpdatePin(pin.id, { icon: type })}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '4px',
                            borderRadius: '4px',
                            background: pin.icon === type || (!pin.icon && type === 'default') ? '#eee' : 'transparent',
                            border: pin.icon === type || (!pin.icon && type === 'default') ? '1px solid #333' : '1px solid #ccc',
                            cursor: 'pointer'
                          }}
                        >
                          <Icon size={16} color={pin.color || 'blue'} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <label htmlFor={`desc-${pin.id}`} style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Description</label>
                    <textarea 
                      id={`desc-${pin.id}`}
                      value={pin.description || ''} 
                      onChange={(e) => onUpdatePin(pin.id, { description: e.target.value })}
                      style={{ width: '100%', padding: '4px', fontSize: '0.85rem', minHeight: '60px' }}
                    />
                  </div>
                  <div style={{ marginBottom: '4px' }}>
                    <label htmlFor={`img-${pin.id}`} style={{ display: 'block', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '4px' }}>Image URL</label>
                    <input 
                      id={`img-${pin.id}`}
                      type="text" 
                      value={pin.imageUrl || ''} 
                      onChange={(e) => onUpdatePin(pin.id, { imageUrl: e.target.value })}
                      style={{ width: '100%', padding: '4px', fontSize: '0.85rem' }}
                    />
                  </div>
                </div>
              )}
            </li>
          ))}
          {pins.length === 0 && (
            <li style={{ padding: '2rem 1rem', color: '#999', textAlign: 'center', fontStyle: 'italic' }}>
              Click the map or search to add your first pin!
            </li>
          )}
        </ul>
      </div>
    </aside>
  );
};

export default Sidebar;
