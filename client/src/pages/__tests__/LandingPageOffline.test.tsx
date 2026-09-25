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

  it('does not let a long-press select the owner or date on a map card', async () => {
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

    // 2. Click view button
    const onlineOnlyCard = screen.getByText('Online Only Map').closest('.card');
    const viewButton = onlineOnlyCard?.querySelector('[aria-label="Open in view mode"]') as HTMLElement;
    expect(viewButton).toBeTruthy();
    fireEvent.click(viewButton);

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByText('This map is not available in offline mode')).toBeInTheDocument();
  });

  it('shows downloaded maps that are missing from cached_maps while offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
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
      expect(screen.getByText('Offline')).toBeInTheDocument();
      expect(screen.getByText('Downloaded')).toBeInTheDocument();
    });
  });

  it('shows stored offline UI immediately then revalidates when the browser is online', async () => {
    sessionStorage.setItem('ourmaps_offline', '1');
    localStorage.setItem('cached_maps', JSON.stringify(mockMaps));

    render(
      <MemoryRouter>
        <ThemeProvider>
          <LandingPage />
        </ThemeProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Retry Sync')).toBeInTheDocument();
    expect(screen.queryByText('New Map')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(apiService.getMaps).toHaveBeenCalled();
      expect(screen.getByText('New Map')).toBeInTheDocument();
    });
    expect(sessionStorage.getItem('ourmaps_offline')).toBeNull();
  });

  it('skips getMaps when the browser reports offline', async () => {
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

    expect(screen.getByText('Retry Sync')).toBeInTheDocument();
    expect(apiService.getMaps).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
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
});
