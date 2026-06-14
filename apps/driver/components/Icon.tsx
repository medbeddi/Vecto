import Svg, {
  Path, Circle, Line, Polyline, Rect, G, Ellipse, Polygon,
} from 'react-native-svg';

type IconName =
  | 'chevron-left' | 'chevron-right' | 'chevron-down'
  | 'scooter' | 'chat' | 'person' | 'phone' | 'headset'
  | 'image' | 'location' | 'mic' | 'send'
  | 'play' | 'pause'
  | 'check' | 'check-circle'
  | 'eye' | 'eye-off'
  | 'star' | 'star-filled'
  | 'wallet' | 'clock' | 'bell' | 'logout'
  | 'arrow-up-right' | 'arrow-down-left' | 'arrow-right'
  | 'edit' | 'user' | 'notification' | 'history'
  | 'file-text'
  | 'trash' | 'close';

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
};

export function Icon({ name, size = 24, color = '#1A1A1A', strokeWidth = 1.75 }: Props) {
  const s = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  const sf = { fill: color };

  const icons: Record<IconName, JSX.Element> = {

    // ─── Navigation ───────────────────────────────────────────────────────────
    'chevron-left': (
      <Polyline points="15 18 9 12 15 6" {...s} />
    ),
    'chevron-right': (
      <Polyline points="9 18 15 12 9 6" {...s} />
    ),
    'chevron-down': (
      <Polyline points="6 9 12 15 18 9" {...s} />
    ),

    // ─── Bottom tabs ──────────────────────────────────────────────────────────
    'scooter': (
      <G {...s}>
        <Path d="M5 17H3a2 2 0 01-2-2v-4a2 2 0 012-2h14l2 2 1 3" />
        <Circle cx="5" cy="17" r="2" />
        <Circle cx="17" cy="17" r="2" />
        <Path d="M12 5v6" />
        <Path d="M9 5h6" />
      </G>
    ),
    'chat': (
      <G {...s}>
        <Path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </G>
    ),
    'person': (
      <G {...s}>
        <Path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <Circle cx="12" cy="7" r="4" />
      </G>
    ),

    // ─── Chat header ──────────────────────────────────────────────────────────
    'headset': (
      <G {...s}>
        <Path d="M3 18v-6a9 9 0 0118 0v6" />
        <Path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3z" />
        <Path d="M3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z" />
      </G>
    ),
    'phone': (
      <G {...s}>
        <Path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.11 1.18 2 2 0 012.11 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 7.09a16 16 0 006 6l.45-.45a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z" transform="scale(0.92) translate(1.3,1.3)" />
      </G>
    ),

    // ─── Chat input ───────────────────────────────────────────────────────────
    'image': (
      <G {...s}>
        <Rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <Circle cx="8.5" cy="8.5" r="1.5" />
        <Polyline points="21 15 16 10 5 21" />
      </G>
    ),
    'location': (
      <G {...s}>
        <Path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
        <Circle cx="12" cy="10" r="3" />
      </G>
    ),
    'mic': (
      <G {...s}>
        <Path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
        <Path d="M19 10v2a7 7 0 01-14 0v-2" />
        <Line x1="12" y1="19" x2="12" y2="23" />
        <Line x1="8" y1="23" x2="16" y2="23" />
      </G>
    ),
    'send': (
      <G {...s}>
        <Line x1="22" y1="2" x2="11" y2="13" />
        <Polygon points="22 2 15 22 11 13 2 9 22 2" fill={color} stroke="none" />
      </G>
    ),

    // ─── Audio player ─────────────────────────────────────────────────────────
    'play': (
      <G>
        <Polygon points="5 3 19 12 5 21 5 3" fill={color} stroke="none" />
      </G>
    ),
    'pause': (
      <G {...s}>
        <Line x1="6" y1="4" x2="6" y2="20" strokeWidth={strokeWidth + 0.5} />
        <Line x1="18" y1="4" x2="18" y2="20" strokeWidth={strokeWidth + 0.5} />
      </G>
    ),

    // ─── States ───────────────────────────────────────────────────────────────
    'check': (
      <Polyline points="20 6 9 17 4 12" {...s} />
    ),
    'check-circle': (
      <G {...s}>
        <Path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
        <Polyline points="22 4 12 14.01 9 11.01" />
      </G>
    ),

    // ─── Eye ─────────────────────────────────────────────────────────────────
    'eye': (
      <G {...s}>
        <Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <Circle cx="12" cy="12" r="3" />
      </G>
    ),
    'eye-off': (
      <G {...s}>
        <Path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
        <Line x1="1" y1="1" x2="23" y2="23" />
      </G>
    ),

    // ─── Profile ──────────────────────────────────────────────────────────────
    'star': (
      <G {...s}>
        <Polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </G>
    ),
    'star-filled': (
      <G>
        <Polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill={color} />
      </G>
    ),
    'wallet': (
      <G {...s}>
        <Rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
        <Line x1="1" y1="10" x2="23" y2="10" />
      </G>
    ),
    'clock': (
      <G {...s}>
        <Circle cx="12" cy="12" r="10" />
        <Polyline points="12 6 12 12 16 14" />
      </G>
    ),
    'bell': (
      <G {...s}>
        <Path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <Path d="M13.73 21a2 2 0 01-3.46 0" />
      </G>
    ),
    'logout': (
      <G {...s}>
        <Path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
        <Polyline points="16 17 21 12 16 7" />
        <Line x1="21" y1="12" x2="9" y2="12" />
      </G>
    ),

    // ─── Wallet transactions ──────────────────────────────────────────────────
    'arrow-up-right': (
      <G {...s}>
        <Line x1="7" y1="17" x2="17" y2="7" />
        <Polyline points="7 7 17 7 17 17" />
      </G>
    ),
    'arrow-down-left': (
      <G {...s}>
        <Line x1="17" y1="7" x2="7" y2="17" />
        <Polyline points="17 17 7 17 7 7" />
      </G>
    ),
    'arrow-right': (
      <G {...s}>
        <Line x1="5" y1="12" x2="19" y2="12" />
        <Polyline points="12 5 19 12 12 19" />
      </G>
    ),

    // ─── Misc ────────────────────────────────────────────────────────────────
    'edit': (
      <G {...s}>
        <Path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
        <Path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
      </G>
    ),
    'user': (
      <G {...s}>
        <Path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <Circle cx="12" cy="7" r="4" />
      </G>
    ),
    'notification': (
      <G {...s}>
        <Path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <Path d="M13.73 21a2 2 0 01-3.46 0" />
      </G>
    ),
    'history': (
      <G {...s}>
        <Path d="M3 3v5h5" />
        <Path d="M3.05 13A9 9 0 1015 21.54" transform="scale(0.9) translate(1.3,1.3)" />
        <Path d="M12 7v5l4 2" />
      </G>
    ),
    'file-text': (
      <G {...s}>
        <Path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <Polyline points="14 2 14 8 20 8" />
        <Line x1="16" y1="13" x2="8" y2="13" />
        <Line x1="16" y1="17" x2="8" y2="17" />
        <Polyline points="10 9 9 9 8 9" />
      </G>
    ),
    'trash': (
      <G {...s}>
        <Polyline points="3 6 5 6 21 6" />
        <Path d="M19 6l-1 14H6L5 6" />
        <Path d="M10 11v6M14 11v6" />
        <Path d="M9 6V4h6v2" />
      </G>
    ),
    'close': (
      <G {...s}>
        <Line x1="18" y1="6" x2="6" y2="18" />
        <Line x1="6" y1="6" x2="18" y2="18" />
      </G>
    ),
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {icons[name]}
    </Svg>
  );
}
