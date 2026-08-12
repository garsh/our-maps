import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import SearchBar from './SearchBar';
import { reverseGeocode } from '../utils/geocoding';
import type { Pin, PinIcon, PinGroup } from '@shared/interfaces';
import { 
  Bed, 
  Utensils, 
  Plane, 
  Bus, 
  Handbag, 
  MapPin,
  type LucideIcon,
  GripVertical,
  Trash2,
  Pencil,
  X,
  ChevronDown,
  ChevronRight,
  Navigation,
  MoreVertical,
  Fuel,
  Zap,
  Eye,
  EyeOff
} from 'lucide-react';
import {
  DndContext, 
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  DragOverlay,
  defaultDropAnimationSideEffects
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToWindowEdges, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { exportMap, importMapFile } from '../utils/fileUtils';
import { 
  countTiles, 
  estimateSizeMB, 
  getTilesForArea, 
  getSurgicalBoxes,
  getPinsBoundingBox,
  type BoundingBox 
} from '../utils/tileUtils';
import { canFit } from '../utils/storageUtils';
import type { MapData } from '@shared/interfaces';

interface DownloadSummary {
  tileCount: number;
  sizeMB: number;
  bbox: BoundingBox;
}

interface SidebarProps {
  mapId: string | null;
  mapName: string;
  onMapNameChange: (name: string) => void;
  groups: PinGroup[];
  onAddGroup: () => void;
  onUpdateGroup: (id: string, updates: Partial<PinGroup>) => void;
  onRemoveGroup: (id: string) => void;
  pins: Pin[];
  onResultSelect: (lat: number, lng: number) => void;
  onAddPin: (lat: number, lng: number, label: string, address?: string) => void;
  onRemovePin: (id: string) => void;
  onPinClick: (pin: Pin) => void;
  onUpdatePin: (id: string, updates: Partial<Pin>) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragOver?: (event: DragOverEvent) => void;
  userRole?: 'owner' | 'edit' | 'view';
  onShare?: () => void;
  onImport?: (data: Partial<MapData>) => void;
  mapBounds?: string | null;
  editingPinId: string | null;
  onSetEditingPinId: (id: string | null) => void;
  hoveredPinId?: string | null;
  targetPinId?: string | null;
  onHoverPin?: (id: string | null) => void;
  customColors?: string[];
  onAddCustomColor?: (color: string) => void;
  selectedNavIds?: Set<string>;
  onToggleNavId?: (id: string) => void;
  onToggleNavIds?: (ids: string[], force?: boolean) => void;
  hiddenGroupIds?: Set<string | null>;
  onToggleGroupVisibility?: (id: string | null) => void;
  expandedGroupIds?: Set<string | null>;
  onToggleExpand?: (id: string | null) => void;
  onHoverSearchResult?: (lat: number | null, lng: number | null) => void;
  isMobile?: boolean;
}

const COLORS = [
  { name: 'blue', value: '#2A81CB' },
  { name: 'red', value: '#CB2B3E' },
  { name: 'green', value: '#2AAD27' },
  { name: 'orange', value: '#CB8427' },
  { name: 'violet', value: '#9C2BCB' },
  { name: 'gold', value: '#FFD700' },
  { name: 'pink', value: '#FF69B4' },
  { name: 'teal', value: '#008080' },
  { name: 'brown', value: '#8B4513' },
  { name: 'black', value: '#000000' }
];

const CustomBoatIcon = ({ size, color }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M 4 18 h 16 c 1.5 0 2 -1.5 2 -4 c 0 -1.5 -0.5 -2 -2 -2 h -16 c -1.5 0 -2 0.5 -2 2 c 0 2.5 0.5 4 2 4 Z M 12 12 V 2 c 0 -1.5 -1 -1.5 -2 -0.5 l -6 9 c -0.5 1 0 1.5 1 1.5 h 7"/>
  </svg>
);

const CustomTrainIcon = ({ size, color }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} color={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M 20 16 h 1 c 1 0 2 -0.5 2 -2 v -3 c 0 -1.5 -0.5 -2 -2 -2 h -1 v -3 c 0 -1 -1 -2 -2 -2 h -2 c -1 0 -2 1 -2 2 v 3 h -4 v -4 c 0 -1.5 -1 -3 -3 -3 h -2 c -1.5 0 -3 1.5 -3 3 v 9 c 0 1.5 1 2 2 2 M 10 16 h 4"/>
    <circle cx="7" cy="16" r="3"/>
    <circle cx="17" cy="16" r="3"/>
  </svg>
);

const CustomCarIcon = ({ size, color }: any) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} color={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M 22 16 v -5.5 a 2.5 2.5 0 0 0 -2.5 -2.5 h -4.5 l -3 -5 h -6 l -4 8 v 4 a 1 1 0 0 0 1 1 h 1 M 10 16 h 4 M 20 16 h 2"/>
    <circle cx="7" cy="16" r="3"/>
    <circle cx="17" cy="16" r="3"/>
  </svg>
);

const ICONS: { type: PinIcon; Icon: LucideIcon | any }[] = [
  { type: 'default', Icon: MapPin },
  { type: 'hotel', Icon: Bed },
  { type: 'restaurant', Icon: Utensils },
  { type: 'airport', Icon: Plane },
  { type: 'car', Icon: CustomCarIcon },
  { type: 'bus', Icon: Bus },
  { type: 'boat', Icon: CustomBoatIcon },
  { type: 'train', Icon: CustomTrainIcon },
  { type: 'gas', Icon: Fuel },
  { type: 'charging', Icon: Zap },
  { type: 'shopping', Icon: Handbag },
];

const IconButton = ({ type, Icon, isSelected, onClick }: { type: PinIcon, Icon: any, isSelected: boolean, onClick: () => void }) => {
  return (
    <button
      title={type !== 'default' ? type.charAt(0).toUpperCase() + type.slice(1) : undefined}
      aria-label={`icon-${type}`}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '20px',
        flex: 1,
        minWidth: 0,
        padding: 0,
        borderRadius: '4px',
        background: isSelected ? 'var(--primary-color)' : '#eee',
        border: '1px solid var(--border-color)',
        cursor: 'pointer'
      }}
    >
      <Icon size={12} color={isSelected ? 'white' : '#333'} />
    </button>
  );
};

const TruncatedTooltip = ({ text, style }: { text: string, style?: React.CSSProperties }) => {
  const [isTruncated, setIsTruncated] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  const checkTruncation = () => {
    if (textRef.current) {
      setIsTruncated(textRef.current.scrollWidth > textRef.current.clientWidth);
    }
  };

  return (
    <div 
      ref={textRef}
      onMouseEnter={checkTruncation}
      title={isTruncated ? text : undefined}
      style={{
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        ...style
      }}
    >
      {text}
    </div>
  );
};

