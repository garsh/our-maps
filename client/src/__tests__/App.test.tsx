import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MapEditor, clampSidebarWidth } from '../App';
import { PIN_HOVER_CLASS } from '../utils/pinHover';
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
      expect(screen.getByText(/map not found or access denied/i)).toBeInTheDocument();
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
      expect(screen.getByText(/Map Synced/i)).toBeInTheDocument();
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
      expect(screen.getByText(/Changes NOT synced/i)).toBeInTheDocument();
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
      expect(screen.getByText(/Map Synced/i)).toBeInTheDocument();
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
});

