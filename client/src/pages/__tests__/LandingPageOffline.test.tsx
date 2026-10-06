import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import LandingPage from '../LandingPage';
import { apiService } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
import * as tileUtils from '../../utils/tileUtils';
import { tileWorkerManager } from '../../utils/tileWorkerManager';
import * as legacyStorage from '../../utils/legacyStorage';

vi.mock('../../services/api');
vi.mock('../../contexts/AuthContext');
vi.mock('../../utils/legacyStorage', () => ({
  findUnrecognizedStorage: vi.fn(async () => []),
  deleteUnrecognizedStorage: vi.fn(async () => {}),
}));
vi.mock('../../utils/tileUtils', async () => {
  const actual = await vi.importActual('../../utils/tileUtils');
  return {
    ...actual,
    getMapDownloadStatuses: vi.fn(),
    unionCachedMapsWithDownloads: vi.fn(async (cached: { id: string }[]) => cached),
  };
});

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('LandingPage Offline Map Access', () => {
  const mockUser = { id: 'user-1', email: 'test@test.com', name: 'Test User' };
  const mockMaps = [
    { id: 'map-downloaded', name: 'Downloaded Map', ownerId: 'user-1', ownerName: 'Test User' },
    { id: 'map-not-downloaded', name: 'Online Only Map', ownerId: 'user-1', ownerName: 'Test User' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    (useAuth as any).mockReturnValue({
      user: mockUser,
      token: 'mock-token',
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      logoutEverywhere: vi.fn(),
    });
    (apiService.getMaps as any).mockResolvedValue(mockMaps);

    const downloadStatuses = new Map();
    downloadStatuses.set('map-downloaded', { isComplete: true, isPartial: false });
    (tileUtils.getMapDownloadStatuses as any).mockResolvedValue(downloadStatuses);
    (tileUtils.unionCachedMapsWithDownloads as any).mockImplementation(async (cached: typeof mockMaps) => cached);
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  it('blocks long-press selection on landing page text and allows it in search inputs', async () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    const owner = (await screen.findAllByTitle('Map Owner'))[0];
    const accessed = screen.getAllByTitle('Last Accessed Date')[0];
    for (const label of [owner, accessed]) {
      expect(label.style.userSelect).toBe('none');
      expect(label.style.webkitUserSelect).toBe('none');
      const contextEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      fireEvent(label, contextEvent);
      expect(contextEvent.defaultPrevented).toBe(true);
    }

    const title = screen.getAllByText('Downloaded Map')[0];
    expect(title.style.userSelect).toBe('none');
    expect(title.style.webkitUserSelect).toBe('none');

    const titleMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fireEvent(title, titleMenu);
    expect(titleMenu.defaultPrevented).toBe(true);

    const titleSelect = new Event('selectstart', { bubbles: true, cancelable: true });
    fireEvent(title, titleSelect);
    expect(titleSelect.defaultPrevented).toBe(true);

    const selection = window.getSelection()!;
    const titleRange = document.createRange();
    titleRange.selectNodeContents(title);
    selection.removeAllRanges();
    selection.addRange(titleRange);
    document.dispatchEvent(new Event('selectionchange'));
    expect(selection.rangeCount).toBe(0);

    for (const selector of ['.landing-page-root', '.landing-container', '.landing-maps-grid']) {
      const blank = document.querySelector(selector) as HTMLElement;
      const contextEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      blank.dispatchEvent(contextEvent);
      expect(contextEvent.defaultPrevented).toBe(false);
    }

    const heading = screen.getByRole('heading', { name: 'All Maps' });
    const headingMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fireEvent(heading, headingMenu);
    expect(headingMenu.defaultPrevented).toBe(true);

    const brand = screen.getByRole('heading', { name: 'OurMaps' });
    const brandMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fireEvent(brand, brandMenu);
    expect(brandMenu.defaultPrevented).toBe(true);

    const newMap = screen.getByRole('button', { name: 'New Map' });
    const buttonMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fireEvent(newMap, buttonMenu);
    expect(buttonMenu.defaultPrevented).toBe(true);

    const headingSelect = new Event('selectstart', { bubbles: true, cancelable: true });
    fireEvent(heading, headingSelect);
    expect(headingSelect.defaultPrevented).toBe(true);

    const headingRange = document.createRange();
    headingRange.selectNodeContents(heading);
    selection.removeAllRanges();
    selection.addRange(headingRange);
    document.dispatchEvent(new Event('selectionchange'));
    expect(selection.rangeCount).toBe(0);

    fireEvent.change(screen.getByLabelText('Filter maps by label'), { target: { value: 'search' } });

    const searchInput = await screen.findByPlaceholderText('Search all maps...');
    const searchMenu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fireEvent(searchInput, searchMenu);
    expect(searchMenu.defaultPrevented).toBe(false);

    const searchSelect = new Event('selectstart', { bubbles: true, cancelable: true });
    fireEvent(searchInput, searchSelect);
    expect(searchSelect.defaultPrevented).toBe(false);
  });

  it('allows opening maps with download when offline', async () => {
    (apiService.getMaps as any).mockRejectedValue(new Error('Network Error'));
    localStorage.setItem('cached_maps', JSON.stringify(mockMaps));

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Downloaded Map')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Downloaded Map'));
    expect(mockNavigate).toHaveBeenCalledWith('/map/map-downloaded');
    expect(mockNavigate).not.toHaveBeenCalledWith('/map/map-downloaded?mode=view');
    expect(screen.queryAllByRole('button', { name: 'Open in view mode' })).toHaveLength(0);
  });

  it('shows a downloaded map\'s labels offline without changing them', async () => {
    (apiService.getMaps as any).mockRejectedValue(new Error('Network Error'));
    localStorage.setItem('cached_maps', JSON.stringify(mockMaps));
    localStorage.setItem('cached_user_labels', JSON.stringify([
      { id: 'label-1', name: 'Road Trips', sortMode: 'last_accessed', position: 0 },
      { id: 'label-2', name: 'Wishlist', sortMode: 'last_accessed', position: 1 },
    ]));
    const assignments = [{ labelId: 'label-1', mapId: 'map-downloaded', position: 0 }];
    localStorage.setItem('cached_map_label_assignments', JSON.stringify(assignments));

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Downloaded Map')).toBeInTheDocument();
    });

    const card = screen.getByText('Downloaded Map').closest('.card') as HTMLElement;
    const labelButton = await waitFor(() => {
      const button = card.querySelector('[aria-label="View labels"]');
      expect(button).toBeTruthy();
      return button as HTMLElement;
    });
    fireEvent.click(labelButton);

    const roadTrips = screen.getByText('Road Trips');
    expect(screen.queryByText('Wishlist')).not.toBeInTheDocument();
    expect(roadTrips.parentElement?.querySelector('svg')).toBeNull();
    expect((roadTrips.parentElement?.parentElement as HTMLElement).style.minHeight).toBe('0px');

    fireEvent.click(roadTrips);

    expect(JSON.parse(localStorage.getItem('cached_map_label_assignments') || '[]')).toEqual(assignments);
    expect(apiService.assignMapLabel).not.toHaveBeenCalled();
    expect(apiService.removeMapLabel).not.toHaveBeenCalled();
    expect(screen.getByText('Road Trips')).toBeInTheDocument();
    expect(screen.queryByText('Wishlist')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Close'));
    const unlabeledCard = screen.getByText('Online Only Map').closest('.card') as HTMLElement;
    fireEvent.click(unlabeledCard.querySelector('[aria-label="View labels"]') as HTMLElement);
    expect(screen.getByText('No labels on this map.')).toBeInTheDocument();
    expect(screen.queryByText('Road Trips')).not.toBeInTheDocument();
    expect(screen.queryByText('Wishlist')).not.toBeInTheDocument();
  });

  it('opens a map in view mode from the view button without also opening as editor', async () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Downloaded Map')).toBeInTheDocument();
    });

    expect(screen.getAllByLabelText('Open in view mode').length).toBeGreaterThanOrEqual(2);
    const downloadedCard = screen.getByText('Downloaded Map').closest('.card');
    const viewButton = downloadedCard?.querySelector('[aria-label="Open in view mode"]') as HTMLElement;
    fireEvent.click(viewButton);

    expect(mockNavigate).toHaveBeenCalledWith('/map/map-downloaded?mode=view');
    expect(mockNavigate).not.toHaveBeenCalledWith('/map/map-downloaded');
  });

  it('displays interstitial pop up and prevents opening undownloaded maps when offline (card click and view button)', async () => {
    (apiService.getMaps as any).mockRejectedValue(new Error('Network Error'));
    localStorage.setItem('cached_maps', JSON.stringify(mockMaps));

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Online Only Map')).toBeInTheDocument();
    });

    // 1. Click card directly
    fireEvent.click(screen.getByText('Online Only Map'));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByText('This map is not available in offline mode')).toBeInTheDocument();

    // Dismiss dialog
    fireEvent.click(screen.getByText('OK'));
    expect(screen.queryByText('This map is not available in offline mode')).not.toBeInTheDocument();

    // 2. View button should NOT be rendered for undownloaded maps when offline
    const onlineOnlyCard = screen.getByText('Online Only Map').closest('.card');
    const viewButton = onlineOnlyCard?.querySelector('[aria-label="Open in view mode"]');
    expect(viewButton).toBeNull();
  });

  it('shows downloaded maps that are missing from cached_maps while offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    (apiService.getMaps as any).mockRejectedValue(new Error('Failed to fetch'));
    localStorage.removeItem('cached_maps');
    (tileUtils.unionCachedMapsWithDownloads as any).mockImplementation(async () => [
      { id: 'map-extract-only', name: 'Extract Only Map', ownerId: 'user-1', ownerName: 'Test User' },
    ]);
    const downloadStatuses = new Map();
    downloadStatuses.set('map-extract-only', { isComplete: true, isPartial: false });
    (tileUtils.getMapDownloadStatuses as any).mockResolvedValue(downloadStatuses);

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Extract Only Map')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Extract Only Map'));
    expect(mockNavigate).toHaveBeenCalledWith('/map/map-extract-only');
  });

  it('displays Offline badge for undownloaded maps when offline', async () => {
    (apiService.getMaps as any).mockRejectedValue(new Error('Network Error'));
    localStorage.setItem('cached_maps', JSON.stringify(mockMaps));

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTitle('Offline')).toBeInTheDocument();
      expect(screen.getByTitle('Downloaded')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Offline'));
    expect(document.querySelector('.touch-tooltip-bubble')).toHaveTextContent('Offline');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('checks the server before showing an offline landing page', async () => {
    sessionStorage.setItem('ourmaps_offline', '1');
    localStorage.setItem('cached_maps', JSON.stringify(mockMaps));

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Loading your maps...')).toBeInTheDocument();
    expect(screen.queryByText('Retry Sync')).not.toBeInTheDocument();
    expect(screen.queryByText('New Map')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Offline')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(apiService.getMaps).toHaveBeenCalled();
      expect(screen.getByText('New Map')).toBeInTheDocument();
    });
    expect(sessionStorage.getItem('ourmaps_offline')).toBeNull();
  });

  it('retries sync once on entry even when the browser still reports offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    sessionStorage.setItem('ourmaps_offline', '1');
    localStorage.setItem('cached_maps', JSON.stringify(mockMaps));

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Loading your maps...')).toBeInTheDocument();
    expect(screen.queryByText('Retry Sync')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Offline')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(apiService.getMaps).toHaveBeenCalledTimes(1);
      expect(apiService.getMaps).toHaveBeenCalledWith({ ignoreNavigatorOnline: true });
      expect(screen.getByText('New Map')).toBeInTheDocument();
    });
    expect(screen.queryByText('Retry Sync')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Offline')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('ourmaps_offline')).toBeNull();

    fireEvent.click(screen.getByText('Online Only Map'));
    expect(mockNavigate).toHaveBeenCalledWith('/map/map-not-downloaded');
    expect(screen.queryByText('This map is not available in offline mode')).not.toBeInTheDocument();
  });

  it('stays offline when the entry sync fails and the browser reports offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    (apiService.getMaps as any).mockRejectedValue(new Error('Failed to fetch'));
    sessionStorage.setItem('ourmaps_offline', '1');
    localStorage.setItem('cached_maps', JSON.stringify(mockMaps));

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(apiService.getMaps).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('Retry Sync')).toBeInTheDocument();
    expect(screen.getByTitle('Offline')).toBeInTheDocument();
    expect(sessionStorage.getItem('ourmaps_offline')).toBe('1');
  });

  it('shows owner name without Shared by prefix for shared maps', async () => {
    const sharedMaps = [
      { id: 'map-shared', name: 'Shared Map', ownerId: 'user-other', ownerName: 'Alice Smith' },
    ];
    (apiService.getMaps as any).mockResolvedValue(sharedMaps);

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.queryByText(/Shared by/i)).not.toBeInTheDocument();
    });
  });

  it('immediately reflects Downloading badge when tileWorkerManager notifies state change', async () => {
    let subscriberCb: any;
    const subscribeSpy = vi.spyOn(tileWorkerManager, 'subscribe').mockImplementation((cb: any) => {
      subscriberCb = cb;
      return () => {};
    });

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Online Only Map')).toBeInTheDocument();
    });

    act(() => {
      if (subscriberCb) {
        subscriberCb({
          mapId: 'map-not-downloaded',
          isDownloading: true,
          isDownloaded: false,
          hasPartialDownload: false,
          downloadProgress: 0.1,
          tileStats: { completed: 1, total: 10 }
        });
      }
    });

    await waitFor(() => {
      expect(screen.getByText('Downloading')).toBeInTheDocument();
    });

    subscribeSpy.mockRestore();
  });

  it('shows Stalled when retries are exhausted and keeps Downloading while a retry is still in progress', async () => {
    let subscriberCb: any;
    const subscribeSpy = vi.spyOn(tileWorkerManager, 'subscribe').mockImplementation((cb: any) => {
      subscriberCb = cb;
      return () => {};
    });

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Online Only Map')).toBeInTheDocument();
    });

    act(() => {
      subscriberCb?.({
        mapId: 'map-not-downloaded',
        isDownloading: true,
        isRemoving: false,
        isDownloaded: false,
        hasPartialDownload: false,
        stalled: true,
        downloadProgress: 0.4,
        tileStats: { completed: 4, total: 10 },
        byteStats: { received: 40, total: 100 },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Downloading')).toBeInTheDocument();
    });
    expect(screen.queryByText('Stalled')).not.toBeInTheDocument();

    act(() => {
      subscriberCb?.({
        mapId: 'map-not-downloaded',
        isDownloading: false,
        isRemoving: false,
        isDownloaded: false,
        hasPartialDownload: true,
        stalled: true,
        downloadProgress: 0.4,
        tileStats: { completed: 4, total: 10 },
        byteStats: { received: 40, total: 100 },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Stalled')).toBeInTheDocument();
    });
    expect(screen.queryByText('Downloading')).not.toBeInTheDocument();

    subscribeSpy.mockRestore();
  });

  it('prevents opening maps in the middle of downloading while offline', async () => {
    (apiService.getMaps as any).mockRejectedValue(new Error('Network Error'));
    localStorage.setItem('cached_maps', JSON.stringify(mockMaps));

    const downloadStatuses = new Map();
    downloadStatuses.set('map-downloaded', { isComplete: true, isPartial: false });
    // map-not-downloaded is in the middle of downloading
    downloadStatuses.set('map-not-downloaded', { isComplete: false, isPartial: true });
    (tileUtils.getMapDownloadStatuses as any).mockResolvedValue(downloadStatuses);

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Online Only Map')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Online Only Map'));

    expect(mockNavigate).not.toHaveBeenCalledWith('/map/map-not-downloaded');
    expect(screen.getByText('This map is not available in offline mode')).toBeInTheDocument();
  });

  it('scans download statuses once after maps load, not twice on mount', async () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Downloaded Map')).toBeInTheDocument();
    });

    expect(tileUtils.getMapDownloadStatuses).toHaveBeenCalledTimes(1);
    expect(tileUtils.getMapDownloadStatuses).toHaveBeenCalledWith(['map-downloaded', 'map-not-downloaded']);
  });

  it('debounces visibility-triggered download status scans', async () => {
    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(tileUtils.getMapDownloadStatuses).toHaveBeenCalledTimes(1);
    });

    vi.useFakeTimers();
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(tileUtils.getMapDownloadStatuses).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(tileUtils.getMapDownloadStatuses).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks to delete leftover older-version storage after Remove All Downloads', async () => {
    vi.spyOn(tileWorkerManager, 'removeAllDownloads').mockResolvedValue(undefined);
    (legacyStorage.findUnrecognizedStorage as any).mockResolvedValue([
      { id: 'indexeddb:MapTilesDB', kind: 'indexeddb', name: 'MapTilesDB', detail: 'Old map database (MapTilesDB)' },
    ]);

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Downloaded Map')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Test User'));
    fireEvent.click(screen.getByText('Remove All Downloads'));
    fireEvent.click(screen.getByText('Remove All'));

    await waitFor(() => {
      expect(screen.getByText('Leftover data found')).toBeInTheDocument();
      expect(screen.getByText('Old map database (MapTilesDB)')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Delete leftovers'));
    await waitFor(() => {
      expect(legacyStorage.deleteUnrecognizedStorage).toHaveBeenCalledWith([
        { id: 'indexeddb:MapTilesDB', kind: 'indexeddb', name: 'MapTilesDB', detail: 'Old map database (MapTilesDB)' },
      ]);
    });
  });

  it('shows Sign In button instead of Retry Sync when unauthenticated and offline', async () => {
    (useAuth as any).mockReturnValue({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      logoutEverywhere: vi.fn(),
    });
    (apiService.getMaps as any).mockRejectedValue(new Error('Unauthorized'));
    localStorage.setItem('cached_maps', JSON.stringify(mockMaps));

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Downloaded Map')).toBeInTheDocument();
    });

    // Should show Sign In button instead of Retry Sync
    expect(screen.getByText('Sign In')).toBeInTheDocument();
    expect(screen.queryByText('Retry Sync')).not.toBeInTheDocument();

    // Clicking Sign In navigates to /login
    fireEvent.click(screen.getByText('Sign In'));
    expect(mockNavigate).toHaveBeenCalledWith('/login');

    // Non-downloaded maps should show "Logged Out" badge
    expect(screen.getByTitle('Logged Out')).toBeInTheDocument();
  });

  it('immediately transitions to Sign In button and Logged Out pills upon sign out', async () => {
    let authUser: any = mockUser;
    (useAuth as any).mockImplementation(() => ({
      user: authUser,
      token: authUser ? 'mock-token' : null,
      isAuthenticated: !!authUser,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(() => {
        authUser = null;
      }),
      logoutEverywhere: vi.fn(),
    }));

    localStorage.setItem('cached_maps', JSON.stringify(mockMaps));

    const { rerender } = render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('New Map')).toBeInTheDocument();
    });

    // Sign out from user menu
    fireEvent.click(screen.getByTitle('Test User'));
    fireEvent.click(screen.getByText('Sign Out'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }));

    // Re-render to reflect auth context state update
    rerender(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    // New Map should be replaced with Sign In
    expect(screen.queryByText('New Map')).not.toBeInTheDocument();
    expect(screen.getByText('Sign In')).toBeInTheDocument();

    // Undownloaded maps should now show "Logged Out"
    expect(screen.getByTitle('Logged Out')).toBeInTheDocument();
  });

  it('sorts maps by lastAccessedAt so most recently accessed appears first', async () => {
    const mapsWithAccess = [
      { id: 'map-older', name: 'Older Access Map', ownerId: 'user-1', ownerName: 'Test User', lastAccessedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'map-newer', name: 'Newer Access Map', ownerId: 'user-1', ownerName: 'Test User', lastAccessedAt: '2026-02-01T00:00:00.000Z' },
    ];
    (apiService.getMaps as any).mockResolvedValue(mapsWithAccess);

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Newer Access Map')).toBeInTheDocument();
      expect(screen.getByText('Older Access Map')).toBeInTheDocument();
    });

    const renderedHeadings = screen.getAllByRole('heading', { level: 3 }).map(el => el.textContent);
    const newerIndex = renderedHeadings.indexOf('Newer Access Map');
    const olderIndex = renderedHeadings.indexOf('Older Access Map');
    expect(newerIndex).toBeLessThan(olderIndex);
  });
});

