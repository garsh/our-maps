import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
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

  const setTheme = useCallback((newTheme: MapTheme) => {
    setThemeState(newTheme);
    localStorage.setItem('ourmaps_map_theme', newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('ourmaps_map_theme', next);
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return (
    <ThemeContext.Provider value={value}>
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
