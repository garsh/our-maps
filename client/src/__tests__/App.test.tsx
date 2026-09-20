import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MapEditor, clampSidebarWidth } from '../App';
import { PIN_HOVER_CLASS, getHoveredPinId, setLastPointerTypeForTests } from '../utils/pinHover';
import { apiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { getOfflineMap } from '../utils/tileUtils';
import { GoogleOAuthProvider } from '@react-oauth/google';

// Mock the dependencies
vi.mock('../services/api');
vi.mock('../contexts/AuthContext');
vi.mock('../utils/tileUtils', async () => {
  const actual = await vi.importActual<typeof import('../utils/tileUtils')>('../utils/tileUtils');
  return {
    ...actual,
    getOfflineMap: vi.fn(async () => null),
    isMapDownloaded: vi.fn(async () => true),
  };
});
vi.mock('../components/MapView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/MapView')>();
  return {
    ...actual,
    default: () => <div data-testid="map-view" />,
  };
});
const { mockSocket, socketCallbacks } = vi.hoisted(() => {
  const socketCallbacks: Record<string, Function> = {};
  const mockSocket = {
    emit: vi.fn(),
    on: vi.fn((event: string, cb: Function) => {
      socketCallbacks[event] = cb;
    }),
    connect: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
  };
  return { mockSocket, socketCallbacks };
});

vi.mock('socket.io-client', () => {
  return { io: vi.fn(() => mockSocket) };
});

