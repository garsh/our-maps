import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  Share2,
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
import { restrictToWindowEdges, snapCenterToCursor } from '@dnd-kit/modifiers';
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
  onHoverPin?: (id: string | null) => void;
  customColors?: string[];
  onAddCustomColor?: (color: string) => void;
  selectedNavIds?: Set<string>;
  onToggleNavId?: (id: string) => void;
  onToggleNavIds?: (ids: string[], force?: boolean) => void;
  hiddenGroupIds?: Set<string | null>;
  onToggleGroupVisibility?: (id: string | null) => void;
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
  { name: 'brown', value: '#8B4513' }
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
  { type: 'gas', Icon: Fuel },
  { type: 'charging', Icon: Zap },
];

const StaticPin = ({ pin }: { pin: Pin }) => {
  const currentColor = COLORS.find(c => c.name === pin.color)?.value || pin.color || '#2A81CB';
  return (
    <div style={{ 
      padding: '0.05rem 0.15rem', 
      borderRadius: 'var(--radius-sm)',
      background: 'white',
      border: '1px solid var(--primary-color)',
      boxShadow: 'var(--shadow-md)',
      display: 'flex', 
      alignItems: 'center',
      gap: '4px',
      opacity: 0.9
    }}>
      <div style={{ width: '8px', padding: '1px 2px', color: '#555' }}><GripVertical size={8} /></div>
      <div style={{ width: '12px', height: '12px', borderRadius: '2px', background: currentColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
         {(() => {
            const iconObj = ICONS.find(i => i.type === pin.icon) || ICONS[0];
            const { Icon } = iconObj;
            return <Icon size={7} color="white" />;
        })()}
      </div>
      <div style={{ fontWeight: '600', fontSize: '0.65rem', color: 'var(--text-primary)' }}>{pin.label}</div>
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
  hoveredPinId,
  onHoverPin,
  onAddCustomColor,
  isSelected,
  onToggleSelect,
  customColors,
  allGroups,
  isAnySelectedDragging
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
  customColors?: string[],
  allGroups: PinGroup[],
  isAnySelectedDragging: boolean
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver
  } = useSortable({ 
    id: pin.id,
    data: { type: 'pin', pin },
    disabled: readOnly
  });

  const isItemInDraggingBundle = isAnySelectedDragging && isSelected;

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
        padding: '0.05rem 0.15rem', 
        marginBottom: '0px',
        borderRadius: 'var(--radius-sm)',
        background: hoveredPinId === pin.id ? 'rgba(72, 61, 139, 0.05)' : (editingPinId === pin.id ? 'var(--bg-color)' : 'transparent'),
        border: editingPinId === pin.id ? '1px solid var(--primary-color)' : '1px solid transparent',
        borderTop: isOver && !isDragging ? '2px solid var(--primary-color)' : '1px solid transparent',
        boxShadow: hoveredPinId === pin.id ? '0 0 0 1px var(--primary-color)' : 'none',
        transition: 'all 0.1s ease',
        cursor: 'default'
      }}
      onMouseEnter={() => onHoverPin?.(pin.id)}
      onMouseLeave={() => onHoverPin?.(null)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
          {!readOnly && (
            <div {...attributes} {...listeners} style={{ cursor: 'grab', marginRight: '0px', color: '#555', padding: '1px 2px' }}>
              <GripVertical size={10} />
            </div>
          )}
          <input 
            type="checkbox" 
            checked={!!isSelected} 
            onChange={(e) => { e.stopPropagation(); onToggleSelect?.(pin.id); }}
            style={{ marginRight: '3px', cursor: 'pointer', accentColor: 'var(--primary-color)', width: '9px', height: '9px' }}
            onClick={(e) => e.stopPropagation()}
          />
          <div 
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', flex: 1, padding: '0px' }}
            onClick={() => onPinClick(pin)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div 
                style={{ 
                  width: '12px', 
                  height: '12px', 
                  borderRadius: '2px', 
                  background: currentColor,
                  boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.15)',
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  flexShrink: 0 
                }}
              >
                {(() => {
                    const iconObj = ICONS.find(i => i.type === pin.icon) || ICONS[0];
                    const { Icon } = iconObj;
                    return <Icon size={7} color="white" />;
                })()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: '600', fontSize: '0.65rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '1.1' }}>{pin.label}</div>
                {pin.description && (
                  <div style={{ fontSize: '0.5rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '-1px', lineHeight: '1' }}>{pin.description}</div>
                )}
              </div>            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '2px', marginLeft: '4px' }}>
          {!readOnly && (
            <button 
              onClick={() => setEditingPinId(editingPinId === pin.id ? null : pin.id)}
              style={{ 
                background: editingPinId === pin.id ? 'var(--primary-color)' : 'transparent', 
                color: editingPinId === pin.id ? 'white' : 'var(--primary-color)', 
                border: 'none',
                borderRadius: '4px', 
                padding: '0px 3px', 
                cursor: 'pointer', 
                fontSize: '0.45rem',
                fontWeight: '700'
              }}
            >
              {editingPinId === pin.id ? 'Close' : 'Edit'}
            </button>
          )}
        </div>
      </div>

      {editingPinId === pin.id && !readOnly && (
        <div style={{ padding: '0.3rem 0.15rem 0.15rem 0.15rem', marginTop: '0.3rem', borderTop: '1px solid var(--border-color)', fontSize: '0.7rem' }}>
          <div style={{ marginBottom: '5px' }}>
            <label htmlFor={`label-${pin.id}`} style={{ display: 'block', fontWeight: '700', marginBottom: '1px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>NAME</label>
            <input 
              id={`label-${pin.id}`}
              type="text" 
              value={pin.label || ''} 
              onChange={(e) => onUpdatePin(pin.id, { label: e.target.value })}
              className="input-field"
              style={{ padding: '2px 4px', fontSize: '0.7rem' }}
            />
          </div>

          <div style={{ marginBottom: '5px' }}>
            <label htmlFor={`address-${pin.id}`} style={{ display: 'block', fontWeight: '700', marginBottom: '1px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>ADDRESS</label>
            <textarea 
              id={`address-${pin.id}`}
              value={pin.address || ''} 
              onChange={(e) => onUpdatePin(pin.id, { address: e.target.value })}
              className="input-field"
              style={{ padding: '2px 4px', fontSize: '0.7rem', minHeight: '30px', resize: 'vertical' }}
              placeholder="Fetch address from map or type here..."
            />
          </div>

          <div style={{ marginBottom: '5px' }}>
            <label style={{ display: 'block', fontWeight: '700', marginBottom: '1px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>LAYER</label>
            <select 
                value={pin.groupId || ''} 
                onChange={(e) => onUpdatePin(pin.id, { groupId: e.target.value || undefined })}
                className="input-field"
                style={{ padding: '2px 4px', fontSize: '0.7rem', background: 'white' }}
            >
                <option value="">Default Layer</option>
                {allGroups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                ))}
            </select>
          </div>

          <div style={{ marginBottom: '5px' }}>
            <label style={{ display: 'block', fontWeight: '700', marginBottom: '3px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>COLOR</label>
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
            <label style={{ display: 'block', fontWeight: '700', marginBottom: '3px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>ICON</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '2px' }}>
              {ICONS.map(({ type, Icon }) => (
                <button
                  key={type}
                  aria-label={`icon-${type}`}
                  onClick={() => onUpdatePin(pin.id, { icon: type })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '20px',
                    borderRadius: '4px',
                    background: pin.icon === type || (!pin.icon && type === 'default') ? 'var(--primary-color)' : '#eee',
                    border: '1px solid var(--border-color)',
                    cursor: 'pointer'
                  }}
                >
                  <Icon size={9} color={pin.icon === type || (!pin.icon && type === 'default') ? 'white' : '#333'} />
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '5px' }}>
            <label htmlFor={`image-${pin.id}`} style={{ display: 'block', fontWeight: '700', marginBottom: '3px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>IMAGE URL</label>
            <input 
              id={`image-${pin.id}`}
              type="text" 
              value={pin.imageUrl || ''} 
              onChange={(e) => onUpdatePin(pin.id, { imageUrl: e.target.value })}
              placeholder="https://example.com/image.jpg"
              className="input-field"
              style={{ padding: '2px 4px', fontSize: '0.7rem' }}
            />
          </div>

          <div style={{ marginBottom: '5px' }}>
            <label htmlFor={`desc-${pin.id}`} style={{ display: 'block', fontWeight: '700', marginBottom: '3px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>DESCRIPTION</label>
            <textarea 
              id={`desc-${pin.id}`}
              value={pin.description || ''} 
              onChange={(e) => onUpdatePin(pin.id, { description: e.target.value })}
              className="input-field"
              style={{ minHeight: '25px', resize: 'vertical', padding: '2px 4px', fontSize: '0.7rem' }}
            />
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', marginTop: '6px' }}>
            <button 
              onClick={() => onRemovePin(pin.id)}
              style={{ background: 'transparent', color: 'var(--error-color)', border: 'none', padding: '2px', cursor: 'pointer', fontSize: '0.6rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '2px' }}
            >
              <Trash2 size={10} /> Delete
            </button>
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
  onToggleNavIds,
  allGroups,
  isHidden,
  onToggleVisibility,
  isAnySelectedDragging
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
  onToggleNavIds?: (ids: string[], force?: boolean) => void,
  allGroups: PinGroup[],
  isHidden: boolean,
  onToggleVisibility: () => void,
  isAnySelectedDragging: boolean
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);

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
        top: '-1px',
        zIndex: 5,
        display: 'flex', 
        alignItems: 'center', 
        background: 'white',
        padding: '0.1rem 0.2rem', 
        borderRadius: 'var(--radius-sm)',
        borderBottom: '1px solid var(--border-color)',
        borderTop: isOver && !isDragging ? '2px solid var(--primary-color)' : '1px solid transparent',
        transition: 'all 0.1s ease',
        boxShadow: isExpanded ? 'none' : 'var(--shadow-sm)'
      }}>
        {!readOnly && (
          <div {...attributes} {...listeners} style={{ cursor: 'grab', color: '#555', padding: '1px 3px', display: 'flex', alignItems: 'center' }}>
            <GripVertical size={11} />
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
          style={{ marginRight: '3px', cursor: 'pointer', accentColor: 'var(--primary-color)', width: '9px', height: '9px' }}
          onClick={(e) => e.stopPropagation()}
          title="Select all in group for navigation"
        />
        <button 
          onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
          style={{ background: 'none', border: 'none', color: isHidden ? '#bbb' : 'var(--primary-color)', cursor: 'pointer', display: 'flex', padding: '2px', marginRight: '0px' }}
          title={isHidden ? "Show group" : "Hide group"}
        >
          {isHidden ? <EyeOff size={11} /> : <Eye size={11} />}
        </button>
        <div onClick={() => setIsExpanded(!isExpanded)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, padding: '1px 0' }}>
          <div style={{ color: 'var(--primary-color)', marginRight: '1px', display: 'flex' }}>
            {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </div>
          {isEditingName && !readOnly ? (
            <input 
              autoFocus
              value={group.name}
              onChange={(e) => onUpdateGroup(group.id, { name: e.target.value })}
              onFocus={(e) => e.target.select()}
              onBlur={() => setIsEditingName(false)}
              onKeyDown={(e) => e.key === 'Enter' && setIsEditingName(false)}
              className="input-field"
              style={{ fontSize: '0.65rem', padding: '1px 3px', height: 'auto' }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span onDoubleClick={() => !readOnly && setIsEditingName(true)} style={{ fontWeight: '700', fontSize: '0.65rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {group.name} <span style={{ fontWeight: 'normal', color: '#aaa', fontSize: '0.55rem', marginLeft: '2px' }}>({groupPins.length})</span>
            </span>
          )}
        </div>
        {!readOnly && (
          <div style={{ display: 'flex', gap: '1px' }}>
            <button 
                onClick={(e) => { e.stopPropagation(); setIsEditingName(!isEditingName); }}
                style={{ background: isEditingName ? 'var(--primary-color)' : 'transparent', color: isEditingName ? 'white' : 'var(--primary-color)', border: 'none', borderRadius: '4px', padding: '0px 2px', cursor: 'pointer', fontSize: '0.4rem', fontWeight: '700' }}
            >
                {isEditingName ? 'DONE' : 'RENAME'}
            </button>
            {!isEditingName && (
                <button 
                    onClick={(e) => { e.stopPropagation(); onRemoveGroup(group.id); }}
                    style={{ background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', padding: '1px', borderRadius: '50%', display: 'flex' }}
                    className="delete-group-btn"
                    title="Delete Group"
                >
                    <Trash2 size={9} />
                </button>
            )}
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
                  hoveredPinId={hoveredPinId}
                  onHoverPin={onHoverPin}
                  onAddCustomColor={onAddCustomColor}
                  isSelected={selectedNavIds?.has(pin.id)}
                  onToggleSelect={onToggleNavId}
                  customColors={customColors}
                  allGroups={allGroups}
                  isAnySelectedDragging={isAnySelectedDragging}
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
  hoveredPinId,
  onHoverPin,
  customColors,
  onAddCustomColor,
  selectedNavIds,
  onToggleNavId,
  onToggleNavIds,
  hiddenGroupIds,
  onToggleGroupVisibility
}: SidebarProps) => {
  const [localMapName, setLocalMapName] = useState(mapName);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const readOnly = userRole === 'view';
  const [activePin, setActivePin] = useState<Pin | null>(null);
  const [activeGroup, setActiveGroup] = useState<PinGroup | null>(null);

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

  const defaultPins = pins.filter(p => !p.groupId).sort((a, b) => a.position - b.position);
  const selectedPins = pins.filter(p => selectedNavIds?.has(p.id))
    .sort((a, b) => {
      if (a.groupId === b.groupId) return a.position - b.position;
      if (!a.groupId) return -1;
      if (!b.groupId) return 1;
      return a.groupId.localeCompare(b.groupId);
    });

  const handleNavigate = () => {
    if (selectedPins.length === 0) return;
    
    const destination = selectedPins[selectedPins.length - 1];
    const waypoints = selectedPins.slice(0, -1).map(p => `${p.lat},${p.lng}`).join('|');
    
    const url = `https://www.google.com/maps/dir/?api=1&origin=current+location&destination=${destination.lat},${destination.lng}&waypoints=${waypoints}&travelmode=driving&dir_action=navigate`;
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

  return (
    <aside style={{ flex: 1, background: 'white', display: 'flex', flexDirection: 'column', padding: '0.6rem', boxSizing: 'border-box', overflow: 'hidden', borderRight: '1px solid var(--border-color)' }}>
      <div style={{ marginBottom: '0.6rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
          <label htmlFor="map-name" style={{ display: 'block', fontWeight: '800', fontSize: '0.6rem', textTransform: 'uppercase', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>Map Name</label>
        </div>
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          <input 
            id="map-name"
            type="text" 
            value={localMapName} 
            onChange={(e) => setLocalMapName(e.target.value)}
            onBlur={() => onMapNameChange(localMapName)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            disabled={readOnly}
            className="input-field"
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
            
            <div style={{ position: 'relative' }} ref={menuRef}>
              <button 
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', display: 'flex', padding: '3px' }}
              >
                <MoreVertical size={16} />
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem', marginTop: '0.2rem' }}>
        <h3 style={{ margin: 0, fontSize: '0.75rem', fontWeight: '800', color: 'var(--text-primary)' }}>Layers</h3>
        {!readOnly && (
          <button 
            onClick={onAddGroup}
            style={{ display: 'flex', alignItems: 'center', gap: '3px', background: 'transparent', border: '1px solid var(--border-color)', padding: '2px 5px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '0.6rem', fontWeight: '600', color: 'var(--text-secondary)' }}
          >
            <FolderPlus size={11} /> New Layer
          </button>
        )}
      </div>

      <div 
        ref={scrollContainerRef}
        style={{ 
          flex: 1, 
          overflowY: 'auto', 
          paddingRight: '4px', 
          margin: '0 -4px'
        }}>
        <DndContext 
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={onDragOver}
          onDragEnd={handleDragEndInternal}
          autoScroll={false}
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
                allGroups={groups}
                isHidden={!!hiddenGroupIds?.has(group.id)}
                onToggleVisibility={() => onToggleGroupVisibility?.(group.id)}
                isAnySelectedDragging={isAnySelectedDragging}
              />
            ))}
          </SortableContext>

          <div style={{ marginTop: groups.length > 0 ? '0.6rem' : '0' }}>
            <div 
              id="default"
              style={{ 
                position: 'sticky', 
                top: '-1px', 
                zIndex: 5, 
                background: 'white',
                borderBottom: '1px solid var(--border-color)',
                padding: '0.1rem 0.2rem',
                marginBottom: '0.2rem',
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between'
              }}>
              <h4 style={{ fontSize: '0.55rem', color: '#aaa', textTransform: 'uppercase', fontWeight: '800', letterSpacing: '0.1em', margin: 0 }}>
                Default Layer
              </h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                <button 
                  onClick={(e) => { e.stopPropagation(); onToggleGroupVisibility?.(null); }}
                  style={{ background: 'none', border: 'none', color: hiddenGroupIds?.has(null) ? '#bbb' : 'var(--primary-color)', cursor: 'pointer', display: 'flex', padding: '2px' }}
                  title={hiddenGroupIds?.has(null) ? "Show group" : "Hide group"}
                >
                  {hiddenGroupIds?.has(null) ? <EyeOff size={11} /> : <Eye size={11} />}
                </button>
                {defaultPins.length > 0 && (
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
                )}
              </div>
            </div>
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
                    hoveredPinId={hoveredPinId}
                    onHoverPin={onHoverPin}
                    customColors={customColors}
                    onAddCustomColor={onAddCustomColor}
                    isSelected={selectedNavIds?.has(pin.id)}
                    onToggleSelect={onToggleNavId}
                    allGroups={groups}
                    isAnySelectedDragging={isAnySelectedDragging}
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
          
        {createPortal(
          <DragOverlay 
            modifiers={[snapCenterToCursor, restrictToWindowEdges]}
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
            {activePin ? (
              <div style={{ width: '200px', position: 'relative' }}>
                {/* Bundle visual: a stack of items if multiple are selected */}
                {isAnySelectedDragging && selectedNavIds && selectedNavIds.size > 1 ? (
                    <>
                        <div style={{ position: 'absolute', top: '4px', left: '4px', width: '100%', zIndex: 1, opacity: 0.4 }}>
                            <StaticPin pin={activePin} />
                        </div>
                        <div style={{ position: 'absolute', top: '2px', left: '2px', width: '100%', zIndex: 2, opacity: 0.7 }}>
                            <StaticPin pin={activePin} />
                        </div>
                        <div style={{ position: 'relative', zIndex: 3 }}>
                            <StaticPin pin={activePin} />
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
                    <StaticPin pin={activePin} />
                )}
              </div>
            ) : activeGroup ? (
              <div style={{ width: '240px', background: 'white', border: '1px solid var(--primary-color)', borderRadius: 'var(--radius-sm)', padding: '0.2rem', opacity: 0.9, boxShadow: 'var(--shadow-md)' }}>
                <div style={{ fontWeight: '700', fontSize: '0.65rem' }}>{activeGroup.name}</div>
              </div>
            ) : null}
          </DragOverlay>,
          document.body
        )}
        </DndContext>
      </div>
    </aside>
  );
};

export default Sidebar;
