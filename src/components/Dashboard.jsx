import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { trelloFetch } from '../api/trello';
import { STORAGE_KEYS, DEFAULT_LAYOUT, TIME_FILTERS } from '../utils/constants';
import {
    getPersistentColors, getPersistentLayout, setPersistentLayout
} from '../utils/persistence';
import {
    convertIntervalToSeconds, getOrGenerateRandomColor, formatDynamicCountdown
} from '../utils/helpers';
import { useDarkMode } from '../context/DarkModeContext';
import DigitalClock from './common/DigitalClock';
import CardDetailsModal from './common/CardDetailsModal';
import LabelFilter from './common/LabelFilter';
// import { formatCountdown } from '../utils/timeUtils'; // Removed as unused/replaced
import '../styles/map.css';

const Dashboard = ({ user, settings, onShowSettings, onLogout, onShowTasks, onShowMap, onGoToStats }) => {
    // DATA STATE
    const [allCards, setAllCards] = useState([]);
    const [allListsMap, setAllListsMap] = useState(new Map());
    const [boardLabels, setBoardLabels] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [countdown, setCountdown] = useState(30);

    // FILTER STATE
    const [timeFilter, setTimeFilter] = useState('all');
    const [selectedLabelIds, setSelectedLabelIds] = useState(null); // null = All

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

    const [modalList, setModalList] = useState(null);

    const boardId = settings?.boardId;
    const boardName = settings?.boardName;
    const listsFromSettings = settings?.selectedLists || [];

    const sectionsLayout = boardId ? getPersistentLayout(user.id, boardId) : DEFAULT_LAYOUT;
    const persistentColors = getPersistentColors(user.id);
    const blocksMap = new Map(sectionsLayout.map(s => [s.id, s]));

    const handleToggleCollapse = (blockId) => {
        const newLayout = sectionsLayout.map(s =>
            s.id === blockId ? { ...s, isCollapsed: !s.isCollapsed } : s
        );
        setPersistentLayout(user.id, boardId, newLayout);
    };

    const effectiveSeconds = useMemo(() => {
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
    const ignoreNoDescCards = localStorage.getItem('IGNORE_NO_DESC_CARDS_' + boardId) === 'true';

    // FETCH DATA
    const isFetchingRef = useRef(false);

    const fetchData = useCallback(async (manual = false) => {
        if (manual || loading) setLoading(true);
        if (isFetchingRef.current) return;
        isFetchingRef.current = true;
        setError('');

        try {
            if (!boardId) throw new Error("No Board ID configured");

            // Fetch Lists, Labels, Cards in parallel
            const [listsData, labelsData, cardsData] = await Promise.all([
                trelloFetch(`/boards/${boardId}/lists?cards=none&fields=id,name,color`, user.token),
                trelloFetch(`/boards/${boardId}/labels`, user.token),
                trelloFetch(`/boards/${boardId}/cards?fields=id,idList,pos,name,desc,isTemplate,dateLastActivity,dueComplete,labels`, user.token)
            ]);

            const listsMap = new Map();
            listsData.forEach(l => listsMap.set(l.id, l));
            setAllListsMap(listsMap);
            setBoardLabels(labelsData);
            setAllCards(cardsData); // Store RAW cards

        } catch (e) {
            console.error("Dashboard fetch error:", e);
            if (e.message && e.message.includes('429')) {
                setError("Trello API Limit Exceeded. Refresh paused.");
            } else {
                setError(e.message);
            }
        } finally {
            isFetchingRef.current = false;
            setLoading(false);
        }
    }, [boardId, user.token, loading]);

    // AUTO REFRESH
    useEffect(() => {
        if (timerRef.current) clearInterval(timerRef.current);
        const interval = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    fetchData();
                    return effectiveSeconds;
                }
                return prev - 1;
            });
        }, 1000);
        timerRef.current = interval;
        setCountdown(effectiveSeconds);
        fetchData(); // Initial Fetch
        return () => clearInterval(interval);
    }, [fetchData, effectiveSeconds]);


    // CALCULATE COUNTS (Client-side Filtering)
    const counts = useMemo(() => {
        const countsMap = new Map();
        if (allCards.length === 0) return countsMap;

        // 1. Group cards by list
        const cardsByList = new Map();
        allCards.forEach(c => {
            if (!cardsByList.has(c.idList)) cardsByList.set(c.idList, []);
            cardsByList.get(c.idList).push(c);
        });

        // 2. Determine Time Filter Dates
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

        // 3. Process each list in layout
        const persistentColorsCopy = getPersistentColors(user.id);
        const usedColors = new Set(Object.values(persistentColorsCopy).flatMap(b => Object.values(b)));
        const uniqueListIds = new Set(sectionsLayout.flatMap(s => s.listIds));

        uniqueListIds.forEach(listId => {
            if (!allListsMap.has(listId)) return; // Skip phantom lists (deleted from Trello)

            const listCards = (cardsByList.get(listId) || []).sort((a, b) => a.pos - b.pos);
            const block = sectionsLayout.find(s => s.listIds.includes(listId));
            const isIgnored = block?.ignoreFirstCard;
            const displayDescription = block?.displayFirstCardDescription;

            let titleCard = null;
            let countableCards = listCards;

            if (isIgnored && listCards.length > 0) {
                titleCard = listCards[0]; // First card by pos
                countableCards = listCards.slice(1);
            }

            // FILTER COUNTABLE CARDS
            const filteredCount = countableCards.filter(c => {
                // Settings Filters
                if (ignoreTemplateCards && c.isTemplate) return false;
                if (ignoreCompletedCards && c.dueComplete) return false;
                if (ignoreNoDescCards && (!c.desc || !c.desc.trim())) return false;

                // Time Filter
                if (sinceDate || beforeDate) {
                    const cardDate = new Date(c.dateLastActivity);
                    if (sinceDate && cardDate < sinceDate) return false;
                    if (beforeDate && cardDate >= beforeDate) return false;
                }

                // Label Filter (Multi-select)
                // If selectedLabelIds is NULL, it means ALL -> return true.
                if (selectedLabelIds !== null && selectedLabelIds.size > 0) {
                    if (!c.labels || c.labels.length === 0) return false; // Card has no labels -> filtered out if specific labels selected?
                    // If I select "Red", and card has "Blue", fail.
                    // If I select "Red", and card has no labels, fail.
                    const hasMatch = c.labels.some(l => selectedLabelIds.has(l.id));
                    if (!hasMatch) return false;
                } else if (selectedLabelIds !== null && selectedLabelIds.size === 0) {
                    // Logic for "Select None" -> Show Nothing?
                    return false;
                }
                // If null (All), proceed.

                return true;
            }).length;

            let descriptionCardName = '';
            if (isIgnored && titleCard && displayDescription) {
                descriptionCardName = titleCard.name;
            }

            const listData = allListsMap.get(listId);
            let color = persistentColors[boardId]?.[listId] || listData?.color;
            if (!color || color === '#cccccc') {
                color = getOrGenerateRandomColor(listId, usedColors);
            }

            countsMap.set(listId, {
                listId: listId,
                count: filteredCount,
                name: listData?.name || 'Unknown List',
                displayColor: color,
                firstCardName: descriptionCardName
            });
        });

        return countsMap;

    }, [allCards, timeFilter, selectedLabelIds, allListsMap, sectionsLayout, user.id, boardId, ignoreTemplateCards, ignoreCompletedCards, ignoreNoDescCards]);


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

    if (loading && allCards.length === 0) return <div className="container" style={{ textAlign: 'center', marginTop: '50px' }}>Loading dashboard data...</div>;

    if (!boardName || listsFromSettings.length === 0) {
        return (
            <div className="container">
                <div className="header">
                    <h1>Trellops Dashboard</h1>
                    <button className="logout-button" onClick={onLogout}>Logout</button>
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
        <div className="map-container">
            {/* HEADER - Updated to match MapView style EXACTLY */}
            <div className="map-header">
                <div className="map-header-title-area">
                    {showClock && <DigitalClock boardId={boardId} />}
                    <h1 style={{ marginLeft: showClock ? '15px' : '0' }}>
                        {boardName} <span style={{ marginLeft: '15px' }}>{filterLabel}</span>
                    </h1>
                </div>

                <div className="map-header-actions" style={{ display: 'flex', alignItems: 'center' }}>

                    {/* Label Filter - Moved BEFORE Time Filter */}
                    <LabelFilter
                        labels={boardLabels}
                        selectedLabelIds={selectedLabelIds}
                        onChange={setSelectedLabelIds}
                    />

                    {/* Time Filter */}
                    <select className="time-filter-select" value={timeFilter} onChange={e => setTimeFilter(e.target.value)} style={{ marginLeft: '10px' }}>
                        {Object.keys(TIME_FILTERS).map(key => (
                            <option key={key} value={key}>{TIME_FILTERS[key].label}</option>
                        ))}
                    </select>

                    {settings?.statistics?.enabled && (
                        <button className="button-secondary" onClick={onGoToStats || (() => window.open('/stats', '_self'))} style={{ marginLeft: '10px', height: '34px', padding: '0 15px', display: 'flex', alignItems: 'center' }}>
                            Stats
                        </button>
                    )}

                    <button className="theme-toggle-button" onClick={() => toggleTheme()} style={{ marginLeft: '10px' }}>
                        {theme === 'dark' ? '☀️' : '🌙'}
                    </button>
                </div>
            </div>

            {/* RENDER BLOCKS */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', paddingBottom: '80px', position: 'relative', zIndex: 1 }}>
                {sectionsLayout.map(block => {
                    const blockTiles = block.listIds
                        .map(listId => {
                            const tileData = counts.get(listId);
                            // If list is not found in counts (e.g. no cards or fetch error), we should still show it if possible?
                            // Logic mimics old behavior: if !tileData, check allListsMap
                            if (!tileData) {
                                const list = allListsMap.get(listId);
                                if (list) {
                                    const persistentColorsCopy = getPersistentColors(user.id);
                                    const usedColors = new Set(Object.values(persistentColorsCopy).flatMap(b => Object.values(b)));
                                    let color = persistentColors[boardId]?.[listId] || list.color;
                                    if (!color || color === '#cccccc') {
                                        color = getOrGenerateRandomColor(listId, usedColors);
                                    }
                                    // Count is 0 if not calculated yet or empty? "..." implies loading? 
                                    // If loading=false but tileData missing, it implies 0 cards?
                                    // counts map initialization handles empty lists?
                                    // No, the loop only iterates uniqueListIds defined in layout.
                                    // But data.cards might be empty.
                                    // In useMemo, we iterate all uniqueListIds. So titleData SHOULD exist unless listsFromSettings changed.
                                    // We'll trust tileData usually exists.
                                    return { listId: list.id, name: list.name, count: '...', displayColor: color, firstCardName: '' };
                                }
                                return undefined;
                            }
                            return tileData;
                        })
                        .filter(item => item !== undefined);

                    const isCollapsed = blocksMap.get(block.id)?.isCollapsed || false;

                    // If filters reduce count to 0, do we hide?
                    // "Only show the count ...".
                    // Existing logic: "if (blockTiles.length === 0) return null".
                    // blockTiles length refers to LISTS in the block, not cards.
                    // So tile remains visible even if count is 0. This is desired.
                    if (blockTiles.length === 0 && !isCollapsed) return null;

                    return (
                        <div key={block.id} className="dashboard-block">
                            <div className="block-header-row">
                                <div className="block-header">{block.name}</div>
                                <button className="collapse-toggle" onClick={() => handleToggleCollapse(block.id)} title={isCollapsed ? 'Show Tiles' : 'Hide Tiles'}>
                                    {isCollapsed ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.02 18.02 0 0 1 5.06-5.06"></path><path d="M4.22 4.22L12 12m5.07-5.07A10.07 10.07 0 0 1 23 12s-4 8-11 8c-1.85 0-3.61-.5-5.17-1.42"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                                    ) : (
                                        <svg className="icon-eye" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
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
                                                <div className="card-description" title={item.firstCardName}>{item.firstCardName}</div>
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
                    ignoreNoDescCards={ignoreNoDescCards}
                />
            )}

            {/* Footer Action Bar - Using MapView strict classes */}
            <div className="map-footer">
                <div className="map-footer-left">
                    {/* Empty Left Side */}
                </div>

                <div className="map-footer-right" style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    <button className="button-secondary" onClick={() => { setCountdown(effectiveSeconds); fetchData(true); }}>
                        Refresh {formatDynamicCountdown(countdown)}
                    </button>

                    {enableMapView && (
                        <div style={{ position: 'relative' }}>
                            <div style={{ display: 'flex' }}>
                                <button className="button-secondary" onClick={onShowMap || (() => window.open('/map', '_blank'))}>
                                    Map View
                                </button>
                                <button className="button-secondary dropdown-arrow" style={{ marginLeft: '-1px', borderLeft: 'none', padding: '0 5px' }} onClick={() => setShowMapDropdown(!showMapDropdown)}>
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

                    {settings?.enableTaskView && (
                        <div style={{ position: 'relative' }}>
                            <div style={{ display: 'flex' }}>
                                <button className="button-secondary" onClick={onShowTasks || (() => window.open('/tasks', '_blank'))}>
                                    Tasks View
                                </button>
                                <button className="button-secondary dropdown-arrow" style={{ marginLeft: '-1px', borderLeft: 'none', padding: '0 5px' }} onClick={() => setShowTaskDropdown(!showTaskDropdown)}>
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



                    <button className="button-secondary" onClick={onShowSettings}>Settings</button>
                    <button className="button-secondary" onClick={onLogout}>Log Out</button>
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
