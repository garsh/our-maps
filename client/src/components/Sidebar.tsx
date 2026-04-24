import { useState, useEffect, useRef } from 'react';
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
  Upload,
  FileJson,
  Map as MapIcon,
  Globe as GlobeIcon,
  Navigation,
  MoreVertical,
  Share2
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
  hoveredPinId?: string | null;
  onHoverPin?: (id: string | null) => void;
  customColors?: string[];
  onAddCustomColor?: (color: string) => void;
  selectedNavIds?: Set<string>;
  onToggleNavId?: (id: string) => void;
  onToggleNavIds?: (ids: string[], force?: boolean) => void;
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
  readOnly,
  hoveredPinId,
  onHoverPin,
  onAddCustomColor,
  isSelected,
  onToggleSelect,
  customColors
}: { 
  pin: Pin, 
  onPinClick: (pin: Pin) => void,
  onRemovePin: (id: string) => void,
  onUpdatePin: (id: string, updates: Partial<Pin>) => void,
  editingPinId: string | null,
  setEditingPinId: (id: string | null) => void,
  readOnly: boolean,
  hoveredPinId?: string | null,
  onHoverPin?: (id: string | null) => void,
  onAddCustomColor?: (color: string) => void,
  isSelected?: boolean,
  onToggleSelect?: (id: string) => void,
  customColors?: string[]
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
        padding: '0.4rem 0.75rem', 
        marginBottom: '2px',
        borderRadius: 'var(--radius-sm)',
        background: hoveredPinId === pin.id ? 'rgba(72, 61, 139, 0.1)' : (editingPinId === pin.id ? 'var(--bg-color)' : 'white'),
        border: editingPinId === pin.id ? '1px solid var(--primary-color)' : '1px solid transparent',
        boxShadow: isDragging ? 'var(--shadow-md)' : (hoveredPinId === pin.id ? '0 0 0 1px var(--primary-color)' : 'none'),
        transition: 'all 0.2s ease',
        cursor: 'default'
      }}
      onMouseEnter={() => onHoverPin?.(pin.id)}
      onMouseLeave={() => onHoverPin?.(null)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
          {!readOnly && (
            <div {...attributes} {...listeners} style={{ cursor: 'grab', marginRight: '6px', color: '#ddd' }}>
              <GripVertical size={14} />
            </div>
          )}
          <input 
            type="checkbox" 
            checked={!!isSelected} 
            onChange={() => onToggleSelect?.(pin.id)}
            style={{ marginRight: '10px', cursor: 'pointer', accentColor: 'var(--primary-color)' }}
            onClick={(e) => e.stopPropagation()}
          />
          <div 
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', flex: 1 }}
            onClick={() => onPinClick(pin)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div 
                style={{ 
                  width: '28px', 
                  height: '28px', 
                  borderRadius: '8px', 
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
                    return <Icon size={14} color={currentColor} />;
                })()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pin.label}</div>
                {pin.description && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pin.description}</div>
                )}
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px', marginLeft: '4px' }}>
          {!readOnly && (
            <button 
              onClick={() => setEditingPinId(editingPinId === pin.id ? null : pin.id)}
              style={{ 
                background: editingPinId === pin.id ? 'var(--primary-color)' : 'transparent', 
                color: editingPinId === pin.id ? 'white' : 'var(--primary-color)', 
                border: '1px solid var(--primary-color)', 
                borderRadius: '6px', 
                padding: '2px 8px', 
                cursor: 'pointer', 
                fontSize: '0.65rem',
                fontWeight: '600'
              }}
            >
              {editingPinId === pin.id ? 'Close' : 'Edit'}
            </button>
          )}
        </div>
      </div>

      {editingPinId === pin.id && !readOnly && (
        <div style={{ padding: '0.75rem 0 0 0', marginTop: '0.75rem', borderTop: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
          <div style={{ marginBottom: '8px' }}>
            <label htmlFor={`label-${pin.id}`} style={{ display: 'block', fontWeight: '700', marginBottom: '4px', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Name</label>
            <input 
              id={`label-${pin.id}`}
              type="text" 
              value={pin.label} 
              onChange={(e) => onUpdatePin(pin.id, { label: e.target.value })}
              className="input-field"
              style={{ padding: '6px 10px', fontSize: '0.85rem' }}
            />
          </div>

          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontWeight: '700', marginBottom: '6px', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Color</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {COLORS.map(color => (
                <button
                  key={color.name}
                  aria-label={`color-${color.name}`}
                  onClick={() => onUpdatePin(pin.id, { color: color.name })}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '6px',
                    background: color.value,
                    border: pin.color === color.name || (!pin.color && color.name === 'blue') ? '2px solid var(--text-primary)' : 'none',
                    cursor: 'pointer',
                    padding: 0,
                    boxShadow: 'var(--shadow-sm)'
                  }}
                />
              ))}
              {/* Persistent Custom Colors */}
              {(customColors || []).map(color => (
                <button
                  key={color}
                  onClick={() => onUpdatePin(pin.id, { color })}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '6px',
                    background: color,
                    border: pin.color === color ? '2px solid var(--text-primary)' : 'none',
                    cursor: 'pointer',
                    padding: 0,
                    boxShadow: 'var(--shadow-sm)'
                  }}
                />
              ))}
              <div style={{ position: 'relative', width: '24px', height: '24px' }}>
                <input 
                  type="color"
                  value={(!pin.color || COLORS.some(c => c.name === pin.color)) ? '#8e44ad' : pin.color}
                  onChange={(e) => {
                    onUpdatePin(pin.id, { color: e.target.value });
                  }}
                  onBlur={(e) => {
                    // Only add to history when the user finished picking
                    onAddCustomColor?.(e.target.value);
                  }}
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
                    width: '24px',
                    height: '24px',
                    borderRadius: '6px',
                    background: (!pin.color || COLORS.some(c => c.name === pin.color)) ? '#f1f1f1' : pin.color,
                    border: pin.color && !COLORS.some(c => c.name === pin.color) ? '2px solid var(--text-primary)' : '1px dashed #ccc',
                    zIndex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '12px',
                    color: pin.color && !COLORS.some(c => c.name === pin.color) ? 'white' : '#666'
                  }}
                >
                  +
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontWeight: '700', marginBottom: '6px', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Icon</label>
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
                    height: '30px',
                    borderRadius: '6px',
                    background: pin.icon === type || (!pin.icon && type === 'default') ? 'var(--primary-color)' : 'white',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <Icon size={14} color={pin.icon === type || (!pin.icon && type === 'default') ? 'white' : currentColor} />
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '8px' }}>
            <label htmlFor={`desc-${pin.id}`} style={{ display: 'block', fontWeight: '700', marginBottom: '4px', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Description</label>
            <textarea 
              id={`desc-${pin.id}`}
              value={pin.description || ''} 
              onChange={(e) => onUpdatePin(pin.id, { description: e.target.value })}
              className="input-field"
              style={{ minHeight: '60px', resize: 'vertical', padding: '6px 10px', fontSize: '0.85rem' }}
            />
          </div>
          
          <div style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button 
                onClick={() => onRemovePin(pin.id)}
                style={{ background: 'transparent', color: 'var(--error-color)', border: 'none', padding: '4px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Trash2 size={14} /> Delete Pin
              </button>
              <button 
                onClick={() => setEditingPinId(null)} 
                style={{ padding: '6px 16px', fontSize: '0.8rem', cursor: 'pointer', border: 'none', borderRadius: 'var(--radius-sm)', background: 'var(--primary-color)', color: 'white', fontWeight: '600' }}
              >
                Done
              </button>
            </div>
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
  readOnly,
  hoveredPinId,
  onHoverPin,
  customColors,
  onAddCustomColor,
  selectedNavIds,
  onToggleNavId,
  onToggleNavIds
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
  readOnly: boolean,
  hoveredPinId?: string | null,
  onHoverPin?: (id: string | null) => void,
  customColors?: string[],
  onAddCustomColor?: (color: string) => void,
  selectedNavIds?: Set<string>,
  onToggleNavId?: (id: string) => void,
  onToggleNavIds?: (ids: string[], force?: boolean) => void
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
    marginBottom: '0.75rem',
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 100 : 0
  };

  const isAllSelected = groupPins.length > 0 && groupPins.every(p => selectedNavIds?.has(p.id));
  const isSomeSelected = groupPins.some(p => selectedNavIds?.has(p.id));

  return (
    <div ref={setNodeRef} style={style}>
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        background: isExpanded ? 'rgba(72, 61, 139, 0.05)' : 'white', 
        padding: '0.6rem 0.8rem', 
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
        transition: 'all 0.2s ease'
      }}>
        {!readOnly && (
          <div {...attributes} {...listeners} style={{ cursor: 'grab', marginRight: '6px', color: '#aaa' }}>
            <GripVertical size={16} />
          </div>
        )}
        <input 
          type="checkbox" 
          checked={isAllSelected} 
          ref={el => { if (el) el.indeterminate = isSomeSelected && !isAllSelected; }}
          onChange={(e) => {
            const checked = e.target.checked;
            onToggleNavIds?.(groupPins.map(p => p.id), checked);
          }}
          style={{ marginRight: '10px', cursor: 'pointer', accentColor: 'var(--primary-color)' }}
          title="Select all in group for navigation"
        />
        <div onClick={() => setIsExpanded(!isExpanded)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--primary-color)', marginRight: '6px', display: 'flex' }}>
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
              style={{ fontSize: '0.85rem', padding: '2px 8px', height: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span onDoubleClick={() => !readOnly && setIsEditingName(true)} style={{ fontWeight: '700', fontSize: '0.9rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
        <div style={{ paddingLeft: '0.75rem', borderLeft: '2px solid var(--border-color)', marginTop: '4px', marginLeft: '1rem' }}>
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
                  hoveredPinId={hoveredPinId}
                  onHoverPin={onHoverPin}
                  onAddCustomColor={onAddCustomColor}
                  isSelected={selectedNavIds?.has(pin.id)}
                  onToggleSelect={onToggleNavId}
                  customColors={customColors}
                />
              ))}
              {groupPins.length === 0 && !readOnly && (
                <li style={{ padding: '1rem', color: '#aaa', fontSize: '0.8rem', fontStyle: 'italic', textAlign: 'center', border: '1px dashed #eee', borderRadius: 'var(--radius-sm)' }}>
                  No pins in this group
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
  onSetEditingPinId,
  hoveredPinId,
  onHoverPin,
  customColors,
  onAddCustomColor,
  selectedNavIds,
  onToggleNavId,
  onToggleNavIds
}: SidebarProps) => {
  const [localMapName, setLocalMapName] = useState(mapName);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const readOnly = userRole === 'view';

  useEffect(() => {
    setLocalMapName(mapName);
  }, [mapName]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExport = (format: 'json' | 'geojson' | 'kml') => {
    exportMap({ 
      id: '', 
      name: mapName, 
      pins, 
      groups,
      ownerId: '' 
    }, format);
    setIsMenuOpen(false);
  };

  const handleImportClick = () => {
    setIsMenuOpen(false);
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
  const selectedPins = pins.filter(p => selectedNavIds?.has(p.id))
    .sort((a, b) => {
      if (a.groupId === b.groupId) return a.position - b.position;
      if (!a.groupId) return -1;
      if (!b.groupId) return 1;
      return a.groupId.localeCompare(b.groupId);
    });

  const handleNavigate = () => {
    if (selectedPins.length === 0) return;
    let url = "";
    if (selectedPins.length === 1) {
      url = `https://www.google.com/maps/search/?api=1&query=${selectedPins[0].lat},${selectedPins[0].lng}`;
    } else {
      const origin = selectedPins[0];
      const destination = selectedPins[selectedPins.length - 1];
      const waypoints = selectedPins.slice(1, -1).map(p => `${p.lat},${p.lng}`).join('|');
      url = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&waypoints=${waypoints}&travelmode=driving`;
    }
    window.open(url, '_blank');
  };

  const isDefaultAllSelected = defaultPins.length > 0 && defaultPins.every(p => selectedNavIds?.has(p.id));
  const isDefaultSomeSelected = defaultPins.some(p => selectedNavIds?.has(p.id));

  return (
    <aside style={{ flex: 1, background: 'white', display: 'flex', flexDirection: 'column', padding: '1rem', boxSizing: 'border-box', overflow: 'hidden', borderRight: '1px solid var(--border-color)' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <label htmlFor="map-name" style={{ display: 'block', fontWeight: '800', fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>Map Configuration</label>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            {selectedPins.length > 0 && (
              <button 
                onClick={handleNavigate}
                style={{ fontSize: '0.7rem', background: 'var(--success-color)', color: 'white', border: 'none', padding: '3px 10px', borderRadius: '50px', cursor: 'pointer', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                <Navigation size={12} /> Go ({selectedPins.length})
              </button>
            )}
            
            <div style={{ position: 'relative' }} ref={menuRef}>
              <button 
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', display: 'flex', padding: '4px' }}
              >
                <MoreVertical size={18} />
              </button>
              
              {isMenuOpen && (
                <div style={{ position: 'absolute', top: '100%', right: 0, width: '180px', background: 'white', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', zIndex: 1600, overflow: 'hidden' }}>
                  {userRole === 'owner' && (
                    <div 
                      style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', fontWeight: '600' }}
                      onClick={() => { onShare?.(); setIsMenuOpen(false); }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <Share2 size={16} color="var(--primary-color)" /> Share Map
                    </div>
                  )}
                  {!readOnly && (
                    <div 
                      style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', fontWeight: '600' }}
                      onClick={handleImportClick}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <Upload size={16} color="#3498db" /> Import
                    </div>
                  )}
                  <div style={{ padding: '8px 16px', fontSize: '0.65rem', fontWeight: '800', color: '#999', background: '#fcfcfc', borderBottom: '1px solid var(--border-color)' }}>EXPORT AS...</div>
                  <div 
                    style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem' }}
                    onClick={() => handleExport('json')}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <FileJson size={16} color="var(--primary-color)" /> JSON
                  </div>
                  <div 
                    style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem' }}
                    onClick={() => handleExport('geojson')}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <GlobeIcon size={16} color="#27ae60" /> GeoJSON
                  </div>
                  <div 
                    style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem' }}
                    onClick={() => handleExport('kml')}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <MapIcon size={16} color="#f39c12" /> KML
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        <input 
          id="map-name"
          type="text" 
          value={localMapName} 
          onChange={(e) => setLocalMapName(e.target.value)}
          onBlur={() => onMapNameChange(localMapName)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          disabled={readOnly}
          className="input-field"
          style={{ fontWeight: '700', fontSize: '0.95rem', padding: '6px 12px' }}
        />
      </div>

      {!readOnly && (
        <SearchBar 
          onResultSelect={onResultSelect} 
          onAddPin={onAddPin} 
          pins={pins} 
          disabled={readOnly} 
          mapBounds={mapBounds}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', marginTop: '0.25rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '800', color: 'var(--text-primary)' }}>Layers</h3>
        {!readOnly && (
          <button 
            onClick={onAddGroup}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: '1px solid var(--border-color)', padding: '3px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: '600', color: 'var(--text-secondary)' }}
          >
            <FolderPlus size={14} /> New Layer
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
                hoveredPinId={hoveredPinId}
                onHoverPin={onHoverPin}
                customColors={customColors}
                onAddCustomColor={onAddCustomColor}
                selectedNavIds={selectedNavIds}
                onToggleNavId={onToggleNavId}
                onToggleNavIds={onToggleNavIds}
              />
            ))}
          </SortableContext>

          <div style={{ marginTop: groups.length > 0 ? '1.5rem' : '0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px', marginBottom: '0.5rem' }}>
              <h4 style={{ fontSize: '0.65rem', color: '#aaa', textTransform: 'uppercase', fontWeight: '800', letterSpacing: '0.1em', margin: 0 }}>
                Default Layer
              </h4>
              {defaultPins.length > 0 && (
                <input 
                  type="checkbox" 
                  checked={isDefaultAllSelected}
                  ref={el => { if (el) el.indeterminate = isDefaultSomeSelected && !isDefaultAllSelected; }}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    onToggleNavIds?.(defaultPins.map(p => p.id), checked);
                  }}
                  style={{ cursor: 'pointer', accentColor: 'var(--primary-color)' }}
                  title="Select all in default layer for navigation"
                />
              )}
            </div>
            <SortableContext items={defaultPins.map(p => p.id)} strategy={verticalListSortingStrategy} disabled={readOnly}>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
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
                    hoveredPinId={hoveredPinId}
                    onHoverPin={onHoverPin}
                    onAddCustomColor={onAddCustomColor}
                    isSelected={selectedNavIds?.has(pin.id)}
                    onToggleSelect={onToggleNavId}
                    customColors={customColors}
                  />
                ))}
                {defaultPins.length === 0 && groups.length === 0 && (
                  <li style={{ padding: '2rem 1rem', color: '#bbb', textAlign: 'center', fontSize: '0.85rem' }}>
                    <div style={{ background: 'var(--bg-color)', width: '50px', height: '50px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem auto' }}>
                      <MapPin size={24} />
                    </div>
                    {readOnly ? 'No pins available.' : 'Right-click the map or use the search bar above to start adding pins!'}
                  </li>
                )}
              </ul>
            </SortableContext>
          </div>
        </DndContext>
      </div>
    </aside>
  );
};

export default Sidebar;
