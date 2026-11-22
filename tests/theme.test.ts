import {
  mossColors,
  readerSurfaces,
  spacing,
  radius,
  motion,
  fontFamilies,
  typography,
} from '@/theme';

describe('Midnight Moss design system tokens', () => {
  test('locks in exact Midnight Moss palette hex values from approved concept', () => {
    expect(mossColors.bg).toBe('#0F1715');
    expect(mossColors.surface).toBe('#172320');
    expect(mossColors.surfaceElevated).toBe('#20312C');
    expect(mossColors.fg).toBe('#EAE6DC');
    expect(mossColors.muted).toBe('#93A79E');
    expect(mossColors.accent).toBe('#E08E6D');
    expect(mossColors.accentFg).toBe('#18100D');
    expect(mossColors.good).toBe('#7DC4A0');
    expect(mossColors.warn).toBe('#E9B44C');
  });

  test('provides Midnight Moss plus optional Warm Paper and True OLED reader surfaces', () => {
    expect(readerSurfaces.moss.bg).toBe('#0F1715');
    expect(readerSurfaces.moss.fg).toBe('#EAE6DC');
    expect(readerSurfaces.paper.bg).toBe('#F5F0E6');
    expect(readerSurfaces.paper.fg).toBe('#1C1917');
    expect(readerSurfaces.oled.bg).toBe('#0B0B0D');
    expect(readerSurfaces.oled.fg).toBe('#EDE8DF');
  });

  test('uses 4-point spacing scale and Lora / DM Sans / IBM Plex Mono font families', () => {
    expect(spacing.xs).toBe(4);
    expect(spacing.sm).toBe(8);
    expect(spacing.md).toBe(16);
    expect(spacing.lg).toBe(24);
    expect(radius.cover).toBe(10);
    expect(radius.card).toBe(16);
    expect(motion.pressScale).toBe(0.97);
    expect(fontFamilies.displaySemiBold).toBe('Lora_600SemiBold');
    expect(fontFamilies.uiMedium).toBe('DMSans_500Medium');
    expect(fontFamilies.monoMedium).toBe('IBMPlexMono_500Medium');
    expect(typography.screenTitle.fontFamily).toBe(fontFamilies.displaySemiBold);
    expect(typography.prose.fontFamily).toBe(fontFamilies.displayRegular);
  });
});
