import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { trelloFetch } from '../api/trello';
import { STORAGE_KEYS, DEFAULT_LAYOUT, TIME_FILTERS } from '../utils/constants';
import {
    getPersistentColors, getPersistentLayout, setPersistentLayout
} from '../utils/persistence';
import {
    calculateDateFilter, convertIntervalToMilliseconds, convertIntervalToSeconds, getOrGenerateRandomColor
} from '../utils/helpers';
import { useDarkMode } from '../context/DarkModeContext';
import DigitalClock from './common/DigitalClock';
import CardDetailsModal from './common/CardDetailsModal';

const Dashboard = ({ user, settings, onShowSettings, onLogout }) => {
    const [counts, setCounts] = useState(new Map());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [countdown, setCountdown] = useState(30);
    const [timeFilter, setTimeFilter] = useState('all');
    const [enableMapView, setEnableMapView] = useState(() => {
        const boardIdLocal = settings?.boardId;
        if (!boardIdLocal) return false;
        const stored = localStorage.getItem(`ENABLE_MAP_VIEW_${boardIdLocal}`);
        return stored === 'true';
    });
    const timerRef = useRef(null);

    // Get theme context for toggle button
    const { theme, toggleTheme } = useDarkMode();

    // Handler for per-board map view toggle
    const handleToggleEnableMapView = (isChecked) => {
        const boardIdLocal = settings?.boardId;
        setEnableMapView(isChecked);
        try {
            if (boardIdLocal) localStorage.setItem(`ENABLE_MAP_VIEW_${boardIdLocal}`, isChecked ? 'true' : 'false');
        } catch (e) {
            console.warn('[Dashboard] Failed to persist ENABLE_MAP_VIEW', e);
        }
    };

    // Update enableMapView when selected board changes
    useEffect(() => {
        const boardIdLocal = settings?.boardId;
        if (!boardIdLocal) return;
        try {
            const stored = localStorage.getItem(`ENABLE_MAP_VIEW_${boardIdLocal}`);
            setEnableMapView(stored === 'true');
        } catch (e) {
            // ignore
        }
    }, [settings?.boardId]);

    const buildNumber = (() => {
        const now = new Date();
        const year = now.getFullYear().toString().slice(-2);
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        return `3.2.${year}${month}${day}${hours}${minutes}`;
    })();

    const [modalList, setModalList] = useState(null);

    const boardId = settings?.boardId;
    const boardName = settings?.boardName;
    const listsFromSettings = settings?.selectedLists || [];

    const sectionsLayout = boardId ? getPersistentLayout(user.id, boardId) : DEFAULT_LAYOUT;

    const allListsMap = new Map(listsFromSettings.map(list => [list.id, list]));
    const persistentColors = getPersistentColors(user.id);

    // Define blocksMap for rendering/lookup
    const blocksMap = new Map(sectionsLayout.map(s => [s.id, s]));

    // Toggle block collapse state
    const handleToggleCollapse = (blockId) => {
        const newLayout = sectionsLayout.map(s =>
            s.id === blockId ? { ...s, isCollapsed: !s.isCollapsed } : s
        );
        setPersistentLayout(user.id, boardId, newLayout);
        fetchListCounts(true);
    };

    // NEW: Get refresh interval setting
    const defaultRefreshSetting = { value: 1, unit: 'minutes' };
    const savedRefresh = localStorage.getItem(STORAGE_KEYS.REFRESH_INTERVAL + boardId);
    const refreshSetting = savedRefresh ? JSON.parse(savedRefresh) : defaultRefreshSetting;
    const refreshIntervalMs = convertIntervalToMilliseconds(refreshSetting.value, refreshSetting.unit);
    const ignoreTemplateCards = localStorage.getItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + boardId) !== 'false';


    const fetchListCounts = useCallback(async (manual = false) => {
        if (manual || loading) {
            setLoading(true);
        }
        setError('');

        const persistentColorsCopy = getPersistentColors(user.id);
        const currentLayout = getPersistentLayout(user.id, boardId);
        const usedColors = new Set(Object.values(persistentColorsCopy).flatMap(b => Object.values(b)));
        const dateFilterParam = calculateDateFilter(timeFilter);
        const uniqueListIds = new Set(currentLayout.flatMap(s => s.listIds));
        const ignoreTemplateCardsSetting = localStorage.getItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + boardId) !== 'false';


        if (uniqueListIds.size === 0) {
            setCounts(new Map());
            setLoading(false);
            return;
        }

        try {
            // --- New Logic: Identify and fetch first card for lists where it might be ignored/used as description ---
            const ignorableFirstCardLists = new Set();
            currentLayout.forEach(block => {
                if (block.ignoreFirstCard) {
                    block.listIds.forEach(listId => ignorableFirstCardLists.add(listId));
                }
            });

            const firstCardPromises = Array.from(ignorableFirstCardLists).map(listId =>
                trelloFetch(`/lists/${listId}/cards?limit=1&fields=name,id,isTemplate`, user.token)
                    .then(cards => ({ listId, firstCard: cards.length > 0 ? cards[0] : null }))
                    .catch(e => {
                        console.error(`Error fetching first card for list ${listId}:`, e);
                        return { listId, firstCard: null };
                    })
            );

            const firstCardResults = await Promise.all(firstCardPromises);
            const firstCardMap = new Map(firstCardResults.map(r => [r.listId, r.firstCard]));

            // Fetch all cards for counting, respecting the time filter. Only ID and list association are needed.
            const allCardsForCount = await trelloFetch(
                `/boards/${boardId}/cards?fields=id,idList,isTemplate${dateFilterParam}`,
                user.token
            );

            const cardsForProcessing = ignoreTemplateCardsSetting
                ? allCardsForCount.filter(c => !c.isTemplate)
                : allCardsForCount;

            const listResults = {};

            // 2. Process card counts from the time-filtered results
            cardsForProcessing.forEach(card => {
                if (!uniqueListIds.has(card.idList)) return;

                if (!listResults[card.idList]) {
                    listResults[card.idList] = { count: 0 };
                }
                listResults[card.idList].count++;
            });

            // 3. Final calculation and mapping
            const countsMap = new Map();

            Array.from(uniqueListIds).forEach(listId => {
                const listData = allListsMap.get(listId);
                const block = currentLayout.find(s => s.listIds.includes(listId));

                const isIgnored = block?.ignoreFirstCard;
                const displayDescription = block?.displayFirstCardDescription;
                const result = listResults[listId] || { count: 0 };

                let finalCount = result.count;
                let descriptionCardName = '';

                // If the first card should be ignored, we may need to adjust the count
                if (isIgnored) {
                    const firstCard = firstCardMap.get(listId);
                    if (firstCard) {
                        // Check if this first card ID is present in the time-filtered, template-filtered list of cards
                        const isFirstCardInFilteredSet = cardsForProcessing.some(c => c.id === firstCard.id);

                        // If it IS in the set, we need to subtract one because it's being used as a description
                        // or is otherwise ignored, and shouldn't be part of the count.
                        if (isFirstCardInFilteredSet) {
                            finalCount--;
                        }

                        // If "display description" is also checked, set the name for display
                        if (displayDescription) {
                            descriptionCardName = firstCard.name;
                        }
                    }
                }
                if (finalCount < 0) finalCount = 0; // Sanity check

                let color = persistentColors[boardId]?.[listId] || listData?.color;
                if (!color || color === '#cccccc') {
                    color = getOrGenerateRandomColor(listId, usedColors);
                }

                countsMap.set(listId, {
                    listId: listId,
                    count: finalCount,
                    name: listData?.name,
                    displayColor: color,
                    firstCardName: descriptionCardName
                });
            });

            setCounts(countsMap);

        } catch (e) {
            console.error("Dashboard fetch error:", e);
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [user.token, listsFromSettings.length, boardId, sectionsLayout.length, timeFilter]);

    // Interval setup
    useEffect(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
        }

        const calculatedSeconds = convertIntervalToSeconds(refreshSetting.value, refreshSetting.unit);
        const effectiveSeconds = calculatedSeconds < 15 ? 15 : calculatedSeconds;

        const interval = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    fetchListCounts();
                    return effectiveSeconds;
                }
                return prev - 1;
            });
        }, 1000);

        timerRef.current = interval;

        // Set initial countdown value and fetch
        setCountdown(effectiveSeconds);
        fetchListCounts();

        return () => clearInterval(interval);
    }, [fetchListCounts, refreshIntervalMs, settings, refreshSetting]);


    const handleTileClick = (listId, listName, color) => {
        setModalList({ listId, listName, color, sectionsLayout }); // Pass layout to modal
    };

    const handleCloseModal = () => {
        setModalList(null);
    };

    const filterLabel = TIME_FILTERS[timeFilter].titleSuffix;
    const clockSetting = localStorage.getItem(STORAGE_KEYS.CLOCK_SETTING + boardId);
    const showClock = clockSetting !== 'false';


    if (loading && listsFromSettings.length === 0) return <div className="container" style={{ textAlign: 'center', marginTop: '50px' }}>Loading dashboard data...</div>;

    if (error) return <div className="container"><div className="error">{error}</div></div>;

    if (!boardName || listsFromSettings.length === 0) {
        return (
            <div className="container">
                <div className="header">
                    <h1>Trellops Dashboard</h1>
                    <button className="logout-button" onClick={onLogout}>Log Out</button>
                </div>
                <p style={{ textAlign: 'center', marginTop: '50px' }}>
                    No Trello Board configured. Please go to settings to set up your first dashboard.
                </p>
                <div style={{ textAlign: 'center', marginTop: '20px' }}>
                    <button className="settings-button" onClick={onShowSettings}>Go to Settings</button>
                </div>
                <div style={{ textAlign: 'center', marginTop: '10px' }}>
                    <a href="help.html" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
                        <img src="assets/help-icon.svg" alt="Help" style={{ width: '18px', height: '18px', verticalAlign: 'middle', marginRight: '8px' }} />
                        <span style={{ color: 'var(--text-secondary)' }}>Need help?</span>
                        &nbsp;
                        <span style={{ color: '#0057d9', fontWeight: 600 }}>Trellops Use Guide</span>
                    </a>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <div className="header">
                <div className="header-title-area">
                    {/* Large Clock */}
                    {showClock && <DigitalClock boardId={boardId} />}
                    {/* Title with time filter */}
                    <h1>{boardName} dashboard - {filterLabel}</h1>
                </div>

                <div className="header-actions-top">
                    {/* Time Filter Dropdown */}
                    <select className="time-filter-select" value={timeFilter} onChange={e => setTimeFilter(e.target.value)}>
                        {Object.keys(TIME_FILTERS).map(key => (
                            <option key={key} value={key}>{TIME_FILTERS[key].label}</option>
                        ))}
                    </select>

                    {/* Theme Toggle Button */}
                    <button className="theme-toggle-button" onClick={() => toggleTheme()}>
                        {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
                    </button>


                </div>
            </div>

            {/* RENDER BLOCKS */}
            {sectionsLayout.map(block => {
                const blockTiles = block.listIds
                    .map(listId => {
                        const tileData = counts.get(listId);

                        // Placeholder Logic
                        if (!tileData) {
                            const list = allListsMap.get(listId);
                            if (list) {
                                const color = list.color || getOrGenerateRandomColor(list.id, new Set());

                                return { listId: list.id, name: list.name, count: '...', displayColor: color, firstCardName: '' };
                            }
                            return undefined;
                        }
                        return tileData;
                    })
                    .filter(item => item !== undefined);

                // Determine collapse state
                const isCollapsed = blocksMap.get(block.id)?.isCollapsed || false;

                if (blockTiles.length === 0 && !isCollapsed) return null;

                return (
                    <div key={block.id} className="dashboard-block">
                        <div className="block-header-row">
                            <div className="block-header">{block.name}</div>
                            <button
                                className="collapse-toggle"
                                onClick={() => handleToggleCollapse(block.id)}
                                title={isCollapsed ? 'Show Tiles' : 'Hide Tiles'}
                            >
                                {isCollapsed ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.02 18.02 0 0 1 5.06-5.06"></path>
                                        <path d="M4.22 4.22L12 12m5.07-5.07A10.07 10.07 0 0 1 23 12s-4 8-11 8c-1.85 0-3.61-.5-5.17-1.42"></path>
                                        <line x1="1" y1="1" x2="23" y2="23"></line>
                                    </svg>
                                ) : (
                                    <svg className="icon-eye" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                        <circle cx="12" cy="12" r="3"></circle>
                                    </svg>
                                )}
                            </button>
                        </div>

                        {/* Conditionally render the grid */}
                        {!isCollapsed && (
                            <div className="dashboard-grid">
                                {blockTiles.map((item) => (
                                    <div
                                        key={item.listId}
                                        className="dashboard-tile"
                                        style={{
                                            backgroundColor: item.displayColor,
                                            color: 'white'
                                        }}
                                        onClick={() => handleTileClick(item.listId, item.name, item.displayColor)}
                                    >
                                        <div className="card-count">{item.count}</div>
                                        <div className="list-name">{item.name}</div>
                                        {/* Display first card name if available */}
                                        {item.firstCardName && (
                                            <div className="card-description" title={item.firstCardName}>
                                                {item.firstCardName}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}


            {modalList && (
                <CardDetailsModal
                    listId={modalList.listId}
                    listName={modalList.listName}
                    color={modalList.color}
                    token={user.token}
                    onClose={handleCloseModal}
                    sectionsLayout={sectionsLayout}
                    ignoreTemplateCards={ignoreTemplateCards}
                />
            )}

            {/* NEW: Fixed Footer Action Bar */}
            <div className="footer-action-bar">

                <span className="countdown">Next refresh in {countdown}s</span>
                <button className="refresh-button" onClick={() => fetchListCounts(true)}>Refresh Tiles</button>
                {enableMapView && (
                    <button className="settings-button" onClick={() => window.open('/map', '_blank')}>Map View</button>
                )}
                <button className="settings-button" onClick={onShowSettings}>Settings</button>
                <button className="logout-button" onClick={onLogout}>Log Out</button>
            </div>
        </div>
    );
};

export default Dashboard;
