import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import SearchBar, { type SearchAreaState } from './SearchBar';
import { reverseGeocode } from '../utils/geocoding';
import type { Pin, PinIcon, PinLayer } from '@shared/interfaces';
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
  Check,
  MoreVertical,
  Fuel,
  Zap,
  Eye,
  EyeOff,
  Download,
  Palette,
  Mountain,
  Box,
  Sun,
  Moon,
  Globe
} from 'lucide-react';
import {
  DndContext, 
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  defaultDropAnimationSideEffects,
  useDroppable
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { exportMap, importMapFile } from '../utils/fileUtils';
import { 
  countUniqueTiles,
  estimateSizeMB, 
  getSurgicalBoxes, 
  getPinsBoundingBox,
  getManifestStats,
  getMapDownloadStatuses,
  getOfflineMap,
  saveMapOffline,
  type BoundingBox 
} from '../utils/tileUtils';
import { canFit } from '../utils/storageUtils';
import { tileWorkerManager } from '../utils/tileWorkerManager';
import type { MapData } from '@shared/interfaces';
import { comparePinPositions } from '../utils/reorderUtils';
import { getMapViewportBounds } from '../utils/mapViewport';
import { PIN_COLORS, resolvePinColorCode } from '../utils/mapUtils';

class MouseSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: React.PointerEvent) => {
        return event.pointerType === 'mouse';
      },
    },
  ];
}

const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 5 } };
const TOUCH_SENSOR_OPTIONS = { activationConstraint: { delay: 250, tolerance: 5 } };
const KEYBOARD_SENSOR_OPTIONS = { coordinateGetter: sortableKeyboardCoordinates };

export type MapTheme = 'light' | 'dark';

interface SidebarProps {
  mapId: string | null;
  mapName: string;
  onMapNameChange: (name: string) => void;
  layers: PinLayer[];
  onAddLayer: () => PinLayer | string | void;
  onUpdateLayer: (id: string, updates: Partial<PinLayer>) => void;
  onRemoveLayer: (id: string) => void;
  pins: Pin[];
  onAddPin: (lat: number, lng: number, label: string, address?: string) => void;
  onRemovePin: (id: string) => void;
  onPinClick: (pin: Pin) => void;
  onUpdatePin: (id: string, updates: Partial<Pin>) => void;
  onMovePinsToLayer?: (pinIds: string[], targetLayerId?: string) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel?: () => void;
  onDragStart?: (event: DragStartEvent) => void;
  userRole?: 'owner' | 'edit' | 'view';
  onShare?: () => void;
  onImport?: (data: Partial<MapData>) => void;
  editingPinId: string | null;
  onSetEditingPinId: (id: string | null) => void;
  targetPinId?: string | null;
  onHoverPin?: (id: string | null, leavingPinId?: string) => void;
  customColors?: string[];
  onAddCustomColor?: (color: string) => void;
  selectedNavIds?: Set<string>;
  onToggleNavId?: (id: string) => void;
  onToggleNavIds?: (ids: string[], force?: boolean) => void;
  hiddenLayerIds?: Set<string | null>;
  onToggleLayerVisibility?: (id: string | null) => void;
  collapsedLayerIds?: Set<string | null>;
  onToggleExpand?: (id: string | null) => void;
  onHoverSearchResult?: (lat: number | null, lng: number | null) => void;
  isMobile?: boolean;
  mobileScale?: number;
  mapTheme?: MapTheme;
  onThemeChange?: (theme: MapTheme) => void;
  showSatellite?: boolean;
  onToggleSatellite?: (enabled: boolean) => void;
  showHillshade?: boolean;
  onToggleHillshade?: (enabled: boolean) => void;
  show3DTerrain?: boolean;
  onToggle3DTerrain?: (enabled: boolean) => void;
  show3DBuildings?: boolean;
  onToggle3DBuildings?: (enabled: boolean) => void;
  isOffline?: boolean;
  isHoverBlocked?: boolean;
  onSearchAreaStateChange?: (state: SearchAreaState | null) => void;
}


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

const ADDRESS_TEXTAREA_MAX_PX = 120;
const PIN_TEXTAREA_STYLE: CSSProperties = {
  display: 'block',
  margin: 0,
  padding: '2px 4px',
  fontSize: '0.6rem',
  fontFamily: 'inherit',
  lineHeight: 1.25,
  overflow: 'hidden',
  resize: 'none',
  fieldSizing: 'content' as any,
};

const fitTextarea = (el: HTMLTextAreaElement | null, minHeight: number, maxHeight: number) => {
  if (!el) return;
  const borderOffset = Math.max(0, el.offsetHeight - el.clientHeight);
  el.style.height = 'auto';
  const needed = el.scrollHeight + borderOffset;
  const finalHeight = Math.min(Math.max(needed, minHeight), maxHeight);
  el.style.height = `${finalHeight}px`;
  el.style.overflowY = needed > maxHeight ? 'auto' : 'hidden';
};

const getCheckColors = (hex: string) => {
  const raw = hex.trim().replace('#', '');
  let r = 0, g = 0, b = 0;
  if (raw.length === 3) {
    r = parseInt(raw[0] + raw[0], 16);
    g = parseInt(raw[1] + raw[1], 16);
    b = parseInt(raw[2] + raw[2], 16);
  } else if (raw.length >= 6) {
    r = parseInt(raw.slice(0, 2), 16);
    g = parseInt(raw.slice(2, 4), 16);
    b = parseInt(raw.slice(4, 6), 16);
  }
  const toLin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
  return luminance > 0.45
    ? { fg: '#111111', outline: '#ffffff' }
    : { fg: '#ffffff', outline: '#111111' };
};

const ColorSwatch = ({
  color,
  isSelected,
  onClick,
  ariaLabel
}: {
  color: string;
  isSelected: boolean;
  onClick: () => void;
  ariaLabel?: string;
}) => {
  const checkColors = isSelected ? getCheckColors(color) : null;
  return (
    <button
      aria-label={ariaLabel}
      onClick={onClick}
      style={{
        flex: 1,
        minWidth: 0,
        height: '16px',
        borderRadius: '4px',
        background: color,
        border: '1px solid rgba(0,0,0,0.2)',
        cursor: 'pointer',
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {checkColors && (
        <span style={{ position: 'relative', width: 12, height: 12, display: 'block' }}>
          <Check size={12} strokeWidth={4} color={checkColors.outline} style={{ position: 'absolute', inset: 0 }} />
          <Check size={12} strokeWidth={2.25} color={checkColors.fg} style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
        </span>
      )}
    </button>
  );
};

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
        background: isSelected ? 'var(--primary-color)' : 'var(--bg-color)',
        border: '1px solid var(--border-color)',
        cursor: 'pointer'
      }}
    >
      <Icon size={12} color={isSelected ? 'white' : 'var(--text-secondary)'} />
    </button>
  );
};

