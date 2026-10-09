import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { MapEditor, clampSidebarWidth } from '../App';
import { PIN_HOVER_CLASS, getHoveredPinId, setLastPointerTypeForTests } from '../utils/pinHover';
import { apiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { getOfflineMap } from '../utils/tileUtils';
import { renderWithProviders, MOCK_USER } from '../testHelpers';

// Mock the dependencies
vi.mock('../services/api');
vi.mock('../contexts/AuthContext');
vi.mock('../utils/tileUtils', async () => {
  const actual = await vi.importActual<typeof import('../utils/tileUtils')>('../utils/tileUtils');
  return {
    ...actual,
    getOfflineMap: vi.fn(async () => null),
    isMapDownloaded: vi.fn(async () => true),
    removeMapDownload: vi.fn(async () => {}),
  };
});
vi.mock('../components/MapView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/MapView')>();
  const { createPortal } = await import('react-dom');
  return {
    ...actual,
    default: ({
      onPinClick,
      pins,
      targetPinId,
      hiddenLayerIds,
      mobileControlsTarget,
      showTransit,
    }: {
      onPinClick?: (pin: { id: string; lat: number; lng: number; label?: string }) => void;
      pins?: Array<{ id: string; lat: number; lng: number; label?: string; layerId?: string }>;
      targetPinId?: string | null;
      hiddenLayerIds?: Set<string | null>;
      mobileControlsTarget?: HTMLElement | null;
      showTransit?: boolean;
    }) => {
      const visiblePins = (pins ?? []).filter((pin) => !hiddenLayerIds?.has(pin.layerId || null));
      const target = mobileControlsTarget || (typeof document !== 'undefined' ? document.getElementById('mobile-map-controls') : null);
      return (
        <div data-testid="map-view" data-target-pin-id={targetPinId || ''} data-show-transit={String(showTransit ?? false)}>
          {visiblePins.map((pin) => (
            <button
              key={pin.id}
              type="button"
              data-testid={`map-pin-${pin.id}`}
              data-is-target={targetPinId === pin.id}
              onClick={() => onPinClick?.(pin)}
            />
          ))}
          {target ? createPortal(
            <>
              <button aria-label="Find my location">Locate</button>
              <button aria-label="Compass - Reset bearing to North">Compass</button>
            </>,
            target
          ) : null}
        </div>
      );
    },
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
  const mockUser = MOCK_USER;

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
    localStorage.removeItem('cached_maps');
  });

  it('MapEditor shows error message when map fails to load', async () => {
    (apiService.getMap as any).mockRejectedValue(new Error('Not Found'));

    renderWithProviders(<MapEditor />, {
      initialEntries: ['/map/invalid-id'],
      routePath: '/map/:id',
    });

    await waitFor(() => {
      expect(screen.getByText(/No Data/i)).toBeInTheDocument();
    });
  });

  it('MapEditor shows error message when creating a new map fails', async () => {
    (apiService.createMap as any).mockRejectedValue(new Error('Save Failed'));

    renderWithProviders(<MapEditor />, {
      initialEntries: ['/map/new'],
      routePath: '/map/:id',
    });

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

    renderWithProviders(<MapEditor />, {
      initialEntries: ['/map/map-1'],
      routePath: '/map/:id',
    });

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

  it('imports pins and layers into an existing map with pins/layers and ignores imported map name', async () => {
    mockSocket.connected = true;
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Existing Map Name',
      pins: [
        { id: 'pin-existing', lat: 1, lng: 2, label: 'Existing Pin', position: 0 }
      ],
      layers: [
        { id: 'layer-existing', name: 'Existing Layer', position: 0 }
      ],
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

      // Confirmation dialog should be displayed
      const dialog = screen.getByTestId('import-confirm-dialog');
      expect(dialog).toBeInTheDocument();
      expect(within(dialog).getByText('Layers and pins will be added to the current map.')).toBeInTheDocument();

      // Confirm import in dialog
      fileInput = null;
      fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
      expect(fileInput).toBeTruthy();

      const file = new File([JSON.stringify({
        name: 'New Imported Title',
        layers: [{ id: 'imp-layer', name: 'Existing Layer', position: 0 }],
        pins: [
          { id: 'imp-pin-1', lat: 10, lng: 20, label: 'Imported In Existing Name Layer', position: 0, layerId: 'imp-layer' },
          { id: 'imp-pin-2', lat: 11, lng: 21, label: 'Imported Default Pin', position: 0 }
        ]
      })], 'map.json', { type: 'application/json' });

      await act(async () => {
        await fileInput!.onchange?.({ target: { files: [file] } } as any);
      });

      await waitFor(() => {
        expect(screen.getByText('Imported In Existing Name Layer')).toBeInTheDocument();
        expect(screen.getByText('Imported Default Pin')).toBeInTheDocument();
      });

      // Existing pin is still there
      expect(screen.getByText('Existing Pin')).toBeInTheDocument();

      // Map name is unchanged (ignored imported name)
      expect(screen.getByText('Existing Map Name')).toBeInTheDocument();
      expect(screen.queryByText('New Imported Title')).not.toBeInTheDocument();
      expect(mockSocket.emit).not.toHaveBeenCalledWith('map-name-update', expect.anything());

      // Layer-create emitted for new layer (not merged with existing layer of same name)
      expect(mockSocket.emit).toHaveBeenCalledWith('layer-create', expect.objectContaining({
        mapId: 'map-1',
        layer: expect.objectContaining({ name: 'Existing Layer', id: expect.not.stringMatching('layer-existing') })
      }), expect.any(Function));

      // Pin-create emitted for both new pins
      expect(mockSocket.emit).toHaveBeenCalledWith('pin-create', expect.objectContaining({
        mapId: 'map-1',
        pin: expect.objectContaining({ label: 'Imported In Existing Name Layer' })
      }), expect.any(Function));
      expect(mockSocket.emit).toHaveBeenCalledWith('pin-create', expect.objectContaining({
        mapId: 'map-1',
        layerId: null,
        pin: expect.objectContaining({ label: 'Imported Default Pin' })
      }), expect.any(Function));
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

  it('resizes the mobile bottom sheet on handle tap and clears search when minimized', async () => {
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
    const controls = sheet.querySelector('.mobile-map-controls');
    expect(controls).toBeTruthy();
    expect(controls?.parentElement?.classList.contains('sidebar-toolbar')).toBe(true);
    expect(controls?.previousElementSibling?.querySelector('input[placeholder="Search..."]')).toBeTruthy();

    // Standard height for 800px height is Math.min(350, Math.round(800 * 0.45)) = 350px
    expect(sheet.style.height).toBe('350px');

    const input = screen.getByPlaceholderText(/Search.../i);
    fireEvent.change(input, { target: { value: 'Coffee' } });
    expect(input).toHaveValue('Coffee');

    // 1. Tapping when at standard height (350px) should close it to 0px and clear search
    fireEvent.pointerDown(handle, { clientY: 450, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 450, pointerId: 1 });
    expect(sheet.style.height).toBe('0px');
    expect(input).toHaveValue('');

    // 2. Tapping when closed (0px) should open it back to standard height (350px)
    fireEvent.pointerDown(handle, { clientY: 800, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 800, pointerId: 1 });
    expect(sheet.style.height).toBe('350px');

    // 3. Drag keeps the released height (no flick maximize)
    fireEvent.pointerDown(handle, { clientY: 450, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 200, pointerId: 1 });
    expect(sheet.style.height).toBe('600px');

    // 4. Tapping when at a custom height should resize to standard height (350px)
    fireEvent.pointerDown(handle, { clientY: 200, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 200, pointerId: 1 });
    expect(sheet.style.height).toBe('350px');

    const pinList = container.querySelector('.pin-list');
    expect(pinList?.classList.contains('pin-hover-blocked')).toBe(true);
  });

  it('keeps compass and location buttons in their relative positions and slides them off the bottom sheet onto the map when minimized', async () => {
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Test Map',
      pins: [],
      layers: [],
      userRole: 'owner'
    });

    const originalDpr = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, writable: true, value: 2.75 });
    window.innerWidth = 375;
    window.innerHeight = 800;

    try {
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
      const host = container.querySelector('.mobile-map-controls');
      expect(within(host as HTMLElement).getByRole('button', { name: /Compass - Reset bearing to North/i })).toBeInTheDocument();
    });

    const handle = container.querySelector('.bottom-sheet-drag-handle') as HTMLElement;
    const sheet = container.querySelector('.mobile-bottom-sheet') as HTMLElement;
    const controls = sheet.querySelector('.mobile-map-controls') as HTMLElement;
    const compassButton = within(controls).getByRole('button', { name: /Compass - Reset bearing to North/i });
    const locatorButton = within(controls).getByRole('button', { name: /Find my location/i });

    // When sheet is open (350px), controls are in the sheet toolbar in relative position: locator on left, compass on right
    expect(controls.contains(compassButton)).toBe(true);
    expect(controls.contains(locatorButton)).toBe(true);
    expect(locatorButton.compareDocumentPosition(compassButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(controls).not.toHaveClass('is-minimized');

    // Minimize sheet (close to 0px)
    fireEvent.pointerDown(handle, { clientY: 450, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 450, pointerId: 1 });
    expect(sheet).toHaveStyle({ height: '0px' });

    // Controls slide off the bottom sheet onto the map (is-minimized applied), stay in their relative positions,
    // and clamp at their final floor position (never going below it)
    expect(controls).toHaveClass('is-minimized');
    expect(controls.contains(compassButton)).toBe(true);
    expect(controls.contains(locatorButton)).toBe(true);
    expect(locatorButton.compareDocumentPosition(compassButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Reopen sheet back to standard height
    fireEvent.pointerDown(handle, { clientY: 800, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 800, pointerId: 1 });
    expect(sheet).toHaveStyle({ height: '350px' });

    // Controls slide back onto the bottom sheet toolbar
    expect(controls).not.toHaveClass('is-minimized');
    expect(controls.contains(compassButton)).toBe(true);
    expect(controls.contains(locatorButton)).toBe(true);
    expect(locatorButton.compareDocumentPosition(compassButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Drag sheet down to intermediate height (40px) overlapping the buttons
    fireEvent.pointerDown(handle, { clientY: 450, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 760, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 760, pointerId: 1 });
    expect(sheet).toHaveStyle({ height: '40px' });
    expect(controls).not.toHaveClass('is-minimized');
    expect(controls.style.getPropertyValue('--controls-shift-y')).toBe('-11.2px');
    expect(controls.contains(compassButton)).toBe(true);
    expect(controls.contains(locatorButton)).toBe(true);
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { configurable: true, writable: true, value: originalDpr });
    }
  });

  it('clears desktop search, clips a minimized sidebar, and renders the options menu outside the header clip', async () => {
    const setViewport = (width: number, height: number) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
      Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
    };
    setViewport(1280, 800);

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
      expect(screen.getByPlaceholderText(/Search.../i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('More options'));
    const menu = await screen.findByTestId('map-options-menu');
    expect(menu).toHaveTextContent('Edit Mode');
    expect(menu).toHaveTextContent('Appearance');
    const openClip = container.querySelector('.sidebar-header-clip') as HTMLElement;
    expect(openClip).toBeTruthy();
    expect(openClip).not.toContainElement(menu);
    expect(document.body.contains(menu)).toBe(true);
    fireEvent.click(screen.getByLabelText('More options'));
    expect(screen.queryByTestId('map-options-menu')).not.toBeInTheDocument();

    const input = screen.getByPlaceholderText(/Search.../i);
    fireEvent.change(input, { target: { value: 'Coffee' } });
    expect(input).toHaveValue('Coffee');

    const resizer = container.querySelector('.resizer-handle') as HTMLElement;
    fireEvent.click(resizer);

    expect((resizer.parentElement as HTMLElement).style.width).toBe('0px');
    expect(input).toHaveValue('');

    const header = container.querySelector('header') as HTMLElement;
    const headerClip = container.querySelector('.sidebar-header-clip') as HTMLElement;
    expect(headerClip).toHaveStyle({ overflow: 'hidden', minWidth: '0px', width: '100%', maxWidth: '100%' });
    expect(headerClip).toContainElement(header);
    expect(headerClip.contains(resizer)).toBe(false);
    expect(header).toContainElement(screen.getByLabelText('More options'));
    expect(resizer.parentElement).toContainElement(headerClip);

    fireEvent.click(resizer);
    expect((resizer.parentElement as HTMLElement).style.width).toBe('400px');

    await act(async () => {
      setViewport(900, 400);
      window.dispatchEvent(new Event('resize'));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });

    const landscapeResizer = container.querySelector('.resizer-handle') as HTMLElement;
    fireEvent.click(landscapeResizer);

    const sheet = landscapeResizer.parentElement as HTMLElement;
    expect(sheet.style.width).toBe('0px');
    expect(sheet.querySelector('.bottom-sheet-drag-handle')).toBeNull();

    const landscapeHeader = container.querySelector('header') as HTMLElement;
    const landscapeClip = container.querySelector('.sidebar-header-clip') as HTMLElement;
    expect(landscapeClip).toHaveStyle({ overflow: 'hidden', minWidth: '0px', width: '100%', maxWidth: '100%' });
    expect(landscapeClip).toContainElement(landscapeHeader);
    expect(landscapeClip.contains(landscapeResizer)).toBe(false);
    expect(landscapeHeader).toContainElement(screen.getByLabelText('More options'));
  });

  it('opens the minimized mobile panel to default size and highlights the tapped pin', async () => {
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Test Map',
      pins: [{ id: 'pin-1', lat: 10, lng: 20, label: 'Pin 1', position: 0 }],
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
      expect(screen.getByText('Pin 1')).toBeInTheDocument();
    });

    // The sheet tap ignores map clicks for 450ms. Advance that window without waiting.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const handle = container.querySelector('.bottom-sheet-drag-handle') as HTMLElement;
      const sheet = container.querySelector('.mobile-bottom-sheet') as HTMLElement;
      fireEvent.pointerDown(handle, { clientY: 450, pointerId: 1 });
      fireEvent.pointerUp(handle, { clientY: 450, pointerId: 1 });
      expect(sheet.style.height).toBe('0px');

      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      fireEvent.click(screen.getByTestId('map-pin-pin-1'));

      expect(sheet.style.height).toBe('350px');
      expect(screen.getByText('Pin 1').closest('li')).toHaveClass('pin-target');
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the minimized desktop sidebar to default size and highlights the clicked pin', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 800 });

    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Test Map',
      pins: [{ id: 'pin-1', lat: 10, lng: 20, label: 'Pin 1', position: 0 }],
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
      expect(screen.getByText('Pin 1')).toBeInTheDocument();
    });

    const resizer = container.querySelector('.resizer-handle') as HTMLElement;
    fireEvent.click(screen.getByTestId('map-pin-pin-1'));
    expect(screen.getByText('Pin 1').closest('li')).toHaveClass('pin-target');

    fireEvent.click(resizer);
    expect((resizer.parentElement as HTMLElement).style.width).toBe('0px');

    fireEvent.click(screen.getByTestId('map-pin-pin-1'));

    expect((resizer.parentElement as HTMLElement).style.width).toBe('400px');
    expect(screen.getByText('Pin 1').closest('li')).toHaveClass('pin-target');
  });

  it('keeps a custom desktop sidebar width when clicking a pin', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 800 });

    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Test Map',
      pins: [{ id: 'pin-1', lat: 10, lng: 20, label: 'Pin 1', position: 0 }],
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
      expect(screen.getByText('Pin 1')).toBeInTheDocument();
    });

    const resizer = container.querySelector('.resizer-handle') as HTMLElement;
    fireEvent.pointerDown(resizer, { clientX: 400, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 520, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 520 });
    expect((resizer.parentElement as HTMLElement).style.width).toBe('520px');

    fireEvent.click(screen.getByTestId('map-pin-pin-1'));

    expect((resizer.parentElement as HTMLElement).style.width).toBe('520px');
    expect(screen.getByText('Pin 1').closest('li')).toHaveClass('pin-target');
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
    expect(screen.queryByPlaceholderText(/Search.../i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/more options/i));
    expect(screen.queryByText('Rename Map')).not.toBeInTheDocument();
    expect(screen.getByText('Edit Mode')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Edit Mode'));

    await waitFor(() => {
      expect(screen.getByText('Rename Map')).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText(/Search.../i)).toBeInTheDocument();
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

    // Successful load leaves offline mode after a 300ms debounce.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
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

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });

      expect(screen.getByText('Synced')).toBeInTheDocument();
      expect(screen.queryByText('Offline')).not.toBeInTheDocument();
      expect(screen.queryByText('Syncing...')).not.toBeInTheDocument();
      expect(sessionStorage.getItem('ourmaps_offline')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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

    // Verify status pill displays Logged Out for non-logged-in users
    expect(screen.queryByText(/Synced/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Syncing/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Offline/i)).not.toBeInTheDocument();
    expect(screen.getByText('Logged Out')).toBeInTheDocument();

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

  it('redirects to login when a cached map answers 401 and does not enter offline mode', async () => {
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

    const tileUtilsMock = await import('../utils/tileUtils');
    (tileUtilsMock.getOfflineMap as any).mockResolvedValue({
      id: 'cached-private-map',
      name: 'Cached Offline Map',
      pins: [{ id: 'pin-1', lat: 1, lng: 2, label: 'Secret trailhead', position: 0 }],
      layers: [],
      userRole: 'view'
    });
    (tileUtilsMock.isMapDownloaded as any).mockResolvedValue(true);
    (apiService.getMap as any).mockRejectedValue(new Error('Authentication required'));

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/cached-private-map']}>
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

    expect(screen.queryByText('Secret trailhead')).not.toBeInTheDocument();
    expect(sessionStorage.getItem('ourmaps_offline')).toBeNull();
    expect(tileUtilsMock.removeMapDownload).not.toHaveBeenCalled();
  });

  it.each(['Access denied', 'Map not found'])(
    'leaves a cached map and drops the local copy when the server responds %s',
    async (message) => {
      const tileUtilsMock = await import('../utils/tileUtils');
      (tileUtilsMock.getOfflineMap as any).mockResolvedValue({
        id: 'revoked-map',
        name: 'Revoked Map',
        pins: [{ id: 'pin-1', lat: 1, lng: 2, label: 'Secret trailhead', position: 0 }],
        layers: [],
        userRole: 'edit'
      });
      (tileUtilsMock.isMapDownloaded as any).mockResolvedValue(true);
      (apiService.getMap as any).mockRejectedValue(new Error(message));
      localStorage.setItem('cached_maps', JSON.stringify([
        { id: 'revoked-map', name: 'Revoked Map' },
        { id: 'kept-map', name: 'Kept Map' },
      ]));

      render(
        <GoogleOAuthProvider clientId="test-client-id">
          <MemoryRouter initialEntries={['/map/revoked-map']}>
            <Routes>
              <Route path="/map/:id" element={<MapEditor />} />
              <Route path="/" element={<div data-testid="home-page">Home</div>} />
            </Routes>
          </MemoryRouter>
        </GoogleOAuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('home-page')).toBeInTheDocument();
      });

      expect(screen.queryByText('Secret trailhead')).not.toBeInTheDocument();
      expect(screen.queryByText(/Offline/i)).not.toBeInTheDocument();
      expect(sessionStorage.getItem('ourmaps_offline')).toBeNull();
      expect(tileUtilsMock.removeMapDownload).toHaveBeenCalledWith('revoked-map');
      expect(JSON.parse(localStorage.getItem('cached_maps') || '[]')).toEqual([
        { id: 'kept-map', name: 'Kept Map' },
      ]);
    }
  );

  it('keeps a cached map offline when the request fails before a response', async () => {
    const tileUtilsMock = await import('../utils/tileUtils');
    (tileUtilsMock.getOfflineMap as any).mockResolvedValue({
      id: 'cached-private-map',
      name: 'Cached Offline Map',
      pins: [],
      layers: [],
      userRole: 'view'
    });
    (tileUtilsMock.isMapDownloaded as any).mockResolvedValue(true);
    (apiService.getMap as any).mockRejectedValue(new TypeError('Failed to fetch'));

    render(
      <GoogleOAuthProvider clientId="test-client-id">
        <MemoryRouter initialEntries={['/map/cached-private-map']}>
          <Routes>
            <Route path="/map/:id" element={<MapEditor />} />
            <Route path="/login" element={<div data-testid="login-page">Login Page</div>} />
          </Routes>
        </MemoryRouter>
      </GoogleOAuthProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Cached Offline Map')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(sessionStorage.getItem('ourmaps_offline')).toBe('1');
    expect(tileUtilsMock.removeMapDownload).not.toHaveBeenCalled();
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

    it('ensures sync and download pills do not shrink while long map names dynamically shorten with ellipsis', async () => {
      (apiService.getMap as any).mockResolvedValue({
        id: 'map-long-name',
        name: 'Cranberry Township map with a very long name too',
        pins: [],
        layers: [],
        permissions: [],
        userRole: 'owner',
        isPublic: false,
      });

      render(
        <GoogleOAuthProvider clientId="test-client-id">
          <MemoryRouter initialEntries={['/map/map-long-name']}>
            <Routes>
              <Route path="/map/:id" element={<MapEditor />} />
            </Routes>
          </MemoryRouter>
        </GoogleOAuthProvider>
      );

      const heading = await screen.findByRole('heading', { level: 1 });
      expect(heading).toHaveTextContent('Cranberry Township map with a very long name too');
      expect(heading.style.textOverflow).toBe('ellipsis');
      expect(heading.style.overflow).toBe('hidden');
      expect(heading.style.whiteSpace).toBe('nowrap');
      expect(heading.style.flexShrink).toBe('1');
      expect(heading.style.minWidth).toBe('0px');

      const titleContainer = heading.closest('div')!;
      expect(titleContainer.style.flexShrink).toBe('1');
      expect(titleContainer.style.minWidth).toBe('0px');

      const syncStatus = screen.getByTestId('sync-status');
      expect(syncStatus).toBeInTheDocument();
      expect(syncStatus.style.flexShrink).toBe('0');

      const syncContainer = syncStatus.parentElement!;
      expect(syncContainer.style.flexShrink).toBe('0');

      const downloadPillContainer = document.getElementById('download-pill-container')!;
      expect(downloadPillContainer).toBeInTheDocument();
      expect(downloadPillContainer.style.flexShrink).toBe('0');

      const pillsGroup = downloadPillContainer.parentElement!;
      expect(pillsGroup.style.flexShrink).toBe('0');

      const rightSection = pillsGroup.parentElement!;
      expect(rightSection.style.flexShrink).toBe('0');
    });
  });

  describe('pin selection in hidden layer', () => {
    it('unhides a custom layer and highlights the pin when tapped in sidebar', async () => {
      (apiService.getMap as any).mockResolvedValue({
        id: 'map-hidden-test',
        name: 'Hidden Layer Map',
        pins: [
          { id: 'pin-custom', lat: 12, lng: 34, label: 'Secret Spot', position: 0, layerId: 'layer-hidden' }
        ],
        layers: [
          { id: 'layer-hidden', name: 'Hidden Category', position: 0 }
        ],
        userRole: 'owner'
      });

      render(
        <GoogleOAuthProvider clientId="test-client-id">
          <MemoryRouter initialEntries={['/map/map-hidden-test']}>
            <Routes>
              <Route path="/map/:id" element={<MapEditor />} />
            </Routes>
          </MemoryRouter>
        </GoogleOAuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Secret Spot')).toBeInTheDocument();
      });

      // Hide the layer using the eye icon in the sidebar
      const layerHeader = screen.getByText(/Hidden Category/).closest('div[data-no-text-select]')!;
      const hideLayerBtn = within(layerHeader).getByRole('button', { name: 'Hide layer' });
      fireEvent.click(hideLayerBtn);

      // Now the button should say "Show layer"
      expect(within(layerHeader).getByRole('button', { name: 'Show layer' })).toBeInTheDocument();
      // On the map, the pin should not be visible
      expect(screen.queryByTestId('map-pin-pin-custom')).not.toBeInTheDocument();

      // Tap the pin in the sidebar
      fireEvent.click(screen.getByText('Secret Spot'));

      // The layer should now be visible again
      await waitFor(() => {
        expect(within(layerHeader).getByRole('button', { name: 'Hide layer' })).toBeInTheDocument();
      });

      // The pin should be visible and highlighted on the map
      const mapPin = screen.getByTestId('map-pin-pin-custom');
      expect(mapPin).toBeInTheDocument();
      expect(mapPin).toHaveAttribute('data-is-target', 'true');

      // The pin item in sidebar should have pin-target class
      expect(screen.getByText('Secret Spot').closest('li')).toHaveClass('pin-target');
    });

    it('unhides default layer and highlights pin when tapped in sidebar', async () => {
      (apiService.getMap as any).mockResolvedValue({
        id: 'map-default-hidden-test',
        name: 'Default Hidden Map',
        pins: [
          { id: 'pin-default', lat: 45, lng: 56, label: 'Default Spot', position: 0 }
        ],
        layers: [],
        userRole: 'owner'
      });

      render(
        <GoogleOAuthProvider clientId="test-client-id">
          <MemoryRouter initialEntries={['/map/map-default-hidden-test']}>
            <Routes>
              <Route path="/map/:id" element={<MapEditor />} />
            </Routes>
          </MemoryRouter>
        </GoogleOAuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Default Spot')).toBeInTheDocument();
      });

      // Hide the default layer
      const defaultHeader = screen.getByText(/Default Layer/).closest('div[data-no-text-select]') as HTMLElement;
      const hideLayerBtn = within(defaultHeader).getByRole('button', { name: 'Hide layer' });
      fireEvent.click(hideLayerBtn);

      // Pin should not be on map
      expect(screen.queryByTestId('map-pin-pin-default')).not.toBeInTheDocument();
      expect(within(defaultHeader).getByRole('button', { name: 'Show layer' })).toBeInTheDocument();

      // Tap the pin in sidebar
      fireEvent.click(screen.getByText('Default Spot'));

      // Default layer is now visible
      await waitFor(() => {
        expect(within(defaultHeader).getByRole('button', { name: 'Hide layer' })).toBeInTheDocument();
      });

      // Pin is visible and highlighted on map
      const mapPin = screen.getByTestId('map-pin-pin-default');
      expect(mapPin).toBeInTheDocument();
      expect(mapPin).toHaveAttribute('data-is-target', 'true');
      expect(screen.getByText('Default Spot').closest('li')).toHaveClass('pin-target');
    });

    it('unhides both layers when a pin is repeated in two layers, both of which are hidden', async () => {
      (apiService.getMap as any).mockResolvedValue({
        id: 'map-repeated-test',
        name: 'Repeated Pin Map',
        pins: [
          { id: 'pin-day1', lat: 40.0, lng: -105.0, label: 'Hotel Night 1', position: 0, layerId: 'layer-day1' },
          { id: 'pin-day2', lat: 40.0, lng: -105.0, label: 'Hotel Night 2', position: 0, layerId: 'layer-day2' }
        ],
        layers: [
          { id: 'layer-day1', name: 'Day 1', position: 0 },
          { id: 'layer-day2', name: 'Day 2', position: 1 }
        ],
        userRole: 'owner'
      });

      render(
        <GoogleOAuthProvider clientId="test-client-id">
          <MemoryRouter initialEntries={['/map/map-repeated-test']}>
            <Routes>
              <Route path="/map/:id" element={<MapEditor />} />
            </Routes>
          </MemoryRouter>
        </GoogleOAuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByText('Hotel Night 1')).toBeInTheDocument();
        expect(screen.getByText('Hotel Night 2')).toBeInTheDocument();
      });

      // Hide both Day 1 and Day 2 layers
      const day1Header = screen.getByText(/Day 1/).closest('div[data-no-text-select]')!;
      const day2Header = screen.getByText(/Day 2/).closest('div[data-no-text-select]')!;

      const day1HideBtn = within(day1Header).getByRole('button', { name: 'Hide layer' });
      const day2HideBtn = within(day2Header).getByRole('button', { name: 'Hide layer' });

      fireEvent.click(day1HideBtn);
      fireEvent.click(day2HideBtn);

      // Both layer headers should now show "Show layer"
      expect(within(day1Header).getByRole('button', { name: 'Show layer' })).toBeInTheDocument();
      expect(within(day2Header).getByRole('button', { name: 'Show layer' })).toBeInTheDocument();
      expect(screen.queryByTestId('map-pin-pin-day1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('map-pin-pin-day2')).not.toBeInTheDocument();

      // Tap Hotel Night 1 in the sidebar
      fireEvent.click(screen.getByText('Hotel Night 1'));

      // Both layers should now be unhidden (both headers now show "Hide layer")
      await waitFor(() => {
        expect(within(day1Header).getByRole('button', { name: 'Hide layer' })).toBeInTheDocument();
        expect(within(day2Header).getByRole('button', { name: 'Hide layer' })).toBeInTheDocument();
      });

      // Map should now render the pins and the target pin should be highlighted
      const day1MapPin = screen.getByTestId('map-pin-pin-day1');
      expect(day1MapPin).toBeInTheDocument();
      expect(day1MapPin).toHaveAttribute('data-is-target', 'true');

      // Both co-located rows in sidebar should have pin-target
      expect(screen.getByText('Hotel Night 1').closest('li')).toHaveClass('pin-target');
      expect(screen.getByText('Hotel Night 2').closest('li')).toHaveClass('pin-target');
    });
  });

  describe('pin-move-layer from the menu and the pin editor', () => {
    const layers = [
      { id: 'dest', name: 'Dest Layer', position: 0 },
      { id: 'src', name: 'Source Layer', position: 1 },
      { id: 'other', name: 'Other Layer', position: 2 },
    ];

    function renderOwnerMap(pins: Array<Record<string, unknown>>) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1280 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 800 });
      (apiService.getMap as any).mockResolvedValue({
        id: 'map-1',
        name: 'Test Map',
        pins,
        layers,
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
    }

    function pinRowLabels() {
      const names = ['Stay A', 'Mid', 'Gap B', 'Stay D', 'Move C', 'Other Low', 'Other High', 'Stay B'];
      return Array.from(document.querySelectorAll('li.pin-list-item'))
        .map((li) => names.find((name) => within(li as HTMLElement).queryByText(name)))
        .filter((name): name is string => Boolean(name));
    }

    function pinCheckbox(label: string) {
      const row = screen.getByText(label).closest('li');
      const checkbox = row?.querySelector('input[type="checkbox"]');
      if (!checkbox) throw new Error(`No checkbox for ${label}`);
      return checkbox as HTMLInputElement;
    }

    function selectPin(label: string) {
      fireEvent.click(pinCheckbox(label));
    }

    function pinMoveCalls() {
      return mockSocket.emit.mock.calls.filter((call) => call[0] === 'pin-move-layer');
    }

    function moveSelectionTo(layerName: string) {
      const actions = screen.getByLabelText('Actions for selected pins');
      expect(actions.tagName).toBe('BUTTON');
      fireEvent.click(actions);
      const menu = screen.getByTestId('selection-actions-menu');
      const select = within(menu).getByLabelText(/Move \d+ pins? to layer\.\.\./) as HTMLSelectElement;
      const option = Array.from(select.options).find((item) => item.textContent === layerName);
      if (!option) throw new Error(`No layer option ${layerName}`);
      fireEvent.change(select, { target: { value: option.value } });
      fireEvent.click(within(menu).getByRole('button', { name: 'Move' }));
    }

    it('sends pin-move-layer in stored list order when Move appends a mixed selection', async () => {
      // Move C is ahead of Gap B in the stored list, and behind it in the sidebar selection order.
      renderOwnerMap([
        { id: 'c', lat: 5, lng: 5, label: 'Move C', layerId: 'src', position: 1 },
        { id: 'a', lat: 1, lng: 1, label: 'Stay A', layerId: 'dest', position: 0 },
        { id: 'd', lat: 4, lng: 4, label: 'Stay D', layerId: 'src', position: 4 },
        { id: 'm', lat: 2, lng: 2, label: 'Mid', layerId: 'dest', position: 3 },
        { id: 'b', lat: 3, lng: 3, label: 'Gap B', layerId: 'dest', position: 5 },
        { id: 'o1', lat: 6, lng: 6, label: 'Other Low', layerId: 'other', position: 2 },
        { id: 'o2', lat: 7, lng: 7, label: 'Other High', layerId: 'other', position: 9 },
      ]);

      await waitFor(() => {
        expect(screen.getByText('Move C')).toBeInTheDocument();
      });
      expect(pinRowLabels()).toEqual([
        'Stay A', 'Mid', 'Gap B', 'Move C', 'Stay D', 'Other Low', 'Other High',
      ]);

      selectPin('Gap B');
      selectPin('Move C');
      moveSelectionTo('Dest Layer');

      await waitFor(() => {
        expect(pinMoveCalls()).toHaveLength(1);
      });
      expect(pinMoveCalls()[0][1]).toEqual({
        mapId: 'map-1',
        pinIds: ['c', 'b'],
        targetLayerId: 'dest',
        destInsertIndex: 2,
      });
      expect(mockSocket.emit.mock.calls.some((call) => call[0] === 'pins-reorder')).toBe(false);
      expect(pinRowLabels()).toEqual([
        'Stay A', 'Mid', 'Move C', 'Gap B', 'Stay D', 'Other Low', 'Other High',
      ]);
      expect(pinCheckbox('Move C').checked).toBe(false);
      expect(pinCheckbox('Gap B').checked).toBe(false);
      expect(screen.queryByText(/Go \(/)).not.toBeInTheDocument();
    });

    it('sends pin-move-layer when the selected pin is already in the target layer', async () => {
      renderOwnerMap([
        { id: 'a', lat: 1, lng: 1, label: 'Stay A', layerId: 'dest', position: 0 },
        { id: 'm', lat: 2, lng: 2, label: 'Mid', layerId: 'dest', position: 3 },
        { id: 'b', lat: 3, lng: 3, label: 'Gap B', layerId: 'dest', position: 5 },
      ]);

      await waitFor(() => {
        expect(screen.getByText('Gap B')).toBeInTheDocument();
      });

      selectPin('Gap B');
      moveSelectionTo('Dest Layer');

      await waitFor(() => {
        expect(pinMoveCalls()).toHaveLength(1);
      });
      expect(pinMoveCalls()[0][1]).toEqual({
        mapId: 'map-1',
        pinIds: ['b'],
        targetLayerId: 'dest',
        destInsertIndex: 2,
      });
      expect(mockSocket.emit.mock.calls.some((call) => call[0] === 'pins-reorder')).toBe(false);
      expect(pinRowLabels()).toEqual(['Stay A', 'Mid', 'Gap B']);
    });

    it('deletes every selected pin', async () => {
      renderOwnerMap([
        { id: 'a', lat: 1, lng: 1, label: 'Stay A', layerId: 'dest', position: 0 },
        { id: 'b', lat: 3, lng: 3, label: 'Gap B', layerId: 'dest', position: 5 },
        { id: 'c', lat: 5, lng: 5, label: 'Move C', layerId: 'src', position: 1 },
      ]);

      await waitFor(() => {
        expect(screen.getByText('Stay A')).toBeInTheDocument();
      });

      selectPin('Stay A');
      selectPin('Gap B');
      const actions = screen.getByLabelText('Actions for selected pins');
      expect(actions.tagName).toBe('BUTTON');
      fireEvent.click(actions);
      const menu = screen.getByTestId('selection-actions-menu');
      fireEvent.click(within(menu).getByRole('button', { name: 'Delete 2 pins' }));
      fireEvent.click(within(screen.getByTestId('delete-pins-dialog')).getByRole('button', { name: 'OK' }));

      await waitFor(() => {
        expect(screen.queryByText('Stay A')).not.toBeInTheDocument();
      });
      expect(screen.queryByText('Gap B')).not.toBeInTheDocument();
      expect(screen.getByText('Move C')).toBeInTheDocument();
      const deletedIds = mockSocket.emit.mock.calls
        .filter((call) => call[0] === 'pin-delete')
        .map((call) => call[1].pinId);
      expect(deletedIds).toEqual(['a', 'b']);
    });

    it('sends pin-move-layer when the pin editor moves one pin onto a gapped layer', async () => {
      renderOwnerMap([
        { id: 'a', lat: 1, lng: 1, label: 'Stay A', layerId: 'dest', position: 0 },
        { id: 'b', lat: 2, lng: 2, label: 'Stay B', layerId: 'dest', position: 5 },
        { id: 'c', lat: 3, lng: 3, label: 'Move C', layerId: 'src', position: 2 },
        { id: 'd', lat: 4, lng: 4, label: 'Stay D', layerId: 'src', position: 4 },
      ]);

      await waitFor(() => {
        expect(screen.getByText('Move C')).toBeInTheDocument();
      });

      const row = screen.getByText('Move C').closest('li')!;
      fireEvent.click(within(row).getByLabelText('Edit'));
      fireEvent.change(within(row).getByRole('combobox'), { target: { value: 'dest' } });

      await waitFor(() => {
        expect(pinMoveCalls()).toHaveLength(1);
      });
      expect(pinMoveCalls()[0][1]).toEqual({
        mapId: 'map-1',
        pinIds: ['c'],
        targetLayerId: 'dest',
        destInsertIndex: 2,
      });
      expect(mockSocket.emit.mock.calls.some((call) => call[0] === 'pins-reorder')).toBe(false);
      expect(pinRowLabels()).toEqual(['Stay A', 'Stay B', 'Move C', 'Stay D']);
    });
  });

  describe('Transit Appearance Setting', () => {
    it('initial default render has transit disabled', async () => {
      localStorage.removeItem('ourmaps_transit');
      (apiService.getMap as any).mockResolvedValue({
        id: 'map-1',
        name: 'Test Map',
        pins: [],
        layers: [],
        userRole: 'owner',
      });

      renderWithProviders(<MapEditor />, {
        initialEntries: ['/map/map-1'],
        routePath: '/map/:id',
      });

      await waitFor(() => {
        expect(screen.getByTestId('map-view')).toHaveAttribute('data-show-transit', 'false');
      });
    });

    it('localStorage hydration initializes transit state when ourmaps_transit is true', async () => {
      localStorage.setItem('ourmaps_transit', 'true');
      (apiService.getMap as any).mockResolvedValue({
        id: 'map-1',
        name: 'Test Map',
        pins: [],
        layers: [],
        userRole: 'owner',
      });

      renderWithProviders(<MapEditor />, {
        initialEntries: ['/map/map-1'],
        routePath: '/map/:id',
      });

      await waitFor(() => {
        expect(screen.getByTestId('map-view')).toHaveAttribute('data-show-transit', 'true');
      });
      localStorage.removeItem('ourmaps_transit');
    });

    it('toggle action updates state and writes ourmaps_transit to localStorage', async () => {
      localStorage.removeItem('ourmaps_transit');
      (apiService.getMap as any).mockResolvedValue({
        id: 'map-1',
        name: 'Test Map',
        pins: [],
        layers: [],
        userRole: 'owner',
      });

      renderWithProviders(<MapEditor />, {
        initialEntries: ['/map/map-1'],
        routePath: '/map/:id',
      });

      await waitFor(() => {
        expect(screen.getByTestId('map-view')).toHaveAttribute('data-show-transit', 'false');
      });

      fireEvent.click(screen.getByLabelText(/more options/i));
      const transitOption = screen.getByText('Transit');
      fireEvent.click(transitOption);

      await waitFor(() => {
        expect(screen.getByTestId('map-view')).toHaveAttribute('data-show-transit', 'true');
      });
      expect(localStorage.getItem('ourmaps_transit')).toBe('true');

      fireEvent.click(transitOption);
      await waitFor(() => {
        expect(screen.getByTestId('map-view')).toHaveAttribute('data-show-transit', 'false');
      });
      expect(localStorage.getItem('ourmaps_transit')).toBe('false');
      localStorage.removeItem('ourmaps_transit');
    });
  });
});

