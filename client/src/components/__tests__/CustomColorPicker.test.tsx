import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  CustomColorPicker,
  hsvToRgb,
  rgbToHex,
  hsvToHex,
  hexToRgb,
  rgbToHsv,
  hexToHsv,
  isValidHex
} from '../CustomColorPicker';

describe('CustomColorPicker math utilities', () => {
  it('converts HSV to RGB and HEX correctly for primary and secondary colors', () => {
    // Red
    expect(hsvToHex(0, 100, 100)).toBe('#FF0000');
    // Green
    expect(hsvToHex(120, 100, 100)).toBe('#00FF00');
    // Blue
    expect(hsvToHex(240, 100, 100)).toBe('#0000FF');
    // Yellow
    expect(hsvToHex(60, 100, 100)).toBe('#FFFF00');
    // Cyan
    expect(hsvToHex(180, 100, 100)).toBe('#00FFFF');
    // Magenta
    expect(hsvToHex(300, 100, 100)).toBe('#FF00FF');
    // Black (0 brightness)
    expect(hsvToHex(0, 100, 0)).toBe('#000000');
    // White (0 saturation, 100 brightness)
    expect(hsvToHex(0, 0, 100)).toBe('#FFFFFF');
  });

  it('converts HEX to RGB correctly', () => {
    expect(hexToRgb('#FF0000')).toEqual([255, 0, 0]);
    expect(hexToRgb('#00FF00')).toEqual([0, 255, 0]);
    expect(hexToRgb('#0000FF')).toEqual([0, 0, 255]);
    expect(hexToRgb('FFF')).toEqual([255, 255, 255]);
    expect(hexToRgb('invalid')).toBeNull();
  });

  it('converts RGB to HSV and back roundtrip correctly', () => {
    const redHsv = rgbToHsv(255, 0, 0);
    expect(redHsv.h).toBe(0);
    expect(redHsv.s).toBe(100);
    expect(redHsv.v).toBe(100);

    const greenHsv = rgbToHsv(0, 255, 0);
    expect(greenHsv.h).toBe(120);
    expect(greenHsv.s).toBe(100);
    expect(greenHsv.v).toBe(100);

    const blueHsv = rgbToHsv(0, 0, 255);
    expect(blueHsv.h).toBe(240);
    expect(blueHsv.s).toBe(100);
    expect(blueHsv.v).toBe(100);
  });

  it('validates hex codes correctly', () => {
    expect(isValidHex('#FFFFFF')).toBe(true);
    expect(isValidHex('123456')).toBe(true);
    expect(isValidHex('#abc')).toBe(true);
    expect(isValidHex('def')).toBe(true);
    expect(isValidHex('xyz')).toBe(false);
    expect(isValidHex('#12345')).toBe(false);
    expect(isValidHex('')).toBe(false);
  });
});

describe('CustomColorPicker component', () => {
  it('does not render when isOpen is false', () => {
    render(
      <CustomColorPicker
        isOpen={false}
        initialColor="#FF0000"
        onClose={vi.fn()}
        onSetColor={vi.fn()}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders when isOpen is true with explicit labels for Hue, Saturation, Brightness, and Hex Code', () => {
    render(
      <CustomColorPicker
        isOpen={true}
        initialColor="#FF0000"
        onClose={vi.fn()}
        onSetColor={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Custom Color')).toBeInTheDocument();
    expect(screen.getByLabelText('Hue')).toBeInTheDocument();
    expect(screen.getByLabelText('Saturation')).toBeInTheDocument();
    expect(screen.getByLabelText('Brightness')).toBeInTheDocument();
    expect(screen.getByLabelText('Hex Code')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('updates Hex Code input and preview when Hue slider changes', () => {
    render(
      <CustomColorPicker
        isOpen={true}
        initialColor="#FF0000"
        onClose={vi.fn()}
        onSetColor={vi.fn()}
      />
    );

    const hueSlider = screen.getByLabelText('Hue');
    const hexInput = screen.getByLabelText('Hex Code') as HTMLInputElement;

    expect(hexInput.value).toBe('FF0000');

    // Change hue to 120 (Green)
    fireEvent.change(hueSlider, { target: { value: '120' } });
    expect(hexInput.value).toBe('00FF00');
  });

  it('updates Hex Code input when Saturation and Brightness sliders change', () => {
    render(
      <CustomColorPicker
        isOpen={true}
        initialColor="#FF0000"
        onClose={vi.fn()}
        onSetColor={vi.fn()}
      />
    );

    const saturationSlider = screen.getByLabelText('Saturation');
    const brightnessSlider = screen.getByLabelText('Brightness');
    const hexInput = screen.getByLabelText('Hex Code') as HTMLInputElement;

    // Saturation to 0% -> White (since Brightness is 100%)
    fireEvent.change(saturationSlider, { target: { value: '0' } });
    expect(hexInput.value).toBe('FFFFFF');

    // Brightness to 0% -> Black
    fireEvent.change(brightnessSlider, { target: { value: '0' } });
    expect(hexInput.value).toBe('000000');
  });

  it('updates sliders when Hex Code input is edited with or without #', () => {
    render(
      <CustomColorPicker
        isOpen={true}
        initialColor="#FF0000"
        onClose={vi.fn()}
        onSetColor={vi.fn()}
      />
    );

    const hexInput = screen.getByLabelText('Hex Code') as HTMLInputElement;
    const hueSlider = screen.getByLabelText('Hue') as HTMLInputElement;

    // Type Blue hex without #
    fireEvent.change(hexInput, { target: { value: '0000FF' } });
    expect(hueSlider.value).toBe('240');

    // Pasting with # also cleans to 6-char hex and updates
    fireEvent.change(hexInput, { target: { value: '#FFFF00' } });
    expect(hexInput.value).toBe('FFFF00');
    expect(hueSlider.value).toBe('60');
  });

  it('calls onSetColor with selected hex and closes when Set is clicked', () => {
    const onSetColor = vi.fn();
    const onClose = vi.fn();

    render(
      <CustomColorPicker
        isOpen={true}
        initialColor="#FF0000"
        onClose={onClose}
        onSetColor={onSetColor}
      />
    );

    const hueSlider = screen.getByLabelText('Hue');
    fireEvent.change(hueSlider, { target: { value: '240' } });

    const setButton = screen.getByRole('button', { name: 'Set' });
    fireEvent.click(setButton);

    expect(onSetColor).toHaveBeenCalledWith('#0000FF');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('preserves exact typed hex code when Set is clicked without roundtrip quantization', () => {
    const onSetColor = vi.fn();
    const onClose = vi.fn();

    render(
      <CustomColorPicker
        isOpen={true}
        initialColor="#FF0000"
        onClose={onClose}
        onSetColor={onSetColor}
      />
    );

    const hexInput = screen.getByLabelText('Hex Code');
    fireEvent.change(hexInput, { target: { value: '123456' } });

    const setButton = screen.getByRole('button', { name: 'Set' });
    fireEvent.click(setButton);

    expect(onSetColor).toHaveBeenCalledWith('#123456');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose without setting color when Cancel or Close button is clicked', () => {
    const onSetColor = vi.fn();
    const onClose = vi.fn();

    render(
      <CustomColorPicker
        isOpen={true}
        initialColor="#FF0000"
        onClose={onClose}
        onSetColor={onSetColor}
      />
    );

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelButton);

    expect(onSetColor).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    const closeIconBtn = screen.getByLabelText('Close');
    fireEvent.click(closeIconBtn);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();

    render(
      <CustomColorPicker
        isOpen={true}
        initialColor="#FF0000"
        onClose={onClose}
        onSetColor={vi.fn()}
      />
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
