import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { apiService } from '../services/api';
import { Map as MapIcon, LogIn, LogOut, WifiOff, CloudSync, Loader2, Trash2, Upload, Sun, Moon, ChevronDown, Check, ArrowUpDown, Search, X, Pencil } from 'lucide-react';
import { getMapDownloadStatuses, unionCachedMapsWithDownloads, type MapDownloadStatus } from '../utils/tileUtils';
import { landingStatusFromWorker, tileWorkerManager } from '../utils/tileWorkerManager';
import { getStoredJson, setStoredJson } from '../utils/storageUtils';
import { setForcedOffline } from '../utils/offlineSession';
import { deleteUnrecognizedStorage, findUnrecognizedStorage, type LeftoverStorageItem } from '../utils/legacyStorage';
import type { UserLabel, MapLabelAssignment, LabelSortMode } from '@shared/interfaces';
import MapLabelDialog from '../components/MapLabelDialog';
import { LandingMapCard, type MapSummary } from '../components/LandingMapCard';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, rectSortingStrategy } from '@dnd-kit/sortable';

interface TouchTooltipState {
  text: string;
  x: number;
  y: number;
  below?: boolean;
}

function parseUtcDateString(dateStr?: string | null): number {
  if (!dateStr) return 0;
  const normalized = dateStr.includes(' ') && !dateStr.endsWith('Z')
    ? dateStr.replace(' ', 'T') + 'Z'
    : dateStr;
  const time = new Date(normalized).getTime();
  return isNaN(time) ? 0 : time;
}

const NO_TEXT_SELECT_STYLE: React.CSSProperties = {
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
};

function isProtectedLandingText(target: EventTarget | Node | null, root: HTMLElement | null): boolean {
  const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  if (!el) return false;
  if (el.closest('input, textarea, select, [contenteditable="true"]')) return false;
  if (el.closest('[data-long-press-label], [data-no-text-select]')) return true;
  if (root && root.contains(el)) return true;
  return false;
}

