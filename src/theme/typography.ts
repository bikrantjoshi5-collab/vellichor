import type { TextStyle } from 'react-native';
import { mossColors } from './colors';

export const fontFamilies = {
  displayRegular: 'Lora_400Regular',
  displayMedium: 'Lora_500Medium',
  displaySemiBold: 'Lora_600SemiBold',
  displayBold: 'Lora_700Bold',
  displayItalic: 'Lora_400Regular_Italic',
  uiRegular: 'DMSans_400Regular',
  uiMedium: 'DMSans_500Medium',
  uiSemiBold: 'DMSans_600SemiBold',
  uiBold: 'DMSans_700Bold',
  monoRegular: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
  monoSemiBold: 'IBMPlexMono_600SemiBold',
} as const;

export const typography = {
  screenTitle: {
    fontFamily: fontFamilies.displaySemiBold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
    color: mossColors.fg,
  },
  sectionTitle: {
    fontFamily: fontFamilies.displaySemiBold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.2,
    color: mossColors.fg,
  },
  cardTitle: {
    fontFamily: fontFamilies.uiSemiBold,
    fontSize: 14,
    lineHeight: 19,
    color: mossColors.fg,
  },
  body: {
    fontFamily: fontFamilies.uiRegular,
    fontSize: 15,
    lineHeight: 22,
    color: mossColors.fg,
  },
  subhead: {
    fontFamily: fontFamilies.uiRegular,
    fontSize: 13,
    lineHeight: 18,
    color: mossColors.muted,
  },
  caption: {
    fontFamily: fontFamilies.uiMedium,
    fontSize: 11.5,
    lineHeight: 16,
    color: mossColors.muted,
  },
  mono: {
    fontFamily: fontFamilies.monoMedium,
    fontSize: 11.5,
    lineHeight: 16,
    color: mossColors.muted,
    fontVariant: ['tabular-nums'],
  },
  prose: {
    fontFamily: fontFamilies.displayRegular,
    fontSize: 17,
    lineHeight: 30,
    color: mossColors.fg,
  },
} as const satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;