describe('App Components Error Handling', () => {
  const mockUser = { id: 'user-1', email: 'test@test.com', name: 'Test User' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = false;
    
    // Default Auth Mock
    (useAuth as any).mockReturnValue({
      user: mockUser,
      token: 'mock-token',
      isAuthenticated: true,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      logoutEverywhere: vi.fn(),
      handleCredentialResponse: vi.fn()
    });

    // Default API Mock
    (apiService.getMaps as any).mockResolvedValue([]);
    (getOfflineMap as any).mockResolvedValue(null);
    sessionStorage.clear();
  });

  it('MapEditor shows error message when map fails to load', async () => {
    (apiService.getMap as any).mockRejectedValue(new Error('Not Found'));

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/invalid-id']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/No Data/i)).toBeInTheDocument();
    });
  });

  it('MapEditor shows error message when creating a new map fails', async () => {
    (apiService.createMap as any).mockRejectedValue(new Error('Save Failed'));

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/new']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Synced/i)).toBeInTheDocument();
    });

    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);

    const renameMenuItem = screen.getByText(/Rename Map/i);
    fireEvent.click(renameMenuItem);

    const nameInput = screen.getByLabelText(/New Map Name/i);

    vi.useFakeTimers();
    try {
      act(() => {
        fireEvent.change(nameInput, { target: { value: 'Trigger Error' } });
        const saveBtn = screen.getByText('Save');
        fireEvent.click(saveBtn);
      });

      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(screen.getByText(/NOT Synced/i)).toBeInTheDocument();
    });
  });

  it('does not create or replace an existing map over HTTP when the name changes', async () => {
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Test Map',
      pins: [],
      layers: [],
      userRole: 'owner'
    });
    (apiService.createMap as any).mockResolvedValue({ id: 'map-1' });

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-1']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Synced/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/more options/i));
    fireEvent.click(screen.getByText(/Rename Map/i));
    fireEvent.change(screen.getByLabelText(/New Map Name/i), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByText('Save'));

    vi.useFakeTimers();
    try {
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(apiService.createMap).not.toHaveBeenCalled();
    expect(mockSocket.emit).toHaveBeenCalledWith('map-name-update', expect.objectContaining({
      mapId: 'map-1',
      name: 'Renamed'
    }), expect.any(Function));
  });

  it('imports pins onto an empty map and emits create deltas', async () => {
    mockSocket.connected = true;
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Test Map',
      pins: [],
      layers: [],
      userRole: 'owner'
    });

    let fileInput: HTMLInputElement | null = null;
    const realCreateElement = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: any) => {
      const el = realCreateElement(tagName, options);
      if (tagName === 'input') fileInput = el as HTMLInputElement;
      return el;
    });

    try {
      render(
        <GoogleOAuthProvider clientId="test-client-id">
          <MemoryRouter initialEntries={['/map/map-1']}>
            <Routes>
              <Route path="/map/:id" element={<MapEditor />} />
            </Routes>
          </MemoryRouter>
        </GoogleOAuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText(/Synced/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByLabelText(/more options/i));
      fireEvent.click(screen.getByText('Import'));
      expect(fileInput).toBeTruthy();

      const file = new File([JSON.stringify({
        name: 'Should Not Replace',
        layers: [{ id: 'old-layer', name: 'Imported Layer', position: 0 }],
        pins: [
          { id: 'old-pin', lat: 10, lng: 20, label: 'Imported Cafe', position: 0, layerId: 'old-layer' }
        ]
      })], 'map.json', { type: 'application/json' });

      await act(async () => {
        await fileInput!.onchange?.({ target: { files: [file] } } as any);
      });

      await waitFor(() => {
        expect(screen.getByText('Imported Cafe')).toBeInTheDocument();
        expect(screen.getByText(/Imported Layer/)).toBeInTheDocument();
      });

      expect(screen.getByText('Test Map')).toBeInTheDocument();
      expect(mockSocket.emit).toHaveBeenCalledWith('layer-create', expect.objectContaining({
        mapId: 'map-1',
        layer: expect.objectContaining({ name: 'Imported Layer' })
      }), expect.any(Function));
      expect(mockSocket.emit).toHaveBeenCalledWith('pin-create', expect.objectContaining({
        mapId: 'map-1',
        pin: expect.objectContaining({ label: 'Imported Cafe' })
      }), expect.any(Function));
      expect(mockSocket.emit).not.toHaveBeenCalledWith('map-name-update', expect.anything());
    } finally {
      createSpy.mockRestore();
    }
  });

  it('allows hovering over remaining pins immediately after deleting a pin', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const mockPins = [
      { id: 'pin-1', lat: 10, lng: 20, label: 'Pin 1', position: 0 },
      { id: 'pin-2', lat: 15, lng: 25, label: 'Pin 2', position: 1 }
    ];

    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Test Map',
      pins: mockPins,
      layers: [],
      userRole: 'owner'
    });

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-1']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    // Wait for map to load
    await waitFor(() => {
      expect(screen.getByText('Pin 1')).toBeInTheDocument();
      expect(screen.getByText('Pin 2')).toBeInTheDocument();
    });

    // Enter edit mode for Pin 1
    const editBtns = screen.getAllByLabelText('Edit');
    fireEvent.click(editBtns[0]);

    // Click delete on Pin 1
    const deleteBtn = screen.getByTitle('Delete Pin');
    fireEvent.click(deleteBtn);

    // Pin 1 should be gone
    await waitFor(() => {
      expect(screen.queryByText('Pin 1')).not.toBeInTheDocument();
      expect(screen.getByText('Pin 2')).toBeInTheDocument();
    });

    // Hover over Pin 2
    const pin2Element = screen.getByText('Pin 2').closest('li')!;
    fireEvent.pointerEnter(pin2Element, { pointerType: 'mouse' });

    expect(pin2Element).toHaveClass(PIN_HOVER_CLASS);

    confirmSpy.mockRestore();
  });

  it('clamps sidebar width to the usable viewport range', () => {
    expect(clampSidebarWidth(100, 1000)).toBe(200);
    expect(clampSidebarWidth(400, 1000)).toBe(400);
    expect(clampSidebarWidth(990, 1000)).toBe(950);
  });

  it('updates sidebar width via DOM during drag and commits on mouseup', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 });

    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Test Map',
      pins: [],
      layers: [],
      userRole: 'owner'
    });

    const { container } = render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-1']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Synced/i)).toBeInTheDocument();
    });

    const resizer = container.querySelector('.resizer-handle') as HTMLElement;
    expect(resizer).toBeTruthy();
    const sidebar = resizer.parentElement as HTMLElement;

    fireEvent.pointerDown(resizer, { clientX: 400, pointerId: 1 });
    expect(sidebar.classList.contains('sidebar-resizing')).toBe(true);
    fireEvent.pointerMove(window, { clientX: 520, pointerId: 1 });
    expect(sidebar.style.width).toBe('520px');

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 520 });
    expect(sidebar.style.width).toBe('520px');
  });

  it('resets a resized sidebar to the default width when rotating to landscape', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 800 });

    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Test Map',
      pins: [],
      layers: [],
      userRole: 'owner'
    });

    const { container } = render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-1']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Synced/i)).toBeInTheDocument();
    });

    const resizer = container.querySelector('.resizer-handle') as HTMLElement;
    fireEvent.pointerDown(resizer, { clientX: 400, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 520, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 520 });
    expect((resizer.parentElement as HTMLElement).style.width).toBe('520px');

    await act(async () => {
      window.innerWidth = 400;
      window.innerHeight = 800;
      window.dispatchEvent(new Event('orientationchange'));
    });

    await waitFor(() => {
      expect(container.querySelector('.mobile-bottom-sheet')).toBeTruthy();
    });

    await act(async () => {
      window.innerWidth = 900;
      window.innerHeight = 400;
      window.dispatchEvent(new Event('orientationchange'));
    });

    await waitFor(() => {
      expect(container.querySelector('.mobile-bottom-sheet')).toBeFalsy();
    });
    const sidebar = container.querySelector('.app-container > div') as HTMLElement;
    expect(sidebar.style.width).toBe('400px');
  });

  it('keeps More options button available when resizing window from desktop to mobile', async () => {
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Test Map',
      pins: [],
      layers: [],
      userRole: 'owner'
    });

    // Start with desktop window size
    window.innerWidth = 1024;

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-1']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/more options/i)).toBeInTheDocument();
    });

    // Simulate resizing window to mobile dimensions (<= 768px)
    await act(async () => {
      window.innerWidth = 500;
      window.dispatchEvent(new Event('resize'));
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/more options/i)).toBeInTheDocument();
    });

    // Verify opening the menu on mobile works
    fireEvent.click(screen.getByLabelText(/more options/i));
    expect(screen.getByText(/Rename Map/i)).toBeInTheDocument();
  });

  it('resizes mobile bottom sheet to standard size on handle tap unless already at standard size', async () => {
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Test Map',
      pins: [],
      layers: [],
      userRole: 'owner'
    });

    window.innerWidth = 375;
    window.innerHeight = 800;

    const { container } = render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-1']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Synced/i)).toBeInTheDocument();
    });

    const handle = container.querySelector('.bottom-sheet-drag-handle') as HTMLElement;
    const sheet = container.querySelector('.mobile-bottom-sheet') as HTMLElement;
    expect(handle).toBeTruthy();
    expect(sheet).toBeTruthy();
    expect(sheet.querySelector('.mobile-map-controls')).toBeTruthy();

    // Standard height for 800px height is Math.min(350, Math.round(800 * 0.45)) = 350px
    expect(sheet.style.height).toBe('350px');

    // 1. Tapping when at standard height (350px) should close it to 0px
    fireEvent.pointerDown(handle, { clientY: 450, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 450, pointerId: 1 });
    expect(sheet.style.height).toBe('0px');

    // 2. Tapping when closed (0px) should open it back to standard height (350px)
    fireEvent.pointerDown(handle, { clientY: 800, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 800, pointerId: 1 });
    expect(sheet.style.height).toBe('350px');

    // 3. Fast flick UP raises all the way to max height (772px)
    fireEvent.pointerDown(handle, { clientY: 450, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 200, pointerId: 1 });
    expect(sheet.style.height).toBe('772px');

    // 4. Tapping when at max/non-standard height (772px) should resize to standard height (350px)
    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 200, pointerId: 1 });
    expect(sheet.style.height).toBe('350px');

    const pinList = container.querySelector('.pin-list');
    expect(pinList?.classList.contains('pin-hover-blocked')).toBe(true);
  });

  it('switches from the portrait bottom sheet to a landscape sidebar and back', async () => {
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Test Map',
      pins: [],
      layers: [],
      userRole: 'owner'
    });

    window.innerWidth = 400;
    window.innerHeight = 800;

    const { container } = render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-1']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Synced/i)).toBeInTheDocument();
    });

    const portraitSheet = container.querySelector('.mobile-bottom-sheet') as HTMLElement;
    expect(portraitSheet).toBeTruthy();
    expect(portraitSheet.style.height).toBe('350px');

    await act(async () => {
      window.innerWidth = 900;
      window.innerHeight = 400;
      window.dispatchEvent(new Event('orientationchange'));
    });

    await waitFor(() => {
      expect(container.querySelector('.mobile-bottom-sheet')).toBeFalsy();
    });
    const landscapeSidebar = container.querySelector('.app-container > div') as HTMLElement;
    expect(landscapeSidebar.style.width).toBe('400px');
    await waitFor(() => {
      expect(container.querySelector('.app-container')?.getAttribute('data-map-reload')).toBe('1');
    });

    await act(async () => {
      window.innerWidth = 400;
      window.innerHeight = 800;
      window.dispatchEvent(new Event('orientationchange'));
    });

    await waitFor(() => {
      const sheet = container.querySelector('.mobile-bottom-sheet') as HTMLElement;
      expect(sheet).toBeTruthy();
      expect(sheet.style.height).toBe('350px');
    });
  });

  it('restores hover state when deselecting a pin by clicking it with fine pointer', async () => {
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Test Map',
      pins: [
        { id: 'pin-1', lat: 10, lng: 20, label: 'My Pin', position: 0 }
      ],
      layers: [],
      userRole: 'owner'
    });

    const { container } = render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-1']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('My Pin')).toBeInTheDocument();
    });

    const pinItem = container.querySelector('#pin-pin-1') || screen.getByText('My Pin').closest('li');
    expect(pinItem).toBeTruthy();

    // 1. Click pin to open info card (select)
    fireEvent.click(screen.getByText('My Pin'));

    // 2. Click pin label again to close info card (deselect)
    fireEvent.click(screen.getByText('My Pin'));

    // Pin should now be hovered for fine pointer
    expect(getHoveredPinId()).toBe('pin-1');
  });

  it('does not leave pin hovered on deselect when pointer is touch', async () => {
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Test Map',
      pins: [
        { id: 'pin-1', lat: 10, lng: 20, label: 'My Pin', position: 0 }
      ],
      layers: [],
      userRole: 'owner'
    });

    setLastPointerTypeForTests('touch');

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-1']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('My Pin')).toBeInTheDocument();
    });

    // 1. Tap pin to open info card (select)
    fireEvent.click(screen.getByText('My Pin'));

    // 2. Tap pin label again to close info card (deselect)
    fireEvent.click(screen.getByText('My Pin'));

    // On touch device, pin should NOT be hovered
    expect(getHoveredPinId()).toBeNull();
  });

  it('opens an owner map in view mode when mode=view is in the URL', async () => {
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Test Map',
      pins: [],
      layers: [],
      userRole: 'owner'
    });

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-1?mode=view']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Map')).toBeInTheDocument();
    });

    expect(screen.getByText(/Synced/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/more options/i));
    expect(screen.queryByText('Rename Map')).not.toBeInTheDocument();
    expect(screen.getByText('Edit Mode')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Edit Mode'));

    await waitFor(() => {
      expect(screen.getByText('Rename Map')).toBeInTheDocument();
    });
    expect(screen.getByText(/Synced/i)).toBeInTheDocument();
  });

  it('keeps Edit Mode off and disabled for view-only collaborators', async () => {
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Shared Map',
      pins: [],
      layers: [],
      userRole: 'view'
    });

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-1']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Shared Map')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/more options/i));
    expect(screen.queryByText('Rename Map')).not.toBeInTheDocument();
    const editModeItem = screen.getByText('Edit Mode');
    expect((editModeItem.parentElement as HTMLElement).style.opacity).toBe('0.45');

    fireEvent.click(editModeItem);
    expect(screen.queryByText('Rename Map')).not.toBeInTheDocument();
    expect(screen.getByText(/Synced/i)).toBeInTheDocument();
  });

  it('greys out Edit Mode toggle and turns it off when device goes offline', async () => {
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Editable Map',
      pins: [],
      layers: [],
      userRole: 'owner'
    });

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-1']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Editable Map')).toBeInTheDocument();
    });

    // Simulate going offline
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.queryByText(/Synced/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/more options/i));
    expect(screen.queryByText('Rename Map')).not.toBeInTheDocument();

    const editModeItem = screen.getByText('Edit Mode');
    const row = editModeItem.parentElement as HTMLElement;
    expect(row.style.opacity).toBe('0.45');
    expect(row.style.cursor).toBe('not-allowed');

    // Click should be ignored when offline
    fireEvent.click(editModeItem);
    expect(screen.queryByText('Rename Map')).not.toBeInTheDocument();

    // Simulate going back online
    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(row.style.opacity).toBe('1');
    expect(row.style.cursor).toBe('pointer');
    expect(screen.getByText('Rename Map')).toBeInTheDocument();
  });

  it('opens a cached owner map in view-only mode when the network load fails', async () => {
    (getOfflineMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Cached Map',
      pins: [],
      layers: [],
      userRole: 'owner',
    });
    (apiService.getMap as any).mockRejectedValue(new Error('Failed to fetch'));

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-1']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Cached Map')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(apiService.getMap).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByLabelText(/more options/i));
    await waitFor(() => {
      const editModeItem = screen.getByText('Edit Mode');
      const row = editModeItem.parentElement as HTMLElement;
      expect(row.style.opacity).toBe('0.45');
      expect(row.style.cursor).toBe('not-allowed');
    });
    expect(screen.queryByText('Rename Map')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Edit Mode'));
    expect(screen.queryByText('Rename Map')).not.toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('shows Syncing then Synced on a cached map without flashing Offline while online, and clears trapped offline session flag', async () => {
    sessionStorage.setItem('ourmaps_offline', '1');
    (getOfflineMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Cached Map',
      pins: [],
      layers: [],
      userRole: 'owner',
    });
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Cached Map',
      pins: [],
      layers: [],
      userRole: 'owner',
    });

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-1']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Synced')).toBeInTheDocument();
    });
    expect(screen.queryByText('Offline')).not.toBeInTheDocument();
    expect(screen.queryByText('Syncing...')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('ourmaps_offline')).toBeNull();
  });

  it('does not set offline mode when socket disconnects while document is hidden in background', async () => {
    (getOfflineMap as any).mockResolvedValue(null);
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-bg-1',
      name: 'Background Map',
      pins: [],
      layers: [],
      userRole: 'owner',
    });

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-bg-1']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Synced')).toBeInTheDocument();
    });

    // Simulate device going to sleep / background
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });

    // Simulate background socket drop
    act(() => {
      socketCallbacks['disconnect']?.('transport close');
    });

    // Application should NOT be marked offline
    expect(sessionStorage.getItem('ourmaps_offline')).toBeNull();
    expect(screen.queryByText('Offline')).not.toBeInTheDocument();

    // Now simulate foreground socket drop while visible
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });

    act(() => {
      socketCallbacks['disconnect']?.('transport close');
    });

    // Now application should transition to offline
    expect(sessionStorage.getItem('ourmaps_offline')).toBe('1');
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });

  it('reconnects and reconciles on resume from background, transitioning sync pill from Syncing to Synced', async () => {
    (getOfflineMap as any).mockResolvedValue(null);
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-sync-1',
      name: 'Sync Map',
      pins: [],
      layers: [],
      userRole: 'owner',
    });

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-sync-1']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Synced')).toBeInTheDocument();
    });

    // Simulate initial socket connection completing
    act(() => {
      mockSocket.connected = true;
      socketCallbacks['connect']?.();
    });

    // Device goes to sleep in background
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    mockSocket.connected = false;
    act(() => {
      socketCallbacks['disconnect']?.('transport close');
    });

    // App resumes from background
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // While reconnecting, status pill displays "Syncing"
    expect(screen.getByText('Syncing')).toBeInTheDocument();
    expect(mockSocket.connect).toHaveBeenCalled();

    // Socket reconnects and reconciliation finishes
    mockSocket.connected = true;
    await act(async () => {
      await socketCallbacks['connect']?.();
    });

    // Status pill cleanly switches to "Synced"
    await waitFor(() => {
      expect(screen.getByText('Synced')).toBeInTheDocument();
      expect(screen.queryByText('Syncing')).not.toBeInTheDocument();
    });
  });

  it('does not refetch the map on resume when the socket is still connected', async () => {
    (getOfflineMap as any).mockResolvedValue(null);
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-connected-resume',
      name: 'Connected Resume Map',
      pins: [],
      layers: [],
      userRole: 'owner',
    });

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-connected-resume']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Synced')).toBeInTheDocument();
    });

    act(() => {
      mockSocket.connected = true;
      socketCallbacks['connect']?.();
    });

    const getMapCallsAfterLoad = (apiService.getMap as any).mock.calls.length;
    mockSocket.connect.mockClear();

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mockSocket.connect).not.toHaveBeenCalled();
    expect((apiService.getMap as any).mock.calls.length).toBe(getMapCallsAfterLoad);
    expect(screen.getByText('Synced')).toBeInTheDocument();
    expect(screen.queryByText('Offline')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('ourmaps_offline')).toBeNull();
  });

  it('redirects with No Data when attempting to open an incompletely downloaded map while offline', async () => {
    sessionStorage.setItem('ourmaps_offline', '1');
    (getOfflineMap as any).mockResolvedValue({
      id: 'map-partial',
      name: 'Partial Download Map',
      pins: [],
      layers: [],
      userRole: 'owner',
    });
    // Incomplete download in progress
    const tileUtilsMock = await import('../utils/tileUtils');
    (tileUtilsMock.isMapDownloaded as any).mockResolvedValue(false);
    (apiService.getMap as any).mockRejectedValue(new Error('Offline: No network connection'));

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-partial']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/No Data/i)).toBeInTheDocument();
    });
  });

  it('allows unauthenticated users to view a public map in view-only mode', async () => {
    (useAuth as any).mockReturnValue({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      logoutEverywhere: vi.fn(),
      handleCredentialResponse: vi.fn()
    });

    (apiService.getMap as any).mockResolvedValue({
      id: 'public-map-1',
      name: 'Public Community Map',
      pins: [],
      layers: [],
      userRole: 'view',
      isPublic: true,
      ownerId: ''
    });

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/public-map-1']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Public Community Map')).toBeInTheDocument();
    });

    // Verify status pill is NOT shown for non-logged-in users
    expect(screen.queryByText(/Synced/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Syncing/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Offline/i)).not.toBeInTheDocument();

    // Verify view-only mode menu (Sign In available, Edit Mode / Download / Export absent)
    fireEvent.click(screen.getByLabelText(/more options/i));
    expect(screen.getByText('Sign In')).toBeInTheDocument();
    expect(screen.queryByText('Edit Mode')).not.toBeInTheDocument();
    expect(screen.queryByText(/Download for Offline/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Export')).not.toBeInTheDocument();
  });

  it('silently redirects unauthenticated users to /login when map is not shared publicly without No Data interstitial', async () => {
    (useAuth as any).mockReturnValue({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      logoutEverywhere: vi.fn(),
      handleCredentialResponse: vi.fn()
    });

    (apiService.getMap as any).mockRejectedValue(new Error('Authentication required'));

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/private-map-1']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
            <Route path="/login" element={<div data-testid="login-page">Login Page</div>} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument();
    });

    // Should never show "No Data" or "Unable to load map offline"
    expect(screen.queryByText(/No Data/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Unable to load map offline/i)).not.toBeInTheDocument();
  });

  it('updates the public-link setting when map-public-updated arrives', async () => {
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Share Map',
      pins: [],
      layers: [],
      userRole: 'owner',
      isPublic: false,
      ownerId: mockUser.id,
      ownerName: mockUser.name,
      ownerEmail: mockUser.email,
    });
    (apiService.getMapPermissions as any).mockResolvedValue({
      owner: { id: mockUser.id, name: mockUser.name, email: mockUser.email },
      permissions: [],
      userRole: 'owner',
      isPublic: false,
    });

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/map-1']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Share Map')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/more options/i));
    fireEvent.click(screen.getByText('Share'));

    const radio = await screen.findByLabelText('Allow anybody with the link to view');
    expect(radio).not.toBeChecked();

    act(() => {
      socketCallbacks['map-public-updated']?.({ mapId: 'map-other', isPublic: true });
    });
    expect(radio).not.toBeChecked();

    act(() => {
      socketCallbacks['map-public-updated']?.({ mapId: 'map-1', isPublic: true });
    });
    expect(radio).toBeChecked();
  });

  describe('Truncated Map Title Tooltip & Long-Press', () => {
    it('shows tooltip on mouse hover when truncated, and hides on mouse leave', async () => {
      (apiService.getMap as any).mockResolvedValue({
        id: 'map-long',
        name: 'This is a very long map name that gets truncated by the header',
        pins: [],
        layers: [],
        permissions: [],
        userRole: 'owner',
        isPublic: false,
      });

      render(
        <GoogleOAuthProvider clientId="test-client-id">
          <MemoryRouter initialEntries={['/map/map-long']}>
            <Routes>
              <Route path="/map/:id" element={<MapEditor />} />
            </Routes>
          </MemoryRouter>
        </GoogleOAuthProvider>
      );

      const heading = await screen.findByRole('heading', { level: 1 });
      expect(heading).toHaveTextContent('This is a very long map name that gets truncated by the header');

      // Mock truncated text
      Object.defineProperty(heading, 'scrollWidth', { configurable: true, value: 500 });
      Object.defineProperty(heading, 'clientWidth', { configurable: true, value: 200 });

      const titleContainer = heading.closest('div')!;

      // Initially no tooltip
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

      // Mouse enter -> shows tooltip
      fireEvent.mouseEnter(titleContainer);
      const tooltip = screen.getByRole('tooltip');
      expect(tooltip).toBeInTheDocument();
      expect(tooltip).toHaveTextContent('This is a very long map name that gets truncated by the header');

      // Mouse leave -> hides tooltip
      fireEvent.mouseLeave(titleContainer);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('does not show tooltip on mouse hover if the map name fits (not truncated)', async () => {
      (apiService.getMap as any).mockResolvedValue({
        id: 'map-short',
        name: 'Short',
        pins: [],
        layers: [],
        permissions: [],
        userRole: 'owner',
        isPublic: false,
      });

      render(
        <GoogleOAuthProvider clientId="test-client-id">
          <MemoryRouter initialEntries={['/map/map-short']}>
            <Routes>
              <Route path="/map/:id" element={<MapEditor />} />
            </Routes>
          </MemoryRouter>
        </GoogleOAuthProvider>
      );

      const heading = await screen.findByRole('heading', { level: 1 });
      // Non-truncated: scrollWidth <= clientWidth
      Object.defineProperty(heading, 'scrollWidth', { configurable: true, value: 80 });
      Object.defineProperty(heading, 'clientWidth', { configurable: true, value: 200 });

      const titleContainer = heading.closest('div')!;

      fireEvent.mouseEnter(titleContainer);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });

    it('shows tooltip on long-press when truncated and suppresses navigation click', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

      try {
        (apiService.getMap as any).mockResolvedValue({
          id: 'map-long',
          name: 'Long Title On Mobile',
          pins: [],
          layers: [],
          permissions: [],
          userRole: 'owner',
          isPublic: false,
        });

        render(
          <GoogleOAuthProvider clientId="test-client-id">
            <MemoryRouter initialEntries={['/map/map-long']}>
              <Routes>
                <Route path="/map/:id" element={<MapEditor />} />
                <Route path="/" element={<div data-testid="home-page">Home</div>} />
              </Routes>
            </MemoryRouter>
          </GoogleOAuthProvider>
        );

        // Wait for map load with fake timers
        await act(async () => {
          vi.advanceTimersByTime(100);
        });

        const heading = screen.getByRole('heading', { level: 1 });
        Object.defineProperty(heading, 'scrollWidth', { configurable: true, value: 500 });
        Object.defineProperty(heading, 'clientWidth', { configurable: true, value: 150 });

        const titleContainer = heading.closest('div')!;

        // Long press: touch start
        act(() => {
          fireEvent.touchStart(titleContainer, {
            touches: [{ clientX: 100, clientY: 20 }],
          });
        });

        // Before 450ms, tooltip should not be visible yet
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

        // Advance to 450ms
        act(() => {
          vi.advanceTimersByTime(450);
        });

        expect(screen.getByRole('tooltip')).toBeInTheDocument();
        expect(screen.getByRole('tooltip')).toHaveTextContent('Long Title On Mobile');

        // Touch end and click (as happens when finger lifts)
        act(() => {
          fireEvent.touchEnd(titleContainer);
          fireEvent.click(titleContainer);
        });

        // Click should NOT have navigated to home!
        expect(screen.queryByTestId('home-page')).not.toBeInTheDocument();

        // Advance timers by 3500ms -> auto-dismiss
        act(() => {
          vi.advanceTimersByTime(3500);
        });
        expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not show tooltip on long-press when map name fits, and quick tap navigates home', async () => {
      (apiService.getMap as any).mockResolvedValue({
        id: 'map-short',
        name: 'Short Title',
        pins: [],
        layers: [],
        permissions: [],
        userRole: 'owner',
        isPublic: false,
      });

      render(
        <GoogleOAuthProvider clientId="test-client-id">
          <MemoryRouter initialEntries={['/map/map-short']}>
            <Routes>
              <Route path="/map/:id" element={<MapEditor />} />
              <Route path="/" element={<div data-testid="home-page">Home</div>} />
            </Routes>
          </MemoryRouter>
        </GoogleOAuthProvider>
      );

      const heading = await screen.findByRole('heading', { level: 1 });
      Object.defineProperty(heading, 'scrollWidth', { configurable: true, value: 100 });
      Object.defineProperty(heading, 'clientWidth', { configurable: true, value: 200 });

      const titleContainer = heading.closest('div')!;

      // Quick tap: touchStart -> touchEnd -> click
      fireEvent.touchStart(titleContainer, {
        touches: [{ clientX: 50, clientY: 20 }],
      });
      fireEvent.touchEnd(titleContainer);
      fireEvent.click(titleContainer);

      // Navigates to home
      expect(screen.getByTestId('home-page')).toBeInTheDocument();
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });
});

