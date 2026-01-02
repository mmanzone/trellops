import React, { createContext, useState, useEffect, useContext } from 'react';
import { STORAGE_KEYS } from '../utils/constants';

const DarkModeContext = createContext();

export const useDarkMode = () => {
    return useContext(DarkModeContext);
};

export const DarkModeProvider = ({ children }) => {
    const [theme, setTheme] = useState(() => localStorage.getItem(STORAGE_KEYS.THEME) || 'system');

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        const applyTheme = (currentTheme) => {
            const resolvedTheme =
                currentTheme === 'system'
                    ? (mediaQuery.matches ? 'dark' : 'light')
                    : currentTheme;
            document.documentElement.setAttribute('data-theme', resolvedTheme);
        };

        applyTheme(theme);

        const handleChange = () => applyTheme(theme);
        mediaQuery.addEventListener('change', handleChange);

        return () => mediaQuery.removeEventListener('change', handleChange);
    }, [theme]);

    const toggleTheme = (newTheme) => {
        const resolvedTheme = newTheme || (theme === 'light' ? 'dark' : 'light');
        setTheme(resolvedTheme);
        localStorage.setItem(STORAGE_KEYS.THEME, resolvedTheme);
    };

    return (
        <DarkModeContext.Provider value={{ theme, toggleTheme }}>
            {children}
        </DarkModeContext.Provider>
    );
};
