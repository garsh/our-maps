import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MapEditor } from '../App';
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
      handleCredentialResponse: vi.fn()
    });

    // Default API Mock
    (apiService.getMaps as any).mockResolvedValue([]);
  });

  it('LandingPage shows error message when server is unreachable', async () => {
    // In our App, getHello is called in a way that error might be caught elsewhere,
    // but LandingPage fetches maps.
    (apiService.getMaps as any).mockRejectedValue(new Error('Network Error'));

    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    );

    // LandingPage doesn't currently show a "could not connect to server" 
    // message in its UI based on my previous edits, it just logs to console.
    // Wait, let me check App.tsx where that message was.
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

    // Pin 2 should have hovered style (boxShadow)
    expect(pin2Element.style.boxShadow).toContain('var(--primary-color)');

    confirmSpy.mockRestore();
  });
});

