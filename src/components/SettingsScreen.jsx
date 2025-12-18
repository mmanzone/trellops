import React, { useState, useEffect, useContext } from 'react';
import { trelloFetch } from '../api/trello';
import { STORAGE_KEYS, DEFAULT_LAYOUT } from '../utils/constants';
import {
    getUserData, setUserData, getPersistentLayout, setPersistentLayout,
    getPersistentColors, setPersistentColor, setPersistentSelections
} from '../utils/persistence';
import { useDarkMode } from '../context/DarkModeContext';
import { convertIntervalToSeconds } from '../utils/helpers';
import MoreOptionsModal from './common/MoreOptionsModal';

const SettingsScreen = ({ user, onSave, onBack, onLogout }) => {
    const initialSettings = getUserData(user.id, 'settings') || {};
    const [boards, setBoards] = useState([]);
    const [selectedBoardId, setSelectedBoardId] = useState(initialSettings.boardId || '');
    const [allBoardLists, setAllBoardLists] = useState([]);

    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // --- Block Management State ---
    const [blocks, setBlocks] = useState(() => getPersistentLayout(user.id, initialSettings.boardId));
    const [listColors, setListColors] = useState(() => (getPersistentColors(user.id)[initialSettings.boardId] || {}));
    const [enableMapView, setEnableMapView] = useState(() => {
        const storageKey = `ENABLE_MAP_VIEW_${initialSettings.boardId}`;
        const stored = localStorage.getItem(storageKey);
        return stored === 'true'; // Default to false (disabled) if not set
    });
    const [mapGeocodeMode, setMapGeocodeMode] = useState(() => {
        const key = `MAP_GEOCODING_MODE_${initialSettings.boardId}`;
        const stored = localStorage.getItem(key);
        return stored || 'store'; // 'store' (default) or 'update'
    });

    // Handler for per-board map view toggle
    const handleToggleEnableMapView = (isChecked) => {
        setEnableMapView(isChecked);
        const storageKey = `ENABLE_MAP_VIEW_${initialSettings.boardId}`;
        localStorage.setItem(storageKey, isChecked ? 'true' : 'false');
    };

    const [newBlockName, setNewBlockName] = useState('');
    const [showMoreOptions, setShowMoreOptions] = useState(false);

    // Clock setting state for settings screen
    const [showClockSetting, setShowClockSetting] = useState(() => localStorage.getItem(STORAGE_KEYS.CLOCK_SETTING + initialSettings.boardId) !== 'false');
    // NEW: Ignore Template Cards setting
    const [ignoreTemplateCards, setIgnoreTemplateCards] = useState(() => localStorage.getItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + initialSettings.boardId) !== 'false');

    // Theme setting from Context
    const { theme, toggleTheme } = useDarkMode();

    // NEW: Refresh Interval State
    const defaultRefreshSetting = { value: 1, unit: 'minutes' };
    const savedRefresh = localStorage.getItem(STORAGE_KEYS.REFRESH_INTERVAL + initialSettings.boardId);
    const [refreshValue, setRefreshValue] = useState(savedRefresh ? JSON.parse(savedRefresh).value : 1);
    const [refreshUnit, setRefreshUnit] = useState(savedRefresh ? JSON.parse(savedRefresh).unit : 'minutes');


    const selectedBoard = boards.find(b => b.id === selectedBoardId);

    // --- Export/Import Handlers ---
    const handleExportConfig = () => {
        if (!selectedBoardId) {
            setError("Please select a board before exporting.");
            return;
        }

        const configData = {
            theme: localStorage.getItem(STORAGE_KEYS.THEME),
            clockSetting: localStorage.getItem(STORAGE_KEYS.CLOCK_SETTING + selectedBoardId),
            refreshInterval: localStorage.getItem(STORAGE_KEYS.REFRESH_INTERVAL + selectedBoardId),
            layout: getPersistentLayout(user.id, selectedBoardId),
            colors: getPersistentColors(user.id)[selectedBoardId],
            // NOTE: API Key and Token are EXCLUDED for security
            boardName: selectedBoard?.name || 'UnknownBoard'
        };

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(configData, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `trellops_${configData.boardName.replace(/\s/g, '_')}_configuration.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    };

    const handleImportConfig = (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const importedConfig = JSON.parse(e.target.result);
                if (!selectedBoardId) {
                    setError("Please select the target Trello board first.");
                    return;
                }

                // 1. Update Theme
                if (importedConfig.theme) {
                    toggleTheme(importedConfig.theme);
                }
                // 2. Update Refresh Rate
                if (importedConfig.refreshInterval) {
                    localStorage.setItem(STORAGE_KEYS.REFRESH_INTERVAL + selectedBoardId, importedConfig.refreshInterval);
                    const { value: rValue, unit: rUnit } = JSON.parse(importedConfig.refreshInterval);
                    setRefreshValue(rValue);
                    setRefreshUnit(rUnit);
                }
                // 3. Update Clock Setting
                if (importedConfig.clockSetting !== undefined) {
                    localStorage.setItem(STORAGE_KEYS.CLOCK_SETTING + selectedBoardId, importedConfig.clockSetting);
                    setShowClockSetting(importedConfig.clockSetting !== 'false');
                }
                // 4. Update Layout (Blocks)
                if (importedConfig.layout) {
                    setPersistentLayout(user.id, selectedBoardId, importedConfig.layout);
                    setBlocks(getPersistentLayout(user.id, selectedBoardId));
                }
                // 5. Update Colors
                if (importedConfig.colors) {
                    const allColors = getPersistentColors(user.id);
                    allColors[selectedBoardId] = importedConfig.colors;
                    setUserData(user.id, 'listColors', allColors);
                    setListColors(importedConfig.colors);
                }

                alert(`Configuration successfully imported for board ${selectedBoardId}.`);
                // Force full settings refresh to apply changes
                onSave({ boardId: selectedBoardId, boardName: importedConfig.boardName || 'Imported Board', selectedLists: [] });

            } catch (err) {
                setError("Invalid configuration file format.");
                console.error("Import error:", err);
            }
        };
        reader.readAsText(file);
    };

    // NEW: Handle Clearing Board Configuration
    const handleClearBoardConfig = () => {
        if (!selectedBoardId) {
            setError("Please select a board to clear configuration.");
            return;
        }

        const boardName = boards.find(b => b.id === selectedBoardId)?.name || 'this board';

        if (window.confirm(`Are you sure you want to reset the layout for the board: "${boardName}"? This cannot be undone.`)) {
            // 1. Clear Layout
            const allLayouts = getUserData(user.id, 'dashboardLayout') || {};
            delete allLayouts[selectedBoardId];
            setUserData(user.id, 'dashboardLayout', allLayouts);

            // 2. Clear Colors
            const allColors = getPersistentColors(user.id);
            delete allColors[selectedBoardId];
            setUserData(user.id, 'listColors', allColors);

            // 3. Clear other per-board settings
            localStorage.removeItem(STORAGE_KEYS.CLOCK_SETTING + selectedBoardId);
            localStorage.removeItem(STORAGE_KEYS.REFRESH_INTERVAL + selectedBoardId);
            localStorage.removeItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + selectedBoardId);

            // 4. Clear the main settings if it's the current board
            const currentSettings = getUserData(user.id, 'settings');
            if (currentSettings && currentSettings.boardId === selectedBoardId) {
                setUserData(user.id, 'settings', null);
            }

            // 5. Reset component state to default values
            setBlocks(DEFAULT_LAYOUT);
            setListColors({});
            setRefreshValue(defaultRefreshSetting.value);
            setRefreshUnit(defaultRefreshSetting.unit);
            setIgnoreTemplateCards(true); // Reset to default

            alert(`Layout cleared for "${boardName}". The dashboard will now reset.`);

            // Force a re-save and switch to dashboard (which will prompt re-setup)
            onSave(null);
        }
    };


    // Fetch Boards on load
    useEffect(() => {
        setLoading(true);
        trelloFetch('/members/me/boards', user.token)
            .then(data => {
                setBoards(data);
                if (data.length > 0 && !selectedBoardId) {
                    setSelectedBoardId(data[0].id);
                }
            })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, [user.token]);

    // Fetch Lists and initialize states when selectedBoardId changes
    useEffect(() => {
        if (!selectedBoardId) return;
        setLoading(true);
        setError('');

        const boardPersistentColors = getPersistentColors(user.id)[selectedBoardId] || {};
        const boardLayout = getPersistentLayout(user.id, selectedBoardId);
        const clockSetting = localStorage.getItem(STORAGE_KEYS.CLOCK_SETTING + selectedBoardId) !== 'false';
        const ignoreTemplates = localStorage.getItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + selectedBoardId) !== 'false';

        // Read refresh setting
        const savedRefresh = localStorage.getItem(STORAGE_KEYS.REFRESH_INTERVAL + selectedBoardId);
        const { value: rValue, unit: rUnit } = savedRefresh ? JSON.parse(savedRefresh) : defaultRefreshSetting;


        trelloFetch(`/boards/${selectedBoardId}/lists?cards=none&fields=id,name`, user.token)
            .then(data => {
                setAllBoardLists(data);
                setListColors(boardPersistentColors);
                setBlocks(boardLayout);
                setShowClockSetting(clockSetting);
                setIgnoreTemplateCards(ignoreTemplates);
                setRefreshValue(rValue);
                setRefreshUnit(rUnit);
            })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, [selectedBoardId, user.token]);

    // --- HANDLERS ---

    const handleBoardChange = (e) => {
        const newId = e.target.value;
        setSelectedBoardId(newId);
        // Reset blocks/colors/clock, will be reloaded by useEffect
        setBlocks(getPersistentLayout(user.id, newId));
        setListColors(getPersistentColors(user.id)[newId] || {});
        setAllBoardLists([]);
        setShowClockSetting(localStorage.getItem(STORAGE_KEYS.CLOCK_SETTING + newId) !== 'false');
        setIgnoreTemplateCards(localStorage.getItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + newId) !== 'false');

        const savedRefresh = localStorage.getItem(STORAGE_KEYS.REFRESH_INTERVAL + newId);
        const { value: rValue, unit: rUnit } = savedRefresh ? JSON.parse(savedRefresh) : defaultRefreshSetting;
        setRefreshValue(rValue);
        setRefreshUnit(rUnit);
    };

    const handleAddBlock = () => {
        if (!newBlockName.trim()) return;
        const newBlock = {
            id: Date.now().toString(),
            name: newBlockName.trim(),
            listIds: [],
            ignoreFirstCard: false,
            displayFirstCardDescription: true,
            isCollapsed: false
        };
        const newLayout = [...blocks, newBlock];
        setBlocks(newLayout);
        setNewBlockName('');
        setPersistentLayout(user.id, selectedBoardId, newLayout);
    };

    const handleRemoveBlock = (blockId) => {
        const blockToRemove = blocks.find(s => s.id === blockId);
        if (!blockToRemove) return;

        const listIdsToMoveBack = blockToRemove.listIds;

        // Add lists from the removed block back to the 'Default' block
        const newBlocks = blocks
            .filter(s => s.id !== blockId)
            .map(s => {
                if (s.id === 'all') {
                    return { ...s, listIds: [...s.listIds, ...listIdsToMoveBack] };
                }
                return s;
            });

        // Ensure 'Default' block exists if it was somehow deleted
        if (!newBlocks.some(s => s.id === 'all')) {
            newBlocks.unshift({ id: 'all', name: 'Default', listIds: listIdsToMoveBack, ignoreFirstCard: false, isCollapsed: false });
        }

        setBlocks(newBlocks);
        setPersistentLayout(user.id, selectedBoardId, newBlocks);
    };

    // Handler for re-ordering blocks
    const handleReorderBlock = (blockId, direction) => {
        const currentBlocks = [...blocks];
        const index = currentBlocks.findIndex(s => s.id === blockId);
        if (index === -1) return;

        const newIndex = direction === 'up' ? index - 1 : index + 1;

        // Only allow swap if the new index is valid and not swapping 'all' (index 0) with any other element
        if (newIndex > 0 && newIndex < currentBlocks.length && currentBlocks[newIndex].id !== 'all') {
            [currentBlocks[index], currentBlocks[newIndex]] = [currentBlocks[newIndex], currentBlocks[index]];

            setBlocks(currentBlocks);
            setPersistentLayout(user.id, selectedBoardId, currentBlocks);
        }
    };


    // Allows renaming of all blocks, including 'all'
    const handleRenameBlock = (blockId, newName) => {
        if (!newName.trim()) return;
        const newBlocks = blocks.map(s => s.id === blockId ? { ...s, name: newName } : s);
        setBlocks(newBlocks);
        setPersistentLayout(user.id, selectedBoardId, newBlocks);
    };

    // Handler for the 'Use first card as description' checkbox
    const handleToggleIgnoreCard = (blockId, isChecked) => {
        const newBlocks = blocks.map(s =>
            s.id === blockId ? { ...s, ignoreFirstCard: isChecked } : s
        );
        setBlocks(newBlocks);
        setPersistentLayout(user.id, selectedBoardId, newBlocks);
    };

    // Handler for the 'Display first card as description' checkbox
    const handleToggleDisplayDescription = (blockId, isChecked) => {
        const newBlocks = blocks.map(s =>
            s.id === blockId ? { ...s, displayFirstCardDescription: isChecked } : s
        );
        setBlocks(newBlocks);
        setPersistentLayout(user.id, selectedBoardId, newBlocks);
    };

    // NEW: Handler for 'Include on Map' checkbox
    const handleToggleIncludeOnMap = (blockId, isChecked) => {
        const newBlocks = blocks.map(s =>
            s.id === blockId ? { ...s, includeOnMap: isChecked } : s
        );
        setBlocks(newBlocks);
        setPersistentLayout(user.id, selectedBoardId, newBlocks);
    };

    // Handler for the Clock checkbox
    const handleToggleClock = (isChecked) => {
        setShowClockSetting(isChecked);
        localStorage.setItem(STORAGE_KEYS.CLOCK_SETTING + selectedBoardId, isChecked ? 'true' : 'false');
    };

    // NEW: Handler for Ignore Template Cards checkbox
    const handleToggleIgnoreTemplateCards = (isChecked) => {
        setIgnoreTemplateCards(isChecked);
        localStorage.setItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + selectedBoardId, isChecked ? 'true' : 'false');
    };

    // Handler for re-ordering tiles
    const handleReorderList = (blockId, listId, direction) => {
        const newBlocks = blocks.map(block => {
            if (block.id !== blockId) return block;

            const listIds = [...block.listIds];
            const index = listIds.indexOf(listId);

            if (index === -1) return block;

            const newIndex = direction === 'up' ? index - 1 : index + 1;

            if (newIndex >= 0 && newIndex < listIds.length) {
                // Swap elements
                [listIds[index], listIds[newIndex]] = [listIds[newIndex], listIds[index]];
                return { ...block, listIds };
            }
            return block;
        });

        setBlocks(newBlocks);
        setPersistentLayout(user.id, selectedBoardId, newBlocks);
    };


    const handleMoveList = (listId, fromBlockId, toBlockId) => {
        const newBlocks = blocks.map(block => {
            if (block.id === fromBlockId) {
                return { ...block, listIds: block.listIds.filter(id => id !== listId) };
            }
            if (block.id === toBlockId) {
                return { ...block, listIds: [...block.listIds, listId] };
            }
            return block;
        });

        // Handle move to pool ("Unassigned Lists")
        if (toBlockId === 'pool') {
            const updatedBlocks = newBlocks.map(s =>
                ({ ...s, listIds: s.listIds.filter(id => id !== listId) })
            );

            const allSelectedIds = updatedBlocks.flatMap(s => s.listIds);
            setPersistentSelections(user.id, selectedBoardId, allSelectedIds);
            setBlocks(updatedBlocks);
            setPersistentLayout(user.id, selectedBoardId, updatedBlocks);
            return;
        }

        setBlocks(newBlocks);
        setPersistentLayout(user.id, selectedBoardId, newBlocks);

        // Update persistent selections cache (add listId)
        const allSelectedIds = newBlocks.flatMap(s => s.listIds);
        setPersistentSelections(user.id, selectedBoardId, allSelectedIds);
    };

    const handleColorChange = (listId, color) => {
        const newColors = { ...listColors, [listId]: color };
        setListColors(newColors);
        setPersistentColor(user.id, selectedBoardId, listId, color);
    };

    // Handle Refresh Rate Change
    const handleRefreshChange = (value, unit) => {
        const newValue = parseInt(value) || 0;
        setRefreshValue(newValue);
        if (unit) setRefreshUnit(unit);

        // Save immediately
        localStorage.setItem(STORAGE_KEYS.REFRESH_INTERVAL + selectedBoardId, JSON.stringify({
            value: newValue,
            unit: unit || refreshUnit
        }));
    };


    const handleSave = () => {
        const selectedBoard = boards.find(b => b.id === selectedBoardId);
        if (!selectedBoard) {
            setError('Please select a board.');
            return;
        }

        // Final validation before saving settings/returning
        const intervalInSeconds = convertIntervalToSeconds(refreshValue, refreshUnit);
        if (intervalInSeconds < 10) {
            setError('Minimum refresh rate is 10 seconds.');
            return;
        }
        if (intervalInSeconds > 86400) { // 24 hours = 86400 seconds
            setError('Maximum refresh rate is 24 hours.');
            return;
        }
        // Save final refresh setting
        localStorage.setItem(STORAGE_KEYS.REFRESH_INTERVAL + selectedBoardId, JSON.stringify({
            value: refreshValue,
            unit: refreshUnit
        }));


        // Gather all lists that are currently assigned to ANY block
        const selectedListsMap = new Map();
        blocks.flatMap(s => s.listIds).forEach(listId => {
            const listData = allBoardLists.find(l => l.id === listId);
            if (listData) {
                selectedListsMap.set(listId, {
                    id: listId,
                    name: listData.name,
                    color: listColors[listId] || ''
                });
            }
        });

        // Update the main SETTINGS cache for dashboard initialization
        const finalSettings = {
            boardId: selectedBoardId,
            boardName: selectedBoard.name,
            selectedLists: Array.from(selectedListsMap.values())
        };

        // Persist per-board Map View settings
        try {
            const geoKey = `MAP_GEOCODING_MODE_${selectedBoardId}`;
            localStorage.setItem(geoKey, mapGeocodeMode || 'store');
        } catch (e) {
            console.warn('Failed to persist MAP_GEOCODING_MODE', e);
        }
        try {
            const mapKey = `ENABLE_MAP_VIEW_${selectedBoardId}`;
            localStorage.setItem(mapKey, enableMapView ? 'true' : 'false');
        } catch (e) {
            console.warn('Failed to persist ENABLE_MAP_VIEW', e);
        }

        setUserData(user.id, 'settings', finalSettings);
        onSave(finalSettings);
    };

    // Derive list pool: Trello lists not currently assigned to any block
    const assignedListIds = new Set(blocks.flatMap(s => s.listIds));
    const listPool = allBoardLists
        .filter(list => !assignedListIds.has(list.id))
        .map(list => ({ id: list.id, name: list.name }));

    // Get the ID of the first block for the default move action
    const firstBlockId = blocks.length > 0 ? blocks[0].id : null;

    if (loading) return <div className="form-card settings">Loading Boards...</div>;

    return (
        <div className="form-card settings">
            <div style={{ position: 'absolute', top: '10px', right: '10px' }}>
                <button className="logout-button" onClick={onLogout} style={{ margin: 0 }}>Log Out</button>
            </div>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span>Trellops Dashboard Setup</span>
                <a href="help.html" target="_blank" rel="noopener noreferrer" className="subtle-help-link">First time user? Check out our user guide</a>
            </h2>

            <div className="admin-section">
                <h3>1. Choose your Trello Board</h3>
                <p style={{ marginTop: '-10px', fontSize: '0.9em', color: 'var(--text-secondary)' }}>
                    Boards are pulled directly from your Trello account, across all workspaces.
                </p>
                <div className="settings-row">
                    <label htmlFor="board-select">Your Trello board:</label>
                    <select id="board-select" value={selectedBoardId} onChange={handleBoardChange}>
                        <option value="">-- Select a Board --</option>
                        {boards.map(board => (
                            <option key={board.id} value={board.id}>{board.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {selectedBoard && (
                <div className="admin-section">
                    <h3>2. Manage your Trellops Blocks</h3>
                    <p style={{ marginTop: '-10px', fontSize: '0.9em', color: 'var(--text-secondary)' }}>
                        A block is a group of tiles representing each Trello list (or column). You will be able to assign one or multiple tiles to each block. Blocks can be shown or hidden on demad on the dashboard.
                    </p>
                    <div className="block-management">
                        <input
                            type="text"
                            placeholder="New Block Name"
                            value={newBlockName}
                            onChange={e => setNewBlockName(e.target.value)}
                            className="block-title-input"
                            style={{ width: '200px', marginRight: '10px' }}
                        />
                        <button className="settings-button" onClick={handleAddBlock} disabled={!newBlockName.trim()}>
                            Add Block
                        </button>
                    </div>

                    {blocks.map((block, blockIndex) => (
                        <div key={block.id} className="layout-block-box" style={{ flexGrow: 1, maxWidth: '100%', marginTop: '20px', padding: '15px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', flexGrow: 1 }}>
                                    <div className="order-buttons" style={{ marginRight: '15px' }}>
                                        <button
                                            onClick={() => handleReorderBlock(block.id, 'up')}
                                            disabled={blockIndex === 0}
                                            title="Move Block Up"
                                        >
                                            ▲
                                        </button>
                                        <button
                                            onClick={() => handleReorderBlock(block.id, 'down')}
                                            disabled={blockIndex === blocks.length - 1}
                                            title="Move Block Down"
                                        >
                                            ▼
                                        </button>
                                    </div>

                                    <input
                                        type="text"
                                        value={block.name}
                                        onChange={e => handleRenameBlock(block.id, e.target.value)}
                                        className="block-title-input"
                                        style={{ width: 'calc(100% - 15px)' }}
                                    />
                                </div>

                                {block.id !== 'all' && (
                                    <button
                                        className="remove-block-button"
                                        onClick={() => handleRemoveBlock(block.id)}
                                        title="Delete block and move lists to 'Default'"
                                    >
                                        &times;
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {selectedBoard && (
                <div className="admin-section">
                    <h3>3. Assign Tiles to your Blocks</h3>
                    <p style={{ marginTop: '-10px', fontSize: '0.9em', color: 'var(--text-secondary)' }}>
                        Tiles show the total count of cards in each Trello list, automatically updating as the cards are created or moved. Choose from the Unassigned pool on the left,  the lists you want to create as a tile in the respective block on the right. Then customise each tile position and colour.
                    </p>
                    <div className="layout-config-container">
                        <div className="layout-column">
                            <div className="layout-block-box">
                                <h4 style={{ marginBottom: '10px', color: '#6b778c' }}>Pool of Unassigned Trello Lists ({listPool.length})</h4>
                                <div className="list-pool" style={{ minHeight: '100px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {listPool.map(list => (
                                        <div key={list.id} className="layout-list-item" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', gap: '10px', flexBasis: 'auto', flexGrow: 0 }}>
                                            <span style={{ flexGrow: 1, flexBasis: '100%' }}>{list.name}</span>
                                            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', justifyContent: 'flex-end', width: '100%' }}>
                                                {blocks.map(block => (
                                                    <button
                                                        key={block.id}
                                                        className="move-button-pool"
                                                        onClick={() => handleMoveList(list.id, 'pool', block.id)}
                                                        title={`Move to ${block.name}`}
                                                    >
                                                        {block.name} &raquo;
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                    {listPool.length === 0 && <p style={{ fontSize: '0.9em', color: '#6b778c' }}>All lists assigned.</p>}
                                </div>
                            </div>
                        </div>
                        <div className="layout-column">
                            {blocks.map((block) => (
                                <div key={block.id} className="layout-block-box" style={{ flexGrow: 1, maxWidth: '100%' }}>
                                    <h4 style={{ marginBottom: '10px' }}>{block.name}</h4>
                                    {block.listIds.length > 0 ? (
                                        block.listIds.map((listId, index) => {
                                            const listData = allBoardLists.find(l => l.id === listId);
                                            if (!listData) return null;

                                            return (
                                                <div key={listId} className="list-config-item">
                                                    <div className="order-buttons">
                                                        <button
                                                            onClick={() => handleReorderList(block.id, listId, 'up')}
                                                            disabled={index === 0}
                                                            title="Move Up"
                                                        >
                                                            ▲
                                                        </button>
                                                        <button
                                                            onClick={() => handleReorderList(block.id, listId, 'down')}
                                                            disabled={index === block.listIds.length - 1}
                                                            title="Move Down"
                                                        >
                                                            ▼
                                                        </button>
                                                    </div>
                                                    <span style={{
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        width: '50%'
                                                    }}>
                                                        {listData.name}
                                                    </span>
                                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                                        <input
                                                            type="color"
                                                            value={listColors[listId] || '#cccccc'}
                                                            onChange={e => handleColorChange(listId, e.target.value)}
                                                            title="Choose Tile Color"
                                                            style={{ marginLeft: '10px' }}
                                                        />
                                                        <select
                                                            onChange={e => handleMoveList(listId, block.id, e.target.value)}
                                                            style={{ marginLeft: '10px', padding: '5px', fontSize: '0.8em', width: '85px' }}
                                                            value={block.id}
                                                        >
                                                            <option value={block.id}>Move...</option>
                                                            <optgroup label="Blocks">
                                                                {blocks.map(s => (
                                                                    s.id !== block.id && <option key={s.id} value={s.id}>{s.name}</option>
                                                                ))}
                                                            </optgroup>
                                                            <optgroup label="Unassigned">
                                                                <option value="pool">Move to Pool</option>
                                                            </optgroup>
                                                        </select>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <p style={{ fontSize: '0.9em', color: '#6b778c' }}>Move lists here.</p>
                                    )}

                                    <div className="section-options">
                                        <label>
                                            <input
                                                type="checkbox"
                                                checked={block.ignoreFirstCard}
                                                onChange={e => handleToggleIgnoreCard(block.id, e.target.checked)}
                                            />
                                            Do not count the first card in the total
                                        </label>
                                        {block.ignoreFirstCard && (
                                            <label className="sub-option">
                                                <input
                                                    type="checkbox"
                                                    checked={block.displayFirstCardDescription}
                                                    onChange={e => handleToggleDisplayDescription(block.id, e.target.checked)}
                                                />
                                                Display the first card as tile description
                                            </label>
                                        )}
                                        {enableMapView && (
                                            <label>
                                                <input
                                                    type="checkbox"
                                                    checked={block.includeOnMap === true}
                                                    onChange={e => handleToggleIncludeOnMap(block.id, e.target.checked)}
                                                />
                                                Show this block on the Map
                                            </label>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {selectedBoard && (
                <div className="admin-section">
                    <h3>4. Other Dashboard Settings for "{selectedBoard.name}"</h3>
                    <p style={{ marginTop: '-10px', fontSize: '0.9em', color: 'var(--text-secondary)' }}>
                        These settings are saved separately for each Trello board. Auto-refresh must be at least 10 seconds; recommmended 30 seconds for live displays. The digital clock appears in the top-left corner for the screen and follows the local computer time format. Template Cards in Trello can be exceluded from the count (recommended)
                    </p>
                    <div className="three-column">
                        <div className="settings-row" style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <label className="switch">
                                    <input
                                        type="checkbox"
                                        id="show-clock-check"
                                        checked={showClockSetting}
                                        onChange={e => handleToggleClock(e.target.checked)}
                                    />
                                    <span className="slider round"></span>
                                </label>
                                <label htmlFor="show-clock-check">Show Digital Clock</label>
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <label>Auto-Refresh:</label>
                                <input
                                    type="number"
                                    min="1"
                                    value={refreshValue}
                                    onChange={e => handleRefreshChange(e.target.value)}
                                    style={{ width: '60px' }}
                                />
                                <select
                                    value={refreshUnit}
                                    onChange={e => handleRefreshChange(refreshValue, e.target.value)}
                                >
                                    <option value="seconds">Seconds</option>
                                    <option value="minutes">Minutes</option>
                                    <option value="hours">Hours</option>
                                </select>
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <label htmlFor="theme-select">Theme:</label>
                                <select
                                    id="theme-select"
                                    value={theme}
                                    onChange={(e) => toggleTheme(e.target.value)}
                                >
                                    <option value="system">System</option>
                                    <option value="light">Light</option>
                                    <option value="dark">Dark</option>
                                </select>
                            </span>
                        </div>
                        <div className="settings-row" style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginTop: '8px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <label className="switch">
                                    <input
                                        type="checkbox"
                                        id="ignore-templates-check"
                                        checked={ignoreTemplateCards}
                                        onChange={e => handleToggleIgnoreTemplateCards(e.target.checked)}
                                    />
                                    <span className="slider round"></span>
                                </label>
                                <label htmlFor="ignore-templates-check">Ignore Template Cards</label>
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {selectedBoard && (
                <div className="admin-section">
                    <h3>5. Map View for "{selectedBoard.name}"</h3>
                    <p style={{ marginTop: '-10px', fontSize: '0.9em', color: 'var(--text-secondary)' }}>
                        Map settings are saved per-board. Choose whether Map View is enabled and how geocoding should behave for cards on this board.
                    </p>
                    <div className="settings-row" style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginTop: '8px' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <label className="switch">
                                <input
                                    type="checkbox"
                                    id="enable-map-view-check"
                                    checked={enableMapView}
                                    onChange={e => handleToggleEnableMapView(e.target.checked)}
                                />
                                <span className="slider round"></span>
                            </label>
                            <label htmlFor="enable-map-view-check">Enable Map View</label>
                        </span>
                    </div>

                    {enableMapView && (
                        <div style={{ marginTop: '12px' }}>
                            <label style={{ fontWeight: 600, display: 'block', marginBottom: '6px' }}>Geocoding behavior</label>
                            <label style={{ display: 'block', marginBottom: '6px' }}>
                                <input type="radio" name="mapGeocodeMode" value="store" checked={mapGeocodeMode === 'store'} onChange={() => setMapGeocodeMode('store')} />
                                <span style={{ marginLeft: '8px' }}>Store geolocation data locally (default)</span>
                            </label>
                            <label style={{ display: 'block', marginBottom: '6px' }}>
                                <input type="radio" name="mapGeocodeMode" value="update" checked={mapGeocodeMode === 'update'} onChange={() => setMapGeocodeMode('update')} />
                                <span style={{ marginLeft: '8px' }}>Update the Trello card coordinates</span>
                            </label>
                            {mapGeocodeMode === 'update' && (
                                <div style={{ marginTop: '8px', padding: '8px', background: '#fff3f0', border: '1px solid #ffd6cc', color: '#7a1f00', borderRadius: '6px' }}>
                                    <strong>Warning:</strong> Using this option will update the Trello card on "{selectedBoard.name}" with lat/long coordinates.
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {error && <div className="error">{error}</div>}

            <div className="actions-container">
                <button className="save-layout-button" onClick={handleSave}>
                    Save Layout & View Dashboard
                </button>
                <button className="button-secondary" onClick={onBack}>
                    Cancel changes
                </button>
                <button className="button-secondary" onClick={() => setShowMoreOptions(true)}>
                    More options...
                </button>
            </div>

            {showMoreOptions && (
                <MoreOptionsModal
                    onClose={() => setShowMoreOptions(false)}
                    onExport={handleExportConfig}
                    onImport={handleImportConfig}
                    onReset={handleClearBoardConfig}
                    boardName={boards.find(b => b.id === selectedBoardId)?.name || ''}
                    selectedBoardId={selectedBoardId}
                />
            )}
        </div>
    );
};

export default SettingsScreen;
