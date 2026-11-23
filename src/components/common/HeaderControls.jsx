import React from 'react';
import { Sun, Moon, Monitor, MonitorOff } from 'lucide-react';
import { useDarkMode } from '../../context/DarkModeContext';

// Shared header controls, so every page (dashboard, map, stats, tasks) shows
// the same icon buttons with the same shape and icons.

export const ThemeToggleButton = ({ style }) => {
    const { theme, toggleTheme } = useDarkMode();
    const isDark = theme === 'dark';
    return (
        <button
            type="button"
            className="theme-toggle-button"
            onClick={() => toggleTheme()}
            title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            style={style}
        >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
    );
};

export const ScreenLockButton = ({ keepScreenOn, onToggle, style }) => {
    if (!onToggle) return null;
    const label = keepScreenOn ? 'Screen will stay on (click to allow sleep)' : 'Screen may turn off (click to keep it on)';
    return (
        <button
            type="button"
            className="theme-toggle-button"
            onClick={onToggle}
            title={label}
            aria-label={label}
            aria-pressed={!!keepScreenOn}
            style={style}
        >
            {keepScreenOn ? <Monitor size={18} /> : <MonitorOff size={18} style={{ opacity: 0.6 }} />}
        </button>
    );
};

// Page title with the optional digital clock in front, with the same spacing on every page.
export const PageTitle = ({ clock, children }) => (
    <div className="map-header-title-area">
        {clock}
        <h1 className="page-title">{children}</h1>
    </div>
);
