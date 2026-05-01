import L from 'leaflet';
import type { PinColor, PinIcon } from '@shared/interfaces';

const COLOR_CODES: Record<PinColor, string> = {
  blue: '#2A81CB',
  red: '#CB2B3E',
  green: '#2AAD27',
  orange: '#CB8427',
  violet: '#9C2BCB',
  gold: '#FFD700',
  yellow: '#FFD700', // Alias for older data
  pink: '#FF69B4',
  teal: '#008080',
  brown: '#8B4513',
};

const ICON_SVG_PATHS: Record<Exclude<PinIcon, 'default'>, string> = {
  hotel: '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
  restaurant: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  airport: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  park: '<path d="M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z"/><path d="M7 16v6"/><path d="M13 19v3"/><path d="M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5"/>',
  museum: '<line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7 12 2"/>',
  shopping: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  gas: '<path d="M3 22L17 22"/><path d="M4 22V4C4 3.44772 4.44772 3 5 3H15C15.5523 3 16 3.44772 16 4V22"/><path d="M19 7H22"/><path d="M18 10V6C18 5.44772 18.4477 5 19 5H22C22.5523 5 23 5.44772 23 6V20C23 20.5523 22.5523 21 22 21H20"/><path d="M7 7H13V11H7V7Z"/>',
  charging: '<path d="M11 2L5.5 12H11L9.5 22L19 10H12L14 2H11Z"/>'
};

export function getMarkerIcon(color: PinColor = 'blue', icon: PinIcon = 'default', isHovered = false) {
  const isHex = color.startsWith('#');
  const colorCode = isHex ? color : (COLOR_CODES[color] || COLOR_CODES.blue);

  let iconContent = '';
  if (icon !== 'default') {
    const svgPath = ICON_SVG_PATHS[icon as Exclude<PinIcon, 'default'>];
    iconContent = `
      <circle cx="15" cy="15" r="11" fill="white"/>
      <g transform="translate(6, 6) scale(0.75)" stroke="${colorCode}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">
        ${svgPath}
      </g>
    `;
  } else {
    // A smaller dot for default icon when pin itself is smaller
    iconContent = `<circle cx="15" cy="15" r="5" fill="white" fill-opacity="0.8"/>`;
  }

  // Smaller base size (half was 30x42, let's try 20x28 which is roughly half area-wise)
  const width = 20;
  const height = 28;
  const scale = width / 30; // 0.66 scale

  const html = `
    <div style="
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: ${width}px;
      height: ${height}px;
    ">
      ${isHovered ? `
        <div style="
          position: absolute;
          width: ${width * 3}px;
          height: ${width * 3}px;
          background: ${colorCode}44;
          border: 3px solid ${colorCode};
          border-radius: 50%;
          z-index: -1;
          animation: pulse 1.2s infinite;
          box-shadow: 0 0 15px ${colorCode}66;
        "></div>
      ` : ''}
      <div style="
        filter: drop-shadow(0 2px 3px rgba(0,0,0,0.4));
        transform: scale(${scale});
        transform-origin: center bottom;
      ">
        <svg width="30" height="42" viewBox="0 0 30 42" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M15 0C6.71573 0 0 6.71573 0 15C0 26.25 15 42 15 42C15 42 30 26.25 30 15C30 6.71573 23.2843 0 15 0Z" fill="${colorCode}"/>
          ${iconContent}
        </svg>
      </div>
    </div>
  `;

  return L.divIcon({
    className: isHovered ? 'custom-pin-modern hovered' : 'custom-pin-modern',
    html,
    iconSize: [width, height],
    iconAnchor: [width / 2, height],
    popupAnchor: [0, -height],
  });
}