const StaticPin = ({ pin, isSelected }: { pin: Pin, isSelected?: boolean }) => {
  const currentColor = COLORS.find(c => c.name === pin.color)?.value || pin.color || '#2A81CB';
  return (
    <div style={{ 
      padding: '0 0.15rem', 
      borderRadius: 'var(--radius-sm)',
      background: 'white',
      border: '1px solid var(--primary-color)',
      boxShadow: 'var(--shadow-md)',
      display: 'flex', 
      alignItems: 'center',
      opacity: 0.9
    }}>
      <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
        <div style={{ marginRight: '0px', color: '#bbb', padding: '1px 1px', marginLeft: '-2px' }}>
          <GripVertical size={10} />
        </div>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, padding: '0px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
               {(() => {
                  const iconObj = ICONS.find(i => i.type === pin.icon) || ICONS[0];
                  const { Icon } = iconObj;
                  return <Icon size={14} color={currentColor} />;
              })()}
            </div>
            <div style={{ fontWeight: '600', fontSize: '0.65rem', color: 'var(--text-primary)' }}>{pin.label}</div>
          </div>
        </div>
        <input 
          type="checkbox" 
          checked={!!isSelected}
          readOnly
          style={{ marginLeft: '4px', accentColor: 'var(--primary-color)', width: '9px', height: '9px' }}
        />
      </div>
    </div>
  );
};

