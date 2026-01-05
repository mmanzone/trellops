import React, { useState, useEffect } from 'react';
import { trelloFetch, trelloAuth } from '../api/trello';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import MoreOptionsModal from './common/MoreOptionsModal';
import IconPicker from './common/IconPicker';
import ColorPicker from './common/ColorPicker';
import { STORAGE_KEYS } from '../utils/constants';
import { setPersistentColors, getPersistentColors, setPersistentLayout } from '../utils/persistence';
import '../styles/settings.css';

const ShareConfigModal = ({ config, onClose, boardName }) => {
    const [copied, setCopied] = useState(false);
    // Encode config to Base64 to be URL safe (UTF-8 safe)
    const configString = JSON.stringify(config);
    const encoded = btoa(unescape(encodeURIComponent(configString)));
    const shareUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}?config=${encodeURIComponent(encoded)}`;

    const handleCopy = () => {
        navigator.clipboard.writeText(shareUrl).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '600px' }}>
                <h3>Share Configuration</h3>
                <p>Copy the link below to share this configuration with others:</p>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                    <input
                        type="text"
                        readOnly
                        value={shareUrl}
                        style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                        onClick={(e) => e.target.select()}
                    />
                    <button onClick={handleCopy} className="action-button">
                        {copied ? 'Copied!' : 'Copy'}
                    </button>
                </div>
                <div style={{
                    marginTop: '15px',
                    padding: '10px',
                    background: '#fff3cd',
                    border: '1px solid #ffeeba',
                    borderRadius: '4px',
                    color: '#856404',
                    fontSize: '0.9em'
                }}>
                    <strong>Note:</strong> The recipient of this link must have a Trello account and access to the board <strong>{boardName || 'specified'}</strong> to be able to display it. Features requiring extended write permissions will have to be granted by the recipients of this link.
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
                    <button className="button-secondary" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
};

const SettingsScreen = ({ user, initialTab = 'dashboard', onClose, onSave, onLogout, importedConfig = null, onClearImportConfig = () => { } }) => {
    // --- State ---
    const [boards, setBoards] = useState([]);
    const [selectedBoardId, setSelectedBoardId] = useState('');
    const [allLists, setAllLists] = useState([]); // All fetched lists
    const [boardLabels, setBoardLabels] = useState([]);

    // Configuration State
    const [blocks, setBlocks] = useState([]); // { id, name, listIds, includeOnMap, mapIcon, ... }
    const [listColors, setListColors] = useState({}); // { listId: hexColor }

    // Other Settings
    const [refreshValue, setRefreshValue] = useState(1);
    const [refreshUnit, setRefreshUnit] = useState('minutes');
    const [showClock, setShowClock] = useState(true);
    const [ignoreTemplateCards, setIgnoreTemplateCards] = useState(true);
    const [ignoreCompletedCards, setIgnoreCompletedCards] = useState(false);

    // Map View
    const [enableMapView, setEnableMapView] = useState(false);
    const [mapGeocodeMode, setMapGeocodeMode] = useState('store');
    const [updateTrelloCoordinates, setUpdateTrelloCoordinates] = useState(false);
    const [enableCardMove, setEnableCardMove] = useState(false); // NEW
    const [markerRules, setMarkerRules] = useState([]);
    const [hasWritePermission, setHasWritePermission] = useState(false);

    const [error, setError] = useState('');
    const [showMoreOptions, setShowMoreOptions] = useState(false);
    const [loadingLists, setLoadingLists] = useState(false);
    const [activeTab, setActiveTab] = useState(initialTab);

    const [showShareModal, setShowShareModal] = useState(false);
    const [pendingImport, setPendingImport] = useState(null);
    const [showResetSection, setShowResetSection] = useState(false); // Collapsible Danger Zone toggle

    // Initial check on mount
    useEffect(() => {
        if (importedConfig) {
            // Show banner instead of popup
            setPendingImport(importedConfig);
        } else if (user?.token) {
            trelloAuth.checkTokenScopes(user.token).then(scopes => {
                const canWrite = scopes.includes('write');
                setHasWritePermission(canWrite);
                if (!canWrite) {
                    setUpdateTrelloCoordinates(false);
                    setEnableCardMove(false);
                }
            });
        }
    }, [user, importedConfig]);

    const applyImportedConfig = () => {
        if (!pendingImport) return;
        const config = pendingImport;

        // 1. Pre-populate board selection
        if (config.boardId) {
            // Even if we don't 'find' the board in accessible boards (user might need login or permissions),
            // we set the ID so 'SettingsScreen' attempts to show it or fetch it.
            // This satisfies "pre-populate... including board name".
            // The Board Name is visually handled by 'selectedBoard.name'. 
            // If the board isn't in 'boards', selectedBoard is undefined, so we won't see the name in the header immediately unless we mock it or fetch succeeds.

            const existingBoard = boards.find(b => b.id === config.boardId);
            if (!existingBoard && config.boardName) {
                // Optional: Inject a placeholder if disjoint? 
                // For now, standard logic: set ID, fetch data.
            }
            setSelectedBoardId(config.boardId);
            fetchBoardData(config.boardId);
        }

        // 2. Apply Settings
        if (config.blocks) setBlocks(config.blocks);
        if (config.listColors) setListColors(config.listColors);
        if (config.markerRules) setMarkerRules(config.markerRules);
        if (config.refreshValue) setRefreshValue(config.refreshValue);
        if (config.refreshUnit) setRefreshUnit(config.refreshUnit);
        if (config.showClock !== undefined) setShowClock(config.showClock);
        if (config.ignoreTemplateCards !== undefined) setIgnoreTemplateCards(config.ignoreTemplateCards);
        if (config.ignoreCompletedCards !== undefined) setIgnoreCompletedCards(config.ignoreCompletedCards);
        if (config.enableMapView !== undefined) setEnableMapView(config.enableMapView);
        if (config.mapGeocodeMode) setMapGeocodeMode(config.mapGeocodeMode);
        if (config.enableCardMove !== undefined) setEnableCardMove(config.enableCardMove);
        if (config.updateTrelloCoordinates !== undefined) setUpdateTrelloCoordinates(config.updateTrelloCoordinates);

        // Clear pending state
        setPendingImport(null);
        onClearImportConfig();
    };

    const dismissImport = () => {
        setPendingImport(null);
        onClearImportConfig();
    }

    useEffect(() => {
        setActiveTab(initialTab);
        if (initialTab === 'map' && user?.token) {
            checkPermissions();
        }
    }, [initialTab, user]);

    const checkPermissions = async () => {
        if (!user?.token) return;
        const scopes = await trelloAuth.checkTokenScopes(user.token);
        const canWrite = scopes.includes('write');
        setHasWritePermission(canWrite);
        console.log("Token scopes:", scopes, "Can write:", canWrite);

        // If user doesn't have write permission, uncheck the update toggle
        if (!canWrite) {
            setUpdateTrelloCoordinates(false);
            setEnableCardMove(false);
        }
    };

    // Helper: Load Settings for a Specific Board
    const loadBoardSettings = async (boardId) => {
        if (!boardId || !user) return;
        setLoadingLists(true);
        setError('');

        try {
            // 1. Fetch Board Data
            await fetchBoardData(boardId);

            // 2. Load Layout
            const allUserData = JSON.parse(localStorage.getItem('trelloUserData') || '{}');
            const savedLayout = allUserData[user.id]?.dashboardLayout?.[boardId];

            if (savedLayout) {
                setBlocks(savedLayout);
            } else {
                const legacyKey = `TRELLO_DASHBOARD_LAYOUT_${boardId}`;
                const legacyLayout = localStorage.getItem(legacyKey);
                if (legacyLayout) setBlocks(JSON.parse(legacyLayout));
                else setBlocks([]); // Clear if nothing found
            }

            // 3. Load Colors
            const savedColors = getPersistentColors(user.id)?.[boardId] || {};
            setListColors(savedColors);

            // 4. Load Other Settings
            const savedRefresh = localStorage.getItem(STORAGE_KEYS.REFRESH_INTERVAL + boardId);
            if (savedRefresh) {
                const parsed = JSON.parse(savedRefresh);
                setRefreshValue(parsed.value);
                setRefreshUnit(parsed.unit);
            } else {
                setRefreshValue(1);
                setRefreshUnit('minutes');
            }

            const savedClock = localStorage.getItem(STORAGE_KEYS.CLOCK_SETTING + boardId);
            setShowClock(savedClock !== 'false');

            const savedIgnore = localStorage.getItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + boardId);
            setIgnoreTemplateCards(savedIgnore !== 'false'); // Default true

            const savedIgnoreCompleted = localStorage.getItem(STORAGE_KEYS.IGNORE_COMPLETED_CARDS + boardId);
            setIgnoreCompletedCards(savedIgnoreCompleted === 'true'); // Default false

            // 5. Load Map Config
            const rulesKey = `TRELLO_MARKER_RULES_${boardId}`;
            const savedRules = localStorage.getItem(rulesKey);
            if (savedRules) setMarkerRules(JSON.parse(savedRules));
            else setMarkerRules([]);

            const userSettings = allUserData[user.id]?.settings;
            if (userSettings) {
                // Global-ish settings that might be per-board in future or just last-used
                // For now, these are somewhat global but applied on load. 
                // If we want per-board map enable, we'd need to change schema or key.
                // The request implies "previously saved settings for Board A would come back".
                // The current persistence saves 'enableMapView' in 'trelloUserData[uid].settings', effectively global/last-used.
                // To strictly follow "per board settings", we rely on what IS saved per board.
                // Most map settings ARE per board in local storage keys below.
            }

            // Map Persistent Keys
            const savedUpdateTrello = localStorage.getItem('updateTrelloCoordinates_' + boardId);
            setUpdateTrelloCoordinates(savedUpdateTrello === 'true');

            const savedEnableCardMove = localStorage.getItem('enableCardMove_' + boardId);
            setEnableCardMove(savedEnableCardMove === 'true');

        } catch (e) {
            console.warn("Error loading board settings", e);
            setError("Failed to load settings for this board.");
        } finally {
            setLoadingLists(false);
        }
    };

    // Initial Load
    useEffect(() => {
        const loadInitialSettings = async () => {
            if (!user) return;
            try {
                // 1. Fetch Boards
                const boardsData = await trelloFetch('/members/me/boards?fields=id,name,url', user.token);
                setBoards(boardsData);

                const storedData = JSON.parse(localStorage.getItem('trelloUserData') || '{}');
                const userSettings = storedData[user.id]?.settings;

                if (userSettings?.boardId) {
                    const bId = userSettings.boardId;
                    setSelectedBoardId(bId);

                    // Use helper to load everything
                    await loadBoardSettings(bId);

                    // Global map enables (legacy fallback or global pref)
                    if (userSettings.enableMapView !== undefined) setEnableMapView(userSettings.enableMapView);
                    if (userSettings.mapGeocodeMode) setMapGeocodeMode(userSettings.mapGeocodeMode);
                }
            } catch (e) {
                console.warn("Error loading settings", e);
            }
        };
        loadInitialSettings();
    }, [user]);

    const fetchBoardData = async (boardId) => {
        setLoadingLists(true);
        setError('');
        try {
            // Fetch lists with 1 card limit to support "first card" preview
            const listsData = await trelloFetch(`/boards/${boardId}/lists?cards=open&card_fields=name&card_limit=1&fields=id,name`, user.token);
            setAllLists(listsData);
            const labelsData = await trelloFetch(`/boards/${boardId}/labels`, user.token);
            setBoardLabels(labelsData);
        } catch (e) {
            setError('Failed to load board lists.');
        } finally {
            setLoadingLists(false);
        }
    };

    const handleBoardChange = async (e) => {
        const boardId = e.target.value;
        setSelectedBoardId(boardId);

        if (boardId) {
            await loadBoardSettings(boardId);
        } else {
            setBlocks([]);
            setListColors({});
            setMarkerRules([]);
            setAllLists([]);
        }
    };

    // --- Actions ---

    const handleAddBlock = () => {
        setBlocks([...blocks, {
            id: `block-${Date.now()}`,
            name: 'New Block',
            listIds: [],
            includeOnMap: false,
            mapIcon: 'map-marker',
            ignoreFirstCard: false,
            displayFirstCardDescription: false
        }]);
    };

    const handleRemoveBlock = (blockId) => {
        if (window.confirm("Delete this block? Assigned lists will be unassigned.")) {
            setBlocks(blocks.filter(b => b.id !== blockId));
        }
    };

    const handleUpdateBlockName = (id, name) => {
        setBlocks(blocks.map(b => b.id === id ? { ...b, name } : b));
    };

    const handleUpdateBlockProp = (id, prop, val) => {
        setBlocks(blocks.map(b => b.id === id ? { ...b, [prop]: val } : b));
    };

    // Drag and Drop Logic
    const onDragEnd = (result) => {
        const { source, destination, draggableId, type } = result;
        if (!destination) return;

        // RULE REORDERING
        if (type === 'RULE') {
            const newRules = Array.from(markerRules);
            const [movedRule] = newRules.splice(source.index, 1);
            newRules.splice(destination.index, 0, movedRule);
            setMarkerRules(newRules);
            return;
        }

        // BLOCK REORDERING
        if (type === 'BLOCK') {
            const newBlocks = Array.from(blocks);
            const [movedBlock] = newBlocks.splice(source.index, 1);
            newBlocks.splice(destination.index, 0, movedBlock);
            setBlocks(newBlocks);
            return;
        }

        // LIST ASSIGNMENT
        const listId = draggableId;
        const sourceId = source.droppableId;
        const destId = destination.droppableId;

        const removeListFromBlock = (blockId, lId) => {
            const block = blocks.find(b => b.id === blockId);
            const newListIds = block.listIds.filter(id => id !== lId);
            return { ...block, listIds: newListIds };
        };

        const addListToBlock = (blockId, lId, index) => {
            const block = blocks.find(b => b.id === blockId);
            const newListIds = Array.from(block.listIds);
            newListIds.splice(index, 0, lId);
            return { ...block, listIds: newListIds };
        };

        // Case 1: Reordering within same block
        if (sourceId === destId && sourceId !== 'unassigned') {
            const block = blocks.find(b => b.id === sourceId);
            const newListIds = Array.from(block.listIds);
            newListIds.splice(source.index, 1);
            newListIds.splice(destination.index, 0, listId);
            setBlocks(blocks.map(b => b.id === sourceId ? { ...b, listIds: newListIds } : b));
            return;
        }

        let newBlocks = [...blocks];

        // Case 2: Moving from Block A to Block B (or Unassigned)
        if (sourceId !== 'unassigned') {
            newBlocks = newBlocks.map(b => b.id === sourceId ? removeListFromBlock(sourceId, listId) : b);
        }

        // Case 3: Moving to Block B
        if (destId !== 'unassigned') {
            newBlocks = newBlocks.map(b => b.id === destId ? addListToBlock(destId, listId, destination.index) : b);
        }

        setBlocks(newBlocks);
    };

    // Rule Management
    const handleAddRule = () => setMarkerRules([...markerRules, { id: `rule-${Date.now()}`, labelId: '', overrideType: 'color', overrideValue: 'red' }]);
    const handleUpdateRule = (id, f, v) => setMarkerRules(markerRules.map(r => r.id === id ? { ...r, [f]: v } : r));
    const removeRule = (id) => setMarkerRules(markerRules.filter(r => r.id !== id));

    const handleSave = () => {
        if (!selectedBoardId) return alert("Select a board first.");

        // VALIDATION: Refresh Interval 
        if (refreshUnit === 'seconds' && parseInt(refreshValue) < 15) {
            setError("Refresh interval must be at least 15 seconds.");
            window.scrollTo(0, 0);
            return;
        }

        const selectedBoard = boards.find(b => b.id === selectedBoardId);

        try {
            // 1. Save Blocks Layout (Correct Persistence)
            setPersistentLayout(user.id, selectedBoardId, blocks);

            // 2. Save Colors
            setPersistentColors(user.id, selectedBoardId, listColors);

            // 3. Save Other Settings
            localStorage.setItem(STORAGE_KEYS.REFRESH_INTERVAL + selectedBoardId, JSON.stringify({ value: refreshValue, unit: refreshUnit }));
            localStorage.setItem(STORAGE_KEYS.CLOCK_SETTING + selectedBoardId, showClock ? 'true' : 'false');
            localStorage.setItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + selectedBoardId, ignoreTemplateCards ? 'true' : 'false');
            localStorage.setItem(STORAGE_KEYS.IGNORE_COMPLETED_CARDS + selectedBoardId, ignoreCompletedCards ? 'true' : 'false');

            // 4. Save Map Config
            localStorage.setItem(`TRELLO_MARKER_RULES_${selectedBoardId}`, JSON.stringify(markerRules.filter(r => r.labelId))); // Clean empty rules

            // Only allow saving true if permission exists
            const safeUpdateTrello = updateTrelloCoordinates && hasWritePermission;
            localStorage.setItem('updateTrelloCoordinates_' + selectedBoardId, safeUpdateTrello ? 'true' : 'false');

            const safeEnableCardMove = enableCardMove && hasWritePermission;
            localStorage.setItem('enableCardMove_' + selectedBoardId, safeEnableCardMove ? 'true' : 'false');

            // If enabling Trello updates, reset the cache to force decoding and updating
            if (safeUpdateTrello) {
                const cacheKey = `MAP_GEOCODING_CACHE_${selectedBoardId}`;
                if (localStorage.getItem(cacheKey)) {
                    localStorage.removeItem(cacheKey);
                    console.log("Cache cleared due to Trello Update enablement.");
                }
            }

            // 5. Update User Settings (CRITICAL: Populate selectedLists for Dashboard.jsx)
            // Flatten all lists assigned to blocks
            const assignedLists = blocks.flatMap(b => b.listIds.map(lId => allLists.find(l => l.id === lId))).filter(Boolean);

            const newSettings = {
                boardId: selectedBoardId,
                boardName: selectedBoard ? selectedBoard.name : 'Trello Board',
                selectedLists: assignedLists, // THIS FIXES THE "NO BOARD CONFIG" ERROR
                enableMapView,
                mapGeocodeMode,
                enableCardMove: enableCardMove && hasWritePermission
            };

            const storedData = JSON.parse(localStorage.getItem('trelloUserData') || '{}');
            storedData[user.id] = {
                ...storedData[user.id],
                settings: newSettings
            };
            localStorage.setItem('trelloUserData', JSON.stringify(storedData));

            // Call onSave with newSettings to update App.jsx state IMMEDIATELY
            onSave(newSettings);
        } catch (e) {
            console.error(e);
            setError("Failed to save settings.");
        }
    };

    const handleClearBoardConfig = () => {
        if (window.confirm("Clear all settings?")) {
            setBlocks([]);
            setListColors({});
            setMarkerRules([]);
        }
    };

    const getConfigObject = () => {
        if (!selectedBoardId) return null;
        // Try to find name in boards list
        const boardName = boards.find(b => b.id === selectedBoardId)?.name;

        return {
            boardId: selectedBoardId,
            boardName: boardName, // Include name
            blocks,
            listColors,
            markerRules,
            refreshValue,
            refreshUnit,
            showClock,
            ignoreTemplateCards,
            ignoreCompletedCards,
            enableMapView,
            mapGeocodeMode,
            enableCardMove
        };
    };

    const handleExportConfig = () => {
        const config = getConfigObject();
        if (!config) return;

        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trellops-config-${selectedBoardId}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleImportConfig = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const config = JSON.parse(evt.target.result);
                if (config.boardId && config.boardId !== selectedBoardId) {
                    if (!window.confirm(`This config is for board ${config.boardId}, but you are on ${selectedBoardId}. Import anyway?`)) return;

                    // Pre-populate board selection if available
                    // We need to set selectedBoardId to the one in config
                    // Ideally, we shoudl check if the user has access to this board in 'boards' list
                    const targetBoard = boards.find(b => b.id === config.boardId);
                    if (targetBoard) {
                        setSelectedBoardId(config.boardId);
                        // We might want to trigger a fetch here or let the effect handle it?
                        // Since we are setting state directly below, we might skip a fetch or need one for lists.
                        // Ideally: Set ID -> Fetch Data -> Apply Config.
                        // But applyConfig is synchronous here.
                        // Let's rely on handleBoardChange logic or manual fetch?
                        // Better: just set the ID. The effect 'loadBoardSettings' or 'fetchBoardData' might trigger if we added it to dependency array, but we didn't.
                        // Let's manually trigger fetch to ensure lists are loaded for the config to map correctly.
                        fetchBoardData(config.boardId);
                    } else {
                        // User might not have this board loaded or access to it.
                        console.warn("Imported config for unknown board:", config.boardId);
                        // Still set it? Or let user stay on current?
                        // Request says "pre-populate all fields including board name".
                        // Use config.boardId as selectedBoardId even if name unknown?
                        setSelectedBoardId(config.boardId);
                        // We can TRY to fetch it.
                        fetchBoardData(config.boardId);
                    }
                }

                if (config.blocks) setBlocks(config.blocks);
                if (config.listColors) setListColors(config.listColors);
                if (config.markerRules) setMarkerRules(config.markerRules);
                if (config.refreshValue) setRefreshValue(config.refreshValue);
                if (config.refreshUnit) setRefreshUnit(config.refreshUnit);
                if (config.showClock !== undefined) setShowClock(config.showClock);
                if (config.ignoreTemplateCards !== undefined) setIgnoreTemplateCards(config.ignoreTemplateCards);
                if (config.ignoreCompletedCards !== undefined) setIgnoreCompletedCards(config.ignoreCompletedCards);
                if (config.enableMapView !== undefined) setEnableMapView(config.enableMapView);
                if (config.mapGeocodeMode) setMapGeocodeMode(config.mapGeocodeMode);
                if (config.enableCardMove !== undefined) setEnableCardMove(config.enableCardMove);
                alert("Configuration imported! Click Save to persist changes.");
            } catch (err) {
                console.error(err);
                alert("Failed to parse configuration file.");
            }
        };
        reader.readAsText(file);
    };

    // Helper: Get Unassigned Lists
    const assignedListIds = new Set(blocks.flatMap(b => b.listIds));
    const unassignedLists = allLists.filter(l => !assignedListIds.has(l.id));

    const selectedBoard = boards.find(b => b.id === selectedBoardId);

    // Reuse Switch Component
    const ToggleSwitch = ({ checked, onChange }) => (
        <label className="switch">
            <input type="checkbox" checked={checked} onChange={onChange} />
            <span className="slider round"></span>
        </label>
    );

    return (
        <div className="settings-container" style={{ maxWidth: '80%', width: '80%' }}>
            <h2>Dashboard Settings</h2>

            {/* TABS HEADER */}
            <div className="settings-tabs">
                <button
                    className={`tab-button ${activeTab === 'dashboard' ? 'active' : ''}`}
                    onClick={() => setActiveTab('dashboard')}
                >
                    Dashboard View Settings
                </button>
                <button
                    className={`tab-button ${activeTab === 'map' ? 'active' : ''}`}
                    onClick={() => {
                        setActiveTab('map');
                        checkPermissions();
                    }}
                >
                    Map View Settings
                </button>
                <button
                    className={`tab-button ${activeTab === 'other' ? 'active' : ''}`}
                    onClick={() => setActiveTab('other')}
                >
                    Other Settings
                </button>
            </div>

            {error && <div className="error-banner" style={{ background: '#ffebee', color: '#c62828', padding: '10px', marginBottom: '15px', borderRadius: '4px', border: '1px solid #ffcdd2', marginTop: '10px' }}>{error}</div>}

            {pendingImport && (
                <div className="info-banner" style={{ background: '#e3f2fd', color: '#0d47a1', padding: '15px', marginBottom: '15px', borderRadius: '4px', border: '1px solid #90caf9', marginTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <strong>Configuration Loaded:</strong> Shared settings available for board <strong>{pendingImport.boardName || pendingImport.boardId}</strong>.
                        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>Unsaved changes will be lost if you apply this configuration.</div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button onClick={applyImportedConfig} style={{ background: '#1976d2', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Apply</button>
                        <button onClick={dismissImport} style={{ background: 'transparent', color: '#0d47a1', border: '1px solid #0d47a1', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>Dismiss</button>
                    </div>
                </div>
            )}



            <DragDropContext onDragEnd={onDragEnd}>
                {/* TAB CONTENT: DASHBOARD */}
                {activeTab === 'dashboard' && (
                    <div className="tab-content">

                        {/* SECTION 1: BOARD */}
                        <div className="admin-section">
                            <h3>1. Choose your Trello Board</h3>
                            <p style={{ fontSize: '0.9em', color: '#666', marginTop: '-10px' }}>
                                Boards are pulled directly from your Trello account, across all workspaces.
                            </p>
                            <select value={selectedBoardId} onChange={handleBoardChange} className="board-select">
                                <option value="">-- Choose a Board --</option>
                                {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                        </div>

                        {selectedBoard ? (
                            <>
                                {/* SECTION 2: BLOCKS */}
                                <div className="admin-section" id="section-2">
                                    <h3>2. Manage your Trellops blocks</h3>
                                    <p style={{ fontSize: '0.9em', color: '#666', marginTop: '-10px' }}>
                                        A block is a group of tiles representing each Trello list (or column). You will be able to assign one or multiple tiles to each block. Blocks can be shown or hidden on demand on the dashboard.
                                    </p>
                                    <Droppable droppableId="blocks-list" type="BLOCK">
                                        {(provided) => (
                                            <div ref={provided.innerRef} {...provided.droppableProps}>
                                                {blocks.map((block, index) => (
                                                    <Draggable key={block.id} draggableId={block.id} index={index}>
                                                        {(provided) => (
                                                            <div
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                                style={{ display: 'flex', gap: '10px', marginBottom: '8px', alignItems: 'center', background: '#fff', padding: '8px', border: '1px solid #eee', borderRadius: '4px', ...provided.draggableProps.style }}
                                                            >
                                                                <div {...provided.dragHandleProps} className="drag-handle" style={{ color: '#ccc', marginRight: '5px' }}>::</div>
                                                                <input
                                                                    type="text"
                                                                    value={block.name}
                                                                    onChange={(e) => handleUpdateBlockName(block.id, e.target.value)}
                                                                    className="block-name-input"
                                                                />
                                                                <button
                                                                    onClick={() => handleRemoveBlock(block.id)}
                                                                    style={{ color: 'red', marginLeft: 'auto', background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', fontWeight: 'bold' }}
                                                                    title="Remove Block"
                                                                >
                                                                    X
                                                                </button>
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                ))}
                                                {provided.placeholder}
                                            </div>
                                        )}
                                    </Droppable>
                                    <button className="add-block-button" onClick={handleAddBlock} style={{ marginTop: '10px' }}>+ Add Block</button>
                                </div>

                                {/* SECTION 3: ASSIGN TILES */}
                                <div className="admin-section" id="section-3">
                                    <h3>3. Assign tiles to your blocks</h3>
                                    <p style={{ fontSize: '0.9em', color: '#666', marginTop: '-10px' }}>
                                        Tiles show the total count of cards in each Trello list, automatically updating as the cards are created or moved. Choose from the Unassigned pool on the left, the lists you want to create as a tile in the respective block on the right. Then customise each tile position and colour.
                                    </p>

                                    <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', marginTop: '15px' }}>
                                        {/* UNASSIGNED */}
                                        <div style={{ flex: 1, background: '#f8f9fa', padding: '10px', borderRadius: '6px', border: '1px solid #dee2e6' }}>
                                            <h4>Available Lists</h4>
                                            <Droppable droppableId="unassigned" type="LIST">
                                                {(provided) => (
                                                    <div ref={provided.innerRef} {...provided.droppableProps} style={{ minHeight: '100px' }}>
                                                        {unassignedLists.map((list, index) => (
                                                            <Draggable key={list.id} draggableId={list.id} index={index}>
                                                                {(provided) => (
                                                                    <div
                                                                        ref={provided.innerRef}
                                                                        {...provided.draggableProps}
                                                                        {...provided.dragHandleProps}
                                                                        style={{ padding: '8px', margin: '4px 0', background: 'white', border: '1px solid #ddd', borderRadius: '4px', ...provided.draggableProps.style }}
                                                                    >
                                                                        {list.name}
                                                                    </div>
                                                                )}
                                                            </Draggable>
                                                        ))}
                                                        {provided.placeholder}
                                                    </div>
                                                )}
                                            </Droppable>
                                        </div>

                                        {/* BLOCKS TARGETS */}
                                        <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                            {blocks.map(block => (
                                                <div key={block.id} style={{ background: '#e7f5ff', padding: '10px', borderRadius: '6px', border: '1px solid #a5d8ff' }}>
                                                    <h4 style={{ margin: 0, marginBottom: '10px' }}>{block.name}</h4>

                                                    {/* Block Options Inside Section 3 */}
                                                    <div style={{ background: 'rgba(255,255,255,0.5)', padding: '8px', borderRadius: '4px', marginBottom: '10px', fontSize: '0.85em' }}>
                                                        <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                                                            <label style={{ display: 'flex', alignItems: 'center' }}>
                                                                <ToggleSwitch checked={block.ignoreFirstCard} onChange={e => handleUpdateBlockProp(block.id, 'ignoreFirstCard', e.target.checked)} />
                                                                <span style={{ marginLeft: '5px' }}>Do not count the first card in the total</span>
                                                            </label>
                                                            {block.ignoreFirstCard && (
                                                                <label style={{ display: 'flex', alignItems: 'center' }}>
                                                                    <ToggleSwitch checked={block.displayFirstCardDescription} onChange={e => handleUpdateBlockProp(block.id, 'displayFirstCardDescription', e.target.checked)} />
                                                                    <span style={{ marginLeft: '5px' }}>Display the first card as tile description</span>
                                                                </label>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <Droppable droppableId={block.id} type="LIST">
                                                        {(provided) => (
                                                            <div ref={provided.innerRef} {...provided.droppableProps} style={{ minHeight: '50px' }}>
                                                                {block.listIds.map((listId, index) => {
                                                                    const list = allLists.find(l => l.id === listId);
                                                                    if (!list) return null;
                                                                    const color = listColors[listId] || '#0079bf';
                                                                    return (
                                                                        <Draggable key={listId} draggableId={listId} index={index}>
                                                                            {(provided) => (
                                                                                <div
                                                                                    ref={provided.innerRef}
                                                                                    {...provided.draggableProps}
                                                                                    {...provided.dragHandleProps}
                                                                                    style={{ padding: '8px', margin: '4px 0', background: 'white', borderLeft: `5px solid ${color}`, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', ...provided.draggableProps.style }}
                                                                                >
                                                                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{list.name}</span>

                                                                                    {block.ignoreFirstCard && block.displayFirstCardDescription && list.cards && list.cards.length > 0 && (
                                                                                        <span style={{
                                                                                            width: '20%',
                                                                                            textAlign: 'right',
                                                                                            fontSize: '0.85em',
                                                                                            color: '#666',
                                                                                            fontStyle: 'italic',
                                                                                            overflow: 'hidden',
                                                                                            textOverflow: 'ellipsis',
                                                                                            whiteSpace: 'nowrap',
                                                                                            flexShrink: 0
                                                                                        }}>
                                                                                            [{list.cards[0].name}]
                                                                                        </span>
                                                                                    )}

                                                                                    <input
                                                                                        type="color"
                                                                                        value={color}
                                                                                        onChange={e => setListColors({ ...listColors, [listId]: e.target.value })}
                                                                                        style={{ width: '30px', height: '30px', padding: 0, border: 'none', background: 'none', cursor: 'pointer', flexShrink: 0 }}
                                                                                        title="Tile Colour"
                                                                                    />
                                                                                </div>
                                                                            )}
                                                                        </Draggable>
                                                                    );
                                                                })}
                                                                {provided.placeholder}
                                                            </div>
                                                        )}
                                                    </Droppable>


                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div style={{ marginTop: '20px', fontStyle: 'italic', color: '#666' }}>Select a board to configure blocks</div>
                        )}
                    </div>
                )}

                {/* TAB CONTENT: MAP */}
                {activeTab === 'map' && (
                    <div className="tab-content">
                        {selectedBoard ? (
                            <div className="admin-section" id="section-5">
                                <h3>Map View Settings for {selectedBoard.name}</h3>
                                <p style={{ fontSize: '0.9em', color: '#666', marginTop: '-10px', marginBottom: '15px' }}>
                                    Map settings are saved per-board. Choose whether Map View is enabled and how geocoding should behave for cards on this board.
                                </p>
                                <div className="settings-row">
                                    <ToggleSwitch checked={enableMapView} onChange={e => setEnableMapView(e.target.checked)} />
                                    <span style={{ marginLeft: '10px' }}>Enable Map View</span>
                                </div>

                                {enableMapView && (
                                    <div style={{ marginTop: '15px' }}>
                                        <div style={{ marginBottom: '15px', background: '#f8f9fa', padding: '10px', borderRadius: '4px', border: '1px solid #eee' }}>
                                            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Geocoding behavior:</label>

                                            {/* Option 1: Always Read (Visual Confirmation) */}
                                            <label style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '8px', opacity: 0.7 }}>
                                                <input type="checkbox" checked={true} disabled style={{ marginTop: '3px' }} />
                                                <span style={{ marginLeft: '8px' }}>
                                                    Read the coordinates from the Trello card to display the card location
                                                </span>
                                            </label>

                                            {/* Option 2: Enable Local Geocoding (Nominatim) */}
                                            <label style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '8px' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={mapGeocodeMode !== 'disabled'}
                                                    onChange={e => {
                                                        const newVal = e.target.checked ? 'store' : 'disabled';
                                                        setMapGeocodeMode(newVal);
                                                        // If disabled, also uncheck the child option
                                                        if (newVal === 'disabled') setUpdateTrelloCoordinates(false);
                                                    }}
                                                    style={{ marginTop: '3px' }}
                                                />
                                                <span style={{ marginLeft: '8px' }}>
                                                    If no coordinates are present in the card, parse the card description to decode the coordinates for the card. (experimental)<br />
                                                    <span style={{ fontSize: '0.85em', color: '#666', fontStyle: 'italic' }}>
                                                        Note: this will use Nominatim throttled API, and will store the coordinates locally on your browser cache
                                                    </span>
                                                </span>
                                            </label>

                                            {/* Option 3: Update Trello Cards (Nested with Upsell) */}
                                            <div style={{ marginLeft: '25px', marginBottom: '15px' }}>
                                                <label style={{
                                                    display: 'flex',
                                                    alignItems: 'flex-start',
                                                    opacity: mapGeocodeMode === 'disabled' ? 0.5 : 1,
                                                    pointerEvents: mapGeocodeMode === 'disabled' ? 'none' : 'auto'
                                                }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={updateTrelloCoordinates}
                                                        onChange={e => {
                                                            if (e.target.checked && !hasWritePermission) {
                                                                // Show visual cue or just let the banner appear (handled below)
                                                            }
                                                            setUpdateTrelloCoordinates(e.target.checked);
                                                        }}
                                                        disabled={mapGeocodeMode === 'disabled'}
                                                        style={{ marginTop: '3px' }}
                                                    />
                                                    <span style={{ marginLeft: '8px' }}>
                                                        Update the Trello card coordinates using the decoded address from Nominatim (beta).<br />
                                                        <span style={{ fontSize: '0.85em', color: '#666', fontStyle: 'italic' }}>
                                                            It is recommended to only have one dashboard enabled with this feature for each Trello board
                                                        </span>
                                                    </span>
                                                </label>

                                                {/* Permission Upsell Banner */}
                                                {updateTrelloCoordinates && !hasWritePermission && (
                                                    <div style={{ marginTop: '10px', padding: '10px', background: '#e3f2fd', border: '1px solid #90caf9', borderRadius: '4px', color: '#0d47a1', fontSize: '0.9em' }}>
                                                        <strong>Permission Required:</strong> To update card coordinates, you must grant Trello "Write" access.<br />
                                                        <span style={{ fontSize: '0.9em', marginTop: '5px', display: 'block' }}>The location cache on your computer will be reset for the cards to be decoded again.</span>
                                                        <button
                                                            onClick={() => trelloAuth.login('read,write')}
                                                            style={{ display: 'block', marginTop: '8px', padding: '5px 10px', background: '#1976d2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                                        >
                                                            Authorize Write Access (Re-Login)
                                                        </button>
                                                    </div>
                                                )}

                                                {/* Success Indicator */}
                                                {updateTrelloCoordinates && hasWritePermission && (
                                                    <div style={{ marginTop: '5px', color: 'green', fontSize: '0.9em', display: 'flex', alignItems: 'center' }}>
                                                        <span style={{ marginRight: '5px' }}>✅</span> Write permissions successfully granted.
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* DUPLICATED BLOCK LIST FOR MAP SETTINGS */}
                                        <h4>Block Map Options</h4>
                                        <p style={{ fontSize: '0.9em', color: '#666', marginTop: '-10px', marginBottom: '15px' }}>
                                            Choose which blocks appear on the map and customize their markers.
                                        </p>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '20px' }}>
                                            {blocks.map(block => (
                                                <div key={block.id} style={{ background: '#f8f9fa', padding: '10px', borderRadius: '6px', border: '1px solid #dee2e6' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <h4 style={{ margin: 0 }}>{block.name}</h4>
                                                        <label style={{ display: 'flex', alignItems: 'center' }}>
                                                            <ToggleSwitch checked={block.includeOnMap} onChange={e => handleUpdateBlockProp(block.id, 'includeOnMap', e.target.checked)} />
                                                            <span style={{ marginLeft: '5px' }}>Show on map</span>
                                                        </label>
                                                    </div>

                                                    {block.includeOnMap && (
                                                        <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(0,0,0,0.1)' }}>
                                                            <label style={{ fontSize: '0.85em', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Icon:</label>
                                                            <div style={{ width: '100%' }}>
                                                                <IconPicker selectedIcon={block.mapIcon} onChange={icon => handleUpdateBlockProp(block.id, 'mapIcon', icon)} />
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>

                                        <div className="admin-section" style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '15px' }}>
                                            <h3>Marker Variants</h3>
                                            <p style={{ fontSize: '0.9em', color: '#666', marginTop: '-10px', marginBottom: '15px' }}>
                                                Choose alternative display options for cards based on their Trello label value. You can choose to display a marker with a different colour or icon. In case of conflicts, the rule higher in the list will be applied.
                                            </p>

                                            <Droppable droppableId="marker-rules" type="RULE">
                                                {(provided) => (
                                                    <div ref={provided.innerRef} {...provided.droppableProps} className="rules-list">
                                                        {markerRules.map((rule, idx) => (
                                                            <Draggable key={rule.id} draggableId={rule.id} index={idx}>
                                                                {(provided) => (
                                                                    <div
                                                                        ref={provided.innerRef}
                                                                        {...provided.draggableProps}
                                                                        className="rule-item"
                                                                        style={{ display: 'flex', gap: '10px', alignItems: 'center', background: '#fff', padding: '10px', marginBottom: '5px', border: '1px solid #eee', flexWrap: 'wrap', ...provided.draggableProps.style }}
                                                                    >
                                                                        <div {...provided.dragHandleProps} className="drag-handle" style={{ color: '#ccc', marginRight: '5px' }}>::</div>
                                                                        <select value={rule.labelId} onChange={e => handleUpdateRule(rule.id, 'labelId', e.target.value)}>
                                                                            <option value="">-- Label --</option>
                                                                            {boardLabels.map(l => <option key={l.id} value={l.id}>{l.name || l.color}</option>)}
                                                                        </select>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                                            <label><input type="radio" checked={rule.overrideType === 'color'} onChange={() => handleUpdateRule(rule.id, 'overrideType', 'color')} /> Color</label>
                                                                            <label><input type="radio" checked={rule.overrideType === 'icon'} onChange={() => handleUpdateRule(rule.id, 'overrideType', 'icon')} /> Icon</label>
                                                                        </div>

                                                                        <div style={{ flex: 1, minWidth: '200px' }}>
                                                                            {rule.overrideType === 'color' ?
                                                                                <ColorPicker selectedColor={rule.overrideValue} onChange={v => handleUpdateRule(rule.id, 'overrideValue', v)} /> :
                                                                                <div style={{ width: '100%' }}>
                                                                                    <IconPicker selectedIcon={rule.overrideValue} onChange={v => handleUpdateRule(rule.id, 'overrideValue', v)} />
                                                                                </div>
                                                                            }
                                                                        </div>

                                                                        <button onClick={() => removeRule(rule.id)} style={{ color: 'red', marginLeft: 'auto' }}>X</button>
                                                                    </div>
                                                                )}
                                                            </Draggable>
                                                        ))}
                                                        {provided.placeholder}
                                                    </div>
                                                )}
                                            </Droppable>
                                            <button onClick={handleAddRule} style={{ marginTop: '10px' }}>+ Add Rule</button>
                                        </div>

                                        {/* MOVING CARDS SETTING */}
                                        <div className="admin-section" style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '15px' }}>
                                            <label style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '8px' }}>
                                                <ToggleSwitch
                                                    checked={enableCardMove}
                                                    onChange={e => {
                                                        if (e.target.checked && !hasWritePermission) {
                                                            // Logic handled by banner display
                                                        }
                                                        setEnableCardMove(e.target.checked);
                                                    }}
                                                />
                                                <span style={{ marginLeft: '10px' }}>
                                                    <strong>Enable card move from the map view</strong><br />
                                                    <span style={{ fontSize: '0.9em', color: '#666' }}>
                                                        Display a dropdown allowing to move a card to another list from the visible block directly from a marker on the map. This requires "write" access to your Trello board for Trellops to move the cards on your behalf
                                                    </span>
                                                </span>
                                            </label>

                                            {enableCardMove && !hasWritePermission && (
                                                <div style={{ marginTop: '10px', padding: '10px', background: '#e3f2fd', border: '1px solid #90caf9', borderRadius: '4px', color: '#0d47a1', fontSize: '0.9em' }}>
                                                    <strong>Permission Required:</strong> To move cards, you must grant Trello "Write" access.<br />
                                                    <button
                                                        onClick={() => trelloAuth.login('read,write')}
                                                        style={{ display: 'block', marginTop: '8px', padding: '5px 10px', background: '#1976d2', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                                    >
                                                        Authorize Write Access (Re-Login)
                                                    </button>
                                                </div>
                                            )}

                                            {enableCardMove && hasWritePermission && (
                                                <div style={{ marginTop: '5px', color: 'green', fontSize: '0.9em', display: 'flex', alignItems: 'center' }}>
                                                    <span style={{ marginRight: '5px' }}>✅</span> Write permissions successfully granted.
                                                </div>
                                            )}
                                        </div>

                                        {/* RESET CACHE SECTION */}
                                        <div className="admin-section" style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '15px' }}>
                                            <h3>Reset coordinates cache</h3>
                                            <p style={{ fontSize: '0.9em', color: '#666', marginTop: '-10px', marginBottom: '15px' }}>
                                                Use this button to remove all card coordinates on your local computer. This is to be used for troubleshooting purposes and will trigger a re-fetch using Nominatim
                                            </p>
                                            <button
                                                className="button-secondary"
                                                style={{ borderColor: '#d32f2f', color: '#d32f2f' }}
                                                onClick={() => {
                                                    if (window.confirm("Are you sure you want to clear the local geocoding cache? This will force addresses to be re-fetched from Nominatim.")) {
                                                        try {
                                                            const key = `MAP_GEOCODING_CACHE_${selectedBoard.id}`;
                                                            localStorage.removeItem(key);
                                                            alert('Cache cleared successfully.');
                                                        } catch (e) {
                                                            alert('Failed to clear cache');
                                                        }
                                                    }
                                                }}
                                            >
                                                Reset Location Cache
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div style={{ marginTop: '20px', fontStyle: 'italic', color: '#666' }}>Select a board to configure map settings</div>
                        )}
                    </div>
                )}

                {/* TAB CONTENT: OTHER */}
                {activeTab === 'other' && (
                    <div className="tab-content">
                        {selectedBoard ? (
                            <div className="admin-section" id="section-4">
                                <h3>Other Settings for {selectedBoard.name}</h3>
                                <p style={{ fontSize: '0.9em', color: '#666', marginTop: '-10px', marginBottom: '15px' }}>
                                    These settings are saved separately for each Trello board. Auto-refresh must be at least 15 seconds; recommended 30 seconds for live displays. The digital clock appears in the top-left corner of the screen and follows the local computer time format. Template Cards in Trello can be excluded from the count (recommended); completed cards can also be excluded.
                                </p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                    <div>
                                        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Refresh Interval</label>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <input type="number" min={refreshUnit === 'seconds' ? 15 : 1} value={refreshValue} onChange={e => setRefreshValue(e.target.value)} style={{ width: '60px', padding: '5px', borderRadius: '4px', border: '1px solid #ccc' }} />
                                            <select value={refreshUnit} onChange={e => setRefreshUnit(e.target.value)} style={{ padding: '5px', borderRadius: '4px', border: '1px solid #ccc' }}>
                                                <option value="seconds">Seconds</option>
                                                <option value="minutes">Minutes</option>
                                                <option value="hours">Hours</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Features</label>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            <label style={{ display: 'flex', alignItems: 'center' }}>
                                                <ToggleSwitch checked={showClock} onChange={e => setShowClock(e.target.checked)} />
                                                <span style={{ marginLeft: '10px' }}>Show Clock</span>
                                                {showClock && (
                                                    <span style={{ marginLeft: '15px', color: '#555', fontFamily: 'monospace', background: '#f0f0f0', padding: '2px 6px', borderRadius: '4px', border: '1px solid #ddd' }}>
                                                        {new Date().toLocaleTimeString()}
                                                    </span>
                                                )}
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center' }}>
                                                <ToggleSwitch checked={ignoreTemplateCards} onChange={e => setIgnoreTemplateCards(e.target.checked)} />
                                                <span style={{ marginLeft: '10px' }}>Ignore Template Cards</span>
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center' }}>
                                                <ToggleSwitch checked={ignoreCompletedCards} onChange={e => setIgnoreCompletedCards(e.target.checked)} />
                                                <span style={{ marginLeft: '10px' }}>Ignore Completed Cards</span>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div style={{ marginTop: '20px', fontStyle: 'italic', color: '#666' }}>Select a board to configure settings</div>
                        )}

                        <div className="danger-zone" style={{ marginTop: '40px', paddingTop: '10px' }}>
                            <style>{`
                                .danger-header:hover { background-color: #fff0f0; }
                             `}</style>
                            <div
                                className="danger-header"
                                onClick={() => setShowResetSection(!showResetSection)}
                                style={{
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '10px'
                                }}
                            >
                                <h4 style={{ color: 'black', margin: 0 }}>⚠️ Global settings reset</h4>
                                <span style={{ fontSize: '1.2em', color: '#d32f2f' }}>{showResetSection ? '▼' : '▶'}</span>
                            </div>

                            {showResetSection && (
                                <div style={{ backgroundColor: '#fff0f0', padding: '15px', borderRadius: '4px', border: '1px solid #ffcdcd', marginTop: '10px' }}>

                                    <p style={{ fontSize: '0.9em', color: '#8b0000', marginBottom: '10px' }}>
                                        Resetting your settings will remove any locally stored information including dashboard and map configuration for <strong>ALL boards</strong>, as well as decoded geolocations.
                                    </p>
                                    <p style={{ fontSize: '0.9em', color: '#8b0000', marginBottom: '15px' }}>
                                        Your Trello account will NOT be affected, nor will your Trellops subscriptions.
                                    </p>

                                    <div style={{ marginBottom: '15px' }}>
                                        <strong style={{ display: 'block', marginBottom: '5px', color: '#8b0000', fontSize: '0.85em' }}>
                                            The reset will erase all the information stored below; it is recommended that you back up each configuration first.
                                        </strong>
                                        <ul style={{ margin: '5px 0 10px 20px', fontSize: '0.85em', color: '#8b0000' }}>
                                            {(() => {
                                                const storedData = JSON.parse(localStorage.getItem('trelloUserData') || '{}');
                                                // Find all boards that have data in trelloUserData OR have specific keys
                                                // For simplicity, we scan trelloUserData.user.settings keys and dashboard keys
                                                const userData = storedData[user?.id] || {};
                                                const boardsWithLayout = Object.keys(userData.dashboardLayout || {});
                                                const boardsWithColors = Object.keys(userData.listColors || {});

                                                const allCachedBoardIds = new Set([...boardsWithLayout, ...boardsWithColors]);

                                                if (allCachedBoardIds.size === 0) return <li>No cached configurations found.</li>;

                                                return Array.from(allCachedBoardIds).map(bid => {
                                                    const bName = boards.find(b => b.id === bid)?.name || bid;
                                                    return <li key={bid}>{bName} <span style={{ color: '#b71c1c', fontSize: '0.8em' }}>({bid})</span></li>;
                                                });
                                            })()}
                                        </ul>
                                    </div>

                                    <button
                                        onClick={() => {
                                            if (confirm(`ARE YOU SURE you want to DELETE ALL LOCAL SETTINGS?\n\nThis cannot be undone.`)) {
                                                // 1. Clear User Data
                                                const storedData = JSON.parse(localStorage.getItem('trelloUserData') || '{}');
                                                if (user?.id) delete storedData[user.id];
                                                localStorage.setItem('trelloUserData', JSON.stringify(storedData));

                                                // 2. Clear specific keys (Scanning all keys since we don't track them all perfectly)
                                                const keysToRemove = [];
                                                for (let i = 0; i < localStorage.length; i++) {
                                                    const key = localStorage.key(i);
                                                    if (key && (
                                                        key.startsWith('TRELLO_') ||
                                                        key.startsWith('MAP_GEOCODING_CACHE_') ||
                                                        key.startsWith('updateTrelloCoordinates_') ||
                                                        key.startsWith('enableCardMove_') ||
                                                        key.startsWith('refreshInterval_') // old keys might exist
                                                    )) {
                                                        keysToRemove.push(key);
                                                    }
                                                }
                                                keysToRemove.forEach(k => localStorage.removeItem(k));

                                                alert("All local cache has been reset. The application will reload.");
                                                window.location.reload();
                                            }
                                        }}
                                        style={{ backgroundColor: '#d32f2f', color: 'white', border: 'none', padding: '10px 15px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                                    >
                                        Reset My Trellops Stored Cache
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </DragDropContext>



            <div className="actions-container" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ marginRight: 'auto', fontWeight: 'bold', color: '#666' }}>
                    v4.1.{__BUILD_ID__ || 1000} - Jan 05, 2026
                </span>
                <button className="save-layout-button" onClick={handleSave}>Save Settings</button>
                <button className="button-secondary" onClick={onClose}>Cancel</button>
                <button className="button-secondary" onClick={() => setShowShareModal(true)}>Share Configuration</button>
                <button className="button-secondary" onClick={() => setShowMoreOptions(true)}>More...</button>
            </div>

            {showShareModal && (
                <ShareConfigModal
                    config={getConfigObject()}
                    onClose={() => setShowShareModal(false)}
                    boardName={selectedBoard?.name}
                />
            )}

            {
                showMoreOptions && (
                    <MoreOptionsModal
                        onClose={() => setShowMoreOptions(false)}
                        onReset={handleClearBoardConfig}
                        onExport={handleExportConfig}
                        onImport={handleImportConfig}
                        selectedBoardId={selectedBoardId}
                        boardName={selectedBoard?.name}
                    />
                )
            }
        </div >
    );
};

export default SettingsScreen;
