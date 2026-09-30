import { useMemo, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import type { UserLabel, MapLabelAssignment } from '@shared/interfaces';

interface MapLabelDialogProps {
  isOpen: boolean;
  mapId: string;
  mapName: string;
  anchorRect?: DOMRect;
  labels: UserLabel[];
  assignments: MapLabelAssignment[];
  onClose: () => void;
  onToggleLabel: (labelId: string, assigned: boolean) => Promise<void> | void;
  readOnly?: boolean;
}

export default function MapLabelDialog({
  isOpen,
  mapId,
  mapName,
  anchorRect,
  labels,
  assignments,
  onClose,
  onToggleLabel,
  readOnly = false,
}: MapLabelDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const assignedLabelIds = useMemo(() => {
    const set = new Set<string>();
    for (const a of assignments) {
      if (a.mapId === mapId) {
        set.add(a.labelId);
      }
    }
    return set;
  }, [assignments, mapId]);

  // Labels in alphabetical order (case-insensitive)
  const sortedLabels = useMemo(() => {
    const ordered = [...labels].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    if (!readOnly) return ordered;
    return ordered.filter(label => assignedLabelIds.has(label.id));
  }, [labels, readOnly, assignedLabelIds]);

  // Calculate popover positioning relative to the label icon button
  const popoverStyle = useMemo((): React.CSSProperties => {
    if (!anchorRect) {
      return {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }

    const gap = 6;
    const padding = 10;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Horizontally: align the right edge of popover with right edge of icon button, clamped to screen
    let right: number | undefined = Math.max(padding, viewportWidth - anchorRect.right);
    let left: number | undefined = undefined;

    // Check vertical space: prefer opening below icon; if not enough room, open above icon
    const spaceBelow = viewportHeight - anchorRect.bottom - gap;
    const spaceAbove = anchorRect.top - gap;
    const maxHeight = Math.min(320, Math.max(180, Math.max(spaceBelow, spaceAbove) - padding));

    let top: number | undefined = undefined;
    let bottom: number | undefined = undefined;

    if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
      top = anchorRect.bottom + gap;
    } else {
      bottom = viewportHeight - anchorRect.top + gap;
    }

    return {
      position: 'fixed',
      top: top !== undefined ? `${top}px` : undefined,
      bottom: bottom !== undefined ? `${bottom}px` : undefined,
      right: right !== undefined ? `${right}px` : undefined,
      left: left !== undefined ? `${left}px` : undefined,
      maxHeight: `${maxHeight}px`,
    };
  }, [anchorRect]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'transparent',
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          ...popoverStyle,
          width: 'max-content',
          minWidth: '150px',
          maxWidth: 'min(240px, calc(100vw - 24px))',
          backgroundColor: 'var(--surface-color)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 2001,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <span
            style={{
              margin: 0,
              fontSize: '0.85rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={mapName}
          >
            Labels
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
              padding: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable Label list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px', minHeight: readOnly ? 0 : '60px' }}>
          {sortedLabels.length === 0 ? (
            <div style={{ padding: '1.25rem 0.5rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {readOnly ? 'No labels on this map.' : 'No labels created yet.'}
            </div>
          ) : (
            sortedLabels.map(label => {
              const isAssigned = assignedLabelIds.has(label.id);
              return (
                <div
                  key={label.id}
                  onClick={readOnly ? undefined : () => onToggleLabel(label.id, !isAssigned)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '6px 8px',
                    borderRadius: 'var(--radius-sm)',
                    cursor: readOnly ? 'default' : 'pointer',
                    userSelect: 'none',
                    transition: 'background 0.1s ease',
                  }}
                  onMouseEnter={readOnly ? undefined : e => (e.currentTarget.style.background = 'var(--bg-color)')}
                  onMouseLeave={readOnly ? undefined : e => (e.currentTarget.style.background = 'transparent')}
                >
                  {!readOnly && (
                    <div
                      style={{
                        width: '16px',
                        height: '16px',
                        borderRadius: '3px',
                        border: isAssigned
                          ? '1.5px solid var(--primary-color)'
                          : '1.5px solid var(--text-secondary)',
                        backgroundColor: isAssigned ? 'var(--primary-color)' : 'var(--surface-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        boxSizing: 'border-box',
                      }}
                    >
                      {isAssigned && <Check size={12} color="white" strokeWidth={3} />}
                    </div>
                  )}

                  <span
                    style={{
                      fontSize: '0.82rem',
                      fontWeight: 500,
                      color: 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {label.name}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
