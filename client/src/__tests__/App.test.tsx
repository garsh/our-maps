import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MapEditor, clampSidebarWidth } from '../App';
import { PIN_HOVER_CLASS, getHoveredPinId, setLastPointerTypeForTests } from '../utils/pinHover';
import LandingPage from '../pages/LandingPage';
import { apiService } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { GoogleOAuthProvider } from '@react-oauth/google';

// Mock the dependencies
vi.mock('../services/api');
vi.mock('../contexts/AuthContext');
vi.mock('../components/MapView', () => ({
  default: () => <div data-testid="map-view" />
}));
vi.mock('socket.io-client', () => {
  const socket = {
    emit: vi.fn(),
    on: vi.fn(),
    disconnect: vi.fn(),
    connected: false
  };
  return { io: vi.fn(() => socket) };
});

describe('App Components Error Handling', () => {
  const mockUser = { id: 'user-1', email: 'test@test.com', name: 'Test User' };

  beforeEach(() => {
    vi.clearAllMocks();
    
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
  });

  it('LandingPage shows error message when server is unreachable', async () => {
    (apiService.getMaps as any).mockRejectedValue(new Error('Network Error'));

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );
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

  it('MapEditor shows error message when saving fails', async () => {
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Test Map',
      pins: [],
      layers: [],
      userRole: 'owner'
    });
    (apiService.updateMap as any).mockRejectedValue(new Error('Save Failed'));

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
      expect(screen.getByText(/Synced/i)).toBeInTheDocument();
    });


    // Trigger auto-save by changing map name
    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);

    const renameMenuItem = screen.getByText(/Rename Map/i);
    fireEvent.click(renameMenuItem);

    const nameInput = screen.getByLabelText(/New Map Name/i);

    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'Trigger Error' } });
      const saveBtn = screen.getByText('Save');
      fireEvent.click(saveBtn);
    });

    // Wait for the debounced save to fail
    await waitFor(() => {
      expect(screen.getByText(/NOT Synced/i)).toBeInTheDocument();
    }, { timeout: 4000 });

  }, 10000);

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

    fireEvent.mouseDown(resizer, { clientX: 400 });
    expect(sidebar.classList.contains('sidebar-resizing')).toBe(true);
    fireEvent.mouseMove(window, { clientX: 520 });
    expect(sidebar.style.width).toBe('520px');

    fireEvent.mouseUp(window);
    expect(sidebar.style.width).toBe('520px');
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

  it('restores hover state on desktop when deselecting a pin by clicking it', async () => {
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Test Map',
      pins: [
        { id: 'pin-1', lat: 10, lng: 20, label: 'My Pin', position: 0 }
      ],
      layers: [],
      userRole: 'owner'
    });

    window.innerWidth = 1200;
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
      expect(screen.getByText('My Pin')).toBeInTheDocument();
    });

    const pinItem = container.querySelector('#pin-pin-1') || screen.getByText('My Pin').closest('li');
    expect(pinItem).toBeTruthy();

    // 1. Click pin to open info card (select)
    fireEvent.click(screen.getByText('My Pin'));

    // 2. Click pin label again to close info card (deselect)
    fireEvent.click(screen.getByText('My Pin'));

    // On desktop, the pin should now be hovered
    expect(getHoveredPinId()).toBe('pin-1');
  });

  it('restores hover state when deselecting a pin by clicking it even at mobile window dimensions', async () => {
    (apiService.getMap as any).mockResolvedValue({
      id: 'map-1',
      name: 'Test Map',
      pins: [
        { id: 'pin-1', lat: 10, lng: 20, label: 'My Pin', position: 0 }
      ],
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
      expect(screen.getByText('My Pin')).toBeInTheDocument();
    });

    // 1. Click pin to open info card (select)
    fireEvent.click(screen.getByText('My Pin'));

    // 2. Click pin label again to close info card (deselect)
    fireEvent.click(screen.getByText('My Pin'));

    // Pin should be hovered regardless of window width
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

    expect(screen.queryByText(/Synced/i)).not.toBeInTheDocument();

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
    expect(screen.queryByText(/Synced/i)).not.toBeInTheDocument();
  });
});