export default function LandingPage() {
  const landingRootRef = useRef<HTMLDivElement>(null);
  const { user, isLoading: authLoading, logout, logoutEverywhere } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [maps, setMaps] = useState<MapSummary[]>(() => getStoredJson<MapSummary[]>('cached_maps', []));
  const [downloadStatuses, setDownloadStatuses] = useState<Map<string, MapDownloadStatus>>(() => {
    const cachedStatuses = getStoredJson<Record<string, MapDownloadStatus> | null>('cached_download_statuses', null);
    if (cachedStatuses) {
      return new Map(Object.entries(cachedStatuses));
    }
    return new Map();
  });
  // Hold cards until the entry probe. navigator.onLine can stay false after reconnect.
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [showSignOutDialog, setShowSignOutDialog] = useState(false);
  const [showRemoveAllDialog, setShowRemoveAllDialog] = useState(false);
  const [isRemovingAll, setIsRemovingAll] = useState(false);
  const [leftoverItems, setLeftoverItems] = useState<LeftoverStorageItem[]>([]);
  const [showLeftoverDialog, setShowLeftoverDialog] = useState(false);
  const [isRemovingLeftovers, setIsRemovingLeftovers] = useState(false);
  const [showOfflineInterstitial, setShowOfflineInterstitial] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [touchTooltip, setTouchTooltip] = useState<TouchTooltipState | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef<boolean>(false);
  // True after a list fetch reaches the server. A stale navigator.onLine must not block opens.
  const reachedServerRef = useRef(false);

  // Label management state
  const [labels, setLabels] = useState<UserLabel[]>(() => getStoredJson<UserLabel[]>('cached_user_labels', []));
  const [assignments, setAssignments] = useState<MapLabelAssignment[]>(() => getStoredJson<MapLabelAssignment[]>('cached_map_label_assignments', []));
  const [systemSettings, setSystemSettings] = useState<Record<string, LabelSortMode>>(() => getStoredJson<Record<string, LabelSortMode>>('cached_system_label_settings', {}));
  const [systemOrder, setSystemOrder] = useState<Record<string, string[]>>(() => getStoredJson<Record<string, string[]>>('cached_system_label_map_order', {}));
  const [activeLabelId, setActiveLabelId] = useState<string>(() => {
    const saved = getStoredJson<string | null>('cached_selected_label', null);
    if (!saved || saved === 'search') return 'all';
    return saved;
  });
  const [labelingMap, setLabelingMap] = useState<{ map: MapSummary; anchorRect: DOMRect } | null>(null);
  const [showCreateLabelModal, setShowCreateLabelModal] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [showEditLabelModal, setShowEditLabelModal] = useState(false);
  const [editLabelId, setEditLabelId] = useState<string | null>(null);
  const [editLabelName, setEditLabelName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const labelHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const [headingEl, setHeadingEl] = useState<HTMLHeadingElement | null>(null);
  const [isTitleOverflowing, setIsTitleOverflowing] = useState(false);
  const [isSortCollapsed, setIsSortCollapsed] = useState(false);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const editBtnRef = useRef<HTMLButtonElement | null>(null);
  const measureSortButtonRef = useRef<HTMLButtonElement | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const activeDragMap = useMemo(() => {
    if (!activeDragId) return null;
    return maps.find(m => m.id === activeDragId) || null;
  }, [maps, activeDragId]);

  const setHeadingRef = useCallback((el: HTMLHeadingElement | null) => {
    labelHeadingRef.current = el;
    setHeadingEl(el);
  }, []);
  const isMountedRef = useRef(true);
  const labelsAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (showEditLabelModal && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [showEditLabelModal]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      labelsAbortRef.current?.abort();
    };
  }, []);

  // Remember the last selected label across visits (ignoring transient search mode)
  useEffect(() => {
    if (activeLabelId && activeLabelId !== 'search') {
      setStoredJson('cached_selected_label', activeLabelId);
    }
  }, [activeLabelId]);

  // If user is not authenticated once auth check finishes, revert user-only labels to 'all'
  useEffect(() => {
    if (!authLoading && !user) {
      if (activeLabelId !== 'all' && activeLabelId !== 'offline' && activeLabelId !== 'search') {
        setActiveLabelId('all');
      }
    }
  }, [user, authLoading, activeLabelId]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const isTouchActiveRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const tooltipDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const calculateTooltipPosition = (text: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const maxHalfWidth = Math.min(160, Math.max(20, (window.innerWidth - 32) / 2));
    const x = Math.max(16 + maxHalfWidth, Math.min(center, window.innerWidth - 16 - maxHalfWidth));
    const below = rect.top < 65;
    return {
      text,
      x,
      y: below ? rect.bottom + 8 : rect.top - 6,
      below,
    };
  };

  const showTooltip = (text: string, element: HTMLElement) => {
    clearLongPress();
    if (tooltipDismissTimerRef.current) {
      clearTimeout(tooltipDismissTimerRef.current);
    }
    setTouchTooltip(calculateTooltipPosition(text, element));
    // Auto-dismiss after 2.5s
    tooltipDismissTimerRef.current = setTimeout(() => {
      setTouchTooltip(prev => (prev?.text === text ? null : prev));
      tooltipDismissTimerRef.current = null;
    }, 2500);
  };

  const handleTouchStart = (text: string, e: React.TouchEvent | React.MouseEvent) => {
    if (!('touches' in e) && isTouchActiveRef.current) {
      return;
    }
    if ('touches' in e) {
      isTouchActiveRef.current = true;
      const touch = e.touches[0];
      touchStartPosRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    } else {
      touchStartPosRef.current = null;
    }

    clearLongPress();
    longPressTriggeredRef.current = false;
    const targetElement = e.currentTarget as HTMLElement;
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      if (tooltipDismissTimerRef.current) {
        clearTimeout(tooltipDismissTimerRef.current);
      }
      setTouchTooltip(calculateTooltipPosition(text, targetElement));
      // Auto-dismiss after 2.5s
      tooltipDismissTimerRef.current = setTimeout(() => {
        setTouchTooltip(prev => (prev?.text === text ? null : prev));
        tooltipDismissTimerRef.current = null;
      }, 2500);
    }, 450);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!longPressTimerRef.current || !touchStartPosRef.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartPosRef.current.x;
    const dy = touch.clientY - touchStartPosRef.current.y;
    if (Math.hypot(dx, dy) > 10) {
      clearLongPress();
    }
  };

  const handleTouchEnd = () => {
    clearLongPress();
    setTimeout(() => {
      isTouchActiveRef.current = false;
    }, 400);
  };

  const handleRemoveAllDownloads = async () => {
    setIsRemovingAll(true);
    try {
      await tileWorkerManager.removeAllDownloads();
      setDownloadStatuses(new Map());
      setStoredJson('cached_download_statuses', {});
      let leftovers: LeftoverStorageItem[] = [];
      try {
        leftovers = await findUnrecognizedStorage();
      } catch (scanErr) {
        console.warn('Failed to scan for leftover storage:', scanErr);
      }
      setShowRemoveAllDialog(false);
      if (leftovers.length > 0) {
        setLeftoverItems(leftovers);
        setShowLeftoverDialog(true);
      }
    } catch (err) {
      console.error('Failed to remove all downloads:', err);
      alert('Failed to remove all downloads: ' + (err instanceof Error ? err.message : String(err)));
      setShowRemoveAllDialog(false);
    } finally {
      setIsRemovingAll(false);
    }
  };

  const handleKeepLeftovers = () => {
    setShowLeftoverDialog(false);
    setLeftoverItems([]);
  };

  const handleDeleteLeftovers = async () => {
    setIsRemovingLeftovers(true);
    try {
      await deleteUnrecognizedStorage(leftoverItems);
      setShowLeftoverDialog(false);
      setLeftoverItems([]);
    } catch (err) {
      console.error('Failed to delete leftover storage:', err);
      alert('Failed to delete leftover data: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsRemovingLeftovers(false);
    }
  };

  const handleMapClick = (mapId: string, viewMode = false) => {
    const browserOffline = typeof navigator !== 'undefined' && !navigator.onLine && !reachedServerRef.current;
    const currentlyOffline = isOffline || browserOffline;
    if (currentlyOffline) {
      const status = downloadStatuses.get(mapId);
      if (!status || !status.isComplete) {
        setShowOfflineInterstitial(true);
        return;
      }
    }
    // Offline still opens as editor intent (no ?mode=view) so coming back
    // online restores edit mode. The map editor forces view-only while offline.
    navigate(viewMode ? `/map/${mapId}?mode=view` : `/map/${mapId}`);
  };

  const fetchDownloadedMapStatuses = async (mapList?: { id: string }[]) => {
    try {
      const mapIds = mapList ? mapList.map(m => m.id) : (maps.length > 0 ? maps.map(m => m.id) : undefined);
      const statusMap = await getMapDownloadStatuses(mapIds);

      // Immediately reflect any active or in-flight downloads from the worker manager
      const targetIds = mapList ? mapList.map(m => m.id) : maps.map(m => m.id);
      targetIds.forEach(id => {
        const activeStatus = tileWorkerManager.getStatus(id);
        if (!activeStatus) return;
        // A finished extract beats a worker left behind by a frozen page.
        if (statusMap.get(id)?.isComplete && !activeStatus.isRemoving) return;
        const badge = landingStatusFromWorker(activeStatus);
        if (badge) statusMap.set(id, badge);
      });

      setDownloadStatuses(statusMap);
      const obj: Record<string, MapDownloadStatus> = {};
      statusMap.forEach((v, k) => { obj[k] = v; });
      setStoredJson('cached_download_statuses', obj);
      statusMap.forEach((status, id) => {
        if (status.isPartial && !status.isStalled) {
          void tileWorkerManager.resumeIfNeeded(id);
        }
      });
    } catch (err) {
      console.error('Failed to load downloaded map statuses', err);
    }
  };

  const applyCachedMaps = async () => {
    const cachedData = getStoredJson<MapSummary[] | null>('cached_maps', null) || [];
    const merged = await unionCachedMapsWithDownloads(cachedData);
    setMaps(merged);
    fetchDownloadedMapStatuses(merged);
  };

  const fetchLabels = async () => {
    if (!user) return;
    labelsAbortRef.current?.abort();
    const controller = new AbortController();
    labelsAbortRef.current = controller;
    try {
      const res = await apiService.getLabels(controller.signal);
      if (!isMountedRef.current) return;
      setLabels(res.labels);
      setAssignments(res.assignments);
      const settingsMap: Record<string, LabelSortMode> = {};
      res.systemSettings.forEach(s => { settingsMap[s.systemLabelId] = s.sortMode; });
      setSystemSettings(settingsMap);
      const orderMap: Record<string, string[]> = {};
      res.systemOrder.forEach(o => {
        if (!orderMap[o.systemLabelId]) orderMap[o.systemLabelId] = [];
        orderMap[o.systemLabelId].push(o.mapId);
      });
      setSystemOrder(orderMap);
      setStoredJson('cached_user_labels', res.labels);
      setStoredJson('cached_map_label_assignments', res.assignments);
      setStoredJson('cached_system_label_settings', settingsMap);
      setStoredJson('cached_system_label_map_order', orderMap);

      if (res.labels) {
        setActiveLabelId(prev => {
          if (['all', 'owned', 'shared', 'unlabelled', 'offline', 'search'].includes(prev)) {
            return prev;
          }
          if (!res.labels.some(l => l.id === prev)) {
            return 'all';
          }
          return prev;
        });
      }
    } catch (err: any) {
      if (!isMountedRef.current || err?.name === 'AbortError' || /failed to fetch/i.test(String(err?.message || ''))) {
        return;
      }
      console.warn('Failed to fetch labels, using cached values', err);
    }
  };

  useEffect(() => {
    if (user) {
      void fetchLabels();
    }
  }, [user]);

  const fetchMaps = async () => {
    try {
      const data = await apiService.getMaps({ ignoreNavigatorOnline: true });
      if (!isMountedRef.current) return;
      reachedServerRef.current = true;
      setForcedOffline(false);
      setMaps(data);
      setIsOffline(false);
      setStoredJson('cached_maps', data);
      fetchDownloadedMapStatuses(data);
    } catch (error: any) {
      console.error('Failed to fetch maps', error);
      if (error?.message?.includes('Unauthorized')) {
        try {
          await logout();
        } catch {}
      }
      reachedServerRef.current = false;
      setForcedOffline(true);
      setIsOffline(true);
      await applyCachedMaps();
    } finally {
      setLoading(false);
    }
  };

  const fetchMapsRef = useRef(fetchMaps);
  const fetchDownloadedMapStatusesRef = useRef(fetchDownloadedMapStatuses);
  useEffect(() => {
    fetchMapsRef.current = fetchMaps;
    fetchDownloadedMapStatusesRef.current = fetchDownloadedMapStatuses;
  });

  useEffect(() => {
    const root = landingRootRef.current;
    if (!root) return;

    const blockSelect = (event: Event) => {
      if (isProtectedLandingText(event.target, root)) {
        event.preventDefault();
      }
    };

    const clearSelection = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      if (
        isProtectedLandingText(sel.anchorNode, root) ||
        isProtectedLandingText(sel.focusNode, root)
      ) {
        sel.removeAllRanges();
      }
    };

    root.addEventListener('selectstart', blockSelect);
    root.addEventListener('contextmenu', blockSelect);
    document.addEventListener('selectionchange', clearSelection);

    return () => {
      root.removeEventListener('selectstart', blockSelect);
      root.removeEventListener('contextmenu', blockSelect);
      document.removeEventListener('selectionchange', clearSelection);
    };
  }, []);

  useEffect(() => {
    fetchMaps();

    const handleOnline = () => {
      setForcedOffline(false);
      setIsOffline(false);
      fetchMapsRef.current();
    };
    const handleOffline = () => {
      reachedServerRef.current = false;
      setForcedOffline(true);
      setIsOffline(true);
    };

    const VISIBILITY_STATUS_DEBOUNCE_MS = 500;
    let visibilityTimer: ReturnType<typeof setTimeout> | null = null;
    const handleVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (visibilityTimer) clearTimeout(visibilityTimer);
      visibilityTimer = setTimeout(() => {
        visibilityTimer = null;
        fetchDownloadedMapStatusesRef.current();
      }, VISIBILITY_STATUS_DEBOUNCE_MS);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisible);

    const unsubscribe = tileWorkerManager.subscribe((state) => {
      setDownloadStatuses((prev) => {
        const newStatus = landingStatusFromWorker(state);

        const current = prev.get(state.mapId);
        if (!newStatus && !current) return prev;
        if (current && newStatus && current.isComplete === newStatus.isComplete && current.isPartial === newStatus.isPartial && !!current.isStalled === !!newStatus.isStalled) {
          return prev;
        }

        const next = new Map(prev);
        if (newStatus) {
          next.set(state.mapId, newStatus);
        } else {
          next.delete(state.mapId);
        }
        const obj: Record<string, MapDownloadStatus> = {};
        next.forEach((v, k) => { obj[k] = v; });
        setStoredJson('cached_download_statuses', obj);
        return next;
      });
    });

    const handleDismissTooltip = () => {
      setTouchTooltip(null);
      clearLongPress();
    };

    window.addEventListener('scroll', handleDismissTooltip, { passive: true });

    return () => {
      if (visibilityTimer) clearTimeout(visibilityTimer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisible);
      window.removeEventListener('scroll', handleDismissTooltip);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setForcedOffline(true);
      setIsOffline(true);
      void applyCachedMaps();
    }
  }, [user]);


  const handleDelete = async (id: string) => {
    if (isOffline) {
      alert('Cannot modify maps while offline.');
      return;
    }
    
    const map = maps.find(m => m.id === id);
    if (!map) return;

    try {
      if (map.ownerId === user?.id) {
        await apiService.deleteMap(id);
      } else {
        await apiService.removeShare(id, user!.id);
      }
      const updatedMaps = maps.filter(m => m.id !== id);
      setMaps(updatedMaps);
      setStoredJson('cached_maps', updatedMaps);
    } catch (error) {
      console.error('Failed to perform action on map', error);
      alert('Failed to perform action on map');
    } finally {
      setDeleteConfirm(null);
    }
  };

  const handleCreateMap = () => {
    if (isOffline) {
      alert('Cannot create maps while offline.');
      return;
    }
    navigate('/map/new');
  };

  const activeSortMode: LabelSortMode = useMemo(() => {
    if (activeLabelId === 'search') {
      const mode = systemSettings['search'] || 'last_accessed';
      return mode === 'custom' ? 'last_accessed' : mode;
    }
    if (['all', 'owned', 'shared', 'unlabelled', 'offline'].includes(activeLabelId)) {
      return systemSettings[activeLabelId] || 'last_accessed';
    }
    const userLabel = labels.find(l => l.id === activeLabelId);
    return userLabel?.sortMode || 'last_accessed';
  }, [activeLabelId, systemSettings, labels]);

  const labelCounts = useMemo(() => {
    const labeledMapIds = new Set(assignments.map(a => a.mapId));
    const counts: Record<string, number> = {
      all: maps.length,
      owned: maps.filter(m => m.ownerId === user?.id).length,
      shared: maps.filter(m => m.ownerId !== user?.id).length,
      unlabelled: maps.filter(m => !labeledMapIds.has(m.id)).length,
      offline: maps.filter(m => downloadStatuses.get(m.id)?.isComplete).length,
    };
    for (const l of labels) {
      counts[l.id] = assignments.filter(a => a.labelId === l.id).length;
    }
    return counts;
  }, [maps, user, downloadStatuses, labels, assignments]);

  const filteredMaps = useMemo(() => {
    let list = maps;
    if (activeLabelId === 'search') {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        list = list.filter(m => m.name.toLowerCase().includes(q) || (m.ownerName || '').toLowerCase().includes(q));
      }
    } else if (activeLabelId === 'owned') {
      list = list.filter(m => m.ownerId === user?.id);
    } else if (activeLabelId === 'shared') {
      list = list.filter(m => m.ownerId !== user?.id);
    } else if (activeLabelId === 'unlabelled') {
      const labeledMapIds = new Set(assignments.map(a => a.mapId));
      list = list.filter(m => !labeledMapIds.has(m.id));
    } else if (activeLabelId === 'offline') {
      list = list.filter(m => downloadStatuses.get(m.id)?.isComplete);
    } else if (activeLabelId !== 'all') {
      const assignedMapIds = new Set(assignments.filter(a => a.labelId === activeLabelId).map(a => a.mapId));
      list = list.filter(m => assignedMapIds.has(m.id));
    }

    const sorted = [...list];
    if (activeSortMode === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (activeSortMode === 'created_at') {
      sorted.sort((a, b) => (b.id || '').localeCompare(a.id || ''));
    } else if (activeSortMode === 'custom') {
      if (['all', 'owned', 'shared', 'unlabelled', 'offline'].includes(activeLabelId)) {
        const order = systemOrder[activeLabelId] || [];
        const orderMap = new Map(order.map((id, idx) => [id, idx]));
        sorted.sort((a, b) => {
          const posA = orderMap.has(a.id) ? orderMap.get(a.id)! : 999999;
          const posB = orderMap.has(b.id) ? orderMap.get(b.id)! : 999999;
          return posA - posB;
        });
      } else {
        const mapPos = new Map<string, number>();
        assignments.filter(a => a.labelId === activeLabelId).forEach(a => mapPos.set(a.mapId, a.position));
        sorted.sort((a, b) => {
          const posA = mapPos.has(a.id) ? mapPos.get(a.id)! : 999999;
          const posB = mapPos.has(b.id) ? mapPos.get(b.id)! : 999999;
          return posA - posB;
        });
      }
    } else {
      // last_accessed (default)
      sorted.sort((a, b) => {
        if (!a.lastAccessedAt && b.lastAccessedAt) return -1;
        if (a.lastAccessedAt && !b.lastAccessedAt) return 1;
        if (a.lastAccessedAt && b.lastAccessedAt) {
          const timeA = parseUtcDateString(a.lastAccessedAt);
          const timeB = parseUtcDateString(b.lastAccessedAt);
          if (timeA !== timeB) {
            return timeB - timeA;
          }
          return b.lastAccessedAt.localeCompare(a.lastAccessedAt);
        }
        return a.name.localeCompare(b.name);
      });
    }

    return sorted;
  }, [maps, activeLabelId, user, downloadStatuses, assignments, searchQuery, activeSortMode, systemOrder]);

  const handleSortModeChange = async (newMode: LabelSortMode) => {
    setShowSortDropdown(false);
    if (activeLabelId === 'search' && newMode === 'custom') {
      return;
    }
    if (newMode === 'custom') {
      let hasOrder = false;
      if (['all', 'owned', 'shared', 'unlabelled', 'offline'].includes(activeLabelId)) {
        hasOrder = Boolean(systemOrder[activeLabelId]?.length);
      } else {
        hasOrder = assignments.some(a => a.labelId === activeLabelId && a.position != null);
      }

      if (!hasOrder) {
        // Seed initial custom order from the current displayed order
        const seedIds = filteredMaps.map(m => m.id);
        if (['all', 'owned', 'shared', 'unlabelled', 'offline'].includes(activeLabelId)) {
          const updated = { ...systemOrder, [activeLabelId]: seedIds };
          setSystemOrder(updated);
          setStoredJson('cached_system_label_map_order', updated);
          if (!isOffline && user) {
            apiService.updateSystemLabelMapOrder(activeLabelId, seedIds).catch(console.error);
          }
        } else {
          const updatedAssignments = assignments.map(a => {
            if (a.labelId === activeLabelId) {
              const idx = seedIds.indexOf(a.mapId);
              return { ...a, position: idx >= 0 ? idx : 999 };
            }
            return a;
          });
          setAssignments(updatedAssignments);
          setStoredJson('cached_map_label_assignments', updatedAssignments);
          if (!isOffline && user) {
            apiService.updateLabelMapOrder(activeLabelId, seedIds).catch(console.error);
          }
        }
      }
    }

    if (['all', 'owned', 'shared', 'unlabelled', 'offline', 'search'].includes(activeLabelId)) {
      const updated = { ...systemSettings, [activeLabelId]: newMode };
      setSystemSettings(updated);
      setStoredJson('cached_system_label_settings', updated);
      if (!isOffline && user) {
        apiService.updateSystemLabelSetting(activeLabelId, newMode).catch(console.error);
      }
    } else {
      setLabels(prev => prev.map(l => l.id === activeLabelId ? { ...l, sortMode: newMode } : l));
      const cached = getStoredJson<UserLabel[]>('cached_user_labels', []);
      setStoredJson('cached_user_labels', cached.map(l => l.id === activeLabelId ? { ...l, sortMode: newMode } : l));
      if (!isOffline && user) {
        apiService.updateLabel(activeLabelId, { sortMode: newMode }).catch(console.error);
      }
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragCancel = () => {
    setActiveDragId(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const currentIds = filteredMaps.map(m => m.id);
    const oldIndex = currentIds.indexOf(String(active.id));
    const newIndex = currentIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const reorderedIds = [...currentIds];
    const [moved] = reorderedIds.splice(oldIndex, 1);
    reorderedIds.splice(newIndex, 0, moved);

    if (['all', 'owned', 'shared', 'unlabelled', 'offline'].includes(activeLabelId)) {
      const updated = { ...systemOrder, [activeLabelId]: reorderedIds };
      setSystemOrder(updated);
      setStoredJson('cached_system_label_map_order', updated);
      if (!isOffline && user) {
        apiService.updateSystemLabelMapOrder(activeLabelId, reorderedIds).catch(console.error);
      }
    } else {
      const idPosMap = new Map(reorderedIds.map((id, idx) => [id, idx]));
      const updatedAssignments = assignments.map(a => {
        if (a.labelId === activeLabelId && idPosMap.has(a.mapId)) {
          return { ...a, position: idPosMap.get(a.mapId)! };
        }
        return a;
      });
      setAssignments(updatedAssignments);
      setStoredJson('cached_map_label_assignments', updatedAssignments);
      if (!isOffline && user) {
        apiService.updateLabelMapOrder(activeLabelId, reorderedIds).catch(console.error);
      }
    }
  };

  const handleToggleLabel = async (labelId: string, assigned: boolean) => {
    if (!labelingMap) return;
    const mapId = labelingMap.map.id;

    let nextAssignments: MapLabelAssignment[];
    if (assigned) {
      nextAssignments = [...assignments.filter(a => !(a.labelId === labelId && a.mapId === mapId)), {
        labelId,
        mapId,
        position: assignments.filter(a => a.labelId === labelId).length
      }];
    } else {
      nextAssignments = assignments.filter(a => !(a.labelId === labelId && a.mapId === mapId));
    }
    setAssignments(nextAssignments);
    setStoredJson('cached_map_label_assignments', nextAssignments);

    if (!isOffline && user) {
      try {
        if (assigned) {
          await apiService.assignMapLabel(labelId, mapId);
        } else {
          await apiService.removeMapLabel(labelId, mapId);
        }
      } catch (err) {
        console.error('Failed to toggle label', err);
      }
    }
  };

  const handleCreateLabel = async (name: string): Promise<UserLabel | null> => {
    if (!name.trim()) return null;
    const tempId = 'label_' + Date.now();
    const tempLabel: UserLabel = {
      id: tempId,
      name: name.trim(),
      sortMode: 'last_accessed',
      position: labels.length
    };
    const updatedLabels = [...labels, tempLabel];
    setLabels(updatedLabels);
    setStoredJson('cached_user_labels', updatedLabels);

    if (!isOffline && user) {
      try {
        const created = await apiService.createLabel(name.trim(), 'last_accessed');
        setLabels(prev => prev.map(l => l.id === tempId ? created : l));
        setActiveLabelId(prev => prev === tempId ? created.id : prev);
        const cached = getStoredJson<UserLabel[]>('cached_user_labels', []);
        setStoredJson('cached_user_labels', cached.map(l => l.id === tempId ? created : l));
        return created;
      } catch (err) {
        console.error('Failed to create label', err);
      }
    }
    return tempLabel;
  };

  const closeEditModal = () => {
    setShowEditLabelModal(false);
    setEditLabelId(null);
    setEditLabelName('');
  };

  const handleDeleteUserLabel = async (labelId: string) => {
    const label = labels.find(l => l.id === labelId);
    if (!label) return;
    if (!confirm(`Are you sure you want to delete label "${label.name}"?`)) return;

    closeEditModal();
    const nextLabels = labels.filter(l => l.id !== labelId);
    const nextAssignments = assignments.filter(a => a.labelId !== labelId);
    setLabels(nextLabels);
    setAssignments(nextAssignments);
    setStoredJson('cached_user_labels', nextLabels);
    setStoredJson('cached_map_label_assignments', nextAssignments);
    if (activeLabelId === labelId) {
      setActiveLabelId('all');
    }

    if (!isOffline && user) {
      try {
        await apiService.deleteLabel(labelId);
      } catch (err) {
        console.error('Failed to delete label', err);
      }
    }
  };

  const handleRenameUserLabel = async (labelId: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const label = labels.find(l => l.id === labelId);
    if (!label) return;
    if (label.name === trimmed) {
      closeEditModal();
      return;
    }

    const isDuplicate = labels.some(l => l.id !== labelId && l.name.toLowerCase() === trimmed.toLowerCase());
    if (isDuplicate) {
      alert('A label with that name already exists');
      return;
    }

    const previousLabels = labels;
    const nextLabels = labels.map(l => l.id === labelId ? { ...l, name: trimmed } : l);
    setLabels(nextLabels);
    setStoredJson('cached_user_labels', nextLabels);
    closeEditModal();

    if (!isOffline && user) {
      try {
        await apiService.updateLabel(labelId, { name: trimmed });
      } catch (err: any) {
        console.error('Failed to rename label', err);
        setLabels(previousLabels);
        setStoredJson('cached_user_labels', previousLabels);
        alert(err.message || 'Failed to rename label');
      }
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never';
    const normalized = dateString.includes(' ') && !dateString.endsWith('Z')
      ? dateString.replace(' ', 'T') + 'Z'
      : dateString;
    return new Date(normalized).toLocaleDateString(undefined, { 
      month: 'short', day: 'numeric', year: 'numeric' 
    });
  };

  const activeLabelTitle = useMemo(() => {
    if (activeLabelId === 'all') return 'All Maps';
    if (activeLabelId === 'owned') return 'Owned by Me';
    if (activeLabelId === 'shared') return 'Shared with Me';
    if (activeLabelId === 'unlabelled') return 'Unlabelled Maps';
    if (activeLabelId === 'offline') return 'Downloaded';
    if (activeLabelId === 'search') return 'Search';
    const found = labels.find(l => l.id === activeLabelId);
    return found ? found.name : 'All Maps';
  }, [activeLabelId, labels]);

  useEffect(() => {
    if (!headingEl || activeLabelId === 'search') {
      setIsSortCollapsed(false);
      setIsTitleOverflowing(false);
      return;
    }

    const checkFit = () => {
      const toolbar = toolbarRef.current;
      const heading = headingEl;
      if (!toolbar || !heading) return;

      const measureSort = measureSortButtonRef.current;
      const fullSortWidth = measureSort ? measureSort.offsetWidth : 120;
      const toolbarWidth = toolbar.clientWidth;
      const toolbarGap = parseFloat(window.getComputedStyle(toolbar).gap) || 4;
      const headingTextWidth = heading.scrollWidth;
      const chevronWidth = 22; // 18px icon + 4px margin
      const hasEditBtn = !['all', 'owned', 'shared', 'unlabelled', 'offline', 'search'].includes(activeLabelId) && !isOffline;
      const editBtn = editBtnRef.current;
      const editWidth = editBtn ? editBtn.offsetWidth + 4 : (hasEditBtn ? 32 : 0);

      const totalNeededWidth = headingTextWidth + chevronWidth + editWidth + toolbarGap + fullSortWidth;
      const isMobile = typeof window !== 'undefined' && window.innerWidth <= 640;
      const shouldCollapse = isMobile && totalNeededWidth > toolbarWidth + 1;

      const currentSortWidth = shouldCollapse ? 32 : fullSortWidth;
      const availableForHeading = toolbarWidth - toolbarGap - currentSortWidth - editWidth - chevronWidth;
      const isOverflowing = headingTextWidth > availableForHeading + 1;

      setIsSortCollapsed(shouldCollapse);
      setIsTitleOverflowing(isOverflowing);
    };

    checkFit();

    let active = true;
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (active) checkFit();
      });
    }

    window.addEventListener('resize', checkFit);

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        active = false;
        window.removeEventListener('resize', checkFit);
      };
    }

    const observer = new ResizeObserver(checkFit);
    if (toolbarRef.current) {
      observer.observe(toolbarRef.current);
    }
    observer.observe(headingEl);
    return () => {
      active = false;
      window.removeEventListener('resize', checkFit);
      observer.disconnect();
    };
  }, [headingEl, activeLabelTitle, activeLabelId, activeSortMode, isOffline]);

  return (
    <div
      ref={landingRootRef}
      className="landing-page-root"
      style={{
        minHeight: '100vh',
        background: 'var(--bg-color)',
        paddingBottom: '4rem',
        ...NO_TEXT_SELECT_STYLE,
      }}
    >
      <header className="landing-header">
        <h1 className="landing-header-title" style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0, fontWeight: 'bold', color: theme === 'dark' ? '#cbd5e1' : 'white', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}>
          <MapIcon size={24} color={theme === 'dark' ? '#cbd5e1' : 'white'} /> OurMaps
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {!loading && !user && (
            <button 
              onClick={() => navigate('/login')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                height: '34px',
                padding: '0 12px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                background: 'rgba(255, 255, 255, 0.2)',
                color: 'white',
                border: '1px solid rgba(255, 255, 255, 0.35)',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'}
            >
              <LogIn size={16} /> Sign In
            </button>
          )}
          {!loading && Boolean(user) && !isOffline && (
            <button 
              onClick={handleCreateMap}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                height: '34px',
                padding: '0 12px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                background: 'rgba(255, 255, 255, 0.2)',
                color: 'white',
                border: '1px solid rgba(255, 255, 255, 0.35)',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'}
            >
              New Map
            </button>
          )}
          {!loading && Boolean(user) && isOffline && (
            <button 
              onClick={() => fetchMaps()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                height: '34px',
                padding: '0 12px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                background: 'rgba(255, 255, 255, 0.2)',
                color: 'white',
                border: '1px solid rgba(255, 255, 255, 0.35)',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'}
            >
              <CloudSync size={16} /> Retry Sync
            </button>
          )}
          <div style={{ position: 'relative' }}>
            <div 
              onClick={() => setShowUserMenu(!showUserMenu)}
              style={{ 
                width: '36px', 
                height: '36px', 
                borderRadius: '50%', 
                cursor: 'pointer', 
                overflow: 'hidden', 
                border: '2px solid rgba(255,255,255,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(255,255,255,0.2)',
                fontWeight: 'bold',
                color: 'white',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitTouchCallout: 'none'
              }}
              title={user?.name}
            >
              {user?.picture ? (
                <img src={user.picture} alt={user.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span>{user?.name?.[0]?.toUpperCase() || 'U'}</span>
              )}
            </div>

            {showUserMenu && (
              <>
                <div 
                  style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }} 
                  onClick={() => setShowUserMenu(false)} 
                />
                <div style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  width: '200px',
                  background: 'var(--surface-color)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-lg)',
                  zIndex: 1001,
                  overflow: 'hidden',
                  padding: '4px 0'
                }}>
                  {/* Light/Dark mode toggle */}
                  <div
                    onClick={() => {
                      toggleTheme();
                    }}
                    style={{
                      padding: '10px 16px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      borderBottom: '1px solid var(--border-color)'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {theme === 'dark' ? <Moon size={16} color="#3b82f6" /> : <Sun size={16} color="#64748b" />}
                      <span>Dark Mode</span>
                    </div>
                    <div
                      style={{
                        width: '34px',
                        height: '18px',
                        borderRadius: '10px',
                        background: theme === 'dark' ? '#3b82f6' : '#e2e8f0',
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
                          left: theme === 'dark' ? '18px' : '2px',
                          transition: 'left 0.2s ease',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                        }}
                      />
                    </div>
                  </div>

                  {/* Remove All Downloads */}
                  <div
                    onClick={() => {
                      setShowUserMenu(false);
                      setShowRemoveAllDialog(true);
                    }}
                    style={{
                      padding: '10px 16px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '0.85rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      borderBottom: '1px solid var(--border-color)'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <Trash2 size={16} color="var(--text-secondary)" />
                    <span>Remove All Downloads</span>
                  </div>

                  {/* Sign Out or Sign In */}
                  {user ? (
                    <div
                      onClick={() => {
                        setShowUserMenu(false);
                        setShowSignOutDialog(true);
                      }}
                      style={{
                        padding: '10px 16px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '0.85rem',
                        fontWeight: '600',
                        color: 'var(--error-color)'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <LogOut size={16} />
                      <span>Sign Out</span>
                    </div>
                  ) : (
                    <div
                      onClick={() => {
                        setShowUserMenu(false);
                        navigate('/login');
                      }}
                      style={{
                        padding: '10px 16px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '0.85rem',
                        fontWeight: '600',
                        color: 'var(--primary-color)'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-color)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <LogIn size={16} />
                      <span>Sign In</span>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="landing-container">
        {/* Landing Toolbar: Label Selection & Sort Controls */}
        {!loading && (
          <div
            ref={toolbarRef}
            className="landing-toolbar"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '4px',
              padding: '0 4px 0.75rem 4px',
              borderBottom: '2px solid var(--primary-color)',
              marginBottom: '1.25rem',
              flexWrap: 'nowrap',
            }}
          >
            {/* Left side: Heading / Label Selection (or Search input) & delete label button */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', minWidth: 0, flex: '1 1 auto' }}>
              {activeLabelId === 'search' ? (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    background: 'var(--surface-color)',
                    border: '1.5px solid var(--primary-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: '0 10px 0 12px',
                    height: '44px',
                    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.08)',
                    position: 'relative',
                    minWidth: 0,
                    width: '100%',
                    maxWidth: '380px',
                    boxSizing: 'border-box',
                    flex: '1 1 auto',
                  }}
                >
                  <Search size={18} color="var(--primary-color)" style={{ flexShrink: 0, marginRight: '6px' }} />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search all maps..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-primary)',
                      fontSize: '1.15rem',
                      fontWeight: 700,
                      outline: 'none',
                      width: '100%',
                      minWidth: 0,
                      padding: 0,
                      fontFamily: 'inherit',
                    }}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        searchInputRef.current?.focus();
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-secondary)',
                        padding: '2px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        flexShrink: 0,
                      }}
                      title="Clear search"
                      aria-label="Clear search"
                    >
                      <X size={16} />
                    </button>
                  )}
                  <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', marginLeft: '4px', flexShrink: 0 }}>
                    <select
                      value="search"
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === '__new__') {
                          setNewLabelName('');
                          setShowCreateLabelModal(true);
                          return;
                        }
                        if (val !== 'search') {
                          setSearchQuery('');
                        }
                        setActiveLabelId(val);
                      }}
                      title="Select label"
                      aria-label="Select label"
                      style={{
                        position: 'absolute',
                        inset: 0,
                        opacity: 0,
                        cursor: 'pointer',
                        width: '100%',
                        height: '100%',
                        zIndex: 2,
                      }}
                    >
                      <option value="all">All Maps ({labelCounts.all || 0})</option>
                      {Boolean(user) && (
                        <>
                          <option value="owned">Owned by Me ({labelCounts.owned || 0})</option>
                          <option value="shared">Shared with Me ({labelCounts.shared || 0})</option>
                        </>
                      )}
                      <option value="unlabelled">Unlabelled Maps ({labelCounts.unlabelled || 0})</option>
                      <option value="offline">Downloaded ({labelCounts.offline || 0})</option>
                      <option value="search">Search</option>
                      {Boolean(user) && labels.map(l => (
                        <option key={l.id} value={l.id}>
                          {l.name} ({labelCounts[l.id] || 0})
                        </option>
                      ))}
                      {Boolean(user) && !isOffline && (
                        <option value="__new__">+ New Label...</option>
                      )}
                    </select>
                    <ChevronDown size={18} color="var(--primary-color)" style={{ pointerEvents: 'none' }} />
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    position: 'relative',
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '4px 0',
                    cursor: 'pointer',
                    background: 'transparent',
                    minWidth: 0,
                    maxWidth: '100%',
                  }}
                >
                  <h2
                    ref={setHeadingRef}
                    className={`landing-label-heading ${isTitleOverflowing ? 'is-overflowing' : ''}`}
                  >
                    {activeLabelTitle}
                  </h2>
                  <ChevronDown
                    size={18}
                    color="var(--text-secondary)"
                    style={{
                      pointerEvents: 'none',
                      flexShrink: 0,
                      marginLeft: isTitleOverflowing ? '-18px' : '4px',
                      position: 'relative',
                      zIndex: 1,
                    }}
                  />
                  <select
                    value={activeLabelId}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === '__new__') {
                        setNewLabelName('');
                        setShowCreateLabelModal(true);
                        return;
                      }
                      if (val !== 'search') {
                        setSearchQuery('');
                      }
                      setActiveLabelId(val);
                      if (val === 'search') {
                        setTimeout(() => searchInputRef.current?.focus(), 50);
                      }
                    }}
                    aria-label="Filter maps by label"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      opacity: 0,
                      cursor: 'pointer',
                      zIndex: 2,
                    }}
                  >
                    <option value="all">All Maps ({labelCounts.all || 0})</option>
                    {Boolean(user) && (
                      <>
                        <option value="owned">Owned by Me ({labelCounts.owned || 0})</option>
                        <option value="shared">Shared with Me ({labelCounts.shared || 0})</option>
                      </>
                    )}
                    <option value="unlabelled">Unlabelled Maps ({labelCounts.unlabelled || 0})</option>
                    <option value="offline">Downloaded ({labelCounts.offline || 0})</option>
                    <option value="search">Search</option>
                    {Boolean(user) && labels.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({labelCounts[l.id] || 0})
                      </option>
                    ))}
                    {Boolean(user) && !isOffline && (
                      <option value="__new__">+ New Label...</option>
                    )}
                  </select>
                </div>
              )}

              {/* If user-defined label: edit label option */}
              {!['all', 'owned', 'shared', 'unlabelled', 'offline', 'search'].includes(activeLabelId) && !isOffline && (
                <button
                  ref={editBtnRef}
                  type="button"
                  onClick={() => {
                    const label = labels.find(l => l.id === activeLabelId);
                    if (label) {
                      setEditLabelId(label.id);
                      setEditLabelName(label.name);
                      setShowEditLabelModal(true);
                    }
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-secondary)',
                    padding: '6px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    flexShrink: 0,
                  }}
                  title="Edit this label"
                  aria-label="Edit this label"
                >
                  <Pencil size={16} />
                </button>
              )}
            </div>

            {/* Right side: Sort Selector Dropdown */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button
                type="button"
                className={`landing-sort-button ${isSortCollapsed ? 'sort-collapsed' : ''}`}
                onClick={() => setShowSortDropdown(!showSortDropdown)}
                aria-label="Change sort order"
                title={`Sort: ${activeSortMode === 'last_accessed' ? 'Last Accessed' : activeSortMode === 'custom' ? 'Custom' : activeSortMode === 'name' ? 'Alphabetical' : 'Date Created'}`}
              >
                <ArrowUpDown size={13} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
                <span className="landing-sort-text">
                  {activeSortMode === 'last_accessed'
                    ? 'Last Accessed'
                    : activeSortMode === 'custom'
                    ? 'Custom'
                    : activeSortMode === 'name'
                    ? 'Alphabetical'
                    : 'Date Created'}
                </span>
              </button>

              {showSortDropdown && (
                <>
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 100 }}
                    onClick={() => setShowSortDropdown(false)}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 'calc(100% + 4px)',
                      zIndex: 101,
                      minWidth: '160px',
                      background: 'var(--surface-color)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-sm)',
                      boxShadow: 'var(--shadow-md)',
                      padding: '4px',
                    }}
                  >
                  {[
                    { id: 'last_accessed' as LabelSortMode, label: 'Last Accessed' },
                    ...(activeLabelId !== 'search' ? [{ id: 'custom' as LabelSortMode, label: 'Custom' }] : []),
                    { id: 'name' as LabelSortMode, label: 'Alphabetical' },
                    { id: 'created_at' as LabelSortMode, label: 'Date Created' },
                  ].map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSortModeChange(opt.id)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        gap: '8px',
                        borderRadius: 'var(--radius-sm)',
                        border: 'none',
                        background: activeSortMode === opt.id ? 'var(--bg-color)' : 'transparent',
                        color: activeSortMode === opt.id ? 'var(--primary-color)' : 'var(--text-primary)',
                        fontSize: '0.95rem',
                        fontWeight: activeSortMode === opt.id ? 700 : 500,
                        cursor: 'pointer',
                        textAlign: 'left',
                        whiteSpace: 'nowrap',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-color)')}
                      onMouseLeave={e => {
                        if (activeSortMode !== opt.id) e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <span>{opt.label}</span>
                      {activeSortMode === opt.id && <Check size={16} style={{ flexShrink: 0 }} />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Hidden off-screen button to measure full sort button width without .sort-collapsed */}
          <button
            ref={measureSortButtonRef}
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="landing-sort-button"
            style={{
              position: 'absolute',
              visibility: 'hidden',
              pointerEvents: 'none',
              top: -9999,
              left: -9999,
              whiteSpace: 'nowrap',
            }}
          >
            <ArrowUpDown size={13} style={{ flexShrink: 0 }} />
            <span className="landing-sort-text">
              {activeSortMode === 'last_accessed'
                ? 'Last Accessed'
                : activeSortMode === 'custom'
                ? 'Custom'
                : activeSortMode === 'name'
                ? 'Alphabetical'
                : 'Date Created'}
            </span>
          </button>
        </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '6rem 0', color: 'var(--text-secondary)', userSelect: 'none', WebkitUserSelect: 'none' }}>
            <Loader2 className="animate-spin" size={36} style={{ margin: '0 auto 1rem auto', color: 'var(--primary-color)' }} />
            <p style={{ margin: 0, fontSize: '0.95rem' }}>Loading your maps...</p>
          </div>
        ) : maps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '5rem 1.5rem', background: 'var(--surface-color)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-sm)', border: '1px solid var(--border-color)' }}>
            <div style={{ background: 'var(--bg-color)', width: '70px', height: '70px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem auto' }}>
              <MapIcon size={34} color="var(--primary-color)" />
            </div>
            <h3 style={{ color: 'var(--text-primary)', fontSize: '1.3rem', marginBottom: '0.5rem' }}>No maps yet</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', maxWidth: '400px', margin: '0 auto 2rem auto', fontSize: '0.95rem' }}>Start creating your personal map collections or import KML files to get started!</p>
            <button 
              onClick={handleCreateMap}
              className="btn-primary"
              disabled={isOffline}
            >
              Create Your First Map
            </button>
          </div>
        ) : filteredMaps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', background: 'var(--surface-color)', borderRadius: 'var(--radius-lg)', color: 'var(--text-secondary)', border: '1px dashed var(--border-color)', fontSize: '0.95rem' }}>
            {activeLabelId === 'search' ? (
              searchQuery.trim() ? (
                `No maps found matching "${searchQuery}"`
              ) : (
                'No maps found.'
              )
            ) : activeLabelId === 'shared' ? (
              'No maps have been shared with you yet.'
            ) : activeLabelId === 'owned' ? (
              'You haven\'t created any maps yet.'
            ) : activeLabelId === 'unlabelled' ? (
              'All maps currently have labels assigned.'
            ) : activeLabelId === 'offline' ? (
              'No maps downloaded for offline use.'
            ) : (
              'No maps with this label yet. Click the label icon on any map card to add it!'
            )}
          </div>
        ) : activeSortMode === 'custom' ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext items={filteredMaps.map(m => m.id)} strategy={rectSortingStrategy}>
              <div className="landing-maps-grid">
                {filteredMaps.map(map => (
                  <LandingMapCard
                    key={map.id}
                    map={map}
                    isCustomSort={true}
                    downloadStatus={downloadStatuses.get(map.id)}
                    currentUserId={user?.id}
                    isOffline={isOffline}
                    onMapClick={handleMapClick}
                    onOpenLabels={(m, e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setLabelingMap({ map: m, anchorRect: rect });
                    }}
                    onDeleteClick={id => setDeleteConfirm(id)}
                    handleTouchStart={handleTouchStart}
                    handleTouchMove={handleTouchMove}
                    handleTouchEnd={handleTouchEnd}
                    showTooltip={showTooltip}
                    longPressTriggeredRef={longPressTriggeredRef}
                    formatDate={formatDate}
                  />
                ))}
              </div>
            </SortableContext>
            {typeof document !== 'undefined' && createPortal(
              <DragOverlay zIndex={1000}>
                {activeDragMap ? (
                  <LandingMapCard
                    map={activeDragMap}
                    isCustomSort={true}
                    downloadStatus={downloadStatuses.get(activeDragMap.id)}
                    currentUserId={user?.id}
                    isOffline={isOffline}
                    formatDate={formatDate}
                    isOverlay={true}
                  />
                ) : null}
              </DragOverlay>,
              document.body
            )}
          </DndContext>
        ) : (
          <div className="landing-maps-grid">
            {filteredMaps.map(map => (
              <LandingMapCard
                key={map.id}
                map={map}
                isCustomSort={false}
                downloadStatus={downloadStatuses.get(map.id)}
                currentUserId={user?.id}
                isOffline={isOffline}
                onMapClick={handleMapClick}
                onOpenLabels={(m, e) => {
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setLabelingMap({ map: m, anchorRect: rect });
                }}
                onDeleteClick={id => setDeleteConfirm(id)}
                handleTouchStart={handleTouchStart}
                handleTouchMove={handleTouchMove}
                handleTouchEnd={handleTouchEnd}
                showTooltip={showTooltip}
                longPressTriggeredRef={longPressTriggeredRef}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}
      </main>

      {touchTooltip && (
        <div 
          className={`touch-tooltip-bubble${touchTooltip.below ? ' is-below' : ''}`}
          style={{
            left: `${touchTooltip.x}px`,
            top: `${touchTooltip.y}px`
          }}
        >
          {touchTooltip.text}
        </div>
      )}

      {deleteConfirm && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, backdropFilter: 'blur(4px)' }} onClick={() => setDeleteConfirm(null)}>
          <div style={{ background: 'var(--surface-color)', padding: '2.5rem', borderRadius: 'var(--radius-lg)', maxWidth: '450px', width: '90%', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>
              {maps.find(m => m.id === deleteConfirm)?.ownerId === user?.id ? 'Delete Map?' : 'Leave Map?'}
            </h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '2rem' }}>
              {maps.find(m => m.id === deleteConfirm)?.ownerId === user?.id 
                ? <>Are you sure you want to delete <strong>{maps.find(m => m.id === deleteConfirm)?.name}</strong>? This action is permanent and cannot be reversed. Collaborators will lose access to the map.  Consider giving someone else Ownership instead.</>
                : <>Are you sure you want to leave <strong>{maps.find(m => m.id === deleteConfirm)?.name}</strong>? You will be removed as a collaborator and it will no longer appear in your list of maps.</>
              }
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'transparent', fontWeight: '600', color: 'var(--text-secondary)' }}>Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--error-color)', color: 'white', fontWeight: '600' }}>
                {maps.find(m => m.id === deleteConfirm)?.ownerId === user?.id ? 'Delete Map' : 'Leave Map'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showOfflineInterstitial && (
        <div 
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, backdropFilter: 'blur(4px)' }} 
          onClick={() => setShowOfflineInterstitial(false)}
        >
          <div 
            style={{ background: 'var(--surface-color)', padding: '2.5rem', borderRadius: 'var(--radius-lg)', maxWidth: '400px', width: '90%', boxShadow: 'var(--shadow-lg)', textAlign: 'center' }} 
            onClick={e => e.stopPropagation()}
          >
            <div style={{ background: 'rgba(239, 68, 68, 0.1)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
              <WifiOff size={32} color="var(--error-color)" />
            </div>
            <h3 style={{ marginTop: 0, fontSize: '1.4rem', fontWeight: '800', color: 'var(--text-primary)' }}>Offline Mode</h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: '1.5', margin: '1rem 0 2rem 0' }}>
              This map is not available in offline mode
            </p>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button 
                onClick={() => setShowOfflineInterstitial(false)} 
                style={{ width: '100%', padding: '12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--primary-color)', color: 'white', fontWeight: '600', cursor: 'pointer' }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {showSignOutDialog && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, backdropFilter: 'blur(4px)' }} onClick={() => setShowSignOutDialog(false)}>
          <div style={{ background: 'var(--surface-color)', padding: '2.5rem', borderRadius: 'var(--radius-lg)', maxWidth: '400px', width: '90%', boxShadow: 'var(--shadow-lg)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ background: 'var(--bg-color)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
              <LogOut size={32} color="var(--primary-color)" />
            </div>
            <h3 style={{ marginTop: 0, fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>Sign Out</h3>
            <p style={{ color: 'var(--text-secondary)', lineHeight: '1.5', margin: '1rem 0 2rem 0' }}>
              Sign out of this browser, or end every signed-in session on all devices.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button onClick={() => setShowSignOutDialog(false)} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'transparent', fontWeight: '600', color: 'var(--text-secondary)' }}>Cancel</button>
                <button onClick={() => { setShowSignOutDialog(false); logout(); }} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--primary-color)', color: 'white', fontWeight: '600' }}>Sign Out</button>
              </div>
              <button onClick={() => { setShowSignOutDialog(false); logoutEverywhere(); }} style={{ padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'transparent', fontWeight: '600', color: 'var(--text-secondary)' }}>Sign out everywhere</button>
            </div>
          </div>
        </div>
      )}

      {showRemoveAllDialog && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            backdropFilter: 'blur(4px)'
          }}
          onClick={() => !isRemovingAll && setShowRemoveAllDialog(false)}
        >
          <div style={{ background: 'var(--surface-color)', padding: '2.5rem', borderRadius: 'var(--radius-lg)', maxWidth: '420px', width: '90%', boxShadow: 'var(--shadow-lg)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            {isRemovingAll ? (
              <>
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
                  <Upload size={32} className="animated-download-icon" color="var(--error-color)" />
                </div>
                <h3 style={{ marginTop: 0, fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>Removing Downloads...</h3>
                <p style={{ color: 'var(--text-secondary)', lineHeight: '1.5', margin: '1rem 0 0 0' }}>
                  Removing all offline map data and map tiles from this device. Please wait...
                </p>
              </>
            ) : (
              <>
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
                  <Trash2 size={32} color="var(--error-color)" />
                </div>
                <h3 style={{ marginTop: 0, fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>Remove All Downloads?</h3>
                <p style={{ color: 'var(--text-secondary)', lineHeight: '1.5', margin: '1rem 0 2rem 0' }}>
                  This will remove all offline map data and map tiles stored on this device.
                </p>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button onClick={() => setShowRemoveAllDialog(false)} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'transparent', fontWeight: '600', color: 'var(--text-secondary)', cursor: 'pointer' }}>Cancel</button>
                  <button onClick={handleRemoveAllDownloads} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--error-color)', color: 'white', fontWeight: '600', cursor: 'pointer' }}>Remove All</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showLeftoverDialog && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            backdropFilter: 'blur(4px)'
          }}
          onClick={() => !isRemovingLeftovers && handleKeepLeftovers()}
        >
          <div style={{ background: 'var(--surface-color)', padding: '2.5rem', borderRadius: 'var(--radius-lg)', maxWidth: '460px', width: '90%', boxShadow: 'var(--shadow-lg)', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            {isRemovingLeftovers ? (
              <>
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
                  <Upload size={32} className="animated-download-icon" color="var(--error-color)" />
                </div>
                <h3 style={{ marginTop: 0, fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>Removing Leftovers...</h3>
                <p style={{ color: 'var(--text-secondary)', lineHeight: '1.5', margin: '1rem 0 0 0' }}>
                  Deleting leftover data from older versions of Our Maps. Please wait...
                </p>
              </>
            ) : (
              <>
                <div style={{ background: 'rgba(239, 68, 68, 0.1)', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
                  <Trash2 size={32} color="var(--error-color)" />
                </div>
                <h3 style={{ marginTop: 0, fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-primary)' }}>Leftover data found</h3>
                <p style={{ color: 'var(--text-secondary)', lineHeight: '1.5', margin: '1rem 0' }}>
                  This browser still has data from an older version of Our Maps that the current app no longer uses. Delete it as well?
                </p>
                <ul style={{ textAlign: 'left', color: 'var(--text-primary)', lineHeight: 1.5, margin: '0 0 2rem 0', padding: '0.75rem 0.75rem 0.75rem 1.75rem', maxHeight: '180px', overflowY: 'auto', background: 'var(--bg-color)', borderRadius: 'var(--radius-sm)' }}>
                  {leftoverItems.map((item) => (
                    <li key={item.id} style={{ marginBottom: '0.35rem' }}>{item.detail}</li>
                  ))}
                </ul>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <button onClick={handleKeepLeftovers} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'transparent', fontWeight: '600', color: 'var(--text-secondary)', cursor: 'pointer' }}>Keep</button>
                  <button onClick={handleDeleteLeftovers} style={{ flex: 1, padding: '12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--error-color)', color: 'white', fontWeight: '600', cursor: 'pointer' }}>Delete leftovers</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {labelingMap && (
        <MapLabelDialog
          isOpen={true}
          mapId={labelingMap.map.id}
          mapName={labelingMap.map.name}
          anchorRect={labelingMap.anchorRect}
          labels={labels}
          assignments={assignments}
          onClose={() => setLabelingMap(null)}
          onToggleLabel={handleToggleLabel}
        />
      )}

      {showCreateLabelModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            backdropFilter: 'blur(4px)',
          }}
          onClick={() => setShowCreateLabelModal(false)}
        >
          <div
            style={{
              background: 'var(--surface-color)',
              padding: '2rem',
              borderRadius: 'var(--radius-lg)',
              maxWidth: '400px',
              width: '90%',
              boxShadow: 'var(--shadow-lg)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Create New Label
            </h3>
            <div style={{ margin: '1.25rem 0 1.5rem 0' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Label Name
              </label>
              <input
                type="text"
                autoFocus
                placeholder="e.g. Road Trips, Wishlist"
                value={newLabelName}
                onChange={e => setNewLabelName(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && newLabelName.trim()) {
                    e.preventDefault();
                    const name = newLabelName.trim();
                    setShowCreateLabelModal(false);
                    const created = await handleCreateLabel(name);
                    if (created) {
                      setActiveLabelId(created.id);
                    }
                  }
                }}
                className="input-field"
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                type="button"
                onClick={() => setShowCreateLabelModal(false)}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-color)',
                  background: 'transparent',
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!newLabelName.trim()}
                onClick={async () => {
                  if (!newLabelName.trim()) return;
                  const name = newLabelName.trim();
                  setShowCreateLabelModal(false);
                  const created = await handleCreateLabel(name);
                  if (created) {
                    setActiveLabelId(created.id);
                  }
                }}
                className="btn-primary"
                style={{ flex: 1, padding: '10px', opacity: !newLabelName.trim() ? 0.5 : 1 }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {showEditLabelModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            backdropFilter: 'blur(4px)',
          }}
          onClick={closeEditModal}
        >
          <div
            style={{
              background: 'var(--surface-color)',
              padding: '2rem',
              borderRadius: 'var(--radius-lg)',
              maxWidth: '400px',
              width: '90%',
              boxShadow: 'var(--shadow-lg)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              Edit Label
            </h3>
            <div style={{ margin: '1.25rem 0 1.5rem 0' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                Label Name
              </label>
              <input
                ref={editInputRef}
                type="text"
                autoFocus
                placeholder="e.g. Road Trips, Wishlist"
                value={editLabelName}
                onChange={e => setEditLabelName(e.target.value)}
                onFocus={e => e.target.select()}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && editLabelName.trim() && editLabelId) {
                    e.preventDefault();
                    await handleRenameUserLabel(editLabelId, editLabelName);
                  } else if (e.key === 'Escape') {
                    closeEditModal();
                  }
                }}
                className="input-field"
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => {
                  if (editLabelId) {
                    handleDeleteUserLabel(editLabelId);
                  }
                }}
                style={{
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--error-color)',
                  background: 'transparent',
                  fontWeight: 600,
                  color: 'var(--error-color)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                title="Delete label"
                aria-label="Delete label"
              >
                <Trash2 size={16} />
                Delete
              </button>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={closeEditModal}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    background: 'transparent',
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!editLabelName.trim()}
                  onClick={async () => {
                    if (editLabelId && editLabelName.trim()) {
                      await handleRenameUserLabel(editLabelId, editLabelName);
                    }
                  }}
                  className="btn-primary"
                  style={{
                    padding: '10px 18px',
                    opacity: !editLabelName.trim() ? 0.5 : 1,
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
