import React, { useState, useEffect } from 'react';
import { trelloFetch } from '../api/trello';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import MoreOptionsModal from './common/MoreOptionsModal';
import IconPicker from './common/IconPicker';
import ColorPicker from './common/ColorPicker';
import { STORAGE_KEYS } from '../utils/constants';
import { setPersistentColors, getPersistentColors, setPersistentLayout } from '../utils/persistence';
import '../styles/settings.css';

const SettingsScreen = ({ user, onClose, onSave, onLogout }) => {
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
    const [markerRules, setMarkerRules] = useState([]);

    const [error, setError] = useState('');
    const [showMoreOptions, setShowMoreOptions] = useState(false);
    const [loadingLists, setLoadingLists] = useState(false);

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
                    await fetchBoardData(bId);

                    // Load Layout - Prefer persistence helper logic
                    const allUserData = JSON.parse(localStorage.getItem('trelloUserData') || '{}');
                    const savedLayout = allUserData[user.id]?.dashboardLayout?.[bId];

                    if (savedLayout) {
                        setBlocks(savedLayout);
                    } else {
                        // Fallback to legacy key if exists (migration)
                        const legacyKey = `TRELLO_DASHBOARD_LAYOUT_${bId}`;
                        const legacyLayout = localStorage.getItem(legacyKey);
                        if (legacyLayout) setBlocks(JSON.parse(legacyLayout));
                    }

                    // Load Colors
                    const savedColors = getPersistentColors(user.id)?.[bId] || {};
                    setListColors(savedColors);

                    // Load Other Settings
                    const savedRefresh = localStorage.getItem(STORAGE_KEYS.REFRESH_INTERVAL + bId);
                    if (savedRefresh) {
                        const parsed = JSON.parse(savedRefresh);
                        setRefreshValue(parsed.value);
                        setRefreshUnit(parsed.unit);
                    }
                    const savedClock = localStorage.getItem(STORAGE_KEYS.CLOCK_SETTING + bId);
                    if (savedClock === 'false') setShowClock(false);

                    const savedIgnore = localStorage.getItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + bId);
                    if (savedIgnore === 'false') setIgnoreTemplateCards(false);

                    const savedIgnoreCompleted = localStorage.getItem(STORAGE_KEYS.IGNORE_COMPLETED_CARDS + bId);
                    if (savedIgnoreCompleted === 'true') setIgnoreCompletedCards(true);
                    else setIgnoreCompletedCards(false);

                    // Load Map Config
                    const rulesKey = `TRELLO_MARKER_RULES_${bId}`;
                    const savedRules = localStorage.getItem(rulesKey);
                    if (savedRules) setMarkerRules(JSON.parse(savedRules));

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
            const listsData = await trelloFetch(`/boards/${boardId}/lists?cards=none&fields=id,name`, user.token);
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
        setBlocks([]);
        setListColors({});
        setMarkerRules([]);
        if (boardId) await fetchBoardData(boardId);
        else setAllLists([]);
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
        if (refreshUnit === 'seconds' && parseInt(refreshValue) < 10) {
            setError("Refresh interval must be at least 10 seconds.");
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

            // 5. Update User Settings (CRITICAL: Populate selectedLists for Dashboard.jsx)
            // Flatten all lists assigned to blocks
            const assignedLists = blocks.flatMap(b => b.listIds.map(lId => allLists.find(l => l.id === lId))).filter(Boolean);

            const newSettings = {
                boardId: selectedBoardId,
                boardName: selectedBoard ? selectedBoard.name : 'Trello Board',
                selectedLists: assignedLists, // THIS FIXES THE "NO BOARD CONFIG" ERROR
                enableMapView,
                mapGeocodeMode
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

    const handleExportConfig = () => {
        if (!selectedBoardId) return;
        const config = {
            boardId: selectedBoardId,
            blocks,
            listColors,
            markerRules,
            refreshValue,
            refreshUnit,
            showClock,
            ignoreTemplateCards,
            ignoreCompletedCards,
            enableMapView,
            mapGeocodeMode
        };
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
            {/* Breadcrumb Navigation */}
            <div style={{ marginBottom: '20px', fontSize: '0.9em' }}>
                <a href="#section-1" onClick={(e) => { e.preventDefault(); document.getElementById('section-1').scrollIntoView({ behavior: 'smooth' }); }}>1. Board</a> |
                <a href="#section-2" onClick={(e) => { e.preventDefault(); document.getElementById('section-2').scrollIntoView({ behavior: 'smooth' }); }}> 2. Blocks</a> |
                <a href="#section-3" onClick={(e) => { e.preventDefault(); document.getElementById('section-3').scrollIntoView({ behavior: 'smooth' }); }}> 3. Assign</a> |
                <a href="#section-4" onClick={(e) => { e.preventDefault(); document.getElementById('section-4').scrollIntoView({ behavior: 'smooth' }); }}> 4. Dashboard Settings</a> |
                <a href="#section-5" onClick={(e) => { e.preventDefault(); document.getElementById('section-5').scrollIntoView({ behavior: 'smooth' }); }}> 5. Map Settings</a>
            </div>

            <h2>Dashboard Settings</h2>

            {error && <div className="error-banner" style={{ background: '#ffebee', color: '#c62828', padding: '10px', marginBottom: '15px', borderRadius: '4px', border: '1px solid #ffcdd2' }}>{error}</div>}

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

            {selectedBoard && (
                <DragDropContext onDragEnd={onDragEnd}>
                    {/* SECTION 2: BLOCKS */}
                    <div className="admin-section" id="section-2">
                        <h3>2. Manage your Trellops blocks</h3>
                        <p style={{ fontSize: '0.9em', color: '#666', marginTop: '-10px' }}>
                            A block is a group of tiles representing each Trello list (or column). You will be able to assign one or multiple tiles to each block. Blocks can be shown or hidden on demad on the dashboard.
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
                                            <div style={{ marginTop: '5px' }}>
                                                <label style={{ display: 'flex', alignItems: 'center' }}>
                                                    <ToggleSwitch checked={block.includeOnMap} onChange={e => handleUpdateBlockProp(block.id, 'includeOnMap', e.target.checked)} />
                                                    <span style={{ marginLeft: '5px' }}>Show on map</span>
                                                </label>
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
                                                                        style={{ padding: '8px', margin: '4px 0', background: 'white', borderLeft: `5px solid ${color}`, borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...provided.draggableProps.style }}
                                                                    >
                                                                        <span>{list.name}</span>
                                                                        <input
                                                                            type="color"
                                                                            value={color}
                                                                            onChange={e => setListColors({ ...listColors, [listId]: e.target.value })}
                                                                            style={{ width: '30px', height: '30px', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
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

                                        {/* Block Marker - Full Width at Bottom */}
                                        {block.includeOnMap && (
                                            <div style={{ marginTop: '15px', paddingTop: '10px', borderTop: '1px solid rgba(0,0,0,0.1)' }}>
                                                <label style={{ fontSize: '0.85em', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Block Marker Icon:</label>
                                                <div style={{ width: '100%' }}>
                                                    <IconPicker selectedIcon={block.mapIcon} onChange={icon => handleUpdateBlockProp(block.id, 'mapIcon', icon)} />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* SECTION 4: OTHER */}
                    <div className="admin-section" id="section-4">
                        <h3>4. Other Dashboard Settings for {selectedBoard.name}</h3>
                        <p style={{ fontSize: '0.9em', color: '#666', marginTop: '-10px', marginBottom: '15px' }}>
                            These settings are saved separately for each Trello board. Auto-refresh must be at least 10 seconds; recommended 30 seconds for live displays. The digital clock appears in the top-left corner of the screen and follows the local computer time format. Template Cards in Trello can be excluded from the count (recommended); completed cards can also be excluded.
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '30px' }}>
                            <div>
                                <label>Refresh Interval</label>
                                <div style={{ marginTop: '5px' }}>
                                    <input type="number" min={refreshUnit === 'seconds' ? 15 : 1} value={refreshValue} onChange={e => setRefreshValue(e.target.value)} style={{ width: '50px', padding: '5px' }} />
                                    <select value={refreshUnit} onChange={e => setRefreshUnit(e.target.value)} style={{ padding: '5px' }}>
                                        <option value="seconds">Seconds</option>
                                        <option value="minutes">Minutes</option>
                                        <option value="hours">Hours</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label>Features</label>
                                <div style={{ marginTop: '5px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
                                        <ToggleSwitch checked={showClock} onChange={e => setShowClock(e.target.checked)} />
                                        <span style={{ marginLeft: '5px' }}>Show Clock</span>
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', marginBottom: '5px' }}>
                                        <ToggleSwitch checked={ignoreTemplateCards} onChange={e => setIgnoreTemplateCards(e.target.checked)} />
                                        <span style={{ marginLeft: '5px' }}>Ignore Template Cards</span>
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center' }}>
                                        <ToggleSwitch checked={ignoreCompletedCards} onChange={e => setIgnoreCompletedCards(e.target.checked)} />
                                        <span style={{ marginLeft: '5px' }}>Ignore Completed Cards</span>
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* SECTION 5: MAP */}
                    <div className="admin-section" id="section-5">
                        <h3>5. Map view for {selectedBoard.name}</h3>
                        <p style={{ fontSize: '0.9em', color: '#666', marginTop: '-10px', marginBottom: '15px' }}>
                            Map settings are saved per-board. Choose whether Map View is enabled and how geocoding should behave for cards on this board.
                        </p>
                        <div className="settings-row">
                            <ToggleSwitch checked={enableMapView} onChange={e => setEnableMapView(e.target.checked)} />
                            <span style={{ marginLeft: '10px' }}>Enable Map View</span>
                        </div>

                        {enableMapView && (
                            <div style={{ marginTop: '15px' }}>
                                <div style={{ marginBottom: '15px' }}>
                                    <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Geocoding behavior:</label>
                                    <label style={{ display: 'block', marginBottom: '3px' }}>
                                        <input type="radio" name="geocodeMode" value="store" checked={mapGeocodeMode === 'store'} onChange={e => setMapGeocodeMode(e.target.value)} />
                                        Store geolocation data locally (default)
                                    </label>
                                    <label style={{ display: 'block' }}>
                                        <input type="radio" name="geocodeMode" value="update" checked={mapGeocodeMode === 'update'} onChange={e => setMapGeocodeMode(e.target.value)} />
                                        Update the Trello card coordinates (beta feature - only for demo purposes)
                                    </label>
                                    {mapGeocodeMode === 'update' && (
                                        <p style={{ color: '#d32f2f', fontSize: '0.85em', marginTop: '5px', marginLeft: '20px', fontStyle: 'italic' }}>
                                            Note: this will update each card in your Trello board with Lat/Long Coordinates in the Location field. Only enable if you want to update each card in Trello.
                                        </p>
                                    )}
                                </div>

                                <h4>Marker Variants</h4>
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
                        )}
                    </div>
                </DragDropContext>
            )}



            <div className="actions-container" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ marginRight: 'auto', fontWeight: 'bold', color: '#666' }}>v3.0.0</span>
                <button className="save-layout-button" onClick={handleSave}>Save Settings</button>
                <button className="button-secondary" onClick={onClose}>Cancel</button>
                <button className="button-secondary" onClick={() => setShowMoreOptions(true)}>More...</button>
            </div>

            {showMoreOptions && (
                <MoreOptionsModal
                    onClose={() => setShowMoreOptions(false)}
                    onReset={handleClearBoardConfig}
                    onExport={handleExportConfig}
                    onImport={handleImportConfig}
                    selectedBoardId={selectedBoardId}
                    boardName={selectedBoard?.name}
                />
            )}
        </div>
    );
};

export default SettingsScreen;
