import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Sidebar from '../Sidebar';
import { useState } from 'react';
import * as dndSortable from '@dnd-kit/sortable';
import * as dndCore from '@dnd-kit/core';
import { PIN_HOVER_CLASS, setHoveredPin, resetPinHoverForTests } from '../../utils/pinHover';

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
  
  const TestWrapper = ({ pins = mockPins, handlers = {}, selectedNavIds = new Set<string>() }: { pins?: any[], handlers?: any, selectedNavIds?: Set<string> }) => {
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

  it('calls onUpdatePin when a color is selected', () => {
    const onUpdatePin = vi.fn();
    render(<TestWrapper handlers={{ onUpdatePin }} />);
    
    fireEvent.click(screen.getByLabelText('Edit'));
    const greenButton = screen.getByLabelText('color-green');
    
    fireEvent.click(greenButton);
    
    expect(onUpdatePin).toHaveBeenCalledWith('1', { color: 'green' });
  });

  it('calls onUpdatePin when an icon is selected', () => {
    const onUpdatePin = vi.fn();
    render(<TestWrapper handlers={{ onUpdatePin }} />);
    
    fireEvent.click(screen.getByLabelText('Edit'));
    const hotelIcon = screen.getByLabelText('icon-hotel');
    
    fireEvent.click(hotelIcon);
    
    expect(onUpdatePin).toHaveBeenCalledWith('1', { icon: 'hotel' });
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

  it('shows the Download for Offline option in the menu when map is not downloaded', async () => {
    render(<TestWrapper />);
    
    // Open the more menu
    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);
    
    expect(await screen.findByText(/Download for Offline/i)).toBeInTheDocument();
  });

  it('shows Remove Download option in the menu when map is downloaded', async () => {
    const tileUtilsModule = await import('../../utils/tileUtils');
    vi.spyOn(tileUtilsModule, 'getManifestStats').mockResolvedValue({ total: 10, completed: 10 });

    render(<TestWrapper handlers={{ mapId: 'test-map-1' }} />);
    
    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);
    
    expect(await screen.findByText(/Remove Download/i)).toBeInTheDocument();
    expect(screen.queryByText(/Download for Offline/i)).not.toBeInTheDocument();
    
    vi.restoreAllMocks();
  });

  it('shows Remove Download option when map is partially downloaded', async () => {
    const tileUtilsModule = await import('../../utils/tileUtils');
    vi.spyOn(tileUtilsModule, 'getManifestStats').mockResolvedValue({ total: 10, completed: 4 });

    render(<TestWrapper handlers={{ mapId: 'test-map-1' }} />);
    
    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);
    
    expect(await screen.findByText(/Remove Download/i)).toBeInTheDocument();
    expect(screen.queryByText(/Download for Offline/i)).not.toBeInTheDocument();
    
    vi.restoreAllMocks();
  });

  it('generates correct navigation URL with first pin as origin', () => {
    const mockPins = [
        { id: '1', lat: 35.0, lng: -97.0, label: 'Oklahoma', position: 0 },
        { id: '2', lat: 39.0, lng: -98.0, label: 'Kansas', position: 1 }
    ] as any;
    
    const openMock = vi.fn();
    vi.stubGlobal('open', openMock);
    
    render(<TestWrapper pins={mockPins} selectedNavIds={new Set(['1', '2'])} />);
    
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

  it('hides Rename Map option when readOnly is true', () => {
    render(<TestWrapper handlers={{ userRole: 'view' }} />);
    
    const moreBtn = screen.getByLabelText(/more options/i);
    fireEvent.click(moreBtn);
    
    expect(screen.queryByText(/Rename Map/i)).not.toBeInTheDocument();
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

  it('shows matching search results in SearchBar dropdown', () => {
    const layers = [
      { id: 'layer-1', name: 'Food', position: 0 },
      { id: 'layer-2', name: 'Attractions', position: 1 }
    ];
    const pins = [
      { id: 'p1', lat: 10, lng: 20, label: 'Burger Joint', layerId: 'layer-1', position: 0 },
      { id: 'p2', lat: 11, lng: 21, label: 'Pizza Place', layerId: 'layer-1', position: 1 },
      { id: 'p3', lat: 12, lng: 22, label: 'City Museum', layerId: 'layer-2', position: 0 }
    ];

    render(
      <TestWrapper 
        pins={pins} 
        handlers={{ layers }} 
      />
    );

    const searchInput = screen.getByPlaceholderText('Search...');
    fireEvent.change(searchInput, { target: { value: 'Burger' } });

    // Matching pin should appear in the search dropdown results
    const matchingElements = screen.getAllByText('Burger Joint');
    expect(matchingElements.length).toBeGreaterThanOrEqual(2);
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
    expect(screen.getByText('MOVE SELECTED TO...')).toBeInTheDocument();
    const layerOptions = screen.getAllByText('Custom Layer');
    // Click the menu option (first match in dropdown)
    fireEvent.click(layerOptions[0]);

    expect(onMovePinsToLayer).toHaveBeenCalledWith(['1', '2'], 'layer-1');
  });
});
