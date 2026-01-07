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

const Dashboard = ({ user, settings, onShowSettings, onLogout, onShowTasks }) => {
    const [counts, setCounts] = useState(new Map());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [countdown, setCountdown] = useState(30);
    const [timeFilter, setTimeFilter] = useState('all');
    const [enableMapView, setEnableMapView] = useState(() => {
        if (settings && settings.enableMapView !== undefined) return settings.enableMapView;
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
    // Sync enableMapView with settings prop changes
    useEffect(() => {
        if (settings) {
            if (settings.enableMapView !== undefined) {
                setEnableMapView(settings.enableMapView);
            } else if (settings.boardId) {
                try {
                    const stored = localStorage.getItem(`ENABLE_MAP_VIEW_${settings.boardId}`);
                    setEnableMapView(stored === 'true');
                } catch (e) { }
            }
        }
    }, [settings]);

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
    // NEW: Get refresh interval setting
    const effectiveSeconds = React.useMemo(() => {
        try {
            const savedRefresh = localStorage.getItem(STORAGE_KEYS.REFRESH_INTERVAL + boardId);
            const defaultRefreshSetting = { value: 1, unit: 'minutes' };
            const refreshSetting = savedRefresh ? JSON.parse(savedRefresh) : defaultRefreshSetting;
            const calculatedSeconds = convertIntervalToSeconds(refreshSetting.value, refreshSetting.unit);
            return calculatedSeconds < 15 ? 15 : calculatedSeconds;
        } catch (e) {
            return 60; // default to 60s on error
        }
    }, [boardId]);

    const ignoreTemplateCards = localStorage.getItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + boardId) !== 'false';
    const ignoreCompletedCards = localStorage.getItem(STORAGE_KEYS.IGNORE_COMPLETED_CARDS + boardId) === 'true';


    const isFetchingRef = useRef(false);

    const fetchListCounts = useCallback(async (manual = false) => {
        if (manual || loading) {
            setLoading(true);
        }

        if (isFetchingRef.current) return;
        isFetchingRef.current = true;

        setError('');

        const persistentColorsCopy = getPersistentColors(user.id);
        const currentLayout = getPersistentLayout(user.id, boardId);
        const usedColors = new Set(Object.values(persistentColorsCopy).flatMap(b => Object.values(b)));
        // We do filtering locally now, so we don't need dateFilterParam for the API call
        // const dateFilterParam = calculateDateFilter(timeFilter); 
        const uniqueListIds = new Set(currentLayout.flatMap(s => s.listIds));
        const ignoreTemplateCardsSetting = localStorage.getItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + boardId) !== 'false';
        const ignoreCompletedCardsSetting = localStorage.getItem(STORAGE_KEYS.IGNORE_COMPLETED_CARDS + boardId) === 'true';

        if (uniqueListIds.size === 0) {
            setCounts(new Map());
            setLoading(false);
            return;
        }

        try {
            // OPTIMIZATION: Fetch ALL cards for the board in ONE request.
            // This avoids N requests (one per list) which causes API throttling (Error 429).
            // We fetch 'name' and 'pos' to determine the "first card" locally.
            // We fetch 'dateLastActivity' to filter by time locally.
            const allCards = await trelloFetch(
                `/boards/${boardId}/cards?fields=id,idList,pos,name,isTemplate,dateLastActivity,dueComplete`,
                user.token
            );

            // 1. Process "First Card" for descriptions (Find min pos per list)
            const firstCardMap = new Map();
            allCards.forEach(c => {
                // Optimization: Only track if list is relevant? 
                // Actually, it's cheap to track for all lists or just filter.
                // Let's just track for all lists to be safe and simple.
                const currentFirst = firstCardMap.get(c.idList);
                if (!currentFirst || c.pos < currentFirst.pos) {
                    firstCardMap.set(c.idList, c);
                }
            });

            // 2. Filter cards for "Counts" based on Time Filter & Templates
            const filterConfig = TIME_FILTERS[timeFilter];
            let sinceDate = null;
            let beforeDate = null;

            if (filterConfig) {
                if (filterConfig.type === 'relative' && timeFilter !== 'all') {
                    const now = new Date();
                    now.setMinutes(now.getMinutes() - filterConfig.minutes);
                    sinceDate = now;
                } else if (filterConfig.type === 'calendar') {
                    if (filterConfig.start) sinceDate = filterConfig.start;
                    if (filterConfig.end && timeFilter !== 'this_month' && timeFilter !== 'this_week') {
                        beforeDate = filterConfig.end; // 'before' is exclusive usually
                    }
                }
            }

            const cardsForProcessing = allCards.filter(c => {
                // Template Filter
                if (ignoreTemplateCardsSetting && c.isTemplate) return false;

                // Completed Filter (NEW)
                if (ignoreCompletedCardsSetting && c.dueComplete) return false;

                // Time Filter
                if (sinceDate || beforeDate) {
                    const cardDate = new Date(c.dateLastActivity); // dateLastActivity is ISO string
                    if (sinceDate && cardDate < sinceDate) return false;
                    if (beforeDate && cardDate >= beforeDate) return false;
                }

                return true;
            });

            const listResults = {};

            // 3. Count cards per list
            cardsForProcessing.forEach(card => {
                if (!uniqueListIds.has(card.idList)) return;

                if (!listResults[card.idList]) {
                    listResults[card.idList] = { count: 0 };
                }
                listResults[card.idList].count++;
            });

            // 4. Final calculation and mapping
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

            // Handle Rate Limiting
            if (e.message && e.message.includes('429')) {
                setError("Trello API Limit Exceeded. Refresh paused. Please wait a moment or increase refresh interval.");
                // We should probably stop the auto-refresh here or relying on the error state to show UI is enough.
                // The useEffect interval depends on 'loading' state? No.
                // It continues running.
                // We should add a 'paused' state logic if error is 429.
            } else {
                setError(e.message);
            }
        } finally {
            isFetchingRef.current = false;
            setLoading(false);
        }
    }, [user.token, listsFromSettings.length, boardId, sectionsLayout.length, timeFilter]);

    // Interval setup
    useEffect(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
        }

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
    }, [fetchListCounts, effectiveSeconds]);


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
                {settings?.enableTaskView && (
                    <button className="settings-button" onClick={onShowTasks}>Tasks View</button>
                )}
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
