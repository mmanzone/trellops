import { TIME_FILTERS, STORAGE_KEYS } from './constants';

export const calculateDateFilter = (filterKey) => {
    const filter = TIME_FILTERS[filterKey];
    if (!filter) return ''; // Safely handle invalid keys

    let params = '';

    if (filter.type === 'relative' && filterKey !== 'all') {
        const now = new Date();
        now.setMinutes(now.getMinutes() - filter.minutes);
        params = `&since=${now.toISOString()}`;
    } else if (filter.type === 'calendar') {
        const { start, end } = filter;

        if (start) {
            params += `&since=${start.toISOString()}`;
        }
        if (end && filterKey !== 'this_month' && filterKey !== 'this_week') {
            params += `&before=${end.toISOString()}`;
        }
    }

    return params;
};

export const convertIntervalToSeconds = (value, unit) => {
    const numValue = parseInt(value) || 0;
    if (unit === 'seconds') return numValue;
    if (unit === 'minutes') return numValue * 60;
    if (unit === 'hours') return numValue * 3600;
    return 30; // Default if invalid
};

export const convertIntervalToMilliseconds = (value, unit) => {
    return convertIntervalToSeconds(value, unit) * 1000;
};

export const getOrGenerateRandomColor = (listId, existingColors) => {
    // Note: In React, we shouldn't read directly from localStorage if we can avoid it, 
    // but this function was designed to be state-agnostic in the original.
    // We can keep it or refactor to use a hook later.
    let cache = JSON.parse(localStorage.getItem(STORAGE_KEYS.RANDOM_COLORS_CACHE)) || {};
    let color = cache[listId];

    const DEFAULT_FALLBACK_COLOR = '#dcdcdc';

    if (!color) {
        let r, g, b;
        // Simple Set-like checking if existingColors is a Set. 
        // If it's an object (values), we might need to adjust.
        // Assuming Set<string> of hex colors
        do {
            r = Math.floor(Math.random() * 101);
            g = Math.floor(Math.random() * 101);
            b = Math.floor(Math.random() * 101);
            color = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).padStart(6, '0');
        } while (existingColors instanceof Set && existingColors.has(color));

        cache[listId] = color;
        localStorage.setItem(STORAGE_KEYS.RANDOM_COLORS_CACHE, JSON.stringify(cache));
    }
    return color || DEFAULT_FALLBACK_COLOR;
};

export const getLabelTextColor = (theme) => {
    const resolvedTheme =
        theme === 'system'
            ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
            : theme;
    return resolvedTheme === 'dark' ? '#ffffff' : '#222222';
};

export const formatDynamicCountdown = (seconds) => {
    if (seconds === null || seconds === undefined) return '';
    if (seconds <= 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
    return `${Math.round(seconds / 3600)}h`;
};
