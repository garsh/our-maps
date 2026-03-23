import { useState, useEffect } from 'react';
import SearchBar from './SearchBar';
import type { Pin, PinColor, PinIcon, PinGroup } from '@shared/interfaces';
import { 
  Bed, 
  Utensils, 
  Plane, 
  Trees, 
  Landmark, 
  ShoppingBag, 
  Camera, 
  MapPin,
  type LucideIcon,
  GripVertical,
  Trash2,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  Download,
  Upload,
  FileJson,
  Map as MapIcon,
  Globe as GlobeIcon
} from 'lucide-react';
import {
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { exportMap, importMapFile } from '../utils/fileUtils';
import type { MapData } from '@shared/interfaces';

interface SidebarProps {
  mapName: string;
  onMapNameChange: (name: string) => void;
  groups: PinGroup[];
  onAddGroup: () => void;
  onUpdateGroup: (id: string, updates: Partial<PinGroup>) => void;
  onRemoveGroup: (id: string) => void;
  pins: Pin[];
  onResultSelect: (lat: number, lng: number) => void;
  onAddPin: (lat: number, lng: number, label: string) => void;
  onRemovePin: (id: string) => void;
  onPinClick: (pin: Pin) => void;
  onUpdatePin: (id: string, updates: Partial<Pin>) => void;
  onDragEnd: (event: DragEndEvent) => void;
  userRole?: 'owner' | 'edit' | 'view';
  onShare?: () => void;
  onImport?: (data: Partial<MapData>) => void;
  mapBounds?: string | null;
  editingPinId: string | null;
  onSetEditingPinId: (id: string | null) => void;
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

const SortablePin = ({ 
  pin, 
  onPinClick, 
  onRemovePin, 
  onUpdatePin,
  editingPinId,
  setEditingPinId,
  readOnly
}: { 
  pin: Pin, 
  onPinClick: (pin: Pin) => void,
  onRemovePin: (id: string) => void,
  onUpdatePin: (id: string, updates: Partial<Pin>) => void,
  editingPinId: string | null,
  setEditingPinId: (id: string | null) => void,
  readOnly: boolean
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ 
    id: pin.id,
    data: { type: 'pin', pin },
    disabled: readOnly
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li 
      id={`pin-${pin.id}`}
      ref={setNodeRef} 
      style={{ ...style, padding: '0.6rem', borderBottom: '1px solid #eee', background: 'white' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
          {!readOnly && (
            <div {...attributes} {...listeners} style={{ cursor: 'grab', marginRight: '8px', color: '#ccc' }}>
              <GripVertical size={16} />
            </div>
          )}
          <div 
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', flex: 1 }}
            onClick={() => onPinClick(pin)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div 
                data-color={pin.color || 'blue'} 
                style={{ width: '16px', height: '16px', borderRadius: '50%', background: pin.color || 'blue', border: '1px solid #999', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
              >
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
              <div style={{ fontWeight: 'bold', fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pin.label}</div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {!readOnly && (
            <button 
              onClick={() => setEditingPinId(editingPinId === pin.id ? null : pin.id)}
              style={{ background: '#3498db', color: 'white', border: 'none', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer', fontSize: '0.7rem' }}
            >
              {editingPinId === pin.id ? 'Close' : 'Edit'}
            </button>
          )}
          {!readOnly && (
            <button 
              onClick={() => onRemovePin(pin.id)}
              style={{ background: '#e74c3c', color: 'white', border: 'none', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer', fontSize: '0.7rem' }}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {editingPinId === pin.id && !readOnly && (
        <div style={{ padding: '8px', background: '#f9f9f9', borderRadius: '4px', border: '1px solid #ddd', marginTop: '8px', fontSize: '0.8rem' }}>
          <div style={{ marginBottom: '6px' }}>
            <label htmlFor={`label-${pin.id}`} style={{ display: 'block', fontWeight: 'bold', marginBottom: '2px' }}>Label</label>
            <input 
              id={`label-${pin.id}`}
              type="text" 
              value={pin.label} 
              onChange={(e) => onUpdatePin(pin.id, { label: e.target.value })}
              style={{ width: '100%', padding: '2px 4px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: '6px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '2px' }}>Color</label>
            <div style={{ display: 'flex', gap: '4px' }}>
              {COLORS.map(color => (
                <button
                  key={color}
                  aria-label={`color-${color}`}
                  onClick={() => onUpdatePin(pin.id, { color })}
                  style={{
                    width: '18px',
                    height: '18px',
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
          <div style={{ marginBottom: '6px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '2px' }}>Icon</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
              {ICONS.map(({ type, Icon }) => (
                <button
                  key={type}
                  aria-label={`icon-${type}`}
                  onClick={() => onUpdatePin(pin.id, { icon: type })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '2px',
                    borderRadius: '4px',
                    background: pin.icon === type || (!pin.icon && type === 'default') ? '#eee' : 'transparent',
                    border: pin.icon === type || (!pin.icon && type === 'default') ? '1px solid #333' : '1px solid #ccc',
                    cursor: 'pointer'
                  }}
                >
                  <Icon size={12} color={pin.color || 'blue'} />
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: '6px' }}>
            <label htmlFor={`desc-${pin.id}`} style={{ display: 'block', fontWeight: 'bold', marginBottom: '2px' }}>Description</label>
            <textarea 
              id={`desc-${pin.id}`}
              value={pin.description || ''} 
              onChange={(e) => onUpdatePin(pin.id, { description: e.target.value })}
              style={{ width: '100%', padding: '2px 4px', minHeight: '40px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: '4px' }}>
            <label htmlFor={`img-${pin.id}`} style={{ display: 'block', fontWeight: 'bold', marginBottom: '2px' }}>Image URL</label>
            <input 
              id={`img-${pin.id}`}
              type="text" 
              value={pin.imageUrl || ''} 
              onChange={(e) => onUpdatePin(pin.id, { imageUrl: e.target.value })}
              style={{ width: '100%', padding: '2px 4px', boxSizing: 'border-box' }}
            />
          </div>
        </div>
      )}
    </li>
  );
};

const SortableGroup = ({ 
  group, 
  groupPins,
  onUpdateGroup,
  onRemoveGroup,
  onPinClick,
  onRemovePin,
  onUpdatePin,
  editingPinId,
  onSetEditingPinId,
  readOnly
}: { 
  group: PinGroup,
  groupPins: Pin[],
  onUpdateGroup: (id: string, updates: Partial<PinGroup>) => void,
  onRemoveGroup: (id: string) => void,
  onPinClick: (pin: Pin) => void,
  onRemovePin: (id: string) => void,
  onUpdatePin: (id: string, updates: Partial<Pin>) => void,
  editingPinId: string | null,
  onSetEditingPinId: (id: string | null) => void,
  readOnly: boolean
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ 
    id: group.id,
    data: { type: 'group', group },
    disabled: readOnly
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    marginBottom: '1rem',
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        background: '#e9ecef', 
        padding: '0.5rem', 
        borderRadius: '4px',
        fontWeight: 'bold',
        fontSize: '0.9rem'
      }}>
        {!readOnly && (
          <div {...attributes} {...listeners} style={{ cursor: 'grab', marginRight: '8px', color: '#666' }}>
            <GripVertical size={16} />
          </div>
        )}
        <div onClick={() => setIsExpanded(!isExpanded)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', flex: 1 }}>
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {isEditingName && !readOnly ? (
            <input 
              autoFocus
              value={group.name}
              onChange={(e) => onUpdateGroup(group.id, { name: e.target.value })}
              onBlur={() => setIsEditingName(false)}
              onKeyDown={(e) => e.key === 'Enter' && setIsEditingName(false)}
              style={{ fontSize: '0.9rem', padding: '2px 4px', width: '100%' }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span onDoubleClick={() => !readOnly && setIsEditingName(true)} style={{ marginLeft: '4px' }}>
              {group.name} ({groupPins.length})
            </span>
          )}
        </div>
        {!readOnly && (
          <button 
            onClick={() => onRemoveGroup(group.id)}
            style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', padding: '4px' }}
            title="Delete Group"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      
      {isExpanded && (
        <div style={{ minHeight: '20px', paddingLeft: '8px', borderLeft: '2px solid #e9ecef', marginTop: '4px' }}>
          <SortableContext items={groupPins.map(p => p.id)} strategy={verticalListSortingStrategy}>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {groupPins.map(pin => (
                <SortablePin 
                  key={pin.id} 
                  pin={pin} 
                  onPinClick={onPinClick}
                  onRemovePin={onRemovePin}
                  onUpdatePin={onUpdatePin}
                  editingPinId={editingPinId}
                  setEditingPinId={onSetEditingPinId}
                  readOnly={readOnly}
                />
              ))}
              {groupPins.length === 0 && !readOnly && (
                <li style={{ padding: '10px', color: '#999', fontSize: '0.8rem', fontStyle: 'italic', textAlign: 'center' }}>
                  Drag pins here
                </li>
              )}
            </ul>
          </SortableContext>
        </div>
      )}
    </div>
  );
};

const Sidebar = ({
  mapName,
  onMapNameChange,
  groups,
  onAddGroup,
  onUpdateGroup,
  onRemoveGroup,
  pins,
  onResultSelect,
  onAddPin,
  onRemovePin,
  onPinClick,
  onUpdatePin,
  onDragEnd,
  userRole = 'owner',
  onShare,
  onImport,
  mapBounds,
  editingPinId,
  onSetEditingPinId
}: SidebarProps) => {
  const [localMapName, setLocalMapName] = useState(mapName);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const readOnly = userRole === 'view';

  useEffect(() => {
    setLocalMapName(mapName);
  }, [mapName]);

  const handleExport = (format: 'json' | 'geojson' | 'kml') => {
    exportMap({ 
      id: '', 
      name: mapName, 
      pins, 
      groups,
      ownerId: '' 
    }, format);
    setIsExportOpen(false);
  };

  const handleImportClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.geojson,.kml';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file && onImport) {
        try {
          const data = await importMapFile(file);
          onImport(data);
        } catch (err: any) {
          alert(err.message);
        }
      }
    };
    input.click();
  };

  const sensors = useSensors(

    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const defaultPins = pins.filter(p => !p.groupId);

  return (
    <aside style={{ flex: 1, background: '#f8f9fa', display: 'flex', flexDirection: 'column', padding: '1.5rem', boxSizing: 'border-box', overflow: 'hidden' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <label htmlFor="map-name" style={{ display: 'block', fontWeight: 'bold' }}>Map Name</label>
          {userRole === 'owner' && (
            <button 
              onClick={onShare}
              style={{ fontSize: '0.8rem', background: '#3498db', color: 'white', border: 'none', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer' }}
            >
              Share
            </button>
          )}
        </div>
        <input 
          id="map-name"
          type="text" 
          value={localMapName} 
          onChange={(e) => setLocalMapName(e.target.value)}
          onBlur={() => onMapNameChange(localMapName)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur(); // Trigger blur to save
            }
          }}
          disabled={readOnly}
          style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ced4da', boxSizing: 'border-box' }}
        />
        <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#666' }}>
          Role: <span style={{ fontWeight: 'bold', textTransform: 'uppercase' }}>{userRole}</span>
        </div>
      </div>

      <SearchBar 
        onResultSelect={onResultSelect} 
        onAddPin={onAddPin} 
        pins={pins} 
        disabled={readOnly} 
        mapBounds={mapBounds}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', marginTop: '1rem' }}>
        <h3 style={{ margin: 0 }}>Pins ({pins.length})</h3>
        {!readOnly && (
          <button 
            onClick={onAddGroup}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#fff', border: '1px solid #ced4da', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
          >
            <FolderPlus size={14} /> Add Group
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
        <DndContext 
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={groups.map(g => g.id)} strategy={verticalListSortingStrategy} disabled={readOnly}>
            {groups.map(group => (
              <SortableGroup 
                key={group.id} 
                group={group} 
                groupPins={pins.filter(p => p.groupId === group.id).sort((a, b) => a.position - b.position)}
                onUpdateGroup={onUpdateGroup}
                onRemoveGroup={onRemoveGroup}
                onPinClick={onPinClick}
                onRemovePin={onRemovePin}
                onUpdatePin={onUpdatePin}
                editingPinId={editingPinId}
                onSetEditingPinId={onSetEditingPinId}
                readOnly={readOnly}
              />
            ))}
          </SortableContext>

          <div style={{ marginTop: groups.length > 0 ? '2rem' : '0' }}>
            <h4 style={{ fontSize: '0.85rem', color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #eee', paddingBottom: '4px', marginBottom: '0.5rem' }}>
              Default Pins
            </h4>
            <SortableContext items={defaultPins.map(p => p.id)} strategy={verticalListSortingStrategy} disabled={readOnly}>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {defaultPins.map((pin) => (
                  <SortablePin 
                    key={pin.id} 
                    pin={pin} 
                    onPinClick={onPinClick}
                    onRemovePin={onRemovePin}
                    onUpdatePin={onUpdatePin}
                    editingPinId={editingPinId}
                    setEditingPinId={onSetEditingPinId}
                    readOnly={readOnly}
                  />
                ))}
                {defaultPins.length === 0 && groups.length === 0 && (
                  <li style={{ padding: '2rem 1rem', color: '#999', textAlign: 'center', fontStyle: 'italic', fontSize: '0.9rem' }}>
                    {readOnly ? 'No pins available.' : 'Click the map or search to add your first pin!'}
                  </li>
                )}
              </ul>
            </SortableContext>
          </div>
        </DndContext>
      </div>

      <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #dee2e6' }}>
        <div style={{ display: 'flex', gap: '8px', position: 'relative' }}>
          <button 
            onClick={() => setIsExportOpen(!isExportOpen)}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: '#fff', border: '1px solid #ced4da', padding: '8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}
          >
            <Download size={16} /> Export
          </button>
          {!readOnly && (
            <button 
              onClick={handleImportClick}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', background: '#fff', border: '1px solid #ced4da', padding: '8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}
            >
              <Upload size={16} /> Import
            </button>
          )}

          {isExportOpen && (
            <div style={{ position: 'absolute', bottom: '100%', left: 0, width: '100%', background: 'white', border: '1px solid #ddd', borderRadius: '4px', boxShadow: '0 -4px 12px rgba(0,0,0,0.1)', marginBottom: '8px', zIndex: 1600 }}>
              <div 
                style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #eee' }}
                onClick={() => handleExport('json')}
                onMouseEnter={(e) => e.currentTarget.style.background = '#f8f9fa'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <FileJson size={14} color="#666" /> <span>Full JSON (.json)</span>
              </div>
              <div 
                style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #eee' }}
                onClick={() => handleExport('geojson')}
                onMouseEnter={(e) => e.currentTarget.style.background = '#f8f9fa'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <GlobeIcon size={14} color="#666" /> <span>GeoJSON (.geojson)</span>
              </div>
              <div 
                style={{ padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
                onClick={() => handleExport('kml')}
                onMouseEnter={(e) => e.currentTarget.style.background = '#f8f9fa'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <MapIcon size={14} color="#666" /> <span>KML (.kml)</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
