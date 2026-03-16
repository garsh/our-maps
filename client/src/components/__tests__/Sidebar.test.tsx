import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Sidebar from '../Sidebar';

describe('Sidebar', () => {
  const mockPins = [
    { id: '1', lat: 10, lng: 20, label: 'Test Pin', description: '', imageUrl: '', position: 0 }
  ];
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
  };

  it('reveals edit fields when Edit button is clicked', () => {
    render(<Sidebar mapName="Test Map" pins={mockPins} {...mockHandlers} />);
    
    // Edit fields should not be visible initially
    expect(screen.queryByText(/description/i)).not.toBeInTheDocument();
    
    // Click Edit
    fireEvent.click(screen.getByText('Edit'));
    
    // Edit fields should now be visible
    expect(screen.getByText(/description/i)).toBeInTheDocument();
  });

  it('calls onAddGroup when Add Group button is clicked', () => {
    render(<Sidebar mapName="Test Map" pins={mockPins} {...mockHandlers} />);
    
    fireEvent.click(screen.getByText(/Add Group/i));
    
    expect(mockHandlers.onAddGroup).toHaveBeenCalled();
  });

  it('calls onUpdatePin when description is changed', () => {
    render(<Sidebar mapName="Test Map" pins={mockPins} {...mockHandlers} />);
    
    fireEvent.click(screen.getByText('Edit'));
    const textarea = screen.getByLabelText(/description/i);
    
    fireEvent.change(textarea, { target: { value: 'New description' } });
    
    expect(mockHandlers.onUpdatePin).toHaveBeenCalledWith('1', { description: 'New description' });
  });

  it('calls onUpdatePin when image URL is changed', () => {
    render(<Sidebar mapName="Test Map" pins={mockPins} {...mockHandlers} />);
    
    fireEvent.click(screen.getByText('Edit'));
    const input = screen.getByLabelText(/image url/i);
    
    fireEvent.change(input, { target: { value: 'http://image.png' } });
    
    expect(mockHandlers.onUpdatePin).toHaveBeenCalledWith('1', { imageUrl: 'http://image.png' });
  });

  it('calls onUpdatePin when a color is selected', () => {
    render(<Sidebar mapName="Test Map" pins={mockPins} {...mockHandlers} />);
    
    fireEvent.click(screen.getByText('Edit'));
    const greenButton = screen.getByLabelText('color-green');
    
    fireEvent.click(greenButton);
    
    expect(mockHandlers.onUpdatePin).toHaveBeenCalledWith('1', { color: 'green' });
  });

  it('calls onUpdatePin when an icon is selected', () => {
    render(<Sidebar mapName="Test Map" pins={mockPins} {...mockHandlers} />);
    
    fireEvent.click(screen.getByText('Edit'));
    const hotelIcon = screen.getByLabelText('icon-hotel');
    
    fireEvent.click(hotelIcon);
    
    expect(mockHandlers.onUpdatePin).toHaveBeenCalledWith('1', { icon: 'hotel' });
  });
});
