import React, { useState, useEffect, useRef, useCallback } from 'react';
import { trelloFetch } from '../api/trello';
import { STORAGE_KEYS, DEFAULT_LAYOUT, TIME_FILTERS } from '../utils/constants';
import {
    getPersistentColors, getPersistentLayout, setPersistentLayout
} from '../utils/persistence';
import {
    convertIntervalToSeconds, getOrGenerateRandomColor
} from '../utils/helpers';
import { useDarkMode } from '../context/DarkModeContext';
import DigitalClock from './common/DigitalClock';
import CardDetailsModal from './common/CardDetailsModal';

const Dashboard = ({ user, settings, onShowSettings, onLogout, onShowTasks, onShowMap }) => {
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
    const [showMapDropdown, setShowMapDropdown] = useState(false);
    const [showTaskDropdown, setShowTaskDropdown] = useState(false);

    // Get theme context for toggle button
    const { theme, toggleTheme } = useDarkMode();

    // Update enableMapView when selected board changes
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
    const blocksMap = new Map(sectionsLayout.map(s => [s.id, s]));

    const handleToggleCollapse = (blockId) => {
        const newLayout = sectionsLayout.map(s =>
            s.id === blockId ? { ...s, isCollapsed: !s.isCollapsed } : s
        );
        setPersistentLayout(user.id, boardId, newLayout);
        fetchListCounts(true);
    };

    const effectiveSeconds = React.useMemo(() => {
        try {
            const savedRefresh = localStorage.getItem(STORAGE_KEYS.REFRESH_INTERVAL + boardId);
            const defaultRefreshSetting = { value: 1, unit: 'minutes' };
            const refreshSetting = savedRefresh ? JSON.parse(savedRefresh) : defaultRefreshSetting;
            const calculatedSeconds = convertIntervalToSeconds(refreshSetting.value, refreshSetting.unit);
            return calculatedSeconds < 15 ? 15 : calculatedSeconds;
        } catch (e) {
            return 60;
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
        const uniqueListIds = new Set(currentLayout.flatMap(s => s.listIds));
        const ignoreTemplateCardsSetting = localStorage.getItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + boardId) !== 'false';
        const ignoreCompletedCardsSetting = localStorage.getItem(STORAGE_KEYS.IGNORE_COMPLETED_CARDS + boardId) === 'true';
        const ignoreNoDescCardsSetting = localStorage.getItem('IGNORE_NO_DESC_CARDS_' + boardId) === 'true';

        if (uniqueListIds.size === 0) {
            setCounts(new Map());
            setLoading(false);
            return;
        }

        try {
            const allCards = await trelloFetch(
                `/boards/${boardId}/cards?fields=id,idList,pos,name,desc,start,isTemplate,dateLastActivity,dueComplete`,
                user.token
            );

            const firstCardMap = new Map();
            allCards.forEach(c => {
                const currentFirst = firstCardMap.get(c.idList);
                if (!currentFirst || c.pos < currentFirst.pos) {
                    firstCardMap.set(c.idList, c);
                }
            });

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
                        beforeDate = filterConfig.end;
                    }
                }
            }

            const cardsForProcessing = allCards.filter(c => {
                if (ignoreTemplateCardsSetting && c.isTemplate) return false;
                if (ignoreCompletedCardsSetting && c.dueComplete) return false;
                if (ignoreNoDescCardsSetting && (!c.desc || !c.desc.trim())) return false;
                if (sinceDate || beforeDate) {
                    const cardDate = new Date(c.dateLastActivity);
                    if (sinceDate && cardDate < sinceDate) return false;
                    if (beforeDate && cardDate >= beforeDate) return false;
                }
                return true;
            });

            const listResults = {};
            cardsForProcessing.forEach(card => {
                if (!uniqueListIds.has(card.idList)) return;
                if (!listResults[card.idList]) {
                    listResults[card.idList] = { count: 0 };
                }
                listResults[card.idList].count++;
            });

            const countsMap = new Map();
            Array.from(uniqueListIds).forEach(listId => {
                const listData = allListsMap.get(listId);
                const block = currentLayout.find(s => s.listIds.includes(listId));
                const isIgnored = block?.ignoreFirstCard;
                const displayDescription = block?.displayFirstCardDescription;
                const result = listResults[listId] || { count: 0 };
                let finalCount = result.count;
                let descriptionCardName = '';
                let descriptionCardStart = null;

                if (isIgnored) {
                    const firstCard = firstCardMap.get(listId);
                    if (firstCard) {
                        const isFirstCardInFilteredSet = cardsForProcessing.some(c => c.id === firstCard.id);
                        if (isFirstCardInFilteredSet) {
                            finalCount--;
                        }
                        if (displayDescription) {
                            descriptionCardName = firstCard.name;
                            if (firstCard.start) descriptionCardStart = firstCard.start;
                        }
                    }
                }
                if (finalCount < 0) finalCount = 0;

                let color = persistentColors[boardId]?.[listId] || listData?.color;
                if (!color || color === '#cccccc') {
                    color = getOrGenerateRandomColor(listId, usedColors);
                }

                countsMap.set(listId, {
                    listId: listId,
                    count: finalCount,
                    name: listData?.name,
                    displayColor: color,
                    firstCardName: descriptionCardName,
                    firstCardStart: descriptionCardStart
                });
            });

            setCounts(countsMap);

        } catch (e) {
            console.error("Dashboard fetch error:", e);
            if (e.message && e.message.includes('429')) {
                setError("Trello API Limit Exceeded. Refresh paused. Please wait a moment or increase refresh interval.");
            } else {
                setError(e.message);
            }
        } finally {
            isFetchingRef.current = false;
            setLoading(false);
        }
    }, [user.token, listsFromSettings.length, boardId, sectionsLayout.length, timeFilter]);

    useEffect(() => {
        if (timerRef.current) clearInterval(timerRef.current);
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
        setCountdown(effectiveSeconds);
        fetchListCounts();
        return () => clearInterval(interval);
    }, [fetchListCounts, effectiveSeconds]);


    const handleTileClick = (listId, listName, color) => {
        setModalList({ listId, listName, color, sectionsLayout });
    };

    const handleCloseModal = () => {
        setModalList(null);
    };

    const filterLabel = TIME_FILTERS[timeFilter].titleSuffix;
    const clockSetting = localStorage.getItem(STORAGE_KEYS.CLOCK_SETTING + boardId);
    const showClock = clockSetting !== 'false';

    // Styling constants matching TaskView/MapView
    const headerStyle = {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 20px',
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border-color, #ccc)',
        height: '60px',
        boxSizing: 'border-box'
    };

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
            </div>
        );
    }

    return (
        <div className="container">
            {/* HEADER - Updated to match MapView/TaskView style */}
            <div className="map-header" style={headerStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    {showClock && <DigitalClock boardId={boardId} compact={true} />}
                    <h2 style={{ margin: 0, fontSize: '1.2em', display: 'flex', alignItems: 'center' }}>
                        {boardName} <span style={{ fontSize: '0.8em', fontWeight: 'normal', color: 'var(--text-secondary)', marginLeft: '8px' }}>{filterLabel}</span>
                    </h2>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <select className="time-filter-select" value={timeFilter} onChange={e => setTimeFilter(e.target.value)} style={{ marginLeft: '10px' }}>
                        {Object.keys(TIME_FILTERS).map(key => (
                            <option key={key} value={key}>{TIME_FILTERS[key].label}</option>
                        ))}
                    </select>

                    <button className="theme-toggle-button" onClick={() => toggleTheme()}>
                        {theme === 'dark' ? '☀️' : '🌙'}
                    </button>
                </div>
            </div>

            {/* RENDER BLOCKS */}
            <div style={{ padding: '20px' }}>
                {sectionsLayout.map(block => {
                    const blockTiles = block.listIds
                        .map(listId => {
                            const tileData = counts.get(listId);
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

                    const isCollapsed = blocksMap.get(block.id)?.isCollapsed || false;

                    if (blockTiles.length === 0 && !isCollapsed) return null;

                    return (
                        <div key={block.id} className="dashboard-block">
                            <div className="block-header-row">
                                <div className="block-header">{block.name}</div>
                                <button className="collapse-toggle" onClick={() => handleToggleCollapse(block.id)} title={isCollapsed ? 'Show Tiles' : 'Hide Tiles'}>
                                    {isCollapsed ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.02 18.02 0 0 1 5.06-5.06"></path><path d="M4.22 4.22L12 12m5.07-5.07A10.07 10.07 0 0 1 23 12s-4 8-11 8c-1.85 0-3.61-.5-5.17-1.42"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                                    ) : (
                                        <svg className="icon-eye" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                                    )}
                                </button>
                            </div>
                            {!isCollapsed && (
                                <div className="dashboard-grid">
                                    {blockTiles.map((item) => (
                                        <div key={item.listId} className="dashboard-tile" style={{ backgroundColor: item.displayColor, color: 'white' }} onClick={() => handleTileClick(item.listId, item.name, item.displayColor)}>
                                            <div className="card-count">{item.count}</div>
                                            <div className="list-name">{item.name}</div>
                                            {item.firstCardName && (
                                                <div className="card-description" title={item.firstCardName}>
                                                    {item.firstCardName}
                                                    {item.firstCardStart && (
                                                        <div style={{ fontSize: '0.85em', opacity: 0.9, marginTop: '4px' }}>
                                                            Start: {new Date(item.firstCardStart).toLocaleString('en-AU', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

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

            {/* Footer Action Bar */}
            <div className="footer-action-bar" style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 20px',
                background: 'var(--bg-secondary)',
                borderTop: '1px solid var(--border-color, #ccc)',
                position: 'relative',
                zIndex: 100
            }}>

                <span className="countdown" style={{ fontSize: '0.9em', color: 'var(--text-secondary)' }}>
                    Next refresh in {countdown}s
                </span>

                <div style={{ display: 'flex', gap: '15px' }}>
                    <button className="refresh-button" onClick={() => fetchListCounts(true)}>Refresh Tiles</button>

                    {settings?.enableTaskView && (
                        <div style={{ position: 'relative' }}>
                            <div style={{ display: 'flex' }}>
                                <button className="settings-button" onClick={onShowTasks}>
                                    Tasks View
                                </button>
                                <button className="settings-button dropdown-arrow" style={{ marginLeft: '-2px', padding: '0 5px' }} onClick={() => setShowTaskDropdown(!showTaskDropdown)}>
                                    ▼
                                </button>
                            </div>
                            {showTaskDropdown && (
                                <div className="context-menu" style={{ position: 'absolute', bottom: '100%', left: 0, background: 'var(--bg-primary)', border: '1px solid #ccc', borderRadius: '4px', padding: '5px', minWidth: '150px' }}>
                                    <div className="menu-item" onClick={() => { window.open('/tasks', '_blank'); setShowTaskDropdown(false); }}>Open in New Tab</div>
                                </div>
                            )}
                        </div>
                    )}

                    {enableMapView && (
                        <div style={{ position: 'relative' }}>
                            <div style={{ display: 'flex' }}>
                                <button className="settings-button" onClick={onShowMap || (() => window.open('/map', '_blank'))}>
                                    Map View
                                </button>
                                <button className="settings-button dropdown-arrow" style={{ marginLeft: '-2px', padding: '0 5px' }} onClick={() => setShowMapDropdown(!showMapDropdown)}>
                                    ▼
                                </button>
                            </div>
                            {showMapDropdown && (
                                <div className="context-menu" style={{ position: 'absolute', bottom: '100%', left: 0, background: 'var(--bg-primary)', border: '1px solid #ccc', borderRadius: '4px', padding: '5px', minWidth: '150px' }}>
                                    <div className="menu-item" onClick={() => { window.open('/map', '_blank'); setShowMapDropdown(false); }}>Open in New Tab</div>
                                </div>
                            )}
                        </div>
                    )}

                    <button className="settings-button" onClick={onShowSettings}>Settings</button>
                    <button className="logout-button" onClick={onLogout}>Log Out</button>
                </div>
            </div>

            {/* Click Outside to Close Dropdowns */}
            {(showTaskDropdown || showMapDropdown) && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={() => { setShowTaskDropdown(false); setShowMapDropdown(false); }} />
            )}
        </div>
    );
};

export default Dashboard;