const SortablePin = ({ 
  pin, 
  onPinClick, 
  onRemovePin, 
  onUpdatePin,
  editingPinId,
  setEditingPinId,
  readOnly,
  targetPinId,
  hoveredPinId,
  onHoverPin,
  onAddCustomColor,
  isSelected,
  onToggleSelect,
  customColors,
  allGroups,
  isAnySelectedDragging,
  isDragActive
}: { 
  pin: Pin, 
  onPinClick: (pin: Pin) => void,
  onRemovePin: (id: string) => void,
  onUpdatePin: (id: string, updates: Partial<Pin>) => void,
  editingPinId: string | null,
  setEditingPinId: (id: string | null) => void,
  readOnly: boolean,
  targetPinId?: string | null,
  hoveredPinId?: string | null,
  onHoverPin?: (id: string | null) => void,
  onAddCustomColor?: (color: string) => void,
  isSelected?: boolean,
  onToggleSelect?: (id: string) => void,
  customColors?: string[],
  allGroups: PinGroup[],
  isAnySelectedDragging: boolean,
  isDragActive: boolean
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

  const [isFetchingAddress, setIsFetchingAddress] = useState(false);

  useEffect(() => {
    if (targetPinId === pin.id && !pin.address && !isFetchingAddress) {
      setIsFetchingAddress(true);
      reverseGeocode(pin.lat, pin.lng).then(addr => {
        if (addr) {
          onUpdatePin(pin.id, { address: addr });
        }
      }).finally(() => {
        setIsFetchingAddress(false);
      });
    }
  }, [targetPinId, pin.id, pin.address, pin.lat, pin.lng, isFetchingAddress, onUpdatePin]);

  const isItemInDraggingBundle = isAnySelectedDragging && isSelected;

  useEffect(() => {
    if (editingPinId === pin.id || targetPinId === pin.id) {
      setTimeout(() => {
        const el = document.getElementById(`pin-${pin.id}`);
        if (el) {
          let container: HTMLElement | null = el.parentElement;
          while (container && container !== document.body) {
            const style = window.getComputedStyle(container);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
              break;
            }
            container = container.parentElement;
          }

          if (container && container !== document.body) {
            const containerRect = container.getBoundingClientRect();
            const rect = el.getBoundingClientRect();
            const stickyHeaderHeight = 24;
            
            if (rect.top < containerRect.top + stickyHeaderHeight || el.offsetHeight >= container.clientHeight - stickyHeaderHeight) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else if (rect.bottom > containerRect.bottom) {
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          } else {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      }, 150); // wait for expand transition
    }
  }, [editingPinId, targetPinId, pin.id]);

  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0 : 1, // Invisible ghost for the active item
    position: 'relative' as const,
    pointerEvents: (isDragging || isItemInDraggingBundle) ? 'none' as const : undefined,
    display: (isItemInDraggingBundle && !isDragging) ? 'none' : 'block', // Remove non-active bundle items from layout
  };

  const currentColor = COLORS.find(c => c.name === pin.color)?.value || pin.color || '#2A81CB';

  return (
    <li 
      id={`pin-${pin.id}`}
      ref={setNodeRef} 
      style={{ 
        ...style, 
        padding: '0 0.15rem', 
        marginBottom: '0px',
        scrollMarginTop: '24px',
        borderRadius: 'var(--radius-sm)',
        background: (hoveredPinId === pin.id && !isDragActive) ? 'rgba(72, 61, 139, 0.05)' : (editingPinId === pin.id ? 'var(--bg-color)' : 'transparent'),
        border: editingPinId === pin.id ? '1px solid var(--primary-color)' : '1px solid transparent',
        boxShadow: (hoveredPinId === pin.id && !isDragActive) ? '0 0 0 1px var(--primary-color)' : 'none',
        transition: 'all 0.1s ease',
        cursor: 'default'
      }}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') onHoverPin?.(pin.id);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') onHoverPin?.(null);
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
          {!readOnly && (
            <div {...attributes} {...listeners} style={{ cursor: 'grab', marginRight: '0px', color: '#bbb', padding: '1px 1px', marginLeft: '-2px' }}>
              <GripVertical size={10} />
            </div>
          )}
          <div 
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', flex: 1, padding: '0px' }}
            onClick={() => onPinClick(pin)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div 
                style={{ 
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
                <TruncatedTooltip 
                  text={pin.label}
                  style={{ fontWeight: '600', fontSize: '0.65rem', color: 'var(--text-primary)', lineHeight: '1.1' }}
                />
                {pin.description && (
                  <div style={{ fontSize: '0.5rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '-1px', lineHeight: '1' }}>{pin.description}</div>
                )}
              </div>            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '2px', marginLeft: '4px', alignItems: 'center' }}>
          <input 
            type="checkbox" 
            checked={!!isSelected} 
            onChange={(e) => { e.stopPropagation(); onToggleSelect?.(pin.id); }}
            style={{ cursor: 'pointer', accentColor: 'var(--primary-color)', width: '9px', height: '9px' }}
            onClick={(e) => e.stopPropagation()}
          />
          {!readOnly && editingPinId === pin.id && (
            <button 
              title="Delete Pin"
              onClick={(e) => { 
                e.stopPropagation(); 
                if (window.confirm('Are you sure you want to delete this pin?')) {
                  onRemovePin(pin.id); 
                }
              }}
              style={{ 
                background: 'transparent', 
                color: 'var(--error-color)', 
                border: 'none',
                padding: '0px 3px', 
                cursor: 'pointer', 
                display: 'flex', 
                alignItems: 'center'
              }}
            >
              <Trash2 size={12} />
            </button>
          )}
          {!readOnly && (
            <button 
              aria-label={editingPinId === pin.id ? "Close edit" : "Edit"}
              onClick={(e) => { e.stopPropagation(); setEditingPinId(editingPinId === pin.id ? null : pin.id); }}
              style={{ 
                background: 'transparent', 
                color: editingPinId === pin.id ? 'var(--text-primary)' : 'var(--primary-color)', 
                border: 'none',
                padding: '0px 3px', 
                cursor: 'pointer', 
                display: 'flex',
                alignItems: 'center'
              }}
            >
              {editingPinId === pin.id ? <X size={12} /> : <Pencil size={12} />}
            </button>
          )}
        </div>
      </div>

      {targetPinId === pin.id && editingPinId !== pin.id && (
        <div style={{ padding: '0.3rem 0.15rem 0.15rem 0.15rem', marginTop: '0.3rem', borderTop: '1px solid var(--border-color)' }}>
          {pin.address && (
            <div style={{ marginBottom: '8px', fontSize: '0.65rem', color: 'var(--text-secondary)', lineHeight: '1.2' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Address:</strong><br/>
              {pin.address}
            </div>
          )}
          {pin.description && (
            <div style={{ marginBottom: '8px', fontSize: '0.65rem', color: 'var(--text-secondary)', lineHeight: '1.2', whiteSpace: 'pre-wrap' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Description:</strong><br/>
              {pin.description}
            </div>
          )}
          <div style={{ marginTop: '8px' }}>
            <a 
              href={`https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none', display: 'block' }}
            >
              <button className="btn-primary" style={{ width: '100%', padding: '6px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                <Navigation size={12} /> Navigate to Pin
              </button>
            </a>
          </div>
        </div>
      )}

      {editingPinId === pin.id && !readOnly && (
        <div style={{ padding: '0.3rem 0.15rem 0.15rem 0.15rem', marginTop: '0.3rem', borderTop: '1px solid var(--border-color)', fontSize: '0.7rem' }}>
          <div style={{ marginBottom: '5px' }}>
            <label htmlFor={`label-${pin.id}`} style={{ display: 'block', fontWeight: '700', marginBottom: '1px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>Name</label>
            <input 
              id={`label-${pin.id}`}
              type="text" 
              value={pin.label || ''} 
              onChange={(e) => onUpdatePin(pin.id, { label: e.target.value })}
              className="input-field"
              style={{ padding: '2px 4px', fontSize: '0.6rem', fontFamily: 'inherit' }}
            />
          </div>

          <div style={{ marginBottom: '5px' }}>
            <label htmlFor={`address-${pin.id}`} style={{ display: 'block', fontWeight: '700', marginBottom: '1px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>Address</label>
            <textarea 
              id={`address-${pin.id}`}
              value={pin.address || ''} 
              onChange={(e) => onUpdatePin(pin.id, { address: e.target.value })}
              className="input-field"
              style={{ padding: '2px 4px', fontSize: '0.6rem', fontFamily: 'inherit', minHeight: '30px', resize: 'vertical' }}
              placeholder="Fetch address from map or type here..."
            />
          </div>

          <div style={{ marginBottom: '5px' }}>
            <label style={{ display: 'block', fontWeight: '700', marginBottom: '1px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>Layer</label>
            <select 
                value={pin.groupId || ''} 
                onChange={(e) => onUpdatePin(pin.id, { groupId: e.target.value || undefined })}
                className="input-field"
                style={{ padding: '2px 4px', fontSize: '0.6rem', fontFamily: 'inherit', background: 'white' }}
            >
                <option value="">Default Layer</option>
                {allGroups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                ))}
            </select>
          </div>

          <div style={{ marginBottom: '5px' }}>
            <label style={{ display: 'block', fontWeight: '700', marginBottom: '3px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>Color</label>
            <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
              {COLORS.map(color => (
                <button
                  key={color.name}
                  aria-label={`color-${color.name}`}
                  onClick={() => onUpdatePin(pin.id, { color: color.name })}
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '4px',
                    background: color.value,
                    border: pin.color === color.name || (!pin.color && color.name === 'blue') ? '1.5px solid var(--text-primary)' : '1px solid rgba(0,0,0,0.1)',
                    cursor: 'pointer',
                    padding: 0
                  }}
                />
              ))}
              {(customColors || []).map(color => (
                <button
                  key={color}
                  onClick={() => onUpdatePin(pin.id, { color })}
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '4px',
                    background: color,
                    border: pin.color === color ? '1.5px solid var(--text-primary)' : '1px solid rgba(0,0,0,0.1)',
                    cursor: 'pointer',
                    padding: 0
                  }}
                />
              ))}
              <div style={{ position: 'relative', width: '16px', height: '16px' }}>
                <input 
                  type="color"
                  value={(!pin.color || COLORS.some(c => c.name === pin.color)) ? '#9C2BCB' : pin.color}
                  onChange={(e) => {
                    onUpdatePin(pin.id, { color: e.target.value });
                  }}
                  onBlur={(e) => onAddCustomColor?.(e.target.value)}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', zIndex: 2 }}
                />
                <div style={{ width: '16px', height: '16px', borderRadius: '4px', background: '#f1f1f1', border: '1px dashed #ccc', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', color: '#666' }}>
                  +
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '5px' }}>
            <label style={{ display: 'block', fontWeight: '700', marginBottom: '3px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>Icon</label>
            <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '1px', justifyContent: 'space-between' }}>
              {ICONS.map(({ type, Icon }) => (
                <IconButton 
                  key={type}
                  type={type}
                  Icon={Icon}
                  isSelected={pin.icon === type || (!pin.icon && type === 'default')}
                  onClick={() => onUpdatePin(pin.id, { icon: type })}
                />
              ))}
            </div>
          </div>


          <div style={{ marginBottom: '5px' }}>
            <label htmlFor={`desc-${pin.id}`} style={{ display: 'block', fontWeight: '700', marginBottom: '1px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>Description</label>
            <textarea 
              id={`desc-${pin.id}`}
              value={pin.description || ''} 
              onChange={(e) => onUpdatePin(pin.id, { description: e.target.value })}
              className="input-field"
              style={{ padding: '2px 4px', fontSize: '0.6rem', fontFamily: 'inherit', minHeight: '30px', resize: 'vertical' }}
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
  readOnly,
  targetPinId,
  hoveredPinId,
  onHoverPin,
  customColors,
  onAddCustomColor,
  selectedNavIds,
  onToggleNavId,
  onToggleNavIds,
  allGroups,
  isHidden,
  onToggleVisibility,
  isExpanded,
  onToggleExpand,
  isAnySelectedDragging,
  isGroupDragging,
  isDragActive
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
  targetPinId?: string | null,
  hoveredPinId?: string | null,
  onHoverPin?: (id: string | null) => void,
  customColors?: string[],
  onAddCustomColor?: (color: string) => void,
  selectedNavIds?: Set<string>,
  onToggleNavId?: (id: string) => void,
  onToggleNavIds?: (ids: string[], force?: boolean) => void,
  allGroups: PinGroup[],
  isHidden: boolean,
  onToggleVisibility: () => void,
  isExpanded: boolean,
  onToggleExpand: () => void,
  isAnySelectedDragging: boolean,
  isGroupDragging: boolean,
  isDragActive: boolean
}) => {
  const [isEditingName, setIsEditingName] = useState(false);

  useEffect(() => {
    if (editingPinId && groupPins.some(p => p.id === editingPinId)) {
      if (!isExpanded) {
        onToggleExpand();
      }
    }
  }, [editingPinId, groupPins, isExpanded, onToggleExpand]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver
  } = useSortable({ 
    id: group.id,
    data: { type: 'group', group },
    disabled: readOnly
  });

  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    marginBottom: '0.2rem',
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 100 : 0
  };

  const isAllSelected = groupPins.length > 0 && groupPins.every(p => selectedNavIds?.has(p.id));
  const isSomeSelected = groupPins.some(p => selectedNavIds?.has(p.id));

  return (
    <div ref={setNodeRef} style={style}>
      <div style={{
        position: 'sticky',
        top: '4px',
        zIndex: 5,
        background: (isOver && !isDragging && !isGroupDragging) ? 'rgba(72, 61, 139, 0.05)' : (isEditingName ? 'var(--bg-color)' : 'white'),
        borderRadius: 'var(--radius-sm)',
        border: (isOver && !isDragging && !isGroupDragging) ? '1px solid var(--primary-color)' : (isEditingName ? '1px solid var(--primary-color)' : '1px solid transparent'),
        boxShadow: (isOver && !isDragging && !isGroupDragging) ? '0 0 0 1px var(--primary-color)' : 'var(--shadow-sm)',
        transition: 'all 0.1s ease'
      }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          padding: '0 0.15rem', 
          borderBottom: 'none',
          transition: 'all 0.1s ease'
        }}>
          {!readOnly && (
            <div {...attributes} {...listeners} style={{ cursor: 'grab', color: '#bbb', padding: '1px 1px', marginLeft: '-2px', display: 'flex', alignItems: 'center' }}>
              <GripVertical size={11} />
            </div>
          )}
          <div onClick={() => onToggleExpand()} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, padding: '1px 0' }}>
            <div style={{ color: 'var(--primary-color)', marginRight: '1px', display: 'flex' }}>
              {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </div>
            <span onDoubleClick={() => !readOnly && setIsEditingName(true)} style={{ fontWeight: '700', fontSize: '0.65rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {group.name} <span style={{ fontWeight: 'normal', color: '#aaa', fontSize: '0.55rem', marginLeft: '2px' }}>({groupPins.length})</span>
            </span>
          </div>
          <div style={{ display: 'flex', gap: '2px', marginLeft: '4px', alignItems: 'center' }}>
            <button 
              onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
              style={{ background: 'transparent', border: 'none', color: isHidden ? '#ccc' : '#555', cursor: 'pointer', padding: '1px 3px', display: 'flex', alignItems: 'center' }}
              title={isHidden ? "Show group on map" : "Hide group on map"}
            >
              {isHidden ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
            <input 
              type="checkbox" 
              checked={isAllSelected} 
              ref={el => { if (el) el.indeterminate = isSomeSelected && !isAllSelected; }}
              onChange={(e) => {
                const checked = e.target.checked;
                onToggleNavIds?.(groupPins.map(p => p.id), checked);
              }}
              style={{ cursor: 'pointer', accentColor: 'var(--primary-color)', width: '9px', height: '9px' }}
              onClick={(e) => e.stopPropagation()}
              title="Select all in group for navigation"
            />
            {!readOnly && (
              <div style={{ display: 'flex', gap: '2px' }}>
              {isEditingName && (
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    let msg = 'Are you sure you want to delete this layer?';
                    if (groupPins.length > 0) {
                      msg += ` The ${groupPins.length} pin${groupPins.length === 1 ? '' : 's'} inside it will be moved to the default layer.`;
                    }
                    if (window.confirm(msg)) {
                      onRemoveGroup(group.id); 
                    }
                  }}
                  style={{ background: 'transparent', border: 'none', color: 'var(--error-color)', cursor: 'pointer', padding: '0px 3px', display: 'flex', alignItems: 'center' }}
                  className="delete-group-btn"
                  title="Delete Group"
                >
                  <Trash2 size={12} />
                </button>
              )}
              <button 
                  onClick={(e) => { e.stopPropagation(); setIsEditingName(!isEditingName); }}
                  style={{ background: 'transparent', color: isEditingName ? 'var(--text-primary)' : 'var(--primary-color)', border: 'none', padding: '0px 3px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                {isEditingName ? <X size={12} /> : <Pencil size={12} />}
              </button>
            </div>
          )}
          </div>
        </div>
        
        {isEditingName && !readOnly && (
          <div style={{ padding: '0.3rem 0.15rem 0.15rem 0.15rem', marginTop: '0', borderTop: '1px solid var(--border-color)', fontSize: '0.7rem' }}>
            <div style={{ marginBottom: '5px' }}>
              <label htmlFor={`label-${group.id}`} style={{ display: 'block', fontWeight: '700', marginBottom: '1px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>NAME</label>
              <input 
                id={`label-${group.id}`}
                type="text" 
                value={group.name} 
                onChange={(e) => onUpdateGroup(group.id, { name: e.target.value })}
                className="input-field"
                style={{ padding: '2px 4px', fontSize: '0.7rem' }}
              />
            </div>
          </div>
        )}
      </div>
      
      {isExpanded && (
        <div style={{ paddingLeft: '0.2rem', borderLeft: '1px solid var(--border-color)', marginTop: '0px', marginLeft: '0.4rem' }}>
          <SortableContext items={groupPins.map(p => p.id)} strategy={verticalListSortingStrategy}>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, minHeight: '10px' }}>
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
                  targetPinId={targetPinId}
                  hoveredPinId={hoveredPinId}
                  onHoverPin={onHoverPin}
                  onAddCustomColor={onAddCustomColor}
                  isSelected={selectedNavIds?.has(pin.id)}
                  onToggleSelect={onToggleNavId}
                  customColors={customColors}
                  allGroups={allGroups}
                  isAnySelectedDragging={isAnySelectedDragging}
                  isDragActive={isDragActive}
                />
              ))}
            </ul>
          </SortableContext>
        </div>
      )}
    </div>
  );
};

const Sidebar = ({
  mapId,
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
  onDragOver,
  userRole = 'owner',
  onShare,
  onImport,
  mapBounds,
  editingPinId,
  onSetEditingPinId,
  targetPinId,
  hoveredPinId,
  onHoverPin,
  customColors,
  onAddCustomColor,
  selectedNavIds,
  onToggleNavId,
  onToggleNavIds,
  hiddenGroupIds,
  onToggleGroupVisibility,
  expandedGroupIds,
  onToggleExpand,
  onHoverSearchResult,
  isMobile
}: SidebarProps) => {
  const [localMapName, setLocalMapName] = useState(mapName);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const readOnly = userRole === 'view';
  const [activePin, setActivePin] = useState<Pin | null>(null);
  const [activeGroup, setActiveGroup] = useState<PinGroup | null>(null);
  // PWA Install State
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    }
  };

  // Offline Download State
  const [showDownloadConfirm, setShowDownloadConfirm] = useState(false);
  const [downloadSummary, setDownloadSummary] = useState<DownloadSummary | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Export Modal State
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFileName, setExportFileName] = useState('');
  const [exportFormat, setExportFormat] = useState<'json' | 'geojson' | 'kml'>('json');

  useEffect(() => {
    setLocalMapName(mapName);
  }, [mapName]);

  const handleDownloadClick = async () => {
    let bbox: BoundingBox | null = getPinsBoundingBox(pins);
    
    if (!bbox) {
        if (!mapBounds) {
            alert("Please wait for map to load bounds.");
            return;
        }
        const parts = mapBounds.split(',').map(Number);
        bbox = {
            west: parts[0],
            north: parts[1],
            east: parts[2],
            south: parts[3]
        };
    }

    const totalCount = countTiles(bbox, 1, 12) + getSurgicalBoxes(pins).reduce((acc, box) => acc + countTiles(box, 13, 17), 0);
    const estimatedSizeMB = estimateSizeMB(totalCount);

    const storageStatus = await canFit(estimatedSizeMB);
    if (!storageStatus.ok) {
        alert(storageStatus.message);
        return;
    }

    setDownloadSummary({
        tileCount: totalCount,
        sizeMB: estimatedSizeMB,
        bbox
    });
    
    if (storageStatus.message) {
        // Show warning but allow proceeding
        console.warn(storageStatus.message);
    }
    
    setShowDownloadConfirm(true);
    setIsMenuOpen(false);
  };

  const startDownload = async () => {
    if (!downloadSummary || !mapId) return;
    
    setIsDownloading(true);
    setDownloadProgress(0);
    setShowDownloadConfirm(false);

    try {
        const allTiles = [
            ...getTilesForArea(downloadSummary.bbox, 1, 12),
            ...getSurgicalBoxes(pins).flatMap(box => getTilesForArea(box, 13, 17))
        ];

        // Deduplication
        const uniqueTilesMap = new Map();
        allTiles.forEach(tile => uniqueTilesMap.set(tile.url, tile));
        const uniqueTiles = Array.from(uniqueTilesMap.values());

        // Spawn Worker
        const worker = new Worker(new URL('../workers/tileWorker.ts', import.meta.url), { type: 'module' });
        
        worker.postMessage({
            type: 'start-download',
            mapId,
            tiles: uniqueTiles
        });

        worker.onmessage = (e) => {
            const { type, progress, error } = e.data;
            if (type === 'progress') {
                setDownloadProgress(progress);
            } else if (type === 'complete') {
                setIsDownloading(false);
                setDownloadProgress(null);
                alert(`Map tiles downloaded successfully! ${uniqueTiles.length.toLocaleString()} tiles are now available offline.`);
                worker.terminate();
            } else if (type === 'error') {
                console.error("Worker error:", error);
                setIsDownloading(false);
                setDownloadProgress(null);
                alert("Failed to download map tiles. Please try again.");
                worker.terminate();
            }
        };

    } catch (error) {
        console.error("Download setup failed:", error);
        setIsDownloading(false);
        setDownloadProgress(null);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!document.body.contains(event.target as Node)) {
        return;
      }
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleExportClick = () => {
    setExportFileName(`${mapName.replace(/\s+/g, '_')}_export.json`);
    setExportFormat('json');
    setShowExportModal(true);
    setIsMenuOpen(false);
  };

  const confirmExport = () => {
    exportMap({ 
      id: '', 
      name: mapName, 
      pins, 
      groups,
      ownerId: '' 
    }, exportFormat, exportFileName);
    setShowExportModal(false);
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

  const defaultPins = pins.filter(p => !p.groupId).sort((a, b) => a.position - b.position);

  const getVisualOrder = (pin: Pin) => {
    if (!pin.groupId) return { groupIndex: Number.MAX_SAFE_INTEGER, pinPosition: pin.position };
    const groupIndex = groups.findIndex(g => g.id === pin.groupId);
    return { 
      groupIndex: groupIndex !== -1 ? groupIndex : Number.MAX_SAFE_INTEGER, 
      pinPosition: pin.position 
    };
  };

  const selectedPins = pins.filter(p => selectedNavIds?.has(p.id))
    .sort((a, b) => {
      const orderA = getVisualOrder(a);
      const orderB = getVisualOrder(b);
      if (orderA.groupIndex !== orderB.groupIndex) {
        return orderA.groupIndex - orderB.groupIndex;
      }
      return orderA.pinPosition - orderB.pinPosition;
    });

  const handleNavigate = () => {
    if (selectedPins.length === 0) return;
    
    let url = '';
    if (selectedPins.length === 1) {
        // Single pin: just navigate to it
        const p = selectedPins[0];
        url = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=driving&dir_action=navigate`;
    } else {
        // Multiple pins: first is origin, last is destination, others are waypoints
        const origin = selectedPins[0];
        const destination = selectedPins[selectedPins.length - 1];
        const waypoints = selectedPins.slice(1, -1).map(p => `${p.lat},${p.lng}`).join('|');
        
        url = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&waypoints=${waypoints}&travelmode=driving&dir_action=navigate`;
    }
    
    window.open(url, '_blank');
  };

  const isDefaultAllSelected = defaultPins.length > 0 && defaultPins.every(p => selectedNavIds?.has(p.id));
  const isDefaultSomeSelected = defaultPins.some(p => selectedNavIds?.has(p.id));

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    if (active.data.current?.type === 'pin') {
      setActivePin(active.data.current.pin);
    } else if (active.data.current?.type === 'group') {
      setActiveGroup(active.data.current.group);
    }
  };

  const handleDragEndInternal = (event: DragEndEvent) => {
    setActivePin(null);
    setActiveGroup(null);
    onDragEnd(event);
  };

  const activePinId = activePin?.id;
  const isAnySelectedDragging = !!(activePinId && selectedNavIds?.has(activePinId));
  const isDragActive = !!(activePinId || activeGroup);

  const customCollisionDetection = (args: any) => {
    const pointerCollisions = closestCorners(args);
    if (args.active.data.current?.type === 'group' && pointerCollisions.length > 0) {
      const firstCollision = pointerCollisions[0];
      const container = args.droppableContainers.find((c: any) => c.id === firstCollision.id);
      
      if (container?.data.current?.type === 'pin') {
        const pinGroupId = container.data.current.pin.groupId;
        if (pinGroupId) {
          const groupContainer = args.droppableContainers.find((c: any) => c.id === pinGroupId);
          if (groupContainer) {
            return [{
              id: pinGroupId,
              data: { droppableContainer: groupContainer }
            }];
          }
        }
        return [];
      }
    }
    return pointerCollisions;
  };

  return (
    <aside style={{ flex: 1, background: 'white', display: 'flex', flexDirection: 'column', padding: isMobile ? '0.2rem 0.6rem 0.6rem 0.6rem' : '0.6rem', boxSizing: 'border-box', overflow: 'hidden', borderRight: '1px solid var(--border-color)', position: 'relative' }}>
      <DndContext 
        sensors={sensors}
        collisionDetection={customCollisionDetection}
        onDragStart={handleDragStart}
        onDragOver={onDragOver}
        onDragEnd={handleDragEndInternal}
        autoScroll={false}
      >
        <div style={{ marginBottom: isMobile ? '0.2rem' : '0.6rem', display: isMobile && readOnly ? 'none' : 'block' }}>

          <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
            <input 
              id="map-name"
              aria-label="map name"
              type="text" 
              value={localMapName} 
              onChange={(e) => setLocalMapName(e.target.value)}
              onBlur={() => onMapNameChange(localMapName)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              disabled={readOnly}
              className="input-field map-name-input"
              style={{ fontWeight: '800', fontSize: '0.9rem', padding: '3px 6px', border: 'none', background: 'transparent', flex: 1, textOverflow: 'ellipsis' }}
            />
            
            <div style={{ display: 'flex', gap: '2px', alignItems: 'center', flexShrink: 0 }}>
              {selectedPins.length > 0 && (
                <button 
                  onClick={handleNavigate}
                  style={{ fontSize: '0.6rem', background: 'var(--success-color)', color: 'white', border: 'none', padding: '2px 7px', borderRadius: '50px', cursor: 'pointer', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '3px' }}
                >
                  <Navigation size={9} /> Go ({selectedPins.length})
                </button>
              )}
              
              {(() => {
                const menuContent = (
                  <div style={{ position: 'relative' }} ref={menuRef}>
                    <button 
                      onClick={() => setIsMenuOpen(!isMenuOpen)}
                      aria-label="More options"
                      style={{ background: 'none', border: 'none', color: isMobile ? 'white' : '#888', cursor: 'pointer', display: 'flex', padding: '3px' }}
                    >
                      <MoreVertical size={isMobile ? 20 : 16} />
                    </button>
                    
                    {isMenuOpen && (
                      <div style={{ position: 'absolute', top: '100%', right: 0, width: '180px', background: 'white', color: 'var(--text-primary)', textAlign: 'left', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', zIndex: 1600, overflow: 'hidden' }}>
                          <div 
                            style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', fontWeight: '600' }}
                            onClick={() => { onShare?.(); setIsMenuOpen(false); }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            Share
                          </div>
                        {!readOnly && (
                          <div 
                            style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', fontWeight: '600' }}
                            onClick={handleImportClick}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            Import
                          </div>
                        )}
                        <div 
                          style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', fontWeight: '600' }}
                          onClick={handleExportClick}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                            Export
                        </div>
                        {deferredPrompt && (
                          <div 
                            style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', fontWeight: '600' }}
                            onClick={() => {
                              handleInstallClick();
                              setIsMenuOpen(false);
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            Install App
                          </div>
                        )}
                        <div 
                          style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', fontWeight: '600', color: isDownloading ? '#999' : 'inherit' }}
                          onClick={isDownloading ? undefined : handleDownloadClick}
                          onMouseEnter={(e) => !isDownloading && (e.currentTarget.style.background = 'var(--bg-color)')}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          Download for Offline
                        </div>
                        {selectedPins.length > 0 && !readOnly && (
                          <>
                            <div style={{ padding: '8px 16px', fontSize: '0.65rem', fontWeight: '800', color: '#999', background: '#fcfcfc', borderBottom: '1px solid var(--border-color)', borderTop: '1px solid var(--border-color)' }}>MOVE SELECTED TO...</div>
                            <div 
                              style={{ padding: '10px 16px', cursor: 'pointer', fontSize: '0.85rem', borderBottom: '1px solid var(--border-color)', fontWeight: '600' }}
                              onClick={() => {
                                selectedPins.forEach(p => onUpdatePin(p.id, { groupId: undefined }));
                                setIsMenuOpen(false);
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            >
                              Default Layer
                            </div>
                            {groups.map(group => (
                              <div 
                                key={group.id}
                                style={{ padding: '10px 16px', cursor: 'pointer', fontSize: '0.85rem', borderBottom: '1px solid var(--border-color)', fontWeight: '600' }}
                                onClick={() => {
                                  selectedPins.forEach(p => onUpdatePin(p.id, { groupId: group.id }));
                                  setIsMenuOpen(false);
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                              >
                                {group.name}
                              </div>
                            ))}
                          </>
                        )}
                        {!readOnly && (
                          <div 
                            style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderTop: '1px solid var(--border-color)', fontSize: '0.85rem', fontWeight: '600' }}
                            onClick={() => {
                              onAddGroup();
                              setIsMenuOpen(false);
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
                            New Layer
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );

                return isMobile && document.getElementById('mobile-header-actions')
                  ? createPortal(menuContent, document.getElementById('mobile-header-actions')!)
                  : menuContent;
              })()}
            </div>
          </div>
        </div>

        {!readOnly && (
          <SearchBar 
            onResultSelect={onResultSelect} 
            onAddPin={onAddPin} 
            pins={pins} 
            disabled={readOnly} 
            mapBounds={mapBounds}
            onHoverSearchResult={onHoverSearchResult}
            onHoverPin={onHoverPin}
          />
        )}



        <div 
          ref={scrollContainerRef}
          style={{ 
            flex: 1, 
            overflowY: 'auto', 
            paddingRight: '4px', 
            margin: '0 -4px'
          }}>
          <div style={{ position: 'sticky', top: 0, height: '4px', background: 'white', zIndex: 4, margin: '0 -4px' }} />
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
                targetPinId={targetPinId}
                hoveredPinId={hoveredPinId}
                onHoverPin={onHoverPin}
                customColors={customColors}
                onAddCustomColor={onAddCustomColor}
                selectedNavIds={selectedNavIds}
                onToggleNavId={onToggleNavId}
                onToggleNavIds={onToggleNavIds}
                allGroups={groups}
                isHidden={!!hiddenGroupIds?.has(group.id)}
                onToggleVisibility={() => onToggleGroupVisibility?.(group.id)}
                isExpanded={!!expandedGroupIds?.has(group.id)}
                onToggleExpand={() => onToggleExpand?.(group.id)}
                isAnySelectedDragging={isAnySelectedDragging}
                isGroupDragging={!!activeGroup}
                isDragActive={isDragActive}
              />
            ))}
          </SortableContext>

          <div style={{ marginTop: groups.length > 0 ? '0.6rem' : '0' }}>
            <div 
              id="default"
              style={{ 
                position: 'sticky', 
                top: '4px', 
                zIndex: 5, 
                background: 'white',
                borderTop: '1px solid transparent',
                borderLeft: '1px solid transparent',
                borderRight: '1px solid transparent',
                borderBottom: 'none',
                borderRadius: 'var(--radius-sm)',
                boxShadow: 'var(--shadow-sm)',
                padding: '0 0.15rem',
                marginBottom: '0.2rem',
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between'
              }}>
              <div onClick={() => onToggleExpand?.(null)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, padding: '1px 0' }}>
                <div style={{ color: 'var(--primary-color)', marginRight: '1px', display: 'flex' }}>
                    {expandedGroupIds?.has(null) ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </div>
                <h4 style={{ fontSize: '0.55rem', color: '#aaa', textTransform: 'uppercase', fontWeight: '800', letterSpacing: '0.1em', margin: 0 }}>
                    Default Layer
                </h4>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginLeft: '4px' }}>
                <button 
                  onClick={(e) => { e.stopPropagation(); onToggleGroupVisibility?.(null); }}
                  style={{ background: 'transparent', border: 'none', color: hiddenGroupIds?.has(null) ? '#bbb' : 'var(--primary-color)', cursor: 'pointer', padding: '1px 3px', display: 'flex', alignItems: 'center' }}
                  title={hiddenGroupIds?.has(null) ? "Show group" : "Hide group"}
                >
                  {hiddenGroupIds?.has(null) ? <EyeOff size={11} /> : <Eye size={11} />}
                </button>
                {defaultPins.length > 0 ? (
                  <input 
                    type="checkbox" 
                    checked={isDefaultAllSelected}
                    ref={el => { if (el) el.indeterminate = isDefaultSomeSelected && !isDefaultAllSelected; }}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      onToggleNavIds?.(defaultPins.map(p => p.id), checked);
                    }}
                    style={{ cursor: 'pointer', accentColor: 'var(--primary-color)', width: '9px', height: '9px' }}
                    title="Select all in default layer for navigation"
                  />
                ) : (
                  <div style={{ width: '9px', height: '9px' }} />
                )}
                {!readOnly && (
                  <div style={{ width: '18px' }} />
                )}
              </div>
            </div>
            {expandedGroupIds?.has(null) && (
              <div style={{ paddingLeft: '0.2rem', borderLeft: '1px solid var(--border-color)', marginTop: '0px', marginLeft: '0.4rem' }}>
                <SortableContext items={defaultPins.map(p => p.id)} strategy={verticalListSortingStrategy} disabled={readOnly}>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, minHeight: '10px' }}>
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
                        targetPinId={targetPinId}
                        hoveredPinId={hoveredPinId}
                        onHoverPin={onHoverPin}
                        customColors={customColors}
                        onAddCustomColor={onAddCustomColor}
                        isSelected={selectedNavIds?.has(pin.id)}
                        onToggleSelect={onToggleNavId}
                        allGroups={groups}
                        isAnySelectedDragging={isAnySelectedDragging}
                        isDragActive={isDragActive}
                      />
                    ))}
                    {defaultPins.length === 0 && groups.length === 0 && (
                      <li style={{ padding: '1rem 0.5rem', color: '#bbb', textAlign: 'center', fontSize: '0.65rem' }}>
                        <div style={{ background: 'var(--bg-color)', width: '32px', height: '32px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.5rem auto' }}>
                          <MapPin size={16} />
                        </div>
                        {readOnly ? 'No pins available.' : 'Right-click the map or use the search bar above to start adding pins!'}
                      </li>
                    )}
                  </ul>
                </SortableContext>
              </div>
            )}
          </div>
        </div>

        {/* Offline Download Confirmation Modal (Portaled) */}
        {showDownloadConfirm && downloadSummary && createPortal(
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999, padding: '20px' }}>
            <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '32px', maxWidth: '440px', width: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '1.3rem', fontWeight: '900', color: '#1a1c1e' }}>Download Map for Offline?</h3>
              <p style={{ margin: '0 0 24px 0', fontSize: '1rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                This will download map tiles for the current area and high-detail tiles around each of your pins.
              </p>
              <div style={{ background: 'var(--bg-color)', padding: '16px', borderRadius: 'var(--radius-md)', marginBottom: '32px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>Estimated Tiles: {downloadSummary.tileCount.toLocaleString()}</div>
                <div style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--text-primary)' }}>Estimated Size: {downloadSummary.sizeMB.toFixed(1)} MB</div>
              </div>
              <div style={{ display: 'flex', gap: '16px' }}>
                <button 
                  onClick={() => setShowDownloadConfirm(false)}
                  style={{ flex: 1, padding: '12px', background: '#f5f5f5', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', fontWeight: '800', cursor: 'pointer', color: '#444' }}
                >
                  Cancel
                </button>
                <button 
                  onClick={startDownload}
                  style={{ flex: 1, padding: '12px', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: '800', cursor: 'pointer', boxShadow: '0 4px 10px rgba(72, 61, 139, 0.3)' }}
                >
                  Download
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* Export Modal (Portaled) */}
        {showExportModal && createPortal(
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999, padding: '20px' }}>
            <div style={{ background: 'white', borderRadius: 'var(--radius-lg)', padding: '32px', maxWidth: '440px', width: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '1.3rem', fontWeight: '900', color: '#1a1c1e' }}>Export Map</h3>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: '700' }}>File Name</label>
                <input 
                  type="text" 
                  value={exportFileName} 
                  onChange={(e) => setExportFileName(e.target.value)} 
                  style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', boxSizing: 'border-box', fontFamily: 'inherit' }}
                />
              </div>
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: '700' }}>Format</label>
                <select 
                  value={exportFormat} 
                  onChange={(e) => {
                    const newFormat = e.target.value as 'json' | 'geojson' | 'kml';
                    setExportFormat(newFormat);
                    let name = exportFileName;
                    if (/\.(json|geojson|kml)$/.test(name)) {
                        name = name.replace(/\.(json|geojson|kml)$/, `.${newFormat}`);
                    } else {
                        name = `${name}.${newFormat}`;
                    }
                    setExportFileName(name);
                  }}
                  style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', boxSizing: 'border-box', fontFamily: 'inherit' }}
                >
                  <option value="json">OurMaps JSON</option>
                  <option value="geojson">GeoJSON</option>
                  <option value="kml">KML</option>
                </select>
              </div>
              <div style={{ display: 'flex', gap: '16px' }}>
                <button 
                  onClick={() => setShowExportModal(false)}
                  style={{ flex: 1, padding: '12px', background: '#f5f5f5', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', fontWeight: '800', cursor: 'pointer', color: '#444' }}
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmExport}
                  style={{ flex: 1, padding: '12px', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: '800', cursor: 'pointer', boxShadow: '0 4px 10px rgba(72, 61, 139, 0.3)' }}
                >
                  Export
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {createPortal(
          <DragOverlay 
            modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}
            style={{ pointerEvents: 'none' }}
            dropAnimation={{
            sideEffects: defaultDropAnimationSideEffects({
                styles: {
                    active: {
                        opacity: '0.3', 
                    },
                },
            }),
          }}>
            <div>
            {activePin ? (
              <div style={{ width: '200px', position: 'relative' }}>
                {/* Bundle visual: a stack of items if multiple are selected */}
                {isAnySelectedDragging && selectedNavIds && selectedNavIds.size > 1 ? (
                    <>
                        <div style={{ position: 'absolute', top: '4px', left: '4px', width: '100%', zIndex: 1, opacity: 0.4 }}>
                            <StaticPin pin={activePin} isSelected={selectedNavIds?.has(activePin.id)} />
                        </div>
                        <div style={{ position: 'absolute', top: '2px', left: '2px', width: '100%', zIndex: 2, opacity: 0.7 }}>
                            <StaticPin pin={activePin} isSelected={selectedNavIds?.has(activePin.id)} />
                        </div>
                        <div style={{ position: 'relative', zIndex: 3 }}>
                            <StaticPin pin={activePin} isSelected={selectedNavIds?.has(activePin.id)} />
                            <div style={{ 
                                position: 'absolute', 
                                top: '-6px', 
                                right: '-6px', 
                                background: 'var(--primary-color)', 
                                color: 'white', 
                                borderRadius: '50%', 
                                width: '14px', 
                                height: '14px', 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center', 
                                fontSize: '0.55rem',
                                fontWeight: '800',
                                boxShadow: 'var(--shadow-sm)',
                                zIndex: 4
                            }}>
                                {selectedNavIds.size}
                            </div>
                        </div>
                    </>
                ) : (
                    <StaticPin pin={activePin} isSelected={selectedNavIds?.has(activePin.id)} />
                )}
              </div>
            ) : activeGroup ? (
              <div style={{ width: '240px', background: 'white', border: '1px solid var(--primary-color)', borderRadius: 'var(--radius-sm)', padding: '0.2rem', opacity: 0.9, boxShadow: 'var(--shadow-md)', marginLeft: '12px' }}>
                <div style={{ fontWeight: '700', fontSize: '0.65rem' }}>{activeGroup.name}</div>
              </div>
            ) : null}
            </div>
          </DragOverlay>,
          document.body
        )}
      </DndContext>

      {/* Download Progress Modal (Portaled to body) */}
      {isDownloading && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div style={{ background: 'white', borderRadius: '24px', padding: '40px', maxWidth: '440px', width: '100%', boxShadow: '0 30px 60px rgba(0,0,0,0.5)', textAlign: 'center', position: 'relative' }}>
            <div className="animate-spin" style={{ width: '64px', height: '64px', border: '8px solid #f3f3f3', borderTop: '8px solid #483D8B', borderRadius: '50%', margin: '0 auto 32px auto' }} />
            <h2 style={{ margin: '0 0 16px 0', fontSize: '1.8rem', fontWeight: '900', color: '#1a1c1e', letterSpacing: '-0.02em' }}>Downloading Map</h2>
            <p style={{ margin: '0 0 40px 0', fontSize: '1rem', color: '#44474e', lineHeight: '1.6' }}>
              We're preparing high-detail tiles for offline use.<br />
              <span style={{ color: '#483D8B', fontWeight: '700' }}>Please keep this tab open until finished.</span>
            </p>
            
            <div style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', alignItems: 'flex-end' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '900', color: '#1a1c1e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {downloadProgress === 0 ? 'Calculating...' : 'Progress'}
                </span>
                <span style={{ fontSize: '1.4rem', fontWeight: '1000', color: '#483D8B' }}>
                  {Math.round((downloadProgress || 0) * 100)}%
                </span>
              </div>
              <div style={{ height: '20px', background: '#f0f0f0', borderRadius: '10px', overflow: 'hidden', boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.2)', border: '1px solid #e0e0e0' }}>
                <div style={{ 
                  height: '100%', 
                  width: `${Math.max(3, (downloadProgress || 0) * 100)}%`, 
                  background: 'linear-gradient(90deg, #483D8B 0%, #6A5ACD 100%)', 
                  transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: '0 0 20px rgba(72, 61, 139, 0.5)'
                }} />
              </div>
              <div style={{ marginTop: '20px', fontSize: '0.85rem', color: '#666', fontWeight: '800', fontVariantNumeric: 'tabular-nums' }}>
                  {downloadProgress !== null ? `${Math.round(downloadProgress * (downloadSummary?.tileCount || 0)).toLocaleString()} / ${downloadSummary?.tileCount.toLocaleString()} TILES` : ''}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </aside>
  );
};

export default Sidebar;
// Force Vite HMR reload
