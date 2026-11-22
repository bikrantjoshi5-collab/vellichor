export const mossColors = {
  bg: '#0F1715',
  surface: '#172320',
  surfaceElevated: '#20312C',
  fg: '#EAE6DC',
  muted: '#93A79E',
  accent: '#E08E6D',
  accentFg: '#18100D',
  accentSoft: 'rgba(224, 142, 109, 0.14)',
  good: '#7DC4A0',
  goodSoft: 'rgba(125, 196, 160, 0.14)',
  warn: '#E9B44C',
  warnSoft: 'rgba(233, 180, 76, 0.16)',
  danger: '#E07A5F',
  dangerSoft: 'rgba(224, 122, 95, 0.16)',
  border: 'rgba(234, 230, 220, 0.10)',
  backdrop: 'rgba(6, 10, 9, 0.72)',
  overlayDark: 'rgba(9, 13, 12, 0.88)',
  coverPlaceholderBg: '#1D2B27',
  coverPlaceholderAccent: '#7DC4A0',
} as const;

export type ReaderSurfaceId = 'moss' | 'paper' | 'oled';

export interface ReaderSurfacePalette {
  id: ReaderSurfaceId;
  label: string;
  bg: string;
  surface: string;
  fg: string;
  muted: string;
  accent: string;
  accentFg: string;
  spokenTint: string;
  border: string;
}

export const readerSurfaces: Record<ReaderSurfaceId, ReaderSurfacePalette> = {
  moss: {
    id: 'moss',
    label: 'Midnight Moss',
    bg: '#0F1715',
    surface: '#172320',
    fg: '#EAE6DC',
    muted: '#93A79E',
    accent: '#E08E6D',
    accentFg: '#18100D',
    spokenTint: 'rgba(224, 142, 109, 0.18)',
    border: 'rgba(234, 230, 220, 0.10)',
  },
  paper: {
    id: 'paper',
    label: 'Warm Paper',
    bg: '#F5F0E6',
    surface: '#ECE5D7',
    fg: '#1C1917',
    muted: '#706557',
    accent: '#C83E2B',
    accentFg: '#FAF6EF',
    spokenTint: 'rgba(200, 62, 43, 0.12)',
    border: 'rgba(28, 25, 23, 0.12)',
  },
  oled: {
    id: 'oled',
    label: 'True OLED',
    bg: '#0B0B0D',
    surface: '#15151A',
    fg: '#EDE8DF',
    muted: '#928C83',
    accent: '#D99B43',
    accentFg: '#120E08',
    spokenTint: 'rgba(217, 155, 67, 0.16)',
    border: 'rgba(237, 232, 223, 0.09)',
  },
};
