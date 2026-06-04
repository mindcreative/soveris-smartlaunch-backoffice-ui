export interface ThemeConfig {
  primaryColor: string
  secondaryColor: string
  accentColor: string
  fontFamily: string
  layout: 'modern' | 'minimal' | 'bold'
  logoUrl?: string
  logoUrlDark?: string
  heroStyle: 'gradient' | 'solid' | 'image'
  buttonStyle: 'rounded' | 'sharp' | 'pill'
  borderRadius: string
  animationsEnabled: boolean
  darkModeSupport: boolean
  backgroundColor: string
  textColor: string
}

export interface UpdateThemeConfigRequest {
  themeConfig: ThemeConfig
}

export const defaultThemeConfig: ThemeConfig = {
  primaryColor: '#6366f1',
  secondaryColor: '#8b5cf6',
  accentColor: '#06b6d4',
  fontFamily: "'Inter', sans-serif",
  layout: 'modern',
  heroStyle: 'gradient',
  buttonStyle: 'rounded',
  borderRadius: '8px',
  animationsEnabled: true,
  darkModeSupport: true,
  backgroundColor: '#ffffff',
  textColor: '#1e293b'
}