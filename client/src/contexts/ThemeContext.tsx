import React, { createContext, useContext, useEffect, useState } from 'react';
import type { MapTheme } from '../components/Sidebar';

interface ThemeContextType {
  theme: MapTheme;
  setTheme: (theme: MapTheme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<MapTheme>(() => {
    const saved = localStorage.getItem('ourmaps_map_theme');
    if (saved && ['light', 'dark'].includes(saved)) {
      return saved as MapTheme;
    }
    return 'light';
  });

  const setTheme = (newTheme: MapTheme) => {
    setThemeState(newTheme);
    localStorage.setItem('ourmaps_map_theme', newTheme);
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    return {
      theme: 'light' as MapTheme,
      setTheme: () => {},
      toggleTheme: () => {},
    };
  }
  return context;
}
