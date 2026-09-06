import { useState, useEffect, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface HSV {
  h: number; // 0 - 360
  s: number; // 0 - 100
  v: number; // 0 - 100
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const sNorm = Math.max(0, Math.min(100, s)) / 100;
  const vNorm = Math.max(0, Math.min(100, v)) / 100;
  const c = vNorm * sNorm;
  const normalizedH = ((h % 360) + 360) % 360;
  const x = c * (1 - Math.abs(((normalizedH / 60) % 2) - 1));
  const m = vNorm - c;

  let r = 0;
  let g = 0;
  let b = 0;

  if (normalizedH >= 0 && normalizedH < 60) {
    r = c; g = x; b = 0;
  } else if (normalizedH >= 60 && normalizedH < 120) {
    r = x; g = c; b = 0;
  } else if (normalizedH >= 120 && normalizedH < 180) {
    r = 0; g = c; b = x;
  } else if (normalizedH >= 180 && normalizedH < 240) {
    r = 0; g = x; b = c;
  } else if (normalizedH >= 240 && normalizedH < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (val: number) => Math.max(0, Math.min(255, Math.round(val))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace(/^#/, '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return [r, g, b];
  }
  return null;
}

export function rgbToHsv(r: number, g: number, b: number): HSV {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rNorm) {
      h = 60 * (((gNorm - bNorm) / delta) % 6);
    } else if (max === gNorm) {
      h = 60 * ((bNorm - rNorm) / delta + 2);
    } else {
      h = 60 * ((rNorm - gNorm) / delta + 4);
    }
  }

  if (h < 0) h += 360;
  const s = max === 0 ? 0 : (delta / max) * 100;
  const v = max * 100;

  return {
    h: Math.round(h),
    s: Math.round(s),
    v: Math.round(v)
  };
}

export function hexToHsv(hex: string): HSV | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return rgbToHsv(rgb[0], rgb[1], rgb[2]);
}

export function isValidHex(hex: string): boolean {
  return /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim());
}

export interface CustomColorPickerProps {
  isOpen: boolean;
  initialColor?: string;
  onClose: () => void;
  onSetColor: (color: string) => void;
}