const TruncatedTooltip = ({ text, style }: { text: string, style?: React.CSSProperties }) => {
  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollWidth > el.clientWidth) {
      el.title = text;
    } else {
      el.removeAttribute('title');
    }
  };

  return (
    <div 
      onMouseEnter={handleMouseEnter}
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
  const currentColor = resolvePinColorCode(pin.color);
  return (
    <div style={{ 
      padding: '0 0.15rem', 
      borderRadius: 'var(--radius-sm)',
      background: 'var(--surface-color)',
      color: 'var(--text-primary)',
      border: '1px solid var(--primary-color)',
      boxShadow: 'var(--shadow-md)',
      display: 'flex', 
      alignItems: 'center',
      opacity: 0.25
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

const DropIndicator = () => (
  <div 
    style={{
      position: 'absolute',
      bottom: '-1px',
      left: '0px',
      right: '0px',
      height: '2px',
      background: 'var(--primary-color)',
      borderRadius: '2px',
      zIndex: 20,
      pointerEvents: 'none',
      boxShadow: '0 0 4px var(--primary-color)'
    }}
  >
    <div style={{
      position: 'absolute',
      left: '-2px',
      top: '-2px',
      width: '6px',
      height: '6px',
      borderRadius: '50%',
      background: 'var(--primary-color)'
    }} />
  </div>
);

const LayerTopDropZone = ({ isLayerDragging }: { isLayerDragging: boolean }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: 'layer-top',
    data: { type: 'layer-top' },
    disabled: !isLayerDragging
  });

  if (!isLayerDragging) return null;

  return (
    <div 
      ref={setNodeRef}
      style={{
        height: '10px',
        marginTop: '-5px',
        marginBottom: '2px',
        position: 'relative'
      }}
    >
      {isOver && <DropIndicator />}
    </div>
  );
};

const SortablePin = memo(({ 
  pin, 
  onPinClick, 
  onRemovePin, 
  onUpdatePin,
  isEditing,
  isTarget,
  setEditingPinId,
  readOnly,
  onHoverPin,
  onAddCustomColor,
  isSelected,
  onToggleSelect,
  customColors,
  allLayers,
  isAnySelectedDragging,
  isAnyPinDragging,
  isHoverBlocked
}: { 
  pin: Pin, 
  onPinClick: (pin: Pin) => void,
  onRemovePin: (id: string) => void,
  onUpdatePin: (id: string, updates: Partial<Pin>) => void,
  isEditing: boolean,
  isTarget: boolean,
  setEditingPinId: (id: string | null) => void,
  readOnly: boolean,
  onHoverPin?: (id: string | null, leavingPinId?: string) => void,
  onAddCustomColor?: (color: string) => void,
  isSelected?: boolean,
  onToggleSelect?: (id: string) => void,
  customColors?: string[],
  allLayers: PinLayer[],
  isAnySelectedDragging: boolean,
  isAnyPinDragging?: boolean,
  isHoverBlocked?: boolean
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transition,
    isDragging,
    isOver
  } = useSortable({ 
    id: pin.id,
    data: { type: 'pin', pin },
    disabled: readOnly
  });

  const [isFetchingAddress, setIsFetchingAddress] = useState(false);
  const fetchingCoordsRef = useRef<{ lat: number; lng: number } | null>(null);

  const [localLabel, setLocalLabel] = useState(pin.label || '');
  const [localAddress, setLocalAddress] = useState(pin.address || '');
  const [localDescription, setLocalDescription] = useState(pin.description || '');
  const localLabelRef = useRef(pin.label || '');
  const localAddressRef = useRef(pin.address || '');
  const localDescriptionRef = useRef(pin.description || '');
  const focusedFieldRef = useRef<'label' | 'address' | 'description' | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressTextareaRef = useRef<HTMLTextAreaElement>(null);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusedFieldRef.current !== 'label') {
      setLocalLabel(pin.label || '');
      localLabelRef.current = pin.label || '';
    }
  }, [pin.label]);

  useEffect(() => {
    if (focusedFieldRef.current !== 'address') {
      setLocalAddress(pin.address || '');
      localAddressRef.current = pin.address || '';
    }
  }, [pin.address]);

  useEffect(() => {
    if (focusedFieldRef.current !== 'description') {
      setLocalDescription(pin.description || '');
      localDescriptionRef.current = pin.description || '';
    }
  }, [pin.description]);

  useEffect(() => {
    if (!isEditing) return;
    fitTextarea(addressTextareaRef.current, 0, ADDRESS_TEXTAREA_MAX_PX);
    fitTextarea(descriptionTextareaRef.current, 0, Math.round(window.innerHeight * 0.7));
  }, [isEditing, pin.id, localAddress, localDescription]);

  const flushField = useCallback((field: 'label' | 'address' | 'description') => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const val = field === 'label' ? localLabelRef.current : field === 'address' ? localAddressRef.current : localDescriptionRef.current;
    const originalVal = (field === 'label' ? pin.label : field === 'address' ? pin.address : pin.description) || '';
    if (val !== originalVal) {
      onUpdatePin(pin.id, { [field]: val });
    }
  }, [pin.id, pin.label, pin.address, pin.description, onUpdatePin]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (localLabelRef.current !== (pin.label || '')) {
        onUpdatePin(pin.id, { label: localLabelRef.current });
      }
      if (localAddressRef.current !== (pin.address || '')) {
        onUpdatePin(pin.id, { address: localAddressRef.current });
      }
      if (localDescriptionRef.current !== (pin.description || '')) {
        onUpdatePin(pin.id, { description: localDescriptionRef.current });
      }
    };
  }, [pin.id, pin.label, pin.address, pin.description, onUpdatePin]);

  const handleFieldChange = (field: 'label' | 'address' | 'description', value: string) => {
    if (field === 'label') {
      setLocalLabel(value);
      localLabelRef.current = value;
    } else if (field === 'address') {
      setLocalAddress(value);
      localAddressRef.current = value;
    } else {
      setLocalDescription(value);
      localDescriptionRef.current = value;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      flushField(field);
    }, 1000);
  };

  const handleFieldBlur = (field: 'label' | 'address' | 'description') => {
    if (focusedFieldRef.current === field) {
      focusedFieldRef.current = null;
    }
    flushField(field);
  };

  const handleLabelKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      flushField('label');
      e.currentTarget.blur();
    }
  };

  useEffect(() => {
    if (isTarget && !pin.address && !isFetchingAddress) {
      setIsFetchingAddress(true);
      const reqLat = pin.lat;
      const reqLng = pin.lng;
      fetchingCoordsRef.current = { lat: reqLat, lng: reqLng };
      reverseGeocode(reqLat, reqLng).then(addr => {
        if (addr && fetchingCoordsRef.current?.lat === reqLat && fetchingCoordsRef.current?.lng === reqLng) {
          onUpdatePin(pin.id, { address: addr });
        }
      }).finally(() => {
        setIsFetchingAddress(false);
      });
    }
  }, [isTarget, pin.id, pin.address, pin.lat, pin.lng, isFetchingAddress, onUpdatePin]);

  const isItemInDraggingBundle = isAnySelectedDragging && isSelected;
  const isDropTarget = isOver && !!isAnyPinDragging && !isDragging && !isItemInDraggingBundle;

  const style = {
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.25 : (isItemInDraggingBundle ? 0.25 : 1),
    position: 'relative' as const,
    pointerEvents: (isDragging || isItemInDraggingBundle) ? 'none' as const : undefined,
  };

  const currentColor = resolvePinColorCode(pin.color);

  return (
    <li 
      id={`pin-${pin.id}`}
      className={`pin-list-item${isEditing ? ' pin-editing' : ''}`}
      ref={setNodeRef} 
      style={{ 
        ...style, 
        padding: '0 0.15rem', 
        marginBottom: '0px',
        scrollMarginTop: '24px',
        borderRadius: 'var(--radius-sm)',
        background: isTarget ? 'rgba(72, 61, 139, 0.05)' : (isEditing ? 'var(--bg-color)' : undefined),
        border: isEditing ? '1px solid var(--primary-color)' : '1px solid transparent',
        boxShadow: isTarget ? '0 0 0 1px var(--primary-color)' : undefined,
        transition: 'all 0.1s ease',
        cursor: 'default'
      }}
      onPointerEnter={(e) => {
        if (!isHoverBlocked && e.pointerType === 'mouse') onHoverPin?.(pin.id);
      }}
      onPointerMove={(e) => {
        if (!isHoverBlocked && e.pointerType === 'mouse') onHoverPin?.(pin.id);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') onHoverPin?.(null, pin.id);
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
          {!readOnly && (
            <div {...attributes} {...listeners} style={{ cursor: 'grab', marginRight: '0px', color: '#bbb', padding: '1px 1px', marginLeft: '-2px', touchAction: 'none' }}>
              <GripVertical size={10} />
            </div>
          )}
          <div 
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', flex: 1, padding: '0px' }}
            onClick={() => {
              if (isEditing) return;
              onPinClick(pin);
            }}
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
                {pin.description && (!isTarget && !isEditing) && (
                  <div style={{ fontSize: '0.5rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '-1px', lineHeight: '1' }}>{pin.description}</div>
                )}
              </div>            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '2px', marginLeft: '4px', alignItems: 'center' }}>
          {!readOnly && isEditing && (
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
          <input 
            type="checkbox" 
            checked={!!isSelected} 
            onChange={(e) => { e.stopPropagation(); onToggleSelect?.(pin.id); }}
            style={{ cursor: 'pointer', accentColor: 'var(--primary-color)', width: '9px', height: '9px' }}
            onClick={(e) => e.stopPropagation()}
          />
          {!readOnly && (
            <button 
              aria-label={isEditing ? "Close edit" : "Edit"}
              onClick={(e) => { e.stopPropagation(); setEditingPinId(isEditing ? null : pin.id); }}
              style={{ 
                background: 'transparent', 
                color: isEditing ? 'var(--text-primary)' : 'var(--primary-color)', 
                border: 'none',
                padding: '0px 3px', 
                cursor: 'pointer', 
                display: 'flex', 
                alignItems: 'center'
              }}
            >
              {isEditing ? <X size={12} /> : <Pencil size={12} />}
            </button>
          )}
        </div>
      </div>

      {isTarget && !isEditing && (pin.address || pin.description) && (
        <div style={{ padding: '0.3rem 0 0.15rem 0.15rem', marginTop: '2px', borderTop: '1px solid var(--divider-color)' }}>
          {pin.address && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-primary)', lineHeight: '1.3', flex: 1, whiteSpace: 'pre-wrap' }}>
                {pin.address}
              </div>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  [pin.label, pin.address].filter(part => part?.trim()).join(', ').replace(/\s+/g, ' ')
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in Google Maps"
                aria-label="Open address in Google Maps"
                onClick={(e) => e.stopPropagation()}
                className="maps-open-btn"
              >
                <img
                  src="/google-maps-pin.png"
                  alt=""
                  width={14}
                  height={14}
                  draggable={false}
                />
              </a>
            </div>
          )}
          {pin.description && (
            <div style={{
              fontSize: '0.65rem',
              color: 'var(--text-primary)',
              lineHeight: '1.3',
              whiteSpace: 'pre-wrap',
              ...(pin.address ? { borderTop: '1px solid var(--divider-color)', marginTop: '0.3rem', paddingTop: '8px' } : {})
            }}>
              {pin.description}
            </div>
          )}
        </div>
      )}

      {isEditing && !readOnly && (
        <div style={{ padding: '0.3rem 0.15rem 0.15rem 0.15rem', marginTop: '2px', borderTop: '1px solid var(--divider-color)', fontSize: '0.7rem' }}>
          <div style={{ marginBottom: '5px' }}>
            <label htmlFor={`label-${pin.id}`} style={{ display: 'block', fontWeight: '700', marginBottom: '1px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>Name</label>
            <input 
              id={`label-${pin.id}`}
              type="text" 
              value={localLabel} 
              onFocus={() => { focusedFieldRef.current = 'label'; }}
              onChange={(e) => handleFieldChange('label', e.target.value)}
              onKeyDown={handleLabelKeyDown}
              onBlur={() => handleFieldBlur('label')}
              className="input-field"
              style={{ padding: '2px 4px', fontSize: '0.6rem', fontFamily: 'inherit' }}
            />
          </div>

          <div style={{ marginBottom: '5px' }}>
            <label htmlFor={`address-${pin.id}`} style={{ display: 'block', fontWeight: '700', marginBottom: '1px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>Address</label>
            <textarea 
              id={`address-${pin.id}`}
              ref={addressTextareaRef}
              rows={1}
              value={localAddress} 
              onFocus={() => { focusedFieldRef.current = 'address'; }}
              onChange={(e) => handleFieldChange('address', e.target.value)}
              onBlur={() => handleFieldBlur('address')}
              className="input-field"
              style={PIN_TEXTAREA_STYLE}
              placeholder="Fetch address from map or type here..."
            />
          </div>

          <div style={{ marginBottom: '5px' }}>
            <label style={{ display: 'block', fontWeight: '700', marginBottom: '1px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>Layer</label>
            <select 
                value={pin.layerId || ''} 
                onChange={(e) => onUpdatePin(pin.id, { layerId: e.target.value || undefined })}
                className="input-field"
                style={{ padding: '2px 4px 2px 1px', fontSize: '0.6rem', fontFamily: 'inherit', background: 'var(--surface-color)', color: 'var(--text-primary)' }}
            >
                <option value="">Default Layer</option>
                {allLayers.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                ))}
            </select>
          </div>

          <div style={{ marginBottom: '5px' }}>
            <label style={{ display: 'block', fontWeight: '700', marginBottom: '3px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>Color</label>
            <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '1px', justifyContent: 'space-between' }}>
              {PIN_COLORS.map(color => (
                <ColorSwatch
                  key={color.name}
                  color={color.value}
                  ariaLabel={`color-${color.name}`}
                  isSelected={pin.color === color.name || (!pin.color && color.name === 'blue')}
                  onClick={() => onUpdatePin(pin.id, { color: color.name })}
                />
              ))}
              {(customColors || []).map(color => (
                <ColorSwatch
                  key={color}
                  color={color}
                  isSelected={pin.color === color}
                  onClick={() => onUpdatePin(pin.id, { color })}
                />
              ))}
              <div style={{ position: 'relative', flex: 1, minWidth: 0, height: '16px' }}>
                <input 
                  type="color"
                  value={(!pin.color || PIN_COLORS.some(c => c.name === pin.color)) ? '#9C2BCB' : pin.color}
                  onChange={(e) => {
                    onUpdatePin(pin.id, { color: e.target.value });
                  }}
                  onBlur={(e) => onAddCustomColor?.(e.target.value)}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', zIndex: 2 }}
                />
                <div style={{ width: '100%', height: '100%', borderRadius: '4px', background: 'var(--bg-color)', border: '1px dashed var(--border-color)', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', color: 'var(--text-secondary)' }}>
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
              ref={descriptionTextareaRef}
              rows={1}
              value={localDescription} 
              onFocus={() => { focusedFieldRef.current = 'description'; }}
              onChange={(e) => handleFieldChange('description', e.target.value)}
              onBlur={() => handleFieldBlur('description')}
              className="input-field"
              style={{ ...PIN_TEXTAREA_STYLE, maxHeight: '70vh' }}
            />
          </div>
        </div>
      )}
      {isDropTarget && <DropIndicator />}
    </li>
  );
});

const DefaultLayerHeader = memo(({
  defaultPins,
  collapsedLayerIds,
  hiddenLayerIds,
  isDefaultAllSelected,
  isDefaultSomeSelected,
  readOnly,
  isLayerDragging,
  onToggleExpand,
  onToggleLayerVisibility,
  onToggleNavIds,
  layersCount,
  children,
  isAnyPinDragging
}: {
  defaultPins: Pin[];
  collapsedLayerIds?: Set<string | null>;
  hiddenLayerIds?: Set<string | null>;
  isDefaultAllSelected: boolean;
  isDefaultSomeSelected: boolean;
  readOnly: boolean;
  isLayerDragging: boolean;
  onToggleExpand?: (id: string | null) => void;
  onToggleLayerVisibility?: (id: string | null) => void;
  onToggleNavIds?: (ids: string[], force?: boolean) => void;
  layersCount: number;
  children?: React.ReactNode;
  isAnyPinDragging?: boolean;
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: 'default',
    data: { type: 'layer', layer: { id: 'default', name: 'Default Layer' } },
    disabled: readOnly
  });

  const isCollapsed = !!collapsedLayerIds?.has(null);
  const isHighlighted = isOver && !isLayerDragging && isCollapsed;
  const isDropTarget = isOver && !!isAnyPinDragging && !isCollapsed && !isLayerDragging;

  return (
    <div style={{ marginTop: layersCount > 0 ? '0.3rem' : '0' }}>
      <div 
        id="default"
        ref={setNodeRef}
        style={{ 
          position: 'sticky', 
          top: 0, 
          zIndex: 5, 
          background: isHighlighted ? 'var(--bg-color)' : 'var(--surface-color)',
          borderRadius: '0 0 var(--radius-sm) var(--radius-sm)',
          border: isHighlighted ? '1px solid var(--primary-color)' : '1px solid transparent',
          boxShadow: isHighlighted ? '0 0 0 1px var(--primary-color)' : 'var(--shadow-sm)',
          transition: 'all 0.1s ease'
        }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          padding: '0 0.15rem', 
          borderBottom: 'none',
          minHeight: '20px',
          transition: 'all 0.1s ease'
        }}>
          {/* Empty placeholder to exactly match GripVertical width and padding from regular layers */}
          <div style={{ padding: '1px 1px', marginLeft: '-2px', display: 'flex', alignItems: 'center', width: '13px', height: '13px' }}></div>
          <div onClick={() => onToggleExpand?.(null)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, padding: '1px 0' }}>
            <div style={{ color: 'var(--primary-color)', marginRight: '1px', display: 'flex' }}>
                {collapsedLayerIds?.has(null) ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
            </div>
            <span style={{ fontWeight: '700', fontSize: '0.65rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Default Layer <span style={{ fontWeight: 'normal', color: 'var(--text-secondary)', fontSize: '0.55rem', marginLeft: '2px' }}>({defaultPins.length})</span>
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginLeft: '4px' }}>
            <button 
              onClick={(e) => { e.stopPropagation(); onToggleLayerVisibility?.(null); }}
              style={{ 
                background: 'transparent', 
                border: 'none', 
                color: hiddenLayerIds?.has(null) ? 'var(--text-secondary)' : 'var(--primary-color)', 
                opacity: hiddenLayerIds?.has(null) ? 0.45 : 1, 
                cursor: 'pointer', 
                padding: '1px 3px', 
                display: 'flex', 
                alignItems: 'center' 
              }}
              title={hiddenLayerIds?.has(null) ? "Show layer" : "Hide layer"}
            >
              {hiddenLayerIds?.has(null) ? <EyeOff size={11} /> : <Eye size={11} />}
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
        {isDropTarget && <DropIndicator />}
      </div>
      {children}
    </div>
  );
});

const SortableLayer = memo(({ 
  layer, 
  layerPins,
  onUpdateLayer,
  onRemoveLayer,
  onPinClick,
  onRemovePin,
  onUpdatePin,
  editingPinId,
  onSetEditingPinId,
  editingLayerId,
  onSetEditingLayerId,
  readOnly,
  targetPinId,
  onHoverPin,
  customColors,
  onAddCustomColor,
  selectedNavIds,
  onToggleNavId,
  onToggleNavIds,
  allLayers,
  isHidden,
  onToggleVisibility,
  isExpanded,
  onToggleExpand,
  isAnySelectedDragging,
  isLayerDragging,
  isAnyPinDragging,
  isHoverBlocked
}: { 
  layer: PinLayer,
  layerPins: Pin[],
  onUpdateLayer: (id: string, updates: Partial<PinLayer>) => void,
  onRemoveLayer: (id: string) => void,
  onPinClick: (pin: Pin) => void,
  onRemovePin: (id: string) => void,
  onUpdatePin: (id: string, updates: Partial<Pin>) => void,
  editingPinId: string | null,
  onSetEditingPinId: (id: string | null) => void,
  editingLayerId?: string | null,
  onSetEditingLayerId?: (id: string | null) => void,
  readOnly: boolean,
  targetPinId?: string | null,
  onHoverPin?: (id: string | null, leavingPinId?: string) => void,
  customColors?: string[],
  onAddCustomColor?: (color: string) => void,
  selectedNavIds?: Set<string>,
  onToggleNavId?: (id: string) => void,
  onToggleNavIds?: (ids: string[], force?: boolean) => void,
  allLayers: PinLayer[],
  isHidden: boolean,
  onToggleVisibility: () => void,
  isExpanded: boolean,
  onToggleExpand: () => void,
  isAnySelectedDragging: boolean,
  isLayerDragging: boolean,
  isAnyPinDragging?: boolean,
  isHoverBlocked?: boolean
}) => {
  const [localIsEditingName, setLocalIsEditingName] = useState(false);
  const isEditingName = editingLayerId !== undefined 
    ? editingLayerId === layer.id 
    : localIsEditingName;

  const setIsEditingName = (val: boolean | ((prev: boolean) => boolean)) => {
    const nextVal = typeof val === 'function' ? val(isEditingName) : val;
    if (onSetEditingLayerId) {
      onSetEditingLayerId(nextVal ? layer.id : null);
    }
    setLocalIsEditingName(nextVal);
  };

  const [localLayerName, setLocalLayerName] = useState(layer.name);
  const layerDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isEditingName) {
      setLocalLayerName(layer.name);
    }
  }, [layer.name, isEditingName]);

  useEffect(() => {
    return () => {
      if (layerDebounceTimerRef.current) {
        clearTimeout(layerDebounceTimerRef.current);
      }
    };
  }, []);

  const layerNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingName && layerNameInputRef.current) {
      layerNameInputRef.current.focus();
      layerNameInputRef.current.select();
      const timer = setTimeout(() => {
        layerNameInputRef.current?.focus();
        layerNameInputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isEditingName]);

  useEffect(() => {
    if (editingPinId && layerPins.some(p => p.id === editingPinId)) {
      if (!isExpanded) {
        onToggleExpand();
      }
    }
  }, [editingPinId, layerPins, isExpanded, onToggleExpand]);

  const {
    attributes,
    listeners,
    setDraggableNodeRef,
    setDroppableNodeRef,
    isDragging,
    isOver
  } = useSortable({ 
    id: layer.id,
    data: { type: 'layer', layer },
    disabled: readOnly
  });

  const style: React.CSSProperties = {
    marginBottom: '0.2rem',
    visibility: isDragging ? 'hidden' : 'visible',
    position: 'relative'
  };

  const pinIds = useMemo(() => layerPins.map(p => p.id), [layerPins]);
  const isAllSelected = layerPins.length > 0 && layerPins.every(p => selectedNavIds?.has(p.id));
  const isSomeSelected = layerPins.some(p => selectedNavIds?.has(p.id));
  const isHighlighted = isOver && !isExpanded && !isDragging && !isLayerDragging;
  const isPinDropTarget = isOver && !!isAnyPinDragging && !isDragging && !isLayerDragging;
  const isLayerDropTarget = isOver && !!isLayerDragging && !isDragging;

  return (
    <div ref={setDraggableNodeRef} style={style}>
      <div 
        ref={setDroppableNodeRef}
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
        background: isHighlighted ? 'var(--bg-color)' : (isEditingName ? 'var(--bg-color)' : 'var(--surface-color)'),
        borderRadius: '0 0 var(--radius-sm) var(--radius-sm)',
        border: isHighlighted ? '1px solid var(--primary-color)' : (isEditingName ? '1px solid var(--primary-color)' : '1px solid transparent'),
        boxShadow: isHighlighted ? '0 0 0 1px var(--primary-color)' : 'var(--shadow-sm)',
        transition: 'all 0.1s ease'
      }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          padding: '0 0.15rem', 
          borderBottom: 'none',
          minHeight: '20px',
          transition: 'all 0.1s ease'
        }}>
          {!readOnly && (
            <div {...attributes} {...listeners} style={{ cursor: 'grab', color: '#bbb', padding: '1px 1px', marginLeft: '-2px', display: 'flex', alignItems: 'center', touchAction: 'none' }}>
              <GripVertical size={11} />
            </div>
          )}
          <div onClick={() => onToggleExpand()} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, padding: '1px 0' }}>
            <div style={{ color: 'var(--primary-color)', marginRight: '1px', display: 'flex' }}>
              {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </div>
            <span onDoubleClick={() => !readOnly && setIsEditingName(true)} style={{ fontWeight: '700', fontSize: '0.65rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {layer.name} <span style={{ fontWeight: 'normal', color: 'var(--text-secondary)', fontSize: '0.55rem', marginLeft: '2px' }}>({layerPins.length})</span>
            </span>
          </div>
          <div style={{ display: 'flex', gap: '2px', marginLeft: '4px', alignItems: 'center' }}>
            <button 
              onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
              style={{ 
                background: 'transparent', 
                border: 'none', 
                color: isHidden ? 'var(--text-secondary)' : 'var(--primary-color)', 
                opacity: isHidden ? 0.45 : 1, 
                cursor: 'pointer', 
                padding: '1px 3px', 
                display: 'flex', 
                alignItems: 'center' 
              }}
              title={isHidden ? "Show layer" : "Hide layer"}
            >
              {isHidden ? <EyeOff size={11} /> : <Eye size={11} />}
            </button>
            {layerPins.length > 0 ? (
              <input 
                type="checkbox" 
                checked={isAllSelected}
                ref={el => { if (el) el.indeterminate = isSomeSelected && !isAllSelected; }}
                onChange={(e) => {
                  const checked = e.target.checked;
                  onToggleNavIds?.(layerPins.map(p => p.id), checked);
                }}
                style={{ cursor: 'pointer', accentColor: 'var(--primary-color)', width: '9px', height: '9px' }}
                onClick={(e) => e.stopPropagation()}
                title="Select all in layer for navigation"
              />
            ) : (
              <div style={{ width: '9px', height: '9px' }} />
            )}
            {!readOnly && (
              <div style={{ display: 'flex', gap: '2px' }}>
                {isEditingName && (
                  <button 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      let msg = 'Are you sure you want to delete this layer?';
                      if (layerPins.length > 0) {
                        msg += ` The ${layerPins.length} pin${layerPins.length === 1 ? '' : 's'} inside it will be moved to the default layer.`;
                      }
                      if (window.confirm(msg)) {
                        onRemoveLayer(layer.id); 
                      }
                    }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--error-color)', cursor: 'pointer', padding: '0px 3px', display: 'flex', alignItems: 'center' }}
                    className="delete-layer-btn"
                    title="Delete Layer"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
                <button 
                  onClick={(e) => { e.stopPropagation(); setIsEditingName(!isEditingName); }}
                  style={{ background: 'transparent', color: isEditingName ? 'var(--text-primary)' : 'var(--primary-color)', border: 'none', padding: '0px 3px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                  title={isEditingName ? "Cancel editing" : "Edit layer name"}
                >
                  {isEditingName ? <X size={12} /> : <Pencil size={12} />}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Quick inline editing input */}
        {isEditingName && !readOnly && (
          <div style={{ padding: '0.2rem 0.4rem 0.3rem 0.4rem', borderTop: '1px solid var(--border-color)', background: 'var(--surface-color)', borderRadius: '0 0 var(--radius-sm) var(--radius-sm)' }}>
            <div style={{ marginBottom: '2px' }}>
              <label htmlFor={`label-${layer.id}`} style={{ display: 'block', fontWeight: '700', marginBottom: '1px', color: 'var(--text-secondary)', fontSize: '0.6rem' }}>NAME</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input 
                  ref={layerNameInputRef}
                  id={`label-${layer.id}`}
                  type="text" 
                  value={localLayerName}
                  placeholder="Layer name..."
                  onChange={(e) => {
                    const newName = e.target.value;
                    setLocalLayerName(newName);
                    if (layerDebounceTimerRef.current) clearTimeout(layerDebounceTimerRef.current);
                    layerDebounceTimerRef.current = setTimeout(() => {
                      onUpdateLayer(layer.id, { name: newName });
                    }, 300);
                  }}
                  onBlur={() => {
                    if (layerDebounceTimerRef.current) clearTimeout(layerDebounceTimerRef.current);
                    setIsEditingName(false);
                    if (localLayerName !== layer.name) {
                      onUpdateLayer(layer.id, { name: localLayerName });
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (layerDebounceTimerRef.current) clearTimeout(layerDebounceTimerRef.current);
                      setIsEditingName(false);
                      if (localLayerName !== layer.name) {
                        onUpdateLayer(layer.id, { name: localLayerName });
                      }
                    } else if (e.key === 'Escape') {
                      if (layerDebounceTimerRef.current) clearTimeout(layerDebounceTimerRef.current);
                      setLocalLayerName(layer.name);
                      setIsEditingName(false);
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '2px 18px 2px 4px',
                    fontSize: '0.65rem',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--primary-color)',
                    background: 'var(--bg-color)',
                    color: 'var(--text-primary)',
                    boxSizing: 'border-box'
                  }}
                />
                {localLayerName && (
                  <button 
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setLocalLayerName('');
                      if (layerDebounceTimerRef.current) clearTimeout(layerDebounceTimerRef.current);
                      onUpdateLayer(layer.id, { name: '' });
                    }}
                    style={{ position: 'absolute', right: '4px', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0' }}
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {isPinDropTarget && <DropIndicator />}
      </div>
      {isLayerDropTarget && <DropIndicator />}
      
      {isExpanded && (
        <div style={{ paddingLeft: '0.2rem', borderLeft: '1px solid var(--border-color)', marginTop: '0px', marginLeft: '0.4rem' }}>
          <SortableContext items={pinIds} strategy={verticalListSortingStrategy}>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, paddingTop: '4px', minHeight: '10px' }}>
              {layerPins.map(pin => (
                <SortablePin 
                  key={pin.id} 
                  pin={pin} 
                  onPinClick={onPinClick}
                  onRemovePin={onRemovePin}
                  onUpdatePin={onUpdatePin}
                  isEditing={editingPinId === pin.id}
                  isTarget={targetPinId === pin.id}
                  setEditingPinId={onSetEditingPinId}
                  readOnly={readOnly}
                  onHoverPin={onHoverPin}
                  onAddCustomColor={onAddCustomColor}
                  isSelected={selectedNavIds?.has(pin.id)}
                  onToggleSelect={onToggleNavId}
                  customColors={customColors}
                  allLayers={allLayers}
                  isAnySelectedDragging={isAnySelectedDragging}
                  isAnyPinDragging={isAnyPinDragging}
                  isHoverBlocked={isHoverBlocked}
                />
              ))}
            </ul>
          </SortableContext>
        </div>
      )}
    </div>
  );
});

const Sidebar = ({
  mapId,
  mapName,
  onMapNameChange,
  layers,
  onAddLayer,
  onUpdateLayer,
  onRemoveLayer,
  pins,
  onAddPin,
  onRemovePin,
  onPinClick,
  onUpdatePin,
  onMovePinsToLayer,
  onDragEnd,
  onDragCancel,
  onDragStart,
  userRole = 'owner',
  onShare,
  onImport,
  editingPinId,
  onSetEditingPinId,
  targetPinId,
  onHoverPin,
  customColors,
  onAddCustomColor,
  selectedNavIds,
  onToggleNavId,
  onToggleNavIds,
  hiddenLayerIds,
  onToggleLayerVisibility,
  collapsedLayerIds,
  onToggleExpand,
  onHoverSearchResult,
  isMobile,
  mobileScale,
  mapTheme = 'light',
  onThemeChange,
  showSatellite = false,
  onToggleSatellite,
  showHillshade = true,
  onToggleHillshade,
  show3DTerrain = true,
  onToggle3DTerrain,
  show3DBuildings = true,
  onToggle3DBuildings,
  isOffline = false,
  isHoverBlocked = false,
  onSearchAreaStateChange
}: SidebarProps) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const readOnly = userRole === 'view' || isOffline;
  const [activePin, setActivePin] = useState<Pin | null>(null);
  const [activeLayer, setActiveLayer] = useState<PinLayer | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [headerActionsEl, setHeaderActionsEl] = useState<HTMLElement | null>(() => {
    return typeof document !== 'undefined' ? document.getElementById('mobile-header-actions') : null;
  });
  const [downloadPillEl, setDownloadPillEl] = useState<HTMLElement | null>(() => {
    return typeof document !== 'undefined' ? document.getElementById('download-pill-container') : null;
  });

  useLayoutEffect(() => {
    const updateContainers = () => {
      setHeaderActionsEl(document.getElementById('mobile-header-actions'));
      setDownloadPillEl(document.getElementById('download-pill-container'));
    };
    updateContainers();

    window.addEventListener('resize', updateContainers);
    return () => window.removeEventListener('resize', updateContainers);
  }, [isMobile]);

  useEffect(() => {
    const handleEditLayerEvent = (e: CustomEvent<{ layerId: string }>) => {
      if (e.detail?.layerId) {
        setEditingLayerId(e.detail.layerId);
      }
    };
    window.addEventListener('ourmaps:edit-layer', handleEditLayerEvent as EventListener);
    return () => window.removeEventListener('ourmaps:edit-layer', handleEditLayerEvent as EventListener);
  }, []);

  // Auto-scroll the sidebar list to keep the active/editing pin in view
  useEffect(() => {
    const targetId = editingPinId || targetPinId;
    if (!targetId) return;

    const timer = setTimeout(() => {
      const el = document.getElementById(`pin-${targetId}`);
      const container = scrollContainerRef.current;
      if (el && container) {
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const scale = (container.offsetHeight > 0 ? containerRect.height / container.offsetHeight : 1) || 1;
        
        // Relative visual position of pin element from the top of the container viewport
        const relativeVisualTop = (elRect.top - containerRect.top) / scale;
        const currentScroll = container.scrollTop;
        const stickyHeaderOffset = 38; // Account for sticky layer headers

        if (relativeVisualTop < stickyHeaderOffset) {
          // Pin is above or behind sticky header: scroll up to place it below header
          const targetScrollTop = currentScroll + relativeVisualTop - stickyHeaderOffset - 4;
          container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
        } else if (relativeVisualTop + el.offsetHeight > container.clientHeight - 8) {
          // Pin is below visible viewport: scroll down to bring it fully into view
          const targetScrollTop = currentScroll + (relativeVisualTop + el.offsetHeight) - container.clientHeight + 24;
          container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
        }
      }
    }, 80);

    return () => clearTimeout(timer);
  }, [targetPinId, editingPinId, pins.length]);
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
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [hasPartialDownload, setHasPartialDownload] = useState(false);
  const [tileStats, setTileStats] = useState<{ total: number; completed: number } | null>(null);

  // Export Modal State
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFileName, setExportFileName] = useState('');
  const [exportFormat, setExportFormat] = useState<'json' | 'geojson' | 'kml'>('json');

  // Rename Modal State
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameInput, setRenameInput] = useState(mapName);

  useEffect(() => {
    setRenameInput(mapName);
  }, [mapName]);

  useEffect(() => {
    if (!mapId) {
      setIsDownloaded(false);
      setHasPartialDownload(false);
      setIsDownloading(false);
      setDownloadProgress(null);
      setTileStats(null);
      return;
    }

    const updateFromState = (state: any) => {
      setIsDownloading(state.isDownloading);
      setIsDownloaded(state.isDownloaded);
      setHasPartialDownload(state.hasPartialDownload);
      setDownloadProgress(state.downloadProgress);
      setTileStats(state.tileStats);
    };

    const unsubscribe = tileWorkerManager.subscribe((state) => {
      if (state.mapId === mapId) {
        updateFromState(state);
      }
    });

    const activeStatus = tileWorkerManager.getStatus(mapId);
    if (activeStatus && activeStatus.isDownloading) {
      updateFromState(activeStatus);
    } else {
      tileWorkerManager.resumeIfNeeded(mapId).then(() => {
        const status = tileWorkerManager.getStatus(mapId);
        if (status) {
          updateFromState(status);
        } else {
          Promise.all([
            getManifestStats(mapId),
            getMapDownloadStatuses([mapId]),
            getOfflineMap(mapId)
          ]).then(([stats, statusMap, offlineMap]) => {
            const mapStatus = statusMap.get(mapId);
            if (mapStatus?.isComplete || (offlineMap && stats.total === 0)) {
              setIsDownloaded(true);
              setHasPartialDownload(false);
              setIsDownloading(false);
              setDownloadProgress(null);
              setTileStats(stats.total > 0 ? stats : { total: stats.total, completed: stats.completed });
            } else if (mapStatus?.isPartial || stats.completed > 0) {
              setIsDownloaded(false);
              setHasPartialDownload(true);
              setIsDownloading(false);
              setDownloadProgress(stats.total > 0 ? stats.completed / stats.total : 0.5);
              setTileStats(stats);
            } else {
              setIsDownloaded(false);
              setHasPartialDownload(false);
              setIsDownloading(false);
              setDownloadProgress(null);
              setTileStats(null);
            }
          });
        }
      });
    }

    return () => {
      unsubscribe();
    };
  }, [mapId]);

  const handleDownloadClick = async () => {
    setIsMenuOpen(false);
    if (!mapId) return;
    let bbox: BoundingBox | null = getPinsBoundingBox(pins);
    
    if (!bbox) {
        const viewportBounds = getMapViewportBounds();
        if (!viewportBounds) {
            alert("Please wait for map to load bounds.");
            return;
        }
        const parts = viewportBounds.split(',').map(Number);
        bbox = {
            west: parts[0],
            north: parts[1],
            east: parts[2],
            south: parts[3]
        };
    }

    const surgicalBoxes = getSurgicalBoxes(pins);
    const totalCount = countUniqueTiles(bbox, surgicalBoxes);
    const estimatedSizeMB = estimateSizeMB(totalCount);

    // Hard Safety Cap: > 50,000 tiles (~1 GB)
    if (totalCount > 50000) {
        alert(`Selected download area is too large for offline caching (${totalCount.toLocaleString()} tiles, approx. ${estimatedSizeMB.toFixed(0)} MB). Please zoom in or add specific pins to download this region.`);
        return;
    }

    const storageStatus = await canFit(estimatedSizeMB);
    if (!storageStatus.ok) {
        alert(storageStatus.message);
        return;
    }
    
    // Soft Warning Threshold: > 10,000 tiles (~200 MB)
    if (totalCount > 10000) {
        const proceed = window.confirm(`This map region covers ${totalCount.toLocaleString()} tiles (approx. ${estimatedSizeMB.toFixed(0)} MB) and may take over a minute to download. Do you want to proceed?`);
        if (!proceed) return;
    } else if (storageStatus.message) {
        // Show warning but allow proceeding
        console.warn(storageStatus.message);
    }

    const currentMapData: MapData = {
      id: mapId,
      name: mapName,
      ownerId: '',
      layers,
      pins,
      userRole,
    };
    await saveMapOffline(currentMapData);

    tileWorkerManager.startDownload(mapId, { bbox, pins, totalTiles: totalCount });
  };

  const handleRemoveDownload = async () => {
    if (!mapId) return;
    try {
      await tileWorkerManager.cancelDownload(mapId);
      setIsDownloading(false);
      setIsDownloaded(false);
      setHasPartialDownload(false);
      setDownloadProgress(null);
      setTileStats(null);
      setIsMenuOpen(false);
    } catch (error) {
      console.error("Failed to remove download:", error);
      alert("Failed to remove download.");
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
      layers,
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
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR_OPTIONS)
  );

  const layerIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    layers.forEach((l, i) => map.set(l.id, i));
    return map;
  }, [layers]);

  const { defaultPins, layerPinsMap } = useMemo(() => {
    const defaultList: Pin[] = [];
    const map = new Map<string, Pin[]>();
    for (const layer of layers) {
      map.set(layer.id, []);
    }
    for (const pin of pins) {
      if (!pin.layerId) {
        defaultList.push(pin);
      } else {
        const list = map.get(pin.layerId);
        if (list) {
          list.push(pin);
        } else {
          defaultList.push(pin);
        }
      }
    }
    defaultList.sort(comparePinPositions);
    for (const list of map.values()) {
      list.sort(comparePinPositions);
    }
    return { defaultPins: defaultList, layerPinsMap: map };
  }, [pins, layers]);

  const layerIds = useMemo(() => layers.map(layer => layer.id), [layers]);
  const defaultPinIds = useMemo(() => defaultPins.map(p => p.id), [defaultPins]);

  const selectedPins = useMemo(() => {
    if (!selectedNavIds || selectedNavIds.size === 0) return [];
    return pins
      .filter(p => selectedNavIds.has(p.id))
      .sort((a, b) => {
        const layerA = a.layerId ? (layerIndexMap.get(a.layerId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        const layerB = b.layerId ? (layerIndexMap.get(b.layerId) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        if (layerA !== layerB) return layerA - layerB;
        return a.position - b.position;
      });
  }, [pins, selectedNavIds, layerIndexMap]);

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
    } else if (active.data.current?.type === 'layer') {
      setActiveLayer(active.data.current.layer);
    }
    onDragStart?.(event);
  };

  const handleDragEndInternal = (event: DragEndEvent) => {
    setActivePin(null);
    setActiveLayer(null);
    onDragEnd(event);
  };

  const handleDragCancelInternal = () => {
    setActivePin(null);
    setActiveLayer(null);
    onDragCancel?.();
  };

  const activePinId = activePin?.id;
  const isAnySelectedDragging = !!(activePinId && selectedNavIds?.has(activePinId));
  const isDragActive = !!(activePinId || activeLayer);
  const isAnyPinDragging = !!activePinId;

  const customCollisionDetection = (args: any) => {
    const { droppableContainers, pointerCoordinates, active, collisionRect } = args;
    if (!pointerCoordinates && !collisionRect) return [];

    const isLayerDrag = active.data.current?.type === 'layer';
    const containerRect = scrollContainerRef.current?.getBoundingClientRect();

    // Filter droppable containers: if dragging a layer, only consider regular layers and layer-top (exclude pins and default layer)
    const allowedContainers = isLayerDrag
      ? droppableContainers.filter((c: any) => (c.data.current?.type === 'layer' || c.data.current?.type === 'layer-top') && c.id !== 'default')
      : droppableContainers;

    if (isLayerDrag) {
      const firstLayerId = layers[0]?.id;
      const firstLayerContainer = firstLayerId ? allowedContainers.find((c: any) => c.id === firstLayerId) : undefined;
      const firstLayerNode = firstLayerContainer?.node.current;
      const firstHeaderRect = firstLayerNode ? firstLayerNode.getBoundingClientRect() : null;

      const containerRectMap = new Map<string, { top: number; bottom: number; left: number; right: number; height: number }>();

      for (const container of allowedContainers) {
        if (container.disabled) continue;
        const baseNode = container.node.current;
        if (!baseNode) continue;

        if (container.id === 'layer-top') {
          const splitY = firstHeaderRect ? firstHeaderRect.top + firstHeaderRect.height / 2 : (containerRect ? containerRect.top + 20 : 0);
          const topBound = containerRect ? containerRect.top - 200 : -1000;
          containerRectMap.set(container.id, {
            top: topBound,
            bottom: splitY,
            left: containerRect ? containerRect.left : 0,
            right: containerRect ? containerRect.right : window.innerWidth,
            height: splitY - topBound
          });
        } else if (container.id === firstLayerId) {
          const fullNode = baseNode.parentElement || baseNode;
          const fullRect = fullNode.getBoundingClientRect();
          const splitY = firstHeaderRect ? firstHeaderRect.top + firstHeaderRect.height / 2 : fullRect.top;
          containerRectMap.set(container.id, {
            top: splitY,
            bottom: fullRect.bottom,
            left: fullRect.left,
            right: fullRect.right,
            height: fullRect.bottom - splitY
          });
        } else if (container.data.current?.type === 'layer' && baseNode.parentElement) {
          const fullRect = baseNode.parentElement.getBoundingClientRect();
          containerRectMap.set(container.id, fullRect);
        } else {
          containerRectMap.set(container.id, baseNode.getBoundingClientRect());
        }
      }

      const collisions: any[] = [];
      for (const container of allowedContainers) {
        if (container.disabled) continue;
        const rect = containerRectMap.get(container.id);
        if (!rect) continue;

        if (containerRect && container.id !== 'layer-top' && (rect.bottom < containerRect.top || rect.top > containerRect.bottom)) {
          continue;
        }

        if (pointerCoordinates) {
          if (
            pointerCoordinates.y >= rect.top &&
            pointerCoordinates.y <= rect.bottom &&
            pointerCoordinates.x >= rect.left &&
            pointerCoordinates.x <= rect.right
          ) {
            const centerY = rect.top + rect.height / 2;
            collisions.push({
              id: container.id,
              data: { droppableContainer: container, value: Math.abs(pointerCoordinates.y - centerY) }
            });
          }
        }
      }

      if (collisions.length > 0) {
        collisions.sort((a, b) => a.data.value - b.data.value);
        return collisions;
      }

      const fallbackCollisions: any[] = [];
      const refY = pointerCoordinates ? pointerCoordinates.y : (collisionRect ? collisionRect.top + collisionRect.height / 2 : 0);

      for (const container of allowedContainers) {
        if (container.disabled) continue;
        const rect = containerRectMap.get(container.id);
        if (!rect) continue;

        if (containerRect && container.id !== 'layer-top' && (rect.bottom < containerRect.top || rect.top > containerRect.bottom)) {
          continue;
        }

        const dist = refY < rect.top ? rect.top - refY : (refY > rect.bottom ? refY - rect.bottom : 0);
        fallbackCollisions.push({
          id: container.id,
          data: { droppableContainer: container, value: dist }
        });
      }

      fallbackCollisions.sort((a, b) => a.data.value - b.data.value);
      return fallbackCollisions;
    }

    // Pin dragging: Group active droppable nodes by layer to compute midpoint split
    const layerGroups = new Map<string, { header?: { container: any; rect: DOMRect }; pins: Array<{ container: any; rect: DOMRect }> }>();

    for (const container of allowedContainers) {
      if (container.disabled) continue;
      const baseNode = container.node.current;
      if (!baseNode) continue;
      const rect = baseNode.getBoundingClientRect();

      const type = container.data.current?.type;
      if (type === 'layer' || container.id === 'default') {
        const layerKey = container.id;
        if (!layerGroups.has(layerKey)) {
          layerGroups.set(layerKey, { pins: [] });
        }
        layerGroups.get(layerKey)!.header = { container, rect };
      } else if (type === 'pin') {
        const pinLayerKey = container.data.current?.pin?.layerId || 'default';
        if (!layerGroups.has(pinLayerKey)) {
          layerGroups.set(pinLayerKey, { pins: [] });
        }
        layerGroups.get(pinLayerKey)!.pins.push({ container, rect });
      }
    }

    // Ordered list of layer IDs matching visual sidebar structure
    const orderedLayerIds = [...layers.map(l => l.id), 'default'];
    const visibleLayerIds = orderedLayerIds.filter(id => layerGroups.has(id));

    const containerRectMap = new Map<string, { top: number; bottom: number; left: number; right: number; height: number }>();

    for (let idx = 0; idx < visibleLayerIds.length; idx++) {
      const layerId = visibleLayerIds[idx];
      const group = layerGroups.get(layerId)!;
      const sortedPins = group.pins.sort((a, b) => a.rect.top - b.rect.top);

      const nextGroup = idx < visibleLayerIds.length - 1 ? layerGroups.get(visibleLayerIds[idx + 1]) : undefined;

      const fullLeft = containerRect ? containerRect.left : (group.header ? group.header.rect.left : 0);
      const fullRight = containerRect ? containerRect.right : (group.header ? group.header.rect.right : window.innerWidth);

      if (group.header) {
        const headerRect = group.header.rect;
        const splitTop = idx === 0 
          ? (containerRect ? containerRect.top - 200 : headerRect.top - 50)
          : headerRect.top;

        let splitBottom: number;
        if (sortedPins.length > 0) {
          splitBottom = sortedPins[0].rect.top + sortedPins[0].rect.height * 0.5;
        } else if (nextGroup && nextGroup.header) {
          splitBottom = nextGroup.header.rect.top;
        } else {
          splitBottom = containerRect ? containerRect.bottom + 200 : headerRect.bottom + 50;
        }

        containerRectMap.set(group.header.container.id, {
          top: splitTop,
          bottom: splitBottom,
          left: fullLeft,
          right: fullRight,
          height: splitBottom - splitTop
        });
      }

      for (let i = 0; i < sortedPins.length; i++) {
        const current = sortedPins[i];
        const next = sortedPins[i + 1];
        const splitTop = current.rect.top + current.rect.height * 0.5;
        const splitBottom = next
          ? (next.rect.top + next.rect.height * 0.5)
          : (nextGroup && nextGroup.header
              ? nextGroup.header.rect.top
              : (containerRect ? containerRect.bottom + 200 : current.rect.bottom + 50));

        containerRectMap.set(current.container.id, {
          top: splitTop,
          bottom: splitBottom,
          left: fullLeft,
          right: fullRight,
          height: splitBottom - splitTop
        });
      }
    }

    const collisions: any[] = [];
    const py = pointerCoordinates?.y;
    const px = pointerCoordinates?.x;

    if (py !== undefined && px !== undefined) {
      for (const container of allowedContainers) {
        if (container.disabled) continue;
        const rect = containerRectMap.get(container.id);
        if (!rect) continue;

        if (containerRect && container.id !== 'layer-top' && (rect.bottom < containerRect.top || rect.top > containerRect.bottom)) {
          continue;
        }

        if (py >= rect.top && py <= rect.bottom && px >= rect.left && px <= rect.right) {
          const centerY = rect.top + rect.height / 2;
          collisions.push({
            id: container.id,
            data: { droppableContainer: container, value: Math.abs(py - centerY) }
          });
        }
      }
    }

    if (collisions.length > 0) {
      collisions.sort((a, b) => a.data.value - b.data.value);
      return collisions;
    }

    // Fallback: Closest container by vertical distance
    const fallbackCollisions: any[] = [];
    const refY = py ?? (collisionRect ? collisionRect.top + collisionRect.height / 2 : 0);

    for (const container of allowedContainers) {
      if (container.disabled) continue;
      const rect = containerRectMap.get(container.id);
      if (!rect) continue;

      if (containerRect && container.id !== 'layer-top' && (rect.bottom < containerRect.top || rect.top > containerRect.bottom)) {
        continue;
      }

      const dist = refY < rect.top ? rect.top - refY : (refY > rect.bottom ? refY - rect.bottom : 0);
      fallbackCollisions.push({
        id: container.id,
        data: { droppableContainer: container, value: dist }
      });
    }

    fallbackCollisions.sort((a, b) => a.data.value - b.data.value);
    return fallbackCollisions;
  };

  return (
    <aside style={{ flex: 1, minHeight: 0, height: '100%', background: 'var(--surface-color)', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column', padding: isMobile ? '0.2rem 0.6rem 0.6rem 0.6rem' : '0.4rem 0.6rem 0.6rem 0.6rem', boxSizing: 'border-box', overflow: 'hidden', position: 'relative' }}>
      <DndContext 
        sensors={sensors}
        collisionDetection={customCollisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEndInternal}
        onDragCancel={handleDragCancelInternal}
        autoScroll={{
          threshold: { x: 0, y: 0.05 },
          acceleration: 10,
          canScroll: (element) => element === scrollContainerRef.current || (element instanceof HTMLElement && element.classList.contains('pin-list')),
        }}
      >
        {(() => {
          const targetHeaderActions = (headerActionsEl && document.body.contains(headerActionsEl))
            ? headerActionsEl
            : (typeof document !== 'undefined' ? document.getElementById('mobile-header-actions') : null);
          const isPortaled = !!(targetHeaderActions && document.body.contains(targetHeaderActions));

          const menuContent = (
            <div style={{ position: 'relative' }} ref={menuRef}>
              <button 
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                aria-label="More options"
                style={{
                  background: 'none',
                  border: 'none',
                  color: isPortaled
                    ? (mapTheme === 'dark' ? '#cbd5e1' : 'white')
                    : (mapTheme === 'dark' ? '#cbd5e1' : 'var(--text-primary)'),
                  cursor: 'pointer',
                  display: 'flex',
                  padding: '3px'
                }}
              >
                <MoreVertical size={20} />
              </button>
              
              {isMenuOpen && (
                <div style={{ position: 'absolute', top: '100%', right: 0, width: '220px', background: 'var(--surface-color)', color: 'var(--text-primary)', textAlign: 'left', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', zIndex: 3000, maxHeight: 'min(80vh, 640px)', overflowY: 'auto' }}>
                  {!readOnly && (
                    <div 
                      style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', fontWeight: '600' }}
                      onClick={() => {
                        setRenameInput(mapName);
                        setShowRenameModal(true);
                        setIsMenuOpen(false);
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      Rename Map
                    </div>
                  )}
                  {!readOnly && (
                    <div 
                      style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', fontWeight: '600' }}
                      onClick={() => { onShare?.(); setIsMenuOpen(false); }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      Share
                    </div>
                  )}
                  {!readOnly && pins.length === 0 && layers.length === 0 && (
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

                  {!isOffline && (
                    isDownloaded || isDownloading || hasPartialDownload ? (
                      <div 
                        style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', fontWeight: '600' }}
                        onClick={handleRemoveDownload}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-color)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        Remove Download
                      </div>
                    ) : (
                      <div 
                        style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', fontWeight: '600', color: isDownloading ? '#999' : 'inherit' }}
                        onClick={isDownloading ? undefined : handleDownloadClick}
                        onMouseEnter={(e) => !isDownloading && (e.currentTarget.style.background = 'var(--bg-color)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        Download for Offline
                      </div>
                    )
                  )}
                  {!readOnly && (
                    <div 
                      style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', fontWeight: '600' }}
                      onClick={() => {
                        const newLayer = onAddLayer();
                        if (newLayer) {
                          const id = typeof newLayer === 'string' ? newLayer : newLayer.id;
                          setEditingLayerId(id);
                        }
                        setIsMenuOpen(false);
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <span>New Layer</span>
                      <span style={{ fontSize: '0.72rem', fontWeight: '500', color: 'var(--text-muted, #888)', opacity: 0.85 }}>Ctrl-Shft-L</span>
                    </div>
                  )}
                  {selectedPins.length > 0 && !readOnly && (
                    <>
                      <div style={{ padding: '8px 16px', fontSize: '0.65rem', fontWeight: '800', color: '#999', background: '#fcfcfc', borderBottom: '1px solid var(--border-color)', borderTop: '1px solid var(--border-color)' }}>MOVE SELECTED TO...</div>
                      <div 
                        style={{ padding: '10px 16px', cursor: 'pointer', fontSize: '0.85rem', borderBottom: '1px solid var(--border-color)', fontWeight: '600' }}
                        onClick={() => {
                          if (onMovePinsToLayer) {
                            onMovePinsToLayer(selectedPins.map(p => p.id), undefined);
                          } else {
                            selectedPins.forEach(p => onUpdatePin(p.id, { layerId: undefined }));
                          }
                          setIsMenuOpen(false);
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      >
                        Default Layer
                      </div>
                      {layers.map(layer => (
                        <div 
                          key={layer.id}
                          style={{ padding: '10px 16px', cursor: 'pointer', fontSize: '0.85rem', borderBottom: '1px solid var(--border-color)', fontWeight: '600' }}
                          onClick={() => {
                            if (onMovePinsToLayer) {
                              onMovePinsToLayer(selectedPins.map(p => p.id), layer.id);
                            } else {
                              selectedPins.forEach(p => onUpdatePin(p.id, { layerId: layer.id }));
                            }
                            setIsMenuOpen(false);
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          {layer.name}
                        </div>
                      ))}
                    </>
                  )}
                  <div
                    style={{
                      padding: '4px 16px',
                      fontSize: '0.7rem',
                      fontWeight: '800',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color: 'var(--text-muted, #999)',
                      background: mapTheme === 'dark' ? 'rgba(59, 130, 246, 0.16)' : 'rgba(59, 130, 246, 0.12)',
                      borderTop: '1px solid var(--border-color)',
                      borderBottom: '1px solid var(--border-color)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <Palette size={12} />
                    Appearance
                  </div>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSatellite?.(!showSatellite);
                    }}
                    style={{
                      padding: '10px 16px 10px 28px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '0.82rem',
                      fontWeight: showSatellite ? '600' : '500',
                      color: 'var(--text-primary)',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Globe size={15} color={showSatellite ? '#3b82f6' : '#64748b'} />
                      <span>Satellite</span>
                    </div>
                    <div
                      style={{
                        width: '34px',
                        height: '18px',
                        borderRadius: '10px',
                        background: showSatellite ? '#3b82f6' : '#e2e8f0',
                        position: 'relative',
                        transition: 'background 0.2s ease',
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '50%',
                          background: 'white',
                          position: 'absolute',
                          top: '2px',
                          left: showSatellite ? '18px' : '2px',
                          transition: 'left 0.2s ease',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                        }}
                      />
                    </div>
                  </div>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      onThemeChange?.(mapTheme === 'dark' ? 'light' : 'dark');
                    }}
                    style={{
                      padding: '10px 16px 10px 28px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '0.82rem',
                      fontWeight: mapTheme === 'dark' ? '600' : '500',
                      color: 'var(--text-primary)',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {mapTheme === 'dark' ? <Moon size={15} color="#3b82f6" /> : <Sun size={15} color="#64748b" />}
                      <span>Dark Mode</span>
                    </div>
                    <div
                      style={{
                        width: '34px',
                        height: '18px',
                        borderRadius: '10px',
                        background: mapTheme === 'dark' ? '#3b82f6' : '#e2e8f0',
                        position: 'relative',
                        transition: 'background 0.2s ease',
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '50%',
                          background: 'white',
                          position: 'absolute',
                          top: '2px',
                          left: mapTheme === 'dark' ? '18px' : '2px',
                          transition: 'left 0.2s ease',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                        }}
                      />
                    </div>
                  </div>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!showSatellite) {
                        onToggleHillshade?.(!showHillshade);
                      }
                    }}
                    style={{
                      padding: '10px 16px 10px 28px',
                      cursor: showSatellite ? 'not-allowed' : 'pointer',
                      opacity: showSatellite ? 0.45 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '0.82rem',
                      fontWeight: showHillshade ? '600' : '500',
                      color: 'var(--text-primary)',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                    onMouseEnter={(e) => {
                      if (!showSatellite) e.currentTarget.style.background = 'var(--bg-color)';
                    }}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={showHillshade ? (showSatellite ? '#94a3b8' : '#1d4ed8') : '#64748b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
                        <path d="M12 11l5 10H12V11z" fill={showHillshade ? (showSatellite ? '#94a3b8' : '#1d4ed8') : '#64748b'} opacity="0.4" stroke="none" />
                      </svg>
                      <span>Hillshading</span>
                    </div>
                    <div
                      style={{
                        width: '34px',
                        height: '18px',
                        borderRadius: '10px',
                        background: showHillshade ? (showSatellite ? '#94a3b8' : '#3b82f6') : '#e2e8f0',
                        position: 'relative',
                        transition: 'background 0.2s ease',
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '50%',
                          background: 'white',
                          position: 'absolute',
                          top: '2px',
                          left: showHillshade ? '18px' : '2px',
                          transition: 'left 0.2s ease',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                        }}
                      />
                    </div>
                  </div>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle3DTerrain?.(!show3DTerrain);
                    }}
                    style={{
                      padding: '10px 16px 10px 28px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '0.82rem',
                      fontWeight: show3DTerrain ? '600' : '500',
                      color: 'var(--text-primary)',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Mountain size={15} style={{ color: show3DTerrain ? '#1d4ed8' : '#64748b' }} />
                      <span>3D Terrain</span>
                    </div>
                    <div
                      style={{
                        width: '34px',
                        height: '18px',
                        borderRadius: '10px',
                        background: show3DTerrain ? '#3b82f6' : '#e2e8f0',
                        position: 'relative',
                        transition: 'background 0.2s ease',
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '50%',
                          background: 'white',
                          position: 'absolute',
                          top: '2px',
                          left: show3DTerrain ? '18px' : '2px',
                          transition: 'left 0.2s ease',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                        }}
                      />
                    </div>
                  </div>
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle3DBuildings?.(!show3DBuildings);
                    }}
                    style={{
                      padding: '10px 16px 10px 28px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '0.82rem',
                      fontWeight: show3DBuildings ? '600' : '500',
                      color: 'var(--text-primary)',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Box size={15} style={{ color: show3DBuildings ? '#1d4ed8' : '#64748b' }} />
                      <span>3D Buildings</span>
                    </div>
                    <div
                      style={{
                        width: '34px',
                        height: '18px',
                        borderRadius: '10px',
                        background: show3DBuildings ? '#3b82f6' : '#e2e8f0',
                        position: 'relative',
                        transition: 'background 0.2s ease',
                        flexShrink: 0,
                      }}
                    >
                      <div
                        style={{
                          width: '14px',
                          height: '14px',
                          borderRadius: '50%',
                          background: 'white',
                          position: 'absolute',
                          top: '2px',
                          left: show3DBuildings ? '18px' : '2px',
                          transition: 'left 0.2s ease',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );

          return isPortaled && targetHeaderActions
            ? createPortal(menuContent, targetHeaderActions)
            : menuContent;
        })()}

        {(!readOnly || selectedPins.length > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px', height: '28px' }}>
            {!readOnly && (
              <div style={{ flex: 1, minWidth: 0, height: '28px' }}>
                <SearchBar 
                  onAddPin={onAddPin}
                  pins={pins} 
                  disabled={readOnly} 
                  onHoverSearchResult={onHoverSearchResult}
                  onHoverPin={onHoverPin}
                  onSearchAreaStateChange={onSearchAreaStateChange}
                />
              </div>
            )}
            {selectedPins.length > 0 && (
              <button 
                onClick={handleNavigate}
                style={{ 
                  fontSize: '0.65rem', 
                  background: 'var(--success-color)', 
                  color: 'white', 
                  border: 'none', 
                  padding: '0 10px', 
                  borderRadius: '50px', 
                  cursor: 'pointer', 
                  fontWeight: '700', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '4px',
                  flexShrink: 0,
                  height: '28px',
                  boxSizing: 'border-box',
                  whiteSpace: 'nowrap',
                  marginLeft: readOnly ? 'auto' : undefined
                }}
              >
                <Navigation size={10} /> Go ({selectedPins.length})
              </button>
            )}
          </div>
        )}



        <div 
          ref={scrollContainerRef}
          className={`pin-list${(targetPinId || editingPinId || isHoverBlocked) ? ' pin-hover-blocked' : ''}${isDragActive ? ' pin-drag-active' : ''}`}
          style={{ 
            flex: 1, 
            minHeight: 0,
            overflowY: 'auto', 
            paddingRight: '4px', 
            paddingTop: '0px',
            paddingBottom: isMobile ? '4rem' : '1.5rem',
            margin: '0 -4px',
            touchAction: 'pan-y',
            WebkitOverflowScrolling: 'touch',
            overscrollBehaviorY: 'contain'
          }}>
          <LayerTopDropZone isLayerDragging={!!activeLayer} />
          <SortableContext items={layerIds} strategy={verticalListSortingStrategy}>
            {layers.map((layer) => (
              <SortableLayer
                key={layer.id}
                layer={layer}
                layerPins={layerPinsMap.get(layer.id) || []}
                onUpdateLayer={onUpdateLayer}
                onRemoveLayer={onRemoveLayer}
                onPinClick={onPinClick}
                onRemovePin={onRemovePin}
                onUpdatePin={onUpdatePin}
                editingPinId={editingPinId}
                onSetEditingPinId={onSetEditingPinId}
                editingLayerId={editingLayerId}
                onSetEditingLayerId={setEditingLayerId}
                readOnly={readOnly}
                targetPinId={targetPinId}
                onHoverPin={onHoverPin}
                customColors={customColors}
                onAddCustomColor={onAddCustomColor}
                selectedNavIds={selectedNavIds}
                onToggleNavId={onToggleNavId}
                onToggleNavIds={onToggleNavIds}
                allLayers={layers}
                isHidden={hiddenLayerIds?.has(layer.id) || false}
                onToggleVisibility={() => onToggleLayerVisibility?.(layer.id)}
                isExpanded={!collapsedLayerIds?.has(layer.id)}
                onToggleExpand={() => onToggleExpand?.(layer.id)}
                isAnySelectedDragging={isAnySelectedDragging}
                isLayerDragging={!!activeLayer}
                isAnyPinDragging={isAnyPinDragging}
                isHoverBlocked={isHoverBlocked}
              />
            ))}
          </SortableContext>
          <DefaultLayerHeader 
            defaultPins={defaultPins}
            collapsedLayerIds={collapsedLayerIds}
            hiddenLayerIds={hiddenLayerIds}
            isDefaultAllSelected={isDefaultAllSelected}
            isDefaultSomeSelected={isDefaultSomeSelected}
            readOnly={readOnly}
            isLayerDragging={!!activeLayer}
            isAnyPinDragging={isAnyPinDragging}
            onToggleExpand={onToggleExpand}
            onToggleLayerVisibility={onToggleLayerVisibility}
            onToggleNavIds={onToggleNavIds}
            layersCount={layers.length}
          >
            {!collapsedLayerIds?.has(null) && (
              <div style={{ paddingLeft: '0.2rem', borderLeft: '1px solid var(--border-color)', marginTop: '0px', marginLeft: '0.4rem' }}>
                <SortableContext items={defaultPinIds} strategy={verticalListSortingStrategy} disabled={readOnly}>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, paddingTop: '2px', minHeight: defaultPins.length === 0 ? '24px' : '10px' }}>
                    {defaultPins.map((pin) => (
                      <SortablePin 
                        key={pin.id} 
                        pin={pin} 
                        onPinClick={onPinClick}
                        onRemovePin={onRemovePin}
                        onUpdatePin={onUpdatePin}
                        isEditing={editingPinId === pin.id}
                        isTarget={targetPinId === pin.id}
                        setEditingPinId={onSetEditingPinId}
                        readOnly={readOnly}
                        onHoverPin={onHoverPin}
                        customColors={customColors}
                        onAddCustomColor={onAddCustomColor}
                        isSelected={selectedNavIds?.has(pin.id)}
                        onToggleSelect={onToggleNavId}
                        allLayers={layers}
                        isAnySelectedDragging={isAnySelectedDragging}
                        isAnyPinDragging={isAnyPinDragging}
                        isHoverBlocked={isHoverBlocked}
                      />
                    ))}
                    {defaultPins.length === 0 && layers.length === 0 && (
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
          </DefaultLayerHeader>
          </div>



        {/* Export Modal (Portaled) */}
        {showExportModal && createPortal(
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999, padding: '20px' }}>
            <div style={{ background: 'var(--surface-color)', borderRadius: 'var(--radius-lg)', padding: '32px', maxWidth: '440px', width: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '1.3rem', fontWeight: '900', color: 'var(--text-primary)' }}>Export Map</h3>
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

        {/* Rename Modal (Portaled) */}
        {showRenameModal && createPortal(
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999, padding: '20px' }}>
            <div style={{ background: 'var(--surface-color)', borderRadius: 'var(--radius-lg)', padding: '32px', maxWidth: '440px', width: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.3)' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '1.3rem', fontWeight: '900', color: 'var(--text-primary)' }}>Rename Map</h3>
              <form onSubmit={(e) => {
                e.preventDefault();
                if (renameInput.trim()) {
                  onMapNameChange(renameInput.trim());
                }
                setShowRenameModal(false);
              }}>
                <div style={{ marginBottom: '24px' }}>
                  <label htmlFor="rename-map-input" style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: '700' }}>New Map Name</label>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input 
                      ref={renameInputRef}
                      id="rename-map-input"
                      type="text" 
                      value={renameInput} 
                      onChange={(e) => setRenameInput(e.target.value)} 
                      autoFocus
                      style={{ width: '100%', padding: '10px', paddingRight: renameInput ? '36px' : '10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', boxSizing: 'border-box', fontFamily: 'inherit' }}
                    />
                    {renameInput && (
                      <button
                        type="button"
                        aria-label="Clear map name"
                        onMouseDown={(e) => e.preventDefault()}
                        onTouchStart={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.preventDefault();
                          setRenameInput('');
                          renameInputRef.current?.focus();
                        }}
                        style={{
                          position: 'absolute',
                          right: '8px',
                          background: 'none',
                          border: 'none',
                          color: '#888',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '4px',
                          borderRadius: '50%'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.color = '#333'}
                        onMouseLeave={(e) => e.currentTarget.style.color = '#888'}
                      >
                        <X size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <button 
                    type="button"
                    onClick={() => setShowRenameModal(false)}
                    style={{ flex: 1, padding: '12px', background: '#f5f5f5', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', fontWeight: '800', cursor: 'pointer', color: '#444' }}
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    style={{ flex: 1, padding: '12px', background: 'var(--primary-color)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', fontWeight: '800', cursor: 'pointer', boxShadow: '0 4px 10px rgba(72, 61, 139, 0.3)' }}
                  >
                    Save
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body
        )}

        {createPortal(
          <DragOverlay 
            modifiers={[restrictToVerticalAxis]}
            style={{ pointerEvents: 'none', zIndex: 3000 }}
            dropAnimation={{
            sideEffects: defaultDropAnimationSideEffects({
                styles: {
                    active: {
                        opacity: '0.25', 
                    },
                },
            }),
          }}>
            <div>
            {(() => {
              const dragOverlayScale = isMobile ? (mobileScale ?? 1) : 1.25;
              if (activePin) {
                return (
                  <div style={{ width: '200px', position: 'relative', transform: `scale(${dragOverlayScale})`, transformOrigin: 'top left' }}>
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
                );
              }
              if (activeLayer) {
                return (
                  <div style={{ width: '240px', background: 'var(--surface-color)', color: 'var(--text-primary)', border: '1px solid var(--primary-color)', borderRadius: 'var(--radius-sm)', padding: '0.2rem', opacity: 0.25, boxShadow: 'var(--shadow-md)', marginLeft: '12px', transform: `scale(${dragOverlayScale})`, transformOrigin: 'top left' }}>
                    <div style={{ fontWeight: '700', fontSize: '0.65rem' }}>{activeLayer.name}</div>
                  </div>
                );
              }
              return null;
            })()}
            </div>
          </DragOverlay>,
          document.body
        )}
      </DndContext>

      {/* Download Pill Indicator (Portaled into header next to sync pill) */}
      {(() => {
        const pillContainer = (downloadPillEl && document.body.contains(downloadPillEl))
          ? downloadPillEl
          : (typeof document !== 'undefined' ? document.getElementById('download-pill-container') : null);
        if (!pillContainer || !document.body.contains(pillContainer)) return null;

        const showActiveProgress = isDownloading || hasPartialDownload;
        const showCompleted = isDownloaded && !showActiveProgress;

        if (!showActiveProgress && !showCompleted) return null;

        const completedCount = tileStats?.completed ?? 0;
        const totalCount = tileStats?.total ?? 0;

        const tooltipText = showCompleted
          ? (completedCount > 0 ? `${completedCount.toLocaleString()} tiles downloaded` : 'Map tiles downloaded')
          : `${completedCount.toLocaleString()} / ${totalCount.toLocaleString()} tiles downloaded`;

        return createPortal(
          <div 
            title={tooltipText}
            style={{
              background: 'rgba(255, 255, 255, 0.1)', 
              padding: '3px 8px', 
              borderRadius: '50px',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              color: 'white',
              fontWeight: '600',
              whiteSpace: 'nowrap',
              fontSize: '0.65rem',
              cursor: 'default'
            }}
          >
            {showActiveProgress && (
              <span>{Math.round((downloadProgress || 0) * 100)}%</span>
            )}
            <Download 
              size={13} 
              className={showActiveProgress ? 'animated-download-icon' : ''} 
              style={showCompleted ? { color: '#4ade80' } : undefined} 
            />
          </div>,
          pillContainer
        );
      })()}
    </aside>
  );
};

export default memo(Sidebar);
