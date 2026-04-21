import { useState, useEffect } from 'react';
import SearchBar from './SearchBar';
import type { Pin, PinIcon, PinGroup } from '@shared/interfaces';
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

const COLORS = [
  { name: 'blue', value: '#2A81CB' },
  { name: 'red', value: '#CB2B3E' },
  { name: 'green', value: '#2AAD27' },
  { name: 'orange', value: '#CB8427' },
  { name: 'violet', value: '#9C2BCB' }
];

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
    zIndex: isDragging ? 10 : 0,
    opacity: isDragging ? 0.5 : 1,
  };

  const currentColor = COLORS.find(c => c.name === pin.color)?.value || pin.color || '#2A81CB';

  return (
    <li 
      id={`pin-${pin.id}`}
      ref={setNodeRef} 
      style={{ 
        ...style, 
        padding: '0.75rem 1rem', 
        marginBottom: '4px',
        borderRadius: 'var(--radius-sm)',
        background: editingPinId === pin.id ? 'var(--bg-color)' : 'white',
        border: editingPinId === pin.id ? '1px solid var(--primary-color)' : '1px solid transparent',
        boxShadow: isDragging ? 'var(--shadow-md)' : 'none',
        transition: 'all 0.2s ease'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
          {!readOnly && (
            <div {...attributes} {...listeners} style={{ cursor: 'grab', marginRight: '12px', color: '#ccc' }}>
              <GripVertical size={16} />
            </div>
          )}
          <div 
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', flex: 1 }}
            onClick={() => onPinClick(pin)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div 
                style={{ 
                  width: '32px', 
                  height: '32px', 
                  borderRadius: '10px', 
                  background: `${currentColor}15`, 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  flexShrink: 0 
                }}
              >
                {(() => {
                    const iconObj = ICONS.find(i => i.type === pin.icon) || ICONS[0];
                    const { Icon } = iconObj;
                    return <Icon size={16} color={currentColor} />;
                })()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: '700', fontSize: '0.9rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pin.label}</div>
                {pin.description && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pin.description}</div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginLeft: '8px' }}>
          {!readOnly && (
            <button 
              onClick={() => setEditingPinId(editingPinId === pin.id ? null : pin.id)}
              style={{ 
                background: editingPinId === pin.id ? 'var(--primary-color)' : 'transparent', 
                color: editingPinId === pin.id ? 'white' : 'var(--primary-color)', 
                border: '1px solid var(--primary-color)', 
                borderRadius: '6px', 
                padding: '4px 8px', 
                cursor: 'pointer', 
                fontSize: '0.7rem',
                fontWeight: '600'
              }}
            >
              {editingPinId === pin.id ? 'Close' : 'Edit'}
            </button>
          )}
          {!readOnly && editingPinId !== pin.id && (
            <button 
              onClick={() => onRemovePin(pin.id)}
              style={{ background: 'transparent', color: '#aaa', border: 'none', padding: '4px', cursor: 'pointer' }}
              className="delete-btn"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {editingPinId === pin.id && !readOnly && (
        <div style={{ padding: '1rem 0 0 0', marginTop: '1rem', borderTop: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
          <div style={{ marginBottom: '12px' }}>
            <label htmlFor={`label-${pin.id}`} style={{ display: 'block', fontWeight: '700', marginBottom: '6px', color: 'var(--text-secondary)' }}>Name</label>
            <input 
              id={`label-${pin.id}`}
              type="text" 
              value={pin.label} 
              onChange={(e) => onUpdatePin(pin.id, { label: e.target.value })}
              className="input-field"
              style={{ padding: '8px 12px' }}
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontWeight: '700', marginBottom: '8px', color: 'var(--text-secondary)' }}>Color</label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {COLORS.map(color => (
                <button
                  key={color.name}
                  aria-label={`color-${color.name}`}
                  onClick={() => onUpdatePin(pin.id, { color: color.name })}
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '8px',
                    background: color.value,
                    border: pin.color === color.name || (!pin.color && color.name === 'blue') ? '2px solid var(--text-primary)' : 'none',
                    cursor: 'pointer',
                    padding: 0,
                    boxShadow: 'var(--shadow-sm)'
                  }}
                />
              ))}
              <div style={{ position: 'relative', width: '28px', height: '28px' }}>
                <input 
                  type="color"
                  value={(!pin.color || COLORS.some(c => c.name === pin.color)) ? '#8e44ad' : pin.color}
                  onChange={(e) => onUpdatePin(pin.id, { color: e.target.value })}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    opacity: 0,
                    cursor: 'pointer',
                    zIndex: 2
                  }}
                />
                <div 
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '8px',
                    background: (!pin.color || COLORS.some(c => c.name === pin.color)) ? '#f1f1f1' : pin.color,
                    border: pin.color && !COLORS.some(c => c.name === pin.color) ? '2px solid var(--text-primary)' : '1px dashed #ccc',
                    zIndex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                    color: pin.color && !COLORS.some(c => c.name === pin.color) ? 'white' : '#666'
                  }}
                >
                  +
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontWeight: '700', marginBottom: '8px', color: 'var(--text-secondary)' }}>Icon</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
              {ICONS.map(({ type, Icon }) => (
                <button
                  key={type}
                  aria-label={`icon-${type}`}
                  onClick={() => onUpdatePin(pin.id, { icon: type })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '36px',
                    borderRadius: '8px',
                    background: pin.icon === type || (!pin.icon && type === 'default') ? 'var(--primary-color)' : 'white',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <Icon size={16} color={pin.icon === type || (!pin.icon && type === 'default') ? 'white' : currentColor} />
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label htmlFor={`desc-${pin.id}`} style={{ display: 'block', fontWeight: '700', marginBottom: '6px', color: 'var(--text-secondary)' }}>Description</label>
            <textarea 
              id={`desc-${pin.id}`}
              value={pin.description || ''} 
              onChange={(e) => onUpdatePin(pin.id, { description: e.target.value })}
              className="input-field"
              style={{ minHeight: '80px', resize: 'vertical', padding: '8px 12px' }}
            />
          </div>
          
          <div style={{ marginBottom: '12px' }}>
            <label htmlFor={`img-${pin.id}`} style={{ display: 'block', fontWeight: '700', marginBottom: '6px', color: 'var(--text-secondary)' }}>Image URL</label>
            <input 
              id={`img-${pin.id}`}
              type="text" 
              value={pin.imageUrl || ''} 
              onChange={(e) => onUpdatePin(pin.id, { imageUrl: e.target.value })}
              className="input-field"
              placeholder="https://example.com/image.jpg"
              style={{ padding: '8px 12px' }}
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
    zIndex: isDragging ? 100 : 0
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        background: isExpanded ? 'rgba(72, 61, 139, 0.05)' : 'white', 
        padding: '0.75rem 1rem', 
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        transition: 'all 0.2s ease'
      }}>
        {!readOnly && (
          <div {...attributes} {...listeners} style={{ cursor: 'grab', marginRight: '12px', color: '#aaa' }}>
            <GripVertical size={16} />
          </div>
        )}
        <div onClick={() => setIsExpanded(!isExpanded)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--primary-color)', marginRight: '8px', display: 'flex' }}>
            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </div>
          {isEditingName && !readOnly ? (
            <input 
              autoFocus
              value={group.name}
              onChange={(e) => onUpdateGroup(group.id, { name: e.target.value })}
              onBlur={() => setIsEditingName(false)}
              onKeyDown={(e) => e.key === 'Enter' && setIsEditingName(false)}
              className="input-field"
              style={{ fontSize: '0.9rem', padding: '4px 8px', height: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span onDoubleClick={() => !readOnly && setIsEditingName(true)} style={{ fontWeight: '700', fontSize: '0.95rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {group.name} <span style={{ fontWeight: 'normal', color: '#aaa', fontSize: '0.8rem', marginLeft: '4px' }}>({groupPins.length})</span>
            </span>
          )}
        </div>
        {!readOnly && (
          <button 
            onClick={() => onRemoveGroup(group.id)}
            style={{ background: 'transparent', border: 'none', color: '#ccc', cursor: 'pointer', padding: '6px', borderRadius: '50%', display: 'flex' }}
            className="delete-group-btn"
            title="Delete Group"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
      
      {isExpanded && (
        <div style={{ paddingLeft: '1rem', borderLeft: '2px solid var(--border-color)', marginTop: '8px', marginLeft: '1.2rem' }}>
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
                <li style={{ padding: '1.5rem', color: '#aaa', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', border: '1px dashed #eee', borderRadius: 'var(--radius-sm)' }}>
                  No pins in this group yet
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
    <aside style={{ flex: 1, background: 'white', display: 'flex', flexDirection: 'column', padding: '1.5rem', boxSizing: 'border-box', overflow: 'hidden', borderRight: '1px solid var(--border-color)' }}>
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <label htmlFor="map-name" style={{ display: 'block', fontWeight: '800', fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>Map Configuration</label>
          {userRole === 'owner' && (
            <button 
              onClick={onShare}
              style={{ fontSize: '0.75rem', background: 'var(--bg-color)', color: 'var(--primary-color)', border: '1px solid var(--primary-color)', padding: '4px 12px', borderRadius: '50px', cursor: 'pointer', fontWeight: '700' }}
            >
              Share Access
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
              e.currentTarget.blur();
            }
          }}
          disabled={readOnly}
          className="input-field"
          style={{ fontWeight: '700', fontSize: '1.1rem' }}
        />
      </div>

      <SearchBar 
        onResultSelect={onResultSelect} 
        onAddPin={onAddPin} 
        pins={pins} 
        disabled={readOnly} 
        mapBounds={mapBounds}
      />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', marginTop: '1rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '800', color: 'var(--text-primary)' }}>Layers</h3>
        {!readOnly && (
          <button 
            onClick={onAddGroup}
            style={{ 
               display: 'flex', 
               alignItems: 'center', 
               gap: '6px', 
               background: 'transparent', 
               border: '1px solid var(--border-color)', 
               padding: '6px 12px', 
               borderRadius: 'var(--radius-sm)', 
               cursor: 'pointer', 
               fontSize: '0.8rem',
               fontWeight: '600',
               color: 'var(--text-secondary)'
            }}
          >
            <FolderPlus size={16} /> New Layer
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', margin: '0 -4px' }}>
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
            <h4 style={{ fontSize: '0.75rem', color: '#aaa', textTransform: 'uppercase', fontWeight: '800', letterSpacing: '0.1em', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', marginBottom: '1rem' }}>
              Default Layer
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
                  <li style={{ padding: '3rem 1rem', color: '#bbb', textAlign: 'center', fontSize: '0.9rem' }}>
                    <div style={{ background: 'var(--bg-color)', width: '60px', height: '60px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem auto' }}>
                      <MapPin size={30} />
                    </div>
                    {readOnly ? 'No pins available.' : 'Right-click the map or use the search bar above to start adding pins!'}
                  </li>
                )}
              </ul>
            </SortableContext>
          </div>
        </DndContext>
      </div>

      <div style={{ marginTop: 'auto', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', gap: '12px', position: 'relative' }}>
          <button 
            onClick={() => setIsExportOpen(!isExportOpen)}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'white', border: '1px solid var(--border-color)', padding: '10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-secondary)' }}
          >
            <Download size={18} /> Export
          </button>
          {!readOnly && (
            <button 
              onClick={handleImportClick}
              style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'white', border: '1px solid var(--border-color)', padding: '10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-secondary)' }}
            >
              <Upload size={18} /> Import
            </button>
          )}

          {isExportOpen && (
            <div style={{ position: 'absolute', bottom: '100%', left: 0, width: '100%', background: 'white', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', marginBottom: '12px', zIndex: 1600, overflow: 'hidden' }}>
              <div 
                style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-color)' }}
                onClick={() => handleExport('json')}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <FileJson size={16} color="var(--primary-color)" /> <span style={{ fontWeight: '600', fontSize: '0.85rem' }}>Full JSON (.json)</span>
              </div>
              <div 
                style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-color)' }}
                onClick={() => handleExport('geojson')}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <GlobeIcon size={16} color="#27ae60" /> <span style={{ fontWeight: '600', fontSize: '0.85rem' }}>GeoJSON (.geojson)</span>
              </div>
              <div 
                style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}
                onClick={() => handleExport('kml')}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
              >
                <MapIcon size={16} color="#f39c12" /> <span style={{ fontWeight: '600', fontSize: '0.85rem' }}>Google Earth (.kml)</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
