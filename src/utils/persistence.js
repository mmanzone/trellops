import { STORAGE_KEYS, DEFAULT_LAYOUT } from './constants';

// --- User-Specific Storage Helpers ---
export const getCurrentUser = () => {
    return localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
};

export const setCurrentUser = (userId) => {
    if (userId) {
        localStorage.setItem(STORAGE_KEYS.CURRENT_USER, userId);
    } else {
        localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
    }
};

export const getUserData = (userId, key) => {
    if (!userId) return null;
    const allUserData = JSON.parse(localStorage.getItem(STORAGE_KEYS.USER_DATA)) || {};
    const userData = allUserData[userId] || {};
    return userData[key];
};

export const setUserData = (userId, key, value) => {
    if (!userId) return;
    const allUserData = JSON.parse(localStorage.getItem(STORAGE_KEYS.USER_DATA)) || {};
    if (!allUserData[userId]) {
        allUserData[userId] = {};
    }
    allUserData[userId][key] = value;
    localStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(allUserData));
};

// --- Persistent Storage Management ---
export const getPersistentColors = (userId) => {
    try {
        return getUserData(userId, 'listColors') || {};
    } catch (e) { return {}; }
};

export const setPersistentColor = (userId, boardId, listId, color) => {
    const colors = getPersistentColors(userId);
    if (!colors[boardId]) { colors[boardId] = {}; }
    colors[boardId][listId] = color;
    setUserData(userId, 'listColors', colors);
};

export const setPersistentColors = (userId, boardId, colorsMap) => {
    const allColors = getPersistentColors(userId);
    allColors[boardId] = colorsMap;
    setUserData(userId, 'listColors', allColors);
};

export const getPersistentSelections = (userId, boardId) => {
    try {
        const allSelections = getUserData(userId, 'listSelections') || {};
        return new Set(allSelections[boardId] || []);
    } catch (e) { return new Set(); }
};

export const setPersistentSelections = (userId, boardId, listIds) => {
    try {
        const allSelections = getUserData(userId, 'listSelections') || {};
        allSelections[boardId] = Array.from(listIds);
        setUserData(userId, 'listSelections', allSelections);
    } catch (e) { console.error("Error saving list selections to cache:", e); }
};

export const getPersistentLayout = (userId, boardId) => {
    try {
        const layout = getUserData(userId, 'dashboardLayout') || {};
        const savedLayout = layout[boardId] || DEFAULT_LAYOUT;
        return savedLayout.map(s => ({
            ...s,
            isCollapsed: s.isCollapsed || false,
            ignoreFirstCard: s.ignoreFirstCard || false,
            displayFirstCardDescription: s.displayFirstCardDescription !== false, // Default to true
            includeOnMap: s.includeOnMap === true // Default to false
        }));
    } catch (e) {
        console.error("Error parsing dashboard layout:", e);
        return DEFAULT_LAYOUT;
    }
};

export const setPersistentLayout = (userId, boardId, layout) => {
    try {
        const allLayouts = getUserData(userId, 'dashboardLayout') || {};
        allLayouts[boardId] = layout;
        setUserData(userId, 'dashboardLayout', allLayouts);
    } catch (e) {
        console.error("Error saving dashboard layout:", e);
    }
};
