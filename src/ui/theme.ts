/** Design tokens (PRD §12). Warm, minimal, calm — a journal more than a dashboard. */
export const colors = {
  cream: '#F7F4EC', // main background
  sage: '#E5EBDD', // secondary surfaces
  softGreen: '#8BA68B', // progress indicators
  forest: '#344B3A', // primary text / accent
  clay: '#D7A58C', // occasional warm accent
  // neutrals
  surface: '#FFFDF8',
  border: '#E3DED1',
  muted: '#6E7468', // secondary text (4.9:1 on cream)
  faint: '#A7AA9F', // future / disabled
  neutralDay: '#ECE8DD', // incomplete past day
  danger: '#9A4A3A',
  white: '#FFFFFF',
} as const;

export const fonts = {
  regular: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  bold: 'DMSans_700Bold',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 16, lg: 22, pill: 999 } as const;

export const type = {
  display: { fontFamily: fonts.bold, fontSize: 40, lineHeight: 46, color: colors.forest },
  stat: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, color: colors.forest },
  title: { fontFamily: fonts.medium, fontSize: 26, lineHeight: 32, color: colors.forest },
  heading: { fontFamily: fonts.medium, fontSize: 18, lineHeight: 24, color: colors.forest },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, color: colors.forest },
  small: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19, color: colors.muted },
  label: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, letterSpacing: 1.2, color: colors.muted },
} as const;

/** Minimum comfortable touch target. */
export const TOUCH = 48;
export const MAX_CONTENT_WIDTH = 560; // keeps the web layout phone-shaped and readable
