import React, { type CSSProperties, type ReactNode, type TouchEvent } from 'react';
import { Eye, Trash2, Download, LogIn, WifiOff, Tag, GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import type { MapDownloadStatus } from '../utils/tileUtils';

export interface MapSummary {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  lastAccessedAt?: string;
}

const LONG_PRESS_LABEL_STYLE: CSSProperties = {
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
};

function LongPressLabel({
  title,
  style,
  className,
  children,
  onClick,
  onTouchStart,
  onTouchEnd,
  disabled = false,
}: {
  title: string;
  style?: CSSProperties;
  className?: string;
  children: ReactNode;
  onClick?: (event: React.MouseEvent<HTMLSpanElement>) => void;
  onTouchStart?: (event: TouchEvent<HTMLSpanElement>) => void;
  onTouchEnd?: () => void;
  disabled?: boolean;
}) {
  return (
    <span
      data-long-press-label=""
      title={title}
      className={className}
      style={{ ...style, ...LONG_PRESS_LABEL_STYLE }}
      onClick={disabled ? undefined : onClick}
      onTouchStart={disabled ? undefined : onTouchStart}
      onTouchEnd={disabled ? undefined : onTouchEnd}
      onTouchCancel={disabled ? undefined : onTouchEnd}
      onContextMenu={e => e.preventDefault()}
    >
      {children}
    </span>
  );
}

interface LandingMapCardProps {
  map: MapSummary;
  isCustomSort: boolean;
  downloadStatus?: MapDownloadStatus;
  currentUserId?: string;
  isOffline: boolean;
  onMapClick?: (mapId: string, viewMode?: boolean) => void;
  onOpenLabels?: (map: MapSummary, e: React.MouseEvent) => void;
  onDeleteClick?: (mapId: string, e: React.MouseEvent) => void;
  handleTouchStart?: (text: string, e: React.TouchEvent | React.MouseEvent) => void;
  handleTouchEnd?: () => void;
  showTooltip?: (text: string, element: HTMLElement) => void;
  longPressTriggeredRef?: React.MutableRefObject<boolean>;
  formatDate: (dateString?: string) => string;
  isOverlay?: boolean;
}

export function LandingMapCard({
  map,
  isCustomSort,
  downloadStatus,
  currentUserId,
  isOffline,
  onMapClick,
  onOpenLabels,
  onDeleteClick,
  handleTouchStart,
  handleTouchEnd,
  showTooltip,
  longPressTriggeredRef,
  formatDate,
  isOverlay = false,
}: LandingMapCardProps) {
  const sortable = useSortable({
    id: map.id,
    disabled: !isCustomSort || isOverlay,
  });

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;

  const style: CSSProperties = isOverlay
    ? {
        cursor: 'grabbing',
        boxShadow: 'var(--shadow-lg)',
        border: '1.5px solid var(--primary-color)',
        background: 'var(--surface-color)',
        opacity: 0.96,
        touchAction: 'none',
        pointerEvents: 'none',
        width: '100%',
        boxSizing: 'border-box',
      }
    : {
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
        opacity: isDragging ? 0.35 : 1,
        zIndex: isDragging ? 0 : undefined,
        pointerEvents: isDragging ? 'none' : undefined,
      };

  const cardClick = () => {
    if (longPressTriggeredRef?.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    onMapClick?.(map.id);
  };

  return (
    <div
      ref={isCustomSort && !isOverlay ? setNodeRef : undefined}
      style={style}
      className={`card map-card-compact${isDragging ? ' is-dragging' : ''}${isOverlay ? ' is-overlay' : ''}`}
      onClick={isOverlay ? undefined : cardClick}
      {...(isCustomSort && !isOverlay ? attributes : {})}
    >
      {/* Drag handle visible only in Custom Order mode */}
      {isCustomSort && (
        <div
          {...(isOverlay ? {} : listeners)}
          onClick={e => e.stopPropagation()}
          style={{
            cursor: isOverlay ? 'grabbing' : 'grab',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            paddingRight: '6px',
            color: isOverlay ? 'var(--primary-color)' : 'var(--text-secondary)',
            touchAction: 'none',
          }}
          title="Drag to reorder"
        >
          <GripVertical size={16} />
        </div>
      )}

      {/* Map Info Section */}
      <div className="map-card-info">
        <h3 className="map-card-title" title={map.name}>
          {map.name}
        </h3>
        <div className="map-card-meta">
          <LongPressLabel
            title="Map Owner"
            style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, cursor: 'default' }}
            onTouchStart={e => handleTouchStart?.('Map Owner', e)}
            onTouchEnd={handleTouchEnd}
            disabled={isCustomSort}
          >
            <span>{map.ownerId === currentUserId ? 'You' : (map.ownerName || 'Shared')}</span>
          </LongPressLabel>
          <span style={{ opacity: 0.5 }}>•</span>
          <LongPressLabel
            title="Last Accessed Date"
            style={{ flexShrink: 0, opacity: 0.85, cursor: 'default' }}
            onTouchStart={e => handleTouchStart?.('Last Accessed Date', e)}
            onTouchEnd={handleTouchEnd}
            disabled={isCustomSort}
          >
            {formatDate(map.lastAccessedAt)}
          </LongPressLabel>

          {/* Download / Offline status badges */}
          {(() => {
            if (downloadStatus?.isComplete) {
              return (
                <LongPressLabel
                  title="Downloaded"
                  className="map-card-badge"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#27ae60',
                    background: 'rgba(39, 174, 96, 0.12)',
                    padding: '2px 6px',
                    borderRadius: '10px',
                    marginLeft: 'auto',
                    flexShrink: 0,
                    cursor: 'pointer',
                  }}
                  onClick={e => {
                    e.stopPropagation();
                    if (showTooltip) {
                      showTooltip('Downloaded', e.currentTarget);
                    }
                  }}
                  disabled={isCustomSort}
                >
                  <Download size={12} />
                </LongPressLabel>
              );
            }
            if (downloadStatus?.isStalled) {
              return (
                <span
                  className="map-card-badge"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    fontSize: '0.7rem',
                    color: 'var(--error-color)',
                    background: 'rgba(203, 43, 62, 0.12)',
                    padding: '1px 6px',
                    borderRadius: '10px',
                    fontWeight: '700',
                    marginLeft: 'auto',
                    flexShrink: 0,
                  }}
                >
                  <Download size={11} /> Stalled
                </span>
              );
            }
            if (downloadStatus?.isPartial) {
              return (
                <span
                  className="map-card-badge"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    fontSize: '0.7rem',
                    color: '#3b82f6',
                    background: 'rgba(59, 130, 246, 0.12)',
                    padding: '1px 6px',
                    borderRadius: '10px',
                    fontWeight: '700',
                    marginLeft: 'auto',
                    flexShrink: 0,
                  }}
                >
                  <Download size={11} className="animated-download-icon" /> Downloading
                </span>
              );
            }
            if (isOffline || !currentUserId) {
              const isLoggedOut = !currentUserId;
              const labelText = isLoggedOut ? 'Logged Out' : 'Offline';
              return (
                <LongPressLabel
                  title={labelText}
                  className="map-card-badge"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#e74c3c',
                    background: 'rgba(231, 76, 60, 0.12)',
                    padding: '2px 6px',
                    borderRadius: '10px',
                    marginLeft: 'auto',
                    flexShrink: 0,
                    cursor: 'pointer',
                  }}
                  onClick={e => {
                    e.stopPropagation();
                    if (showTooltip) {
                      showTooltip(labelText, e.currentTarget);
                    }
                  }}
                  disabled={isCustomSort}
                >
                  {isLoggedOut ? <LogIn size={12} /> : <WifiOff size={12} />}
                </LongPressLabel>
              );
            }
            return null;
          })()}
        </div>
      </div>

      {/* Map Card Actions */}
      <div
        className="map-card-actions"
        onClick={e => e.stopPropagation()}
        onPointerDown={e => e.stopPropagation()}
      >
        {/* View Mode Action */}
        {((!isOffline && Boolean(currentUserId)) || Boolean(downloadStatus?.isComplete)) && (
          <button
            type="button"
            className="map-card-action-btn view-btn"
            onClick={e => {
              e.stopPropagation();
              if (longPressTriggeredRef?.current) {
                longPressTriggeredRef.current = false;
                return;
              }
              onMapClick?.(map.id, true);
            }}
            onPointerDown={e => e.stopPropagation()}
            onTouchStart={isCustomSort ? undefined : e => handleTouchStart?.('Open in view mode', e)}
            onTouchEnd={isCustomSort ? undefined : handleTouchEnd}
            onTouchCancel={isCustomSort ? undefined : handleTouchEnd}
            title="Open in view mode"
            aria-label="Open in view mode"
          >
            <Eye size={18} />
          </button>
        )}

        {/* Labels Management Dialog Action */}
        {Boolean(currentUserId) && (
          <button
            type="button"
            className="map-card-action-btn label-btn"
            onClick={e => {
              e.stopPropagation();
              if (longPressTriggeredRef?.current) {
                longPressTriggeredRef.current = false;
                return;
              }
              onOpenLabels?.(map, e);
            }}
            onPointerDown={e => e.stopPropagation()}
            onTouchStart={isCustomSort ? undefined : e => handleTouchStart?.('Manage labels', e)}
            onTouchEnd={isCustomSort ? undefined : handleTouchEnd}
            onTouchCancel={isCustomSort ? undefined : handleTouchEnd}
            title="Manage labels"
            aria-label="Manage labels"
          >
            <Tag size={18} />
          </button>
        )}

        {/* Delete / Leave Map Action */}
        {!isOffline && (
          <button
            type="button"
            className="map-card-action-btn delete-btn"
            onClick={e => {
              e.stopPropagation();
              if (longPressTriggeredRef?.current) {
                longPressTriggeredRef.current = false;
                return;
              }
              onDeleteClick?.(map.id, e);
            }}
            onPointerDown={e => e.stopPropagation()}
            onTouchStart={isCustomSort ? undefined : e => handleTouchStart?.(map.ownerId === currentUserId ? 'Delete Map' : 'Leave Map', e)}
            onTouchEnd={isCustomSort ? undefined : handleTouchEnd}
            onTouchCancel={isCustomSort ? undefined : handleTouchEnd}
            title={map.ownerId === currentUserId ? 'Delete Map' : 'Leave Map'}
            aria-label={map.ownerId === currentUserId ? 'Delete Map' : 'Leave Map'}
          >
            <Trash2 size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
