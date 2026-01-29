// IMPORTANT: Replace with your Trello API Key
export const TRELLO_API_KEY = "558e200650487a28cf1cc0b33561cd82";
export const TRELLO_API_BASE = "https://api.trello.com/1";

export const STORAGE_KEYS = {
    CURRENT_USER: 'trelloCurrentUser',
    USER_DATA: 'trelloUserData',
    THEME: 'dashboardTheme',
    CLOCK_SETTING: 'dashboardClockSetting_',
    REFRESH_INTERVAL: 'dashboardRefreshInterval_',
    IGNORE_TEMPLATE_CARDS: 'dashboardIgnoreTemplateCards_',
    IGNORE_COMPLETED_CARDS: 'dashboardIgnoreCompletedCards_',
    IGNORE_NO_DESC_CARDS: 'IGNORE_NO_DESC_CARDS_', // Matches legacy/SettingsScreen value
    RANDOM_COLORS_CACHE: 'dashboardRandomColors',
    IGNORE_CARDS: 'dashboardIgnoredCards_'
};

export const DEFAULT_LAYOUT = [{ id: 'all', name: 'Default', listIds: [], ignoreFirstCard: false, displayFirstCardDescription: true, isCollapsed: false }];

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const now = new Date();

const calcCalendarFilter = (key) => {
    let start, end;
    if (key === 'last_month') {
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0);
        const monthName = MONTH_NAMES[start.getMonth()];
        return { start, end, label: `Last month (${monthName} ${start.getFullYear()})`, titleSuffix: `${monthName} ${start.getFullYear()}` };
    } else if (key === 'this_month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = now;
        const monthName = MONTH_NAMES[now.getMonth()];
        return { start, end, label: `This month (${monthName} ${now.getFullYear()})`, titleSuffix: `${monthName} ${now.getFullYear()}` };
    } else if (key === 'this_week') {
        const dayOfWeek = now.getDay();
        const daysToSubtract = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);

        start = new Date(now);
        start.setDate(now.getDate() - daysToSubtract);
        start.setHours(0, 0, 0, 0);

        end = now;
        return { start, end, label: `This week (Mon-Sun)`, titleSuffix: `This Week` };
    } else if (key === 'last_week') {
        const dayOfWeek = now.getDay();
        const daysToSubtract = (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + 7;

        start = new Date(now);
        start.setDate(now.getDate() - daysToSubtract);
        start.setHours(0, 0, 0, 0);

        end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        return { start, end, label: `Last week (Mon-Sun)`, titleSuffix: `Last Week` };
    } else if (key === 'last_3m') {
        start = new Date(now);
        start.setMonth(now.getMonth() - 3);
        start.setHours(0, 0, 0, 0);
        end = now;
        return { start, end, label: 'Last 3 Months', titleSuffix: 'Last 3 Months' };
    } else if (key === 'ytd') {
        start = new Date(now.getFullYear(), 0, 1);
        end = now;
        return { start, end, label: 'Year to Date', titleSuffix: 'YTD' };
    } else if (key === 'last_year') {
        start = new Date(now.getFullYear() - 1, 0, 1);
        end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
        return { start, end, label: 'Last Year', titleSuffix: 'Last Year' };
    }
};

export const TIME_FILTERS = {
    'all': { label: 'All Time', minutes: 0, titleSuffix: 'All Time', type: 'absolute' },
    '24h': { label: 'Last 24h', minutes: 60 * 24, titleSuffix: 'Last 24h', type: 'relative' },
    '48h': { label: 'Last 48h', minutes: 60 * 48, titleSuffix: 'Last 48h', type: 'relative' },
    '72h': { label: 'Last 72h', minutes: 60 * 72, titleSuffix: 'Last 72h', type: 'relative' },
    '7d': { label: 'Last 7 days', minutes: 60 * 24 * 7, titleSuffix: 'Last 7 Days', type: 'relative' },

    'this_week': { ...calcCalendarFilter('this_week'), type: 'calendar' },
    'last_week': { ...calcCalendarFilter('last_week'), type: 'calendar' },

    'last_30d': { label: 'Last 30 days', minutes: 60 * 24 * 30, titleSuffix: 'Last 30 Days', type: 'relative' },
    'this_month': { ...calcCalendarFilter('this_month'), type: 'calendar' },
    'last_month': { ...calcCalendarFilter('last_month'), type: 'calendar' },
    'last_3m': { ...calcCalendarFilter('last_3m'), type: 'calendar' },
    'ytd': { ...calcCalendarFilter('ytd'), type: 'calendar' },
    'last_year': { ...calcCalendarFilter('last_year'), type: 'calendar' },
};
