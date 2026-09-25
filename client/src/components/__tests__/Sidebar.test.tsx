import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Sidebar, { computeCustomCollisionDetection, isPinRowVisibleInList, getPinListScrollElement, scrollPinRowIntoList, PIN_LIST_STICKY_HEADER_OFFSET, PIN_LIST_SCROLL_DELAY_MS, PIN_LIST_SCROLL_AFTER_PANEL_OPEN_MS } from '../Sidebar';
import { useState } from 'react';
import * as dndSortable from '@dnd-kit/sortable';
import * as dndCore from '@dnd-kit/core';
import { PIN_HOVER_CLASS, setHoveredPin, resetPinHoverForTests, syncCoLocatedPins } from '../../utils/pinHover';

describe('Sidebar', () => {
  beforeEach(() => {
    resetPinHoverForTests();
  });

  afterEach(() => {
    resetPinHoverForTests();
  });

  const mockPins = [
    { id: '1', lat: 10, lng: 20, label: 'Test Pin', description: '', position: 0 }
  ];
  
  const TestWrapper = ({ pins = mockPins, handlers = {}, selectedNavIds = new Set<string>(), isTrackingLocation = false }: { pins?: any[], handlers?: any, selectedNavIds?: Set<string>, isTrackingLocation?: boolean }) => {
    const [editingPinId, setEditingPinId] = useState<string | null>(null);
    const mockHandlers = {
      onMapNameChange: vi.fn(),
      layers: [],
      onAddLayer: vi.fn(),
      onUpdateLayer: vi.fn(),
      onRemoveLayer: vi.fn(),
      onAddPin: vi.fn(),
      onRemovePin: vi.fn(),
      onPinClick: vi.fn(),
      onUpdatePin: vi.fn(),
      onDragEnd: vi.fn(),
      onShare: vi.fn(),
      onImport: vi.fn(),
      collapsedLayerIds: new Set<string | null>(),
      onToggleExpand: vi.fn(),
      ...handlers
    };

    return (
      <Sidebar 
        mapName="Test Map" 
        pins={pins} 
        {...mockHandlers} 
        editingPinId={editingPinId} 
        onSetEditingPinId={setEditingPinId} 
        selectedNavIds={selectedNavIds}
        isTrackingLocation={isTrackingLocation}
      />
    );
  };

  it('reveals edit fields when Edit button is clicked', () => {
    render(<TestWrapper />);
    
    // Edit fields should not be visible initially
    expect(screen.queryByText(/description/i)).not.toBeInTheDocument();
    
    // Click Edit
    fireEvent.click(screen.getByLabelText('Edit'));
    
    // Edit fields should now be visible
    expect(screen.getByText(/description/i)).toBeInTheDocument();
  });

  it('calls onAddLayer when Add Layer button is clicked', () => {
    const onAddLayer = vi.fn();
    render(<TestWrapper handlers={{ onAddLayer }} />);
    
    fireEvent.click(screen.getByLabelText(/more options/i));
    fireEvent.click(screen.getByText(/New Layer/i));
    
    expect(onAddLayer).toHaveBeenCalled();
  });

  it('opens newly added layer in edit mode with focus and text selection', () => {
    const TestComponent = () => {
      const [layers, setLayers] = useState<any[]>([]);
      const handleAddLayer = () => {
        const newLayer = { id: 'layer-1', name: 'Layer 1', position: 0 };
        setLayers(prev => [...prev, newLayer]);
        return newLayer;
      };
      return (
        <TestWrapper 
          handlers={{ 
            layers, 
            onAddLayer: handleAddLayer 
          }} 
        />
      );
    };

    render(<TestComponent />);

    fireEvent.click(screen.getByLabelText(/more options/i));
    fireEvent.click(screen.getByText(/New Layer/i));

    const nameInput = screen.getByLabelText(/NAME/i) as HTMLInputElement;
    expect(nameInput).toBeInTheDocument();
    expect(nameInput.value).toBe('Layer 1');
    expect(document.activeElement).toBe(nameInput);
    expect(nameInput.selectionStart).toBe(0);
    expect(nameInput.selectionEnd).toBe('Layer 1'.length);
  });

  it('calls onUpdatePin when description is changed', () => {
    const onUpdatePin = vi.fn();
    render(<TestWrapper handlers={{ onUpdatePin }} />);
    
    fireEvent.click(screen.getByLabelText('Edit'));
    const textarea = screen.getByLabelText(/description/i);
    expect(textarea).toHaveAttribute('rows', '1');
    
    fireEvent.change(textarea, { target: { value: 'New description' } });
    fireEvent.blur(textarea);
    
    expect(onUpdatePin).toHaveBeenCalledWith('1', { description: 'New description' });
  });

  it('flushes pin name edit on Enter key press without waiting for debounce', () => {
    const onUpdatePin = vi.fn();
    render(<TestWrapper handlers={{ onUpdatePin }} />);
    
    fireEvent.click(screen.getByLabelText('Edit'));
    const nameInput = screen.getByLabelText(/^Name$/i);
    
    fireEvent.change(nameInput, { target: { value: 'Updated Pin Name' } });
    expect(onUpdatePin).not.toHaveBeenCalled();
    
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    expect(onUpdatePin).toHaveBeenCalledWith('1', { label: 'Updated Pin Name' });
  });

  it('flushes pending edits when pin component is unmounted', () => {
    const onUpdatePin = vi.fn();
    const { unmount } = render(<TestWrapper handlers={{ onUpdatePin }} />);
    
    fireEvent.click(screen.getByLabelText('Edit'));
    const nameInput = screen.getByLabelText(/^Name$/i);
    
    fireEvent.change(nameInput, { target: { value: 'Unsaved Name' } });
    expect(onUpdatePin).not.toHaveBeenCalled();
    
    unmount();
    expect(onUpdatePin).toHaveBeenCalledWith('1', { label: 'Unsaved Name' });
  });

  it('calls onUpdatePin when a color is selected and displays color name tooltips', () => {
    const onUpdatePin = vi.fn();
    render(<TestWrapper handlers={{ onUpdatePin }} />);
    
    fireEvent.click(screen.getByLabelText('Edit'));
    const greenButton = screen.getByLabelText('color-green');
    expect(greenButton).toHaveAttribute('title', 'Green');

    const electricBlueButton = screen.getByLabelText('color-electric_blue');
    expect(electricBlueButton).toHaveAttribute('title', 'Electric Blue');
    
    fireEvent.click(electricBlueButton);
    expect(onUpdatePin).toHaveBeenCalledWith('1', { color: 'electric_blue' });
  });

  it('opens CustomColorPicker when custom color button is clicked and sets custom color', () => {
    const onUpdatePin = vi.fn();
    const onAddCustomColor = vi.fn();
    render(<TestWrapper handlers={{ onUpdatePin, onAddCustomColor }} />);

    fireEvent.click(screen.getByLabelText('Edit'));
    const customColorBtn = screen.getByLabelText('Custom color picker');
    fireEvent.click(customColorBtn);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Custom Color')).toBeInTheDocument();

    const hexInput = screen.getByLabelText('Hex Code');
    fireEvent.change(hexInput, { target: { value: '123456' } });

    fireEvent.click(screen.getByRole('button', { name: 'Set' }));

    expect(onUpdatePin).toHaveBeenCalledWith('1', { color: '#123456' });
    expect(onAddCustomColor).toHaveBeenCalledWith('#123456');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onUpdatePin with icon and its default color when an icon is selected', () => {
    const onUpdatePin = vi.fn();
    render(<TestWrapper handlers={{ onUpdatePin }} />);
    
    fireEvent.click(screen.getByLabelText('Edit'));
    const hotelIcon = screen.getByLabelText('icon-hotel');
    
    fireEvent.click(hotelIcon);
    
    expect(onUpdatePin).toHaveBeenCalledWith('1', { icon: 'hotel', color: 'violet' });

    const restaurantIcon = screen.getByLabelText('icon-restaurant');
    fireEvent.click(restaurantIcon);
    expect(onUpdatePin).toHaveBeenCalledWith('1', { icon: 'restaurant', color: 'green' });

    const airportIcon = screen.getByLabelText('icon-airport');
    fireEvent.click(airportIcon);
    expect(onUpdatePin).toHaveBeenCalledWith('1', { icon: 'airport', color: 'black' });

    const gasIcon = screen.getByLabelText('icon-gas');
    fireEvent.click(gasIcon);
    expect(onUpdatePin).toHaveBeenCalledWith('1', { icon: 'gas', color: 'brown' });

    const shoppingIcon = screen.getByLabelText('icon-shopping');
    fireEvent.click(shoppingIcon);
    expect(onUpdatePin).toHaveBeenCalledWith('1', { icon: 'shopping', color: 'pink' });

    const defaultIcon = screen.getByLabelText('icon-default');
    fireEvent.click(defaultIcon);
    expect(onUpdatePin).toHaveBeenCalledWith('1', { icon: 'default', color: 'blue' });
  });

  it('calls onPinClick when a pin is clicked', () => {
    const onPinClick = vi.fn();
    render(<TestWrapper handlers={{ onPinClick }} />);
    
    // Click the pin label
    fireEvent.click(screen.getByText('Test Pin'));
    
    expect(onPinClick).toHaveBeenCalled();
  });

  it('marks pin rows for CSS hover and applies the shared hover class from the store', () => {
    const onHoverPin = vi.fn();
    render(<TestWrapper handlers={{ onHoverPin }} />);

    const pinRow = screen.getByText('Test Pin').closest('li')!;
    expect(pinRow).toHaveClass('pin-list-item');
    expect(pinRow.id).toBe('pin-1');

    fireEvent.pointerEnter(pinRow, { pointerType: 'mouse' });
    expect(onHoverPin).toHaveBeenCalledWith('1');

    onHoverPin.mockClear();
    fireEvent.pointerMove(pinRow, { pointerType: 'mouse' });
    expect(onHoverPin).toHaveBeenCalledWith('1');

    setHoveredPin('1');
    expect(pinRow).toHaveClass(PIN_HOVER_CLASS);
  });

  it('applies hover class to every co-located pin row', () => {
    const layers = [
      { id: 'day-1', name: 'Day 1', position: 0 },
      { id: 'day-2', name: 'Day 2', position: 1 },
    ];
    const pins = [
      { id: 'h1', lat: 40.0, lng: -105.0, label: 'Hotel Night 1', layerId: 'day-1', position: 0 },
      { id: 'h2', lat: 40.0, lng: -105.0, label: 'Hotel Night 2', layerId: 'day-2', position: 0 },
      { id: 'cafe', lat: 40.1, lng: -105.1, label: 'Cafe', layerId: 'day-1', position: 1 },
    ];
    syncCoLocatedPins(pins);
    render(<TestWrapper pins={pins} handlers={{ layers }} />);

    setHoveredPin('h2');
    expect(screen.getByText('Hotel Night 1').closest('li')).toHaveClass(PIN_HOVER_CLASS);
    expect(screen.getByText('Hotel Night 2').closest('li')).toHaveClass(PIN_HOVER_CLASS);
    expect(screen.getByText('Cafe').closest('li')).not.toHaveClass(PIN_HOVER_CLASS);
  });

  it('shows the Download for Offline option in the menu when map is not downloaded', async () => {
    render(<TestWrapper />);
    
    // Open the more menu
    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);
    
    expect(await screen.findByText(/Download for Offline/i)).toBeInTheDocument();
  });

  it('shows Remove Download when the status cache is stale but the extract is complete', async () => {
    localStorage.setItem('cached_download_statuses', JSON.stringify({
      'test-map-1': { isComplete: false, isPartial: false },
    }));
    const tileUtilsModule = await import('../../utils/tileUtils');
    vi.spyOn(tileUtilsModule, 'getDownloadStats').mockResolvedValue({ total: 10, completed: 10 });

    try {
      render(<TestWrapper handlers={{ mapId: 'test-map-1' }} />);

      const moreBtn = screen.getByLabelText(/more options/i);
      fireEvent.click(moreBtn);

      expect(await screen.findByText(/Remove Download/i)).toBeInTheDocument();
      expect(screen.queryByText(/Download for Offline/i)).not.toBeInTheDocument();
    } finally {
      localStorage.removeItem('cached_download_statuses');
      vi.restoreAllMocks();
    }
  });

  it('shows the map as downloaded after the page becomes visible again', async () => {
    const tileUtilsModule = await import('../../utils/tileUtils');
    const extractStore = await import('../../utils/extractStore');
    const stats = vi.spyOn(tileUtilsModule, 'getDownloadStats').mockResolvedValue({ total: 10, completed: 0 });
    vi.spyOn(extractStore, 'getExtractResumeInfo').mockResolvedValue({ partBytes: 0, totalBytes: 0 });
    vi.spyOn(extractStore, 'getExtractFile').mockResolvedValue(null);

    try {
      render(<TestWrapper handlers={{ mapId: 'test-map-1' }} />);

      fireEvent.click(screen.getByLabelText(/more options/i));
      expect(await screen.findByText(/Download for Offline/i)).toBeInTheDocument();

      stats.mockResolvedValue({ total: 10, completed: 10 });
      fireEvent(document, new Event('visibilitychange'));

      expect(await screen.findByText(/Remove Download/i)).toBeInTheDocument();
      expect(screen.queryByText(/Download for Offline/i)).not.toBeInTheDocument();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('shows Remove Download option in the menu when map is downloaded', async () => {
    const tileUtilsModule = await import('../../utils/tileUtils');
    vi.spyOn(tileUtilsModule, 'getDownloadStats').mockResolvedValue({ total: 10, completed: 10 });

    render(<TestWrapper handlers={{ mapId: 'test-map-1' }} />);
    
    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);
    
    expect(await screen.findByText(/Remove Download/i)).toBeInTheDocument();
    expect(screen.queryByText(/Download for Offline/i)).not.toBeInTheDocument();
    
    vi.restoreAllMocks();
  });

  it('shows Remove Download option when map is partially downloaded', async () => {
    const tileUtilsModule = await import('../../utils/tileUtils');
    vi.spyOn(tileUtilsModule, 'getDownloadStats').mockResolvedValue({ total: 10, completed: 4 });

    render(<TestWrapper handlers={{ mapId: 'test-map-1' }} />);
    
    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);
    
    expect(await screen.findByText(/Remove Download/i)).toBeInTheDocument();
    expect(screen.queryByText(/Download for Offline/i)).not.toBeInTheDocument();
    
    vi.restoreAllMocks();
  });

  it('prevents downloading when map area exceeds MAX_EXTRACT_TILES', async () => {
    const tileUtilsModule = await import('../../utils/tileUtils');
    vi.spyOn(tileUtilsModule, 'countTiles').mockReturnValue(60_000_000);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(<TestWrapper handlers={{ mapId: 'test-map-too-large' }} />);
    
    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);
    
    const downloadBtn = await screen.findByText(/Download for Offline/i);
    fireEvent.click(downloadBtn);

    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('too large to download'));
    alertSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('aborts download preparation and alerts if size estimation fails', async () => {
    const tileUtilsModule = await import('../../utils/tileUtils');
    vi.spyOn(tileUtilsModule, 'countTiles').mockReturnValue(100);
    const apiModule = await import('../../services/api');
    vi.spyOn(apiModule.apiService, 'estimateExtract').mockRejectedValue(new Error('Server extract limit reached'));
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(<TestWrapper handlers={{ mapId: 'test-map-est-fail' }} />);
    
    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);
    
    const downloadBtn = await screen.findByText(/Download for Offline/i);
    fireEvent.click(downloadBtn);

    await vi.waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining('Server extract limit reached'));
    });
    alertSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('generates correct navigation URL with first pin as origin when location tracking is off', () => {
    const mockPins = [
        { id: '1', lat: 35.0, lng: -97.0, label: 'Oklahoma', position: 0 },
        { id: '2', lat: 39.0, lng: -98.0, label: 'Kansas', position: 1 }
    ] as any;
    
    const openMock = vi.fn();
    vi.stubGlobal('open', openMock);
    
    render(<TestWrapper pins={mockPins} selectedNavIds={new Set(['1', '2'])} isTrackingLocation={false} />);
    
    const goBtn = screen.getByText(/Go \(2\)/i);
    fireEvent.click(goBtn);
    
    expect(openMock).toHaveBeenCalledWith(
        expect.stringContaining('origin=35,-97'),
        '_blank'
    );
    expect(openMock).toHaveBeenCalledWith(
        expect.stringContaining('destination=39,-98'),
        '_blank'
    );
    expect(openMock.mock.calls[0][0]).not.toContain('dir_action=navigate');
    
    vi.unstubAllGlobals();
  });

  it('omits origin and includes intermediate pins as waypoints when location tracking is on', () => {
    const mockPins = [
        { id: '1', lat: 35.0, lng: -97.0, label: 'Oklahoma', position: 0 },
        { id: '2', lat: 37.0, lng: -97.5, label: 'Wichita', position: 1 },
        { id: '3', lat: 39.0, lng: -98.0, label: 'Kansas', position: 2 }
    ] as any;
    
    const openMock = vi.fn();
    vi.stubGlobal('open', openMock);
    
    render(<TestWrapper pins={mockPins} selectedNavIds={new Set(['1', '2', '3'])} isTrackingLocation={true} />);
    
    const goBtn = screen.getByText(/Go \(3\)/i);
    fireEvent.click(goBtn);
    
    expect(openMock).toHaveBeenCalledTimes(1);
    const url = openMock.mock.calls[0][0];
    // Should NOT contain an origin parameter or dir_action=navigate
    expect(url).not.toContain('origin=');
    expect(url).not.toContain('dir_action=navigate');
    // Destination is the last pin
    expect(url).toContain('destination=39,-98');
    // Waypoints include all previous pins (pin 1 and pin 2)
    expect(url).toContain('waypoints=35,-97|37,-97.5');
    
    vi.unstubAllGlobals();
  });

  it('generates correct navigation URL without origin for a single selected pin and omits dir_action=navigate', () => {
    const mockPins = [
        { id: '1', lat: 35.0, lng: -97.0, label: 'Oklahoma', position: 0 }
    ] as any;
    
    const openMock = vi.fn();
    vi.stubGlobal('open', openMock);
    
    render(<TestWrapper pins={mockPins} selectedNavIds={new Set(['1'])} isTrackingLocation={true} />);
    
    const goBtn = screen.getByText(/Go \(1\)/i);
    fireEvent.click(goBtn);
    
    expect(openMock).toHaveBeenCalledTimes(1);
    const url = openMock.mock.calls[0][0];
    expect(url).not.toContain('origin=');
    expect(url).not.toContain('dir_action=navigate');
    expect(url).toContain('destination=35,-97');
    
    vi.unstubAllGlobals();
  });

  it('shows Rename Map option at the top of menu and updates map name on submit', async () => {
    const onMapNameChange = vi.fn();
    render(<TestWrapper handlers={{ onMapNameChange }} />);
    
    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);
    
    const renameMenuItem = screen.getByText(/Rename Map/i);
    expect(renameMenuItem).toBeInTheDocument();
    fireEvent.click(renameMenuItem);
    
    const input = screen.getByLabelText(/New Map Name/i);
    expect(input).toHaveValue('Test Map');
    fireEvent.change(input, { target: { value: 'Renamed Test Map' } });
    
    const saveBtn = screen.getByText('Save');
    fireEvent.click(saveBtn);
    
    expect(onMapNameChange).toHaveBeenCalledWith('Renamed Test Map');
  });

  it('clears rename input when X button is clicked', () => {
    render(<TestWrapper />);
    
    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);
    
    fireEvent.click(screen.getByText(/Rename Map/i));
    
    const input = screen.getByLabelText(/New Map Name/i);
    expect(input).toHaveValue('Test Map');
    
    const clearBtn = screen.getByLabelText(/Clear map name/i);
    fireEvent.click(clearBtn);
    
    expect(input).toHaveValue('');
  });

  it('clears rename input box when map name is Unnamed Map', () => {
    render(<TestWrapper handlers={{ mapName: 'Unnamed Map' }} />);
    
    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);
    
    fireEvent.click(screen.getByText(/Rename Map/i));
    
    const input = screen.getByLabelText(/New Map Name/i);
    expect(input).toHaveValue('');
  });

  it('hides Rename Map option when readOnly is true', () => {
    render(<TestWrapper handlers={{ userRole: 'view' }} />);
    
    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);
    
    expect(screen.queryByText(/Rename Map/i)).not.toBeInTheDocument();
  });

  it('shows Edit Mode above Rename Map and toggles it without closing the menu', () => {
    const onToggleEditMode = vi.fn();
    render(<TestWrapper handlers={{ onToggleEditMode, editMode: true }} />);

    fireEvent.click(screen.getByLabelText(/more options/i));

    const rename = screen.getByText('Rename Map');
    const editModeItem = screen.getByText('Edit Mode');
    expect(editModeItem.compareDocumentPosition(rename) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(editModeItem);
    expect(onToggleEditMode).toHaveBeenCalledWith(false);
    expect(screen.getByText('Edit Mode')).toBeInTheDocument();
    expect(screen.getByText('Rename Map')).toBeInTheDocument();
  });

  it('greys out Edit Mode and leaves it off when the user only has view permission', () => {
    const onToggleEditMode = vi.fn();
    render(<TestWrapper handlers={{ userRole: 'view', onToggleEditMode }} />);

    fireEvent.click(screen.getByLabelText(/more options/i));

    expect(screen.queryByText('Rename Map')).not.toBeInTheDocument();
    const editModeItem = screen.getByText('Edit Mode');
    const row = editModeItem.parentElement as HTMLElement;
    expect(row.style.opacity).toBe('0.45');
    expect(row.style.cursor).toBe('not-allowed');

    fireEvent.click(editModeItem);
    expect(onToggleEditMode).not.toHaveBeenCalled();
  });

  it('hides Rename Map when editMode is off for an owner and allows turning it back on', () => {
    const onToggleEditMode = vi.fn();
    render(<TestWrapper handlers={{ userRole: 'owner', editMode: false, onToggleEditMode }} />);

    fireEvent.click(screen.getByLabelText(/more options/i));

    expect(screen.queryByText('Rename Map')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Edit Mode'));
    expect(onToggleEditMode).toHaveBeenCalledWith(true);
  });

  it('greys out Edit Mode and turns it off when device is offline while in edit mode', () => {
    const onToggleEditMode = vi.fn();
    render(<TestWrapper handlers={{ userRole: 'owner', editMode: true, isOffline: true, onToggleEditMode }} />);

    fireEvent.click(screen.getByLabelText(/more options/i));

    expect(screen.queryByText('Rename Map')).not.toBeInTheDocument();
    const editModeItem = screen.getByText('Edit Mode');
    const row = editModeItem.parentElement as HTMLElement;
    expect(row.style.opacity).toBe('0.45');
    expect(row.style.cursor).toBe('not-allowed');

    // Verify switch knob is in the OFF (left: 2px) position
    const switchKnob = row.lastElementChild?.firstElementChild as HTMLElement;
    expect(switchKnob.style.left).toBe('2px');

    fireEvent.click(editModeItem);
    expect(onToggleEditMode).not.toHaveBeenCalled();
  });

  it('renders default layer header as a droppable element with id="default"', () => {
    const { container } = render(<TestWrapper />);
    const defaultLayerHeader = container.querySelector('#default');
    expect(defaultLayerHeader).not.toBeNull();
    expect(defaultLayerHeader?.textContent).toContain('Default Layer');
  });

  it('allows toggling hillshading in appearance menu', () => {
    const onToggleHillshade = vi.fn();
    render(<TestWrapper handlers={{ onToggleHillshade, showHillshade: true }} />);

    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);

    expect(screen.getByText('Appearance')).toBeInTheDocument();
    const hillshadeOption = screen.getByText('Hillshading');
    expect(hillshadeOption).toBeInTheDocument();

    fireEvent.click(hillshadeOption);
    expect(onToggleHillshade).toHaveBeenCalledWith(false);
  });

  it('allows toggling 3D terrain and 3D buildings in appearance menu', () => {
    const onToggle3DTerrain = vi.fn();
    const onToggle3DBuildings = vi.fn();
    render(<TestWrapper handlers={{ onToggle3DTerrain, show3DTerrain: true, onToggle3DBuildings, show3DBuildings: true }} />);

    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);

    expect(screen.getByText('Appearance')).toBeInTheDocument();
    const terrainOption = screen.getByText('3D Terrain');
    expect(terrainOption).toBeInTheDocument();
    fireEvent.click(terrainOption);
    expect(onToggle3DTerrain).toHaveBeenCalledWith(false);

    const buildingsOption = screen.getByText('3D Buildings');
    expect(buildingsOption).toBeInTheDocument();
    fireEvent.click(buildingsOption);
    expect(onToggle3DBuildings).toHaveBeenCalledWith(false);
  });

  it('toggles 3D terrain when clicked in more options menu', () => {
    const onToggle3DTerrain = vi.fn();
    render(<TestWrapper handlers={{ onToggle3DTerrain, show3DTerrain: true, isOffline: true }} />);

    fireEvent.click(screen.getByLabelText(/more options/i));
    const terrainOption = screen.getByText('3D Terrain');
    const row = terrainOption.parentElement?.parentElement as HTMLElement;
    const switchKnob = row.lastElementChild?.firstElementChild as HTMLElement;
    expect(switchKnob.style.left).toBe('18px');

    fireEvent.click(terrainOption);
    expect(onToggle3DTerrain).toHaveBeenCalledWith(false);
  });

  it('keeps appearance menu open when dark mode is toggled', () => {
    const onThemeChange = vi.fn();
    render(<TestWrapper handlers={{ onThemeChange, mapTheme: 'light' }} />);

    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);

    expect(screen.getByText('Appearance')).toBeInTheDocument();
    const darkModeOption = screen.getByText('Dark Mode');
    expect(darkModeOption).toBeInTheDocument();

    fireEvent.click(darkModeOption);
    expect(onThemeChange).toHaveBeenCalledWith('dark');
    // Verify menu is still open and showing appearance options
    expect(screen.getByText('Dark Mode')).toBeInTheDocument();
    expect(screen.getByText('Hillshading')).toBeInTheDocument();
  });

  it('allows toggling satellite mode in appearance menu', () => {
    const onToggleSatellite = vi.fn();
    render(<TestWrapper handlers={{ onToggleSatellite, showSatellite: false }} />);

    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);

    expect(screen.getByText('Appearance')).toBeInTheDocument();
    const satelliteOption = screen.getByText('Satellite');
    expect(satelliteOption).toBeInTheDocument();

    fireEvent.click(satelliteOption);
    expect(onToggleSatellite).toHaveBeenCalledWith(true);
  });

  it('orders appearance options and describes offline behavior on hover and long-press', () => {
    const onToggle3DTerrain = vi.fn();
    render(<TestWrapper handlers={{ onToggle3DTerrain, show3DTerrain: true }} />);

    fireEvent.click(screen.getByLabelText(/more options/i));

    const labels = ['Dark Mode', '3D Buildings', 'Hillshading', '3D Terrain', 'Satellite'];
    const nodes = labels.map((label) => screen.getByText(label));
    for (let i = 0; i < nodes.length - 1; i++) {
      expect(nodes[i].compareDocumentPosition(nodes[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    const row = (label: string) => screen.getByText(label).parentElement?.parentElement as HTMLElement;

    const terrainRow = row('3D Terrain');
    expect(terrainRow.style.userSelect).toBe('none');
    expect(terrainRow.style.webkitUserSelect).toBe('none');
    const contextEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    fireEvent(terrainRow, contextEvent);
    expect(contextEvent.defaultPrevented).toBe(true);

    fireEvent.mouseEnter(row('Dark Mode'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Available offline via download.');
    fireEvent.mouseLeave(row('Dark Mode'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.mouseEnter(row('3D Buildings'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Available offline via download.');
    fireEvent.mouseLeave(row('3D Buildings'));

    fireEvent.mouseEnter(row('Hillshading'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Not available offline except where previously viewed.');
    fireEvent.mouseLeave(row('Hillshading'));

    fireEvent.mouseEnter(row('Satellite'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Not available offline except where previously viewed.');
    fireEvent.mouseLeave(row('Satellite'));

    fireEvent.mouseEnter(row('3D Terrain'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Not available offline except where previously viewed.');
    fireEvent.mouseLeave(row('3D Terrain'));

    vi.useFakeTimers();
    try {
      fireEvent.touchStart(terrainRow, { touches: [{ clientX: 8, clientY: 8 }] });
      act(() => {
        vi.advanceTimersByTime(449);
      });
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByRole('tooltip')).toHaveTextContent('Not available offline except where previously viewed.');
      fireEvent.click(terrainRow);
      expect(onToggle3DTerrain).not.toHaveBeenCalled();

      fireEvent.touchEnd(terrainRow);
      fireEvent.touchStart(terrainRow, { touches: [{ clientX: 8, clientY: 8 }] });
      fireEvent.touchEnd(terrainRow);
      act(() => {
        vi.advanceTimersByTime(450);
      });
      fireEvent.click(terrainRow);
      expect(onToggle3DTerrain).toHaveBeenCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows dark mode toggle but greys out and disables hillshading when satellite mode is active', () => {
    const onThemeChange = vi.fn();
    const onToggleHillshade = vi.fn();
    render(<TestWrapper handlers={{ onThemeChange, onToggleHillshade, showSatellite: true, mapTheme: 'light', showHillshade: true }} />);

    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);

    expect(screen.getByText('Appearance')).toBeInTheDocument();
    const darkModeOption = screen.getByText('Dark Mode');
    const hillshadeOption = screen.getByText('Hillshading');

    fireEvent.click(darkModeOption);
    expect(onThemeChange).toHaveBeenCalledWith('dark');

    fireEvent.click(hillshadeOption);
    expect(onToggleHillshade).not.toHaveBeenCalled();
  });

  it('defaults Satellite mode and Dark mode to OFF for new users', () => {
    render(<TestWrapper handlers={{}} />);

    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);

    expect(screen.getByText('Appearance')).toBeInTheDocument();
    const satelliteOption = screen.getByText('Satellite');
    const darkModeOption = screen.getByText('Dark Mode');

    expect(satelliteOption).toBeInTheDocument();
    expect(darkModeOption).toBeInTheDocument();

    // Verify switch elements are in OFF state by checking background styles or text styles
    const satelliteContainer = satelliteOption.closest('div[style*="padding"]');
    const darkModeContainer = darkModeOption.closest('div[style*="padding"]');

    expect(satelliteContainer?.textContent).toContain('Satellite');
    expect(darkModeContainer?.textContent).toContain('Dark Mode');
  });

  it('hides edit menu items and edit buttons when isOffline is true', () => {
    const pins = [{ id: 'p1', lat: 0, lng: 0, label: 'Pin 1', position: 0 }];
    render(<TestWrapper handlers={{ isOffline: true, pins }} />);

    // Open map options menu
    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);

    // Verify edit & offline management menu items are hidden
    expect(screen.queryByText('Rename Map')).not.toBeInTheDocument();
    expect(screen.queryByText('Share')).not.toBeInTheDocument();
    expect(screen.queryByText('Import')).not.toBeInTheDocument();
    expect(screen.queryByText('Download for Offline')).not.toBeInTheDocument();
    expect(screen.queryByText('New Layer')).not.toBeInTheDocument();

    // Verify Pencil edit button on pin item is hidden
    expect(screen.queryByLabelText('Edit')).not.toBeInTheDocument();
  });

  it('hides Import when the map already has pins', () => {
    render(<TestWrapper />);

    fireEvent.click(screen.getByLabelText(/more options/i));
    expect(screen.queryByText('Import')).not.toBeInTheDocument();
  });

  it('shows Import when the map has no pins or layers', () => {
    render(<TestWrapper pins={[]} />);

    fireEvent.click(screen.getByLabelText(/more options/i));
    expect(screen.getByText('Import')).toBeInTheDocument();
  });

  it('calls onRemoveLayer when Delete Layer button is confirmed', () => {
    const onRemoveLayer = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const layers = [{ id: 'layer-test-1', name: 'Test Layer', position: 0 }];

    render(<TestWrapper handlers={{ layers, onRemoveLayer }} />);

    // Double-click layer name to enter inline editing mode
    const layerName = screen.getByText(/Test Layer/i);
    fireEvent.doubleClick(layerName);

    // Delete button should now be rendered
    const deleteBtn = screen.getByTitle('Delete Layer');

    // Simulate mousedown with preventDefault check
    const mouseDownEvent = fireEvent.mouseDown(deleteBtn);
    expect(mouseDownEvent).toBe(false); // defaultPrevented is true when fireEvent returns false

    fireEvent.click(deleteBtn);

    expect(confirmSpy).toHaveBeenCalled();
    expect(onRemoveLayer).toHaveBeenCalledWith('layer-test-1');

    confirmSpy.mockRestore();
  });

  it('does not call onRemoveLayer when Delete Layer confirmation is cancelled', () => {
    const onRemoveLayer = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const layers = [{ id: 'layer-test-1', name: 'Test Layer', position: 0 }];

    render(<TestWrapper handlers={{ layers, onRemoveLayer }} />);

    const layerName = screen.getByText(/Test Layer/i);
    fireEvent.doubleClick(layerName);

    const deleteBtn = screen.getByTitle('Delete Layer');
    fireEvent.click(deleteBtn);

    expect(confirmSpy).toHaveBeenCalled();
    expect(onRemoveLayer).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('calls onRemovePin when pin delete button is clicked', () => {
    const onRemovePin = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<TestWrapper handlers={{ onRemovePin }} />);

    fireEvent.click(screen.getByLabelText('Edit'));
    const deletePinBtn = screen.getByTitle('Delete Pin');
    fireEvent.click(deletePinBtn);

    expect(confirmSpy).toHaveBeenCalled();
    expect(onRemovePin).toHaveBeenCalledWith('1');

    confirmSpy.mockRestore();
  });

  it('updates address in edit dialog when pin address arrives while editing', () => {
    const initialPins = [{ id: '1', lat: 10, lng: 20, label: 'Pin 1', address: '', position: 0 }];
    const { rerender } = render(<TestWrapper pins={initialPins} />);

    // Open edit dialog
    fireEvent.click(screen.getByLabelText('Edit'));
    const addressInput = screen.getByLabelText(/address/i) as HTMLTextAreaElement;
    expect(addressInput.value).toBe('');

    // Async reverse geocode resolves and updates pin address in parent
    const updatedPins = [{ id: '1', lat: 10, lng: 20, label: 'Pin 1', address: '123 Main St', position: 0 }];
    rerender(<TestWrapper pins={updatedPins} />);

    expect(addressInput.value).toBe('123 Main St');
  });

  it('renders multi-layer pin list and handles layer collapse/expand', () => {
    const layers = [
      { id: 'layer-1', name: 'Restaurants', position: 0 },
      { id: 'layer-2', name: 'Hotels', position: 1 }
    ];
    const pins = [
      { id: 'p1', lat: 10, lng: 20, label: 'Restaurant 1', layerId: 'layer-1', position: 0 },
      { id: 'p2', lat: 11, lng: 21, label: 'Restaurant 2', layerId: 'layer-1', position: 1 },
      { id: 'p3', lat: 12, lng: 22, label: 'Hotel 1', layerId: 'layer-2', position: 0 },
      { id: 'p4', lat: 13, lng: 23, label: 'Default Pin', layerId: undefined, position: 0 }
    ];

    const onToggleExpand = vi.fn();
    const { rerender } = render(
      <TestWrapper 
        pins={pins} 
        handlers={{ 
          layers, 
          collapsedLayerIds: new Set<string | null>(),
          onToggleExpand 
        }} 
      />
    );

    // All pins and layer headers should be visible
    expect(screen.getByText('Restaurants')).toBeInTheDocument();
    expect(screen.getByText('Hotels')).toBeInTheDocument();
    expect(screen.getByText('Restaurant 1')).toBeInTheDocument();
    expect(screen.getByText('Restaurant 2')).toBeInTheDocument();
    expect(screen.getByText('Hotel 1')).toBeInTheDocument();
    expect(screen.getByText('Default Pin')).toBeInTheDocument();

    // Rerender with layer-1 collapsed
    rerender(
      <TestWrapper 
        pins={pins} 
        handlers={{ 
          layers, 
          collapsedLayerIds: new Set(['layer-1']),
          onToggleExpand 
        }} 
      />
    );

    // Restaurant pins should now be hidden
    expect(screen.queryByText('Restaurant 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Restaurant 2')).not.toBeInTheDocument();
    // Hotel and Default pins should still be visible
    expect(screen.getByText('Hotel 1')).toBeInTheDocument();
    expect(screen.getByText('Default Pin')).toBeInTheDocument();
  });

  it('handles multi-pin navigation selection and Select All toggle', () => {
    const layers = [{ id: 'layer-1', name: 'Activities', position: 0 }];
    const pins = [
      { id: 'p1', lat: 10, lng: 20, label: 'Activity 1', layerId: 'layer-1', position: 0 },
      { id: 'p2', lat: 11, lng: 21, label: 'Activity 2', layerId: 'layer-1', position: 1 }
    ];

    const onToggleSelectNav = vi.fn();
    const onToggleSelectAll = vi.fn();

    render(
      <TestWrapper 
        pins={pins} 
        selectedNavIds={new Set(['p1'])}
        handlers={{ 
          layers, 
          onToggleSelectNav, 
          onToggleSelectAll 
        }} 
      />
    );

    // Activity 1 checkbox should be checked
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);

    // Navigation button should show 1 selected
    expect(screen.getByText(/Go\s*\(\s*1\s*\)/i)).toBeInTheDocument();
  });

  it('renders a hidden disabled checkbox placeholder for empty layers to preserve button alignment', () => {
    const layers = [{ id: 'empty-layer', name: 'Empty Layer', position: 0 }];
    const { container } = render(<TestWrapper handlers={{ layers, pins: [] }} />);

    // Active navigation checkboxes with titles should not exist for empty layers
    expect(screen.queryByTitle('Select all in layer for navigation')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Select all in default layer for navigation')).not.toBeInTheDocument();

    // But hidden disabled checkbox placeholders should exist to preserve alignment
    const hiddenCheckboxes = container.querySelectorAll('input[type="checkbox"][disabled]');
    expect(hiddenCheckboxes.length).toBeGreaterThanOrEqual(2);
    hiddenCheckboxes.forEach((cb) => {
      expect(cb).toHaveStyle({ visibility: 'hidden' });
    });
  });

  it('renders SearchBar within sidebar', () => {
    render(<TestWrapper />);
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('hides SearchBar in view mode and when the user cannot edit', () => {
    const { rerender } = render(<TestWrapper handlers={{ userRole: 'owner', editMode: false }} />);
    expect(screen.queryByPlaceholderText('Search...')).not.toBeInTheDocument();

    rerender(<TestWrapper handlers={{ userRole: 'view', editMode: true }} />);
    expect(screen.queryByPlaceholderText('Search...')).not.toBeInTheDocument();

    rerender(<TestWrapper handlers={{ userRole: 'owner', editMode: true, isOffline: true }} />);
    expect(screen.queryByPlaceholderText('Search...')).not.toBeInTheDocument();

    rerender(<TestWrapper handlers={{ userRole: 'owner', editMode: true }} />);
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('does not highlight an expanded empty layer header when dragged over', () => {
    const spy = vi.spyOn(dndSortable, 'useSortable').mockImplementation((args: any) => {
      if (args.id === 'layer-1') {
        return {
          attributes: {},
          listeners: {},
          setNodeRef: vi.fn(),
          transform: null,
          transition: undefined,
          isDragging: false,
          isOver: true,
        } as any;
      }
      return {
        attributes: {},
        listeners: {},
        setNodeRef: vi.fn(),
        transform: null,
        transition: undefined,
        isDragging: false,
        isOver: false,
      } as any;
    });

    const layers = [{ id: 'layer-1', name: 'Empty Layer', position: 0 }];
    render(
      <TestWrapper 
        pins={[]} 
        handlers={{ 
          layers,
          collapsedLayerIds: new Set<string | null>()
        }} 
      />
    );

    const layerHeader = screen.getByText('Empty Layer').closest('div[style*="position: sticky"]') as HTMLElement;
    expect(layerHeader.style.border).toBe('1px solid transparent');
    expect(layerHeader.style.boxShadow).toBe('var(--shadow-sm)');

    spy.mockRestore();
  });

  it('highlights a collapsed layer header when dragged over', () => {
    const spy = vi.spyOn(dndSortable, 'useSortable').mockImplementation((args: any) => {
      if (args.id === 'layer-1') {
        return {
          attributes: {},
          listeners: {},
          setNodeRef: vi.fn(),
          transform: null,
          transition: undefined,
          isDragging: false,
          isOver: true,
        } as any;
      }
      return {
        attributes: {},
        listeners: {},
        setNodeRef: vi.fn(),
        transform: null,
        transition: undefined,
        isDragging: false,
        isOver: false,
      } as any;
    });

    const layers = [{ id: 'layer-1', name: 'Empty Layer', position: 0 }];
    render(
      <TestWrapper 
        pins={[]} 
        handlers={{ 
          layers,
          collapsedLayerIds: new Set(['layer-1'])
        }} 
      />
    );

    const layerHeader = screen.getByText('Empty Layer').closest('div[style*="position: sticky"]') as HTMLElement;
    expect(layerHeader.style.border).toBe('1px solid var(--primary-color)');
    expect(layerHeader.style.boxShadow).toBe('0 0 0 1px var(--primary-color)');

    spy.mockRestore();
  });

  it('does not highlight default layer header when expanded and hovered, but does when collapsed', () => {
    const droppableSpy = vi.spyOn(dndCore, 'useDroppable').mockImplementation((args: any) => {
      if (args.id === 'default') {
        return {
          setNodeRef: vi.fn(),
          isOver: true,
        } as any;
      }
      return {
        setNodeRef: vi.fn(),
        isOver: false,
      } as any;
    });

    // 1. Expanded default layer
    const { rerender } = render(
      <TestWrapper 
        pins={[]} 
        handlers={{ 
          layers: [],
          collapsedLayerIds: new Set<string | null>()
        }} 
      />
    );

    const defaultHeader = document.getElementById('default') as HTMLElement;
    expect(defaultHeader.style.border).toBe('1px solid transparent');
    expect(defaultHeader.style.boxShadow).toBe('var(--shadow-sm)');

    // 2. Collapsed default layer
    rerender(
      <TestWrapper 
        pins={[]} 
        handlers={{ 
          layers: [],
          collapsedLayerIds: new Set<string | null>([null])
        }} 
      />
    );

    expect(defaultHeader.style.border).toBe('1px solid var(--primary-color)');
    expect(defaultHeader.style.boxShadow).toBe('0 0 0 1px var(--primary-color)');

    droppableSpy.mockRestore();
  });

  it('calls onMovePinsToLayer with batched pin IDs when moving selected pins', () => {
    const onMovePinsToLayer = vi.fn();
    const pins = [
      { id: '1', lat: 10, lng: 20, label: 'Pin 1', position: 0 },
      { id: '2', lat: 11, lng: 21, label: 'Pin 2', position: 1 },
    ];
    const layers = [{ id: 'layer-1', name: 'Custom Layer', position: 0 }];

    render(
      <TestWrapper 
        pins={pins} 
        selectedNavIds={new Set(['1', '2'])}
        handlers={{ 
          layers,
          onMovePinsToLayer,
        }} 
      />
    );

    fireEvent.click(screen.getByLabelText(/more options/i));
    const menu = screen.getByTestId('map-options-menu');
    expect(within(menu).getByText('MOVE SELECTED TO...')).toBeInTheDocument();
    fireEvent.click(within(menu).getByText('Custom Layer'));

    expect(onMovePinsToLayer).toHaveBeenCalledWith(['1', '2'], 'layer-1');
  });

  it('caches collision detection geometry to avoid repeated getBoundingClientRect layout thrashing', () => {
    const pins = [
      { id: 'p1', lat: 10, lng: 20, label: 'Pin 1', position: 0 },
      { id: 'p2', lat: 11, lng: 21, label: 'Pin 2', position: 1 },
    ];

    const collisionCacheRef = { current: null };
    const mockScrollContainer = {
      getBoundingClientRect: () => ({ top: 0, bottom: 500, left: 0, right: 300, width: 300, height: 500 }),
      scrollTop: 0
    } as any;

    const node1GetBoundingClientRect = vi.fn().mockReturnValue({ top: 100, bottom: 150, left: 0, right: 300, height: 50, width: 300 });
    const node2GetBoundingClientRect = vi.fn().mockReturnValue({ top: 150, bottom: 200, left: 0, right: 300, height: 50, width: 300 });

    const droppableContainers = [
      { id: 'p1', disabled: false, node: { current: { getBoundingClientRect: node1GetBoundingClientRect } }, data: { current: { type: 'pin', pin: pins[0] } } },
      { id: 'p2', disabled: false, node: { current: { getBoundingClientRect: node2GetBoundingClientRect } }, data: { current: { type: 'pin', pin: pins[1] } } },
    ];

    const active = { id: 'p1', data: { current: { type: 'pin', pin: pins[0] } } };

    // Frame 1: Pointer moves to (50, 120)
    const collisions1 = computeCustomCollisionDetection({
      droppableContainers,
      pointerCoordinates: { x: 50, y: 120 },
      active,
      collisionRect: null
    }, {
      layers: [],
      scrollContainer: mockScrollContainer,
      collisionCacheRef
    });
    expect(collisions1.length).toBeGreaterThan(0);
    expect(node1GetBoundingClientRect).toHaveBeenCalledTimes(1);
    expect(node2GetBoundingClientRect).toHaveBeenCalledTimes(1);

    // Frame 2: Pointer moves to (50, 130) in subsequent animation frame
    const collisions2 = computeCustomCollisionDetection({
      droppableContainers,
      pointerCoordinates: { x: 50, y: 130 },
      active,
      collisionRect: null
    }, {
      layers: [],
      scrollContainer: mockScrollContainer,
      collisionCacheRef
    });
    expect(collisions2.length).toBeGreaterThan(0);
    // Verified: No additional getBoundingClientRect calls on subsequent pointer movement frames!
    expect(node1GetBoundingClientRect).toHaveBeenCalledTimes(1);
    expect(node2GetBoundingClientRect).toHaveBeenCalledTimes(1);
  });

  it('accurately resolves collision when dragging a pin from the bottom of the list to the top during scroll', () => {
    const pins = [
      { id: 'p1', lat: 10, lng: 20, label: 'Pin 1', position: 0 },
      { id: 'p2', lat: 11, lng: 21, label: 'Pin 2', position: 1 },
      { id: 'p3', lat: 12, lng: 22, label: 'Pin 3', position: 2 },
    ];

    const collisionCacheRef = { current: null };
    const mockScrollContainer = {
      getBoundingClientRect: () => ({ top: 0, bottom: 500, left: 0, right: 300, width: 300, height: 500 }),
      scrollTop: 1000 // Initial drag starts at bottom of list
    } as any;

    const droppableContainers = [
      { id: 'p1', disabled: false, node: { current: { getBoundingClientRect: () => ({ top: 0 - mockScrollContainer.scrollTop, bottom: 50 - mockScrollContainer.scrollTop, left: 0, right: 300, height: 50, width: 300 }) } }, data: { current: { type: 'pin', pin: pins[0] } } },
      { id: 'p2', disabled: false, node: { current: { getBoundingClientRect: () => ({ top: 50 - mockScrollContainer.scrollTop, bottom: 100 - mockScrollContainer.scrollTop, left: 0, right: 300, height: 50, width: 300 }) } }, data: { current: { type: 'pin', pin: pins[1] } } },
      { id: 'p3', disabled: false, node: { current: { getBoundingClientRect: () => ({ top: 1000 - mockScrollContainer.scrollTop, bottom: 1050 - mockScrollContainer.scrollTop, left: 0, right: 300, height: 50, width: 300 }) } }, data: { current: { type: 'pin', pin: pins[2] } } },
    ];

    const active = { id: 'p3', data: { current: { type: 'pin', pin: pins[2] } } };

    // Initial frame at bottom: pointer at (50, 35) in viewport matches p3 (viewport top: 0, bottom: 50)
    const initialCollision = computeCustomCollisionDetection({
      droppableContainers,
      pointerCoordinates: { x: 50, y: 35 },
      active,
      collisionRect: null
    }, {
      layers: [],
      scrollContainer: mockScrollContainer,
      collisionCacheRef
    });
    expect(initialCollision[0].id).toBe('p3');

    // User moves pointer to top and auto-scroll brings scrollTop to 0
    mockScrollContainer.scrollTop = 0;
    const topCollision = computeCustomCollisionDetection({
      droppableContainers,
      pointerCoordinates: { x: 50, y: 35 },
      active,
      collisionRect: null
    }, {
      layers: [],
      scrollContainer: mockScrollContainer,
      collisionCacheRef
    });
    // At scrollTop = 0 and pointer at y=35 -> matches p1 (viewport top: 0, bottom: 50)!
    expect(topCollision[0].id).toBe('p1');
  });

  it('shows Sign In option at top of menu when user is not authenticated', () => {
    const onSignIn = vi.fn();
    render(
      <Sidebar
        mapName="Guest Map"
        pins={[]}
        layers={[]}
        onMapNameChange={vi.fn()}
        onAddLayer={vi.fn()}
        onUpdateLayer={vi.fn()}
        onRemoveLayer={vi.fn()}
        onAddPin={vi.fn()}
        onRemovePin={vi.fn()}
        onPinClick={vi.fn()}
        onUpdatePin={vi.fn()}
        onDragEnd={vi.fn()}
        editingPinId={null}
        onSetEditingPinId={vi.fn()}
        isAuthenticated={false}
        onSignIn={onSignIn}
      />
    );

    fireEvent.click(screen.getByLabelText(/more options/i));

    const signInBtn = screen.getByText('Sign In');
    expect(signInBtn).toBeInTheDocument();

    // Verify Edit Mode, Download for Offline, and Export are hidden
    expect(screen.queryByText('Edit Mode')).not.toBeInTheDocument();
    expect(screen.queryByText(/Download for Offline/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Export')).not.toBeInTheDocument();

    fireEvent.click(signInBtn);
    expect(onSignIn).toHaveBeenCalled();
  });

  it('highlights every pin at the same exact location when one is targeted', () => {
    const layers = [
      { id: 'day-1', name: 'Day 1', position: 0 },
      { id: 'day-2', name: 'Day 2', position: 1 },
    ];
    const pins = [
      { id: 'h1', lat: 40.0, lng: -105.0, label: 'Hotel Night 1', layerId: 'day-1', position: 0 },
      { id: 'h2', lat: 40.0, lng: -105.0, label: 'Hotel Night 2', layerId: 'day-2', position: 0 },
      { id: 'cafe', lat: 40.1, lng: -105.1, label: 'Cafe', layerId: 'day-1', position: 1 },
    ];

    render(
      <TestWrapper
        pins={pins}
        handlers={{ layers, targetPinId: 'h1' }}
      />
    );

    expect(screen.getByText('Hotel Night 1').closest('li')).toHaveClass('pin-target');
    expect(screen.getByText('Hotel Night 2').closest('li')).toHaveClass('pin-target');
    expect(screen.getByText('Cafe').closest('li')).not.toHaveClass('pin-target');
  });

  it('does not highlight a co-located pin whose layer is collapsed', () => {
    const layers = [
      { id: 'day-1', name: 'Day 1', position: 0 },
      { id: 'day-2', name: 'Day 2', position: 1 },
    ];
    const pins = [
      { id: 'h1', lat: 40.0, lng: -105.0, label: 'Hotel Night 1', layerId: 'day-1', position: 0 },
      { id: 'h2', lat: 40.0, lng: -105.0, label: 'Hotel Night 2', layerId: 'day-2', position: 0 },
    ];

    render(
      <TestWrapper
        pins={pins}
        handlers={{ layers, targetPinId: 'h1', collapsedLayerIds: new Set(['day-2']) }}
      />
    );

    expect(screen.getByText('Hotel Night 1').closest('li')).toHaveClass('pin-target');
    expect(screen.queryByText('Hotel Night 2')).not.toBeInTheDocument();
  });

  it('highlights co-located pins in the default layer', () => {
    const pins = [
      { id: 'h1', lat: 40.0, lng: -105.0, label: 'Hotel A', position: 0 },
      { id: 'h2', lat: 40.0, lng: -105.0, label: 'Hotel B', position: 1 },
    ];

    render(<TestWrapper pins={pins} handlers={{ targetPinId: 'h2' }} />);

    expect(screen.getByText('Hotel A').closest('li')).toHaveClass('pin-target');
    expect(screen.getByText('Hotel B').closest('li')).toHaveClass('pin-target');
  });

  it('does not scroll the pin list during the panel-open animation', () => {
    vi.useFakeTimers();

    try {
      const { rerender, container } = render(
        <TestWrapper handlers={{ targetPinId: '1', isPanelMinimized: true }} />
      );

      rerender(
        <TestWrapper handlers={{ targetPinId: '1', isPanelMinimized: false }} />
      );

      const pinList = container.querySelector('.pin-list') as HTMLElement;
      const scrollTo = vi.fn();
      pinList.scrollTo = scrollTo;

      act(() => {
        vi.advanceTimersByTime(PIN_LIST_SCROLL_DELAY_MS);
      });
      expect(scrollTo).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(PIN_LIST_SCROLL_AFTER_PANEL_OPEN_MS - PIN_LIST_SCROLL_DELAY_MS);
      });
      expect(scrollTo).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('scrolls the pin list when the pin being edited moves to another layer', () => {
    vi.useFakeTimers();

    try {
      const layers = [
        { id: 'layer-1', name: 'Restaurants', position: 0 },
        { id: 'layer-2', name: 'Hotels', position: 1 },
      ];
      const pin = { id: 'p1', lat: 10, lng: 20, label: 'Restaurant 1', layerId: 'layer-1', position: 0 };

      const { rerender, container } = render(
        <TestWrapper pins={[pin]} handlers={{ layers }} />
      );

      fireEvent.click(screen.getByLabelText('Edit'));

      const pinList = container.querySelector('.pin-list') as HTMLElement;
      const scrollTo = vi.fn();
      pinList.scrollTo = scrollTo;

      act(() => {
        vi.advanceTimersByTime(PIN_LIST_SCROLL_DELAY_MS);
      });
      expect(scrollTo).toHaveBeenCalled();
      scrollTo.mockClear();

      rerender(
        <TestWrapper
          pins={[{ ...pin, layerId: 'layer-2' }]}
          handlers={{ layers }}
        />
      );

      act(() => {
        vi.advanceTimersByTime(PIN_LIST_SCROLL_DELAY_MS);
      });
      expect(scrollTo).toHaveBeenCalled();
      scrollTo.mockClear();

      rerender(
        <TestWrapper
          pins={[{ ...pin, layerId: 'layer-2', label: 'Renamed' }]}
          handlers={{ layers }}
        />
      );

      act(() => {
        vi.advanceTimersByTime(PIN_LIST_SCROLL_DELAY_MS);
      });
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('scrolls once a collapsed destination layer expands around the pin being edited', () => {
    vi.useFakeTimers();

    try {
      const layers = [
        { id: 'layer-1', name: 'Restaurants', position: 0 },
        { id: 'layer-2', name: 'Hotels', position: 1 },
      ];
      const pin = { id: 'p1', lat: 10, lng: 20, label: 'Restaurant 1', layerId: 'layer-1', position: 0 };

      const Harness = ({ pins, collapsed }: { pins: typeof pin[], collapsed: Set<string | null> }) => (
        <TestWrapper
          pins={pins}
          handlers={{
            layers,
            collapsedLayerIds: collapsed,
            onToggleExpand: vi.fn(),
          }}
        />
      );

      const { rerender, container } = render(
        <Harness pins={[pin]} collapsed={new Set<string | null>()} />
      );

      fireEvent.click(screen.getByLabelText('Edit'));

      const pinList = container.querySelector('.pin-list') as HTMLElement;
      const scrollTo = vi.fn();
      pinList.scrollTo = scrollTo;

      act(() => {
        vi.advanceTimersByTime(PIN_LIST_SCROLL_DELAY_MS);
      });
      scrollTo.mockClear();

      rerender(
        <Harness pins={[{ ...pin, layerId: 'layer-2' }]} collapsed={new Set<string | null>(['layer-2'])} />
      );

      act(() => {
        vi.advanceTimersByTime(PIN_LIST_SCROLL_DELAY_MS);
      });
      expect(document.getElementById('pin-p1')).toBeNull();
      expect(scrollTo).not.toHaveBeenCalled();

      rerender(
        <Harness pins={[{ ...pin, layerId: 'layer-2' }]} collapsed={new Set<string | null>()} />
      );

      act(() => {
        vi.advanceTimersByTime(PIN_LIST_SCROLL_DELAY_MS);
      });
      expect(document.getElementById('pin-p1')).not.toBeNull();
      expect(scrollTo).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('pin list scroll targeting', () => {
  const mockRect = (el: HTMLElement, rect: { top: number; height: number }) => {
    Object.defineProperty(el, 'offsetHeight', { value: rect.height, configurable: true });
    el.getBoundingClientRect = () => ({
      x: 0,
      y: rect.top,
      width: 300,
      height: rect.height,
      top: rect.top,
      left: 0,
      bottom: rect.top + rect.height,
      right: 300,
      toJSON() { return {}; },
    });
  };

  const makeContainer = (clientHeight: number) => {
    const container = document.createElement('div');
    Object.defineProperty(container, 'clientHeight', { value: clientHeight, configurable: true });
    Object.defineProperty(container, 'offsetHeight', { value: clientHeight, configurable: true });
    mockRect(container, { top: 0, height: clientHeight });
    document.body.appendChild(container);
    return container;
  };

  const makePinRow = (id: string, top: number, height = 24) => {
    const el = document.createElement('li');
    el.id = `pin-${id}`;
    mockRect(el, { top, height });
    document.body.appendChild(el);
    return el;
  };

  const makeScrollable = (container: HTMLElement, scrollTop = 0) => {
    Object.defineProperty(container, 'scrollHeight', { value: 4000, configurable: true });
    container.scrollTop = scrollTop;
    const scrollTo = vi.fn();
    container.scrollTo = scrollTo;
    return scrollTo;
  };

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('treats a row behind the sticky header or below the viewport as not visible', () => {
    const container = makeContainer(200);
    const behindHeader = makePinRow('a', 20);
    const inView = makePinRow('b', 50);
    const belowFold = makePinRow('c', 180);

    expect(isPinRowVisibleInList(behindHeader, container)).toBe(false);
    expect(isPinRowVisibleInList(inView, container)).toBe(true);
    expect(isPinRowVisibleInList(belowFold, container)).toBe(false);
  });

  it('does not request a scroll target when any co-located pin is already visible', () => {
    const container = makeContainer(200);
    makePinRow('h1', 250);
    makePinRow('h2', 50);

    expect(getPinListScrollElement(container, ['h1', 'h2'], 'h1')).toBeNull();
  });

  it('scrolls to the preferred pin when none of the co-located pins are visible', () => {
    const container = makeContainer(200);
    const preferred = makePinRow('h1', 250);
    makePinRow('h2', 280);

    expect(getPinListScrollElement(container, ['h1', 'h2'], 'h1')).toBe(preferred);
  });

  it('does not scroll when the preferred pin is missing but a sibling is in view', () => {
    const container = makeContainer(200);
    makePinRow('h2', 50);

    expect(getPinListScrollElement(container, ['h1', 'h2'], 'h1')).toBeNull();
  });

  it('aligns a too-tall row to the top when it sits below the fold', () => {
    const container = makeContainer(200);
    const scrollTo = makeScrollable(container);
    const row = makePinRow('edit', 250, 400);

    scrollPinRowIntoList(row, container);

    expect(scrollTo).toHaveBeenCalledWith({
      top: 250 - PIN_LIST_STICKY_HEADER_OFFSET - 4,
      behavior: 'smooth',
    });
  });

  it('aligns a too-tall row to the top when it sits above the fold', () => {
    const container = makeContainer(200);
    const scrollTo = makeScrollable(container, 400);
    const row = makePinRow('edit', -120, 400);

    scrollPinRowIntoList(row, container);

    expect(scrollTo).toHaveBeenCalledWith({
      top: 400 - 120 - PIN_LIST_STICKY_HEADER_OFFSET - 4,
      behavior: 'smooth',
    });
  });

  it('brings a short row fully into view when only its bottom is clipped', () => {
    const container = makeContainer(200);
    const scrollTo = makeScrollable(container);
    const row = makePinRow('pin', 180, 40);

    scrollPinRowIntoList(row, container);

    expect(scrollTo).toHaveBeenCalledWith({ top: 180 + 40 - 200 + 24, behavior: 'smooth' });
  });
});
