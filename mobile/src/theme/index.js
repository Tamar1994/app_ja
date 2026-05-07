// Paleta de cores do aplicativo Já!
const colors = {
  // Primárias
  primary: '#FF6B00',
  primaryDark: '#E55A00',
  primaryLight: '#FF8C38',
  secondary: '#1565C0',
  secondaryLight: '#1976D2',

  // Apoio
  white: '#FFFFFF',
  background: '#F5F6FA',
  surface: '#FFFFFF',
  card: '#FFFFFF',
  textPrimary: '#1A1A2E',
  textSecondary: '#5C6B7A',
  textLight: '#A8B5C0',
  border: '#EDF0F5',
  divider: '#F0F2F5',

  // Feedback
  warning: '#FFB300',
  success: '#00C853',
  successLight: '#E8F5E9',
  error: '#F44336',
  info: '#2196F3',

  // Gradientes (arrays para LinearGradient)
  gradientPrimary: ['#FF8C38', '#FF6B00'],
  gradientSecondary: ['#1976D2', '#1565C0'],
  gradientDark: ['#1A1A2E', '#16213E'],
  gradientSuccess: ['#43A047', '#00C853'],

  // Status
  statusSearching: '#FF6B00',
  statusAccepted: '#1565C0',
  statusInProgress: '#FFB300',
  statusCompleted: '#00C853',
  statusCancelled: '#A8B5C0',
};

const typography = {
  fontSizes: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 17,
    xl: 20,
    xxl: 26,
    xxxl: 32,
  },
  fontWeights: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
  },
};

const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  full: 999,
};

const shadows = {
  sm: {
    shadowColor: '#1A1A2E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  md: {
    shadowColor: '#1A1A2E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 12,
    elevation: 5,
  },
  lg: {
    shadowColor: '#1A1A2E',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 10,
  },
  primary: {
    shadowColor: '#FF6B00',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
};

export { colors, typography, spacing, borderRadius, shadows };