export const CustomColorPicker = memo(({
  isOpen,
  initialColor = '#9C2BCB',
  onClose,
  onSetColor
}: CustomColorPickerProps) => {
  const [hsv, setHsv] = useState<HSV>(() => {
    return hexToHsv(initialColor) || { h: 282, s: 79, v: 80 };
  });
  const [hexInput, setHexInput] = useState<string>(() => {
    const parsed = hexToHsv(initialColor);
    const hex = parsed ? hsvToHex(parsed.h, parsed.s, parsed.v) : '#9C2BCB';
    return hex.replace(/^#/, '');
  });

  // Re-sync when picker opens or initialColor changes
  useEffect(() => {
    if (isOpen) {
      const parsed = hexToHsv(initialColor);
      if (parsed) {
        setHsv(parsed);
        setHexInput(hsvToHex(parsed.h, parsed.s, parsed.v).replace(/^#/, ''));
      }
    }
  }, [isOpen, initialColor]);

  // Handle keyboard escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const updateFromHsv = useCallback((newHsv: HSV) => {
    setHsv(newHsv);
    const newHex = hsvToHex(newHsv.h, newHsv.s, newHsv.v);
    setHexInput(newHex.replace(/^#/, ''));
  }, []);

  const handleHueChange = (newH: number) => {
    updateFromHsv({ ...hsv, h: newH });
  };

  const handleSaturationChange = (newS: number) => {
    updateFromHsv({ ...hsv, s: newS });
  };

  const handleBrightnessChange = (newV: number) => {
    updateFromHsv({ ...hsv, v: newV });
  };

  const handleHexInputChange = (value: string) => {
    const clean = value.replace(/^#/, '').slice(0, 6).toUpperCase();
    setHexInput(clean);
    if (isValidHex(clean)) {
      const parsed = hexToHsv(clean);
      if (parsed) {
        // Keep previous Hue if saturation or brightness is 0 so hue slider doesn't snap to red
        const preservedHue = parsed.s === 0 || parsed.v === 0 ? hsv.h : parsed.h;
        setHsv({ ...parsed, h: preservedHue });
      }
    }
  };

  const handleHexBlur = () => {
    const clean = hexInput.replace(/^#/, '').trim().toUpperCase();
    if (isValidHex(clean)) {
      const expanded = clean.length === 3
        ? `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
        : clean;
      setHexInput(expanded);
      const parsed = hexToHsv(expanded);
      if (parsed) {
        const preservedHue = parsed.s === 0 || parsed.v === 0 ? hsv.h : parsed.h;
        setHsv({ ...parsed, h: preservedHue });
      }
    } else {
      // Revert to current valid HSV hex without '#'
      setHexInput(hsvToHex(hsv.h, hsv.s, hsv.v).replace(/^#/, ''));
    }
  };

  const handleSet = () => {
    const clean = hexInput.replace(/^#/, '').trim().toUpperCase();
    const finalHex = isValidHex(clean)
      ? (clean.length === 3
          ? `#${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
          : `#${clean}`)
      : hsvToHex(hsv.h, hsv.s, hsv.v);
    onSetColor(finalHex);
    onClose();
  };

  if (!isOpen) return null;

  const cleanHex = hexInput.replace(/^#/, '').trim().toUpperCase();
  const currentHex = isValidHex(cleanHex)
    ? (cleanHex.length === 3
        ? `#${cleanHex[0]}${cleanHex[0]}${cleanHex[1]}${cleanHex[1]}${cleanHex[2]}${cleanHex[2]}`
        : `#${cleanHex}`)
    : hsvToHex(hsv.h, hsv.s, hsv.v);

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100000,
        padding: '16px'
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-color-picker-title"
        style={{
          background: 'var(--surface-color)',
          color: 'var(--text-primary)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px',
          maxWidth: '340px',
          width: '100%',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.4)',
          border: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          position: 'relative'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 id="custom-color-picker-title" style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Custom Color
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 'var(--radius-sm)'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Color Preview Swatch + Hex Code Input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {/* Solid Color Sample (takes up rest of width) */}
          <div
            aria-label="Color preview"
            style={{
              flex: 1,
              height: '52px',
              borderRadius: 'var(--radius-md)',
              background: currentHex,
              border: '1px solid var(--border-color)',
              boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.15)'
            }}
          />

          {/* Hex Code Input right justified, sized for 6 characters */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
            <label
              htmlFor="color-hex"
              style={{
                display: 'block',
                marginBottom: '4px',
                fontSize: '0.9rem',
                fontWeight: 700,
                color: 'var(--text-secondary)',
                textAlign: 'center',
                width: '100%'
              }}
            >
              Hex Code
            </label>
            <input
              id="color-hex"
              type="text"
              value={hexInput}
              onChange={(e) => handleHexInputChange(e.target.value)}
              onBlur={handleHexBlur}
              maxLength={6}
              placeholder="RRGGBB"
              className="input-field"
              style={{
                width: '76px',
                padding: '6px 8px',
                textAlign: 'right',
                fontSize: '0.95rem',
                fontFamily: 'monospace',
                fontWeight: 700,
                background: 'var(--bg-color)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--text-primary)',
                letterSpacing: '1px'
              }}
            />
          </div>
        </div>

        {/* Labeled Sliders */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Hue */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.9rem', fontWeight: 700 }}>
              <label htmlFor="color-hue" style={{ color: 'var(--text-secondary)' }}>Hue</label>
              <span style={{ color: 'var(--text-secondary)' }}>{hsv.h}°</span>
            </div>
            <input
              id="color-hue"
              type="range"
              min="0"
              max="360"
              value={hsv.h}
              onChange={(e) => handleHueChange(Number(e.target.value))}
              aria-label="Hue"
              className="color-slider"
              style={{
                height: '28px',
                background: 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)'
              }}
            />
          </div>

          {/* Saturation */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.9rem', fontWeight: 700 }}>
              <label htmlFor="color-saturation" style={{ color: 'var(--text-secondary)' }}>Saturation</label>
              <span style={{ color: 'var(--text-secondary)' }}>{hsv.s}%</span>
            </div>
            <input
              id="color-saturation"
              type="range"
              min="0"
              max="100"
              value={hsv.s}
              onChange={(e) => handleSaturationChange(Number(e.target.value))}
              aria-label="Saturation"
              className="color-slider"
              style={{
                height: '28px',
                background: `linear-gradient(to right, ${hsvToHex(hsv.h, 0, hsv.v)}, ${hsvToHex(hsv.h, 100, hsv.v)})`
              }}
            />
          </div>

          {/* Brightness */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '0.9rem', fontWeight: 700 }}>
              <label htmlFor="color-brightness" style={{ color: 'var(--text-secondary)' }}>Brightness</label>
              <span style={{ color: 'var(--text-secondary)' }}>{hsv.v}%</span>
            </div>
            <input
              id="color-brightness"
              type="range"
              min="0"
              max="100"
              value={hsv.v}
              onChange={(e) => handleBrightnessChange(Number(e.target.value))}
              aria-label="Brightness"
              className="color-slider"
              style={{
                height: '28px',
                background: `linear-gradient(to right, #000000, ${hsvToHex(hsv.h, hsv.s, 100)})`
              }}
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 1,
              padding: '9px 16px',
              background: 'var(--surface-color)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer',
              color: 'var(--text-secondary)'
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSet}
            className="btn-primary"
            style={{
              flex: 1,
              padding: '9px 16px',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 700,
              fontSize: '0.85rem',
              cursor: 'pointer'
            }}
          >
            Set
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
});
