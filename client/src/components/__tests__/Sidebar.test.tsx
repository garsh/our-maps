import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Sidebar from '../Sidebar';
import { useState } from 'react';

describe('Sidebar', () => {
  const mockPins = [
    { id: '1', lat: 10, lng: 20, label: 'Test Pin', description: '', imageUrl: '', position: 0 }
  ];
  
  const TestWrapper = ({ pins = mockPins, handlers = {} }) => {
    const [editingPinId, setEditingPinId] = useState<string | null>(null);
    const mockHandlers = {
      onMapNameChange: vi.fn(),
      groups: [],
      onAddGroup: vi.fn(),
      onUpdateGroup: vi.fn(),
      onRemoveGroup: vi.fn(),
      onResultSelect: vi.fn(),
      onAddPin: vi.fn(),
      onRemovePin: vi.fn(),
      onPinClick: vi.fn(),
      onUpdatePin: vi.fn(),
      onDragEnd: vi.fn(),
      onShare: vi.fn(),
      onImport: vi.fn(),
      ...handlers
    };

    return (
      <Sidebar 
        mapName="Test Map" 
        pins={pins} 
        {...mockHandlers} 
        editingPinId={editingPinId} 
        onSetEditingPinId={setEditingPinId} 
      />
    );
  };

  it('reveals edit fields when Edit button is clicked', () => {
    render(<TestWrapper />);
    
    // Edit fields should not be visible initially
    expect(screen.queryByText(/description/i)).not.toBeInTheDocument();
    
    // Click Edit
    fireEvent.click(screen.getByText('Edit'));
    
    // Edit fields should now be visible
    expect(screen.getByText(/description/i)).toBeInTheDocument();
  });

  it('calls onAddGroup when Add Group button is clicked', () => {
    const onAddGroup = vi.fn();
    render(<TestWrapper handlers={{ onAddGroup }} />);
    
    fireEvent.click(screen.getByText(/New Layer/i));
    
    expect(onAddGroup).toHaveBeenCalled();
  });

  it('calls onUpdatePin when description is changed', () => {
    const onUpdatePin = vi.fn();
    render(<TestWrapper handlers={{ onUpdatePin }} />);
    
    fireEvent.click(screen.getByText('Edit'));
    const textarea = screen.getByLabelText(/description/i);
    
    fireEvent.change(textarea, { target: { value: 'New description' } });
    
    expect(onUpdatePin).toHaveBeenCalledWith('1', { description: 'New description' });
  });

  it('calls onUpdatePin when image URL is changed', () => {
    const onUpdatePin = vi.fn();
    render(<TestWrapper handlers={{ onUpdatePin }} />);
    
    fireEvent.click(screen.getByText('Edit'));
    const input = screen.getByLabelText(/image url/i);
    
    fireEvent.change(input, { target: { value: 'http://image.png' } });
    
    expect(onUpdatePin).toHaveBeenCalledWith('1', { imageUrl: 'http://image.png' });
  });

  it('calls onUpdatePin when a color is selected', () => {
    const onUpdatePin = vi.fn();
    render(<TestWrapper handlers={{ onUpdatePin }} />);
    
    fireEvent.click(screen.getByText('Edit'));
    const greenButton = screen.getByLabelText('color-green');
    
    fireEvent.click(greenButton);
    
    expect(onUpdatePin).toHaveBeenCalledWith('1', { color: 'green' });
  });

  it('calls onUpdatePin when an icon is selected', () => {
    const onUpdatePin = vi.fn();
    render(<TestWrapper handlers={{ onUpdatePin }} />);
    
    fireEvent.click(screen.getByText('Edit'));
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
});
