import React, { useState, useEffect } from 'react';
import { trelloFetch } from '/src/api/trello';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import MoreOptionsModal from './common/MoreOptionsModal';
import IconPicker from './common/IconPicker';
import ColorPicker from './common/ColorPicker';
import { STORAGE_KEYS } from '/src/utils/constants';
import { setPersistentColors, getPersistentColors } from '/src/utils/persistence';
import '/src/styles/settings.css';

const SettingsScreen = ({ user, onClose, onSave }) => {
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

                    // Load Layout
                    const layoutKey = `TRELLO_DASHBOARD_LAYOUT_${bId}`;
                    const savedLayout = localStorage.getItem(layoutKey);
                    if (savedLayout) {
                        setBlocks(JSON.parse(savedLayout));
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
        if (boardId) await fetchBoardData(boardId);
        else setAllLists([]);
    };

    // --- Actions ---

    const handleAddBlock = () => {
        const newBlock = {
            id: `block-${Date.now()}`,
            name: 'New Block',
            listIds: [],
            includeOnMap: false,
            mapIcon: 'map-marker',
            ignoreFirstCard: false,
            displayFirstCardDescription: false
        };
        setBlocks([...blocks, newBlock]);
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
        const { source, destination, draggableId } = result;
        if (!destination) return;

        // Moving between blocks or unassigned
        // Source Droppable ID: 'unassigned' or blockId
        // Dest Droppable ID: 'unassigned' or blockId

        // Helper to remove listId from a block
        const removeListFromBlock = (blockId, listId) => {
            const block = blocks.find(b => b.id === blockId);
            const newListIds = Array.from(block.listIds);
            const index = newListIds.indexOf(listId);
            if (index > -1) newListIds.splice(index, 1);
            return { ...block, listIds: newListIds };
        };

        // Helper to add listId to a block
        const addListToBlock = (blockId, listId, index) => {
            const block = blocks.find(b => b.id === blockId);
            const newListIds = Array.from(block.listIds);
            newListIds.splice(index, 0, listId);
            return { ...block, listIds: newListIds };
        };

        const listId = draggableId;
        const sourceId = source.droppableId;
        const destId = destination.droppableId;

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
    const moveRule = (idx, dir) => {
        const newRules = [...markerRules];
        const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
        [newRules[idx], newRules[swapIdx]] = [newRules[swapIdx], newRules[idx]];
        setMarkerRules(newRules);
    };

    const handleSave = () => {
        if (!selectedBoardId) return alert("Select a board first.");

        const selectedBoard = boards.find(b => b.id === selectedBoardId);

        try {
            // 1. Save Blocks Layout
            const layoutKey = `TRELLO_DASHBOARD_LAYOUT_${selectedBoardId}`;
            localStorage.setItem(layoutKey, JSON.stringify(blocks));

            // 2. Save Colors
            setPersistentColors(user.id, selectedBoardId, listColors);

            // 3. Save Other Settings
            localStorage.setItem(STORAGE_KEYS.REFRESH_INTERVAL + selectedBoardId, JSON.stringify({ value: refreshValue, unit: refreshUnit }));
            localStorage.setItem(STORAGE_KEYS.CLOCK_SETTING + selectedBoardId, showClock ? 'true' : 'false');
            localStorage.setItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + selectedBoardId, ignoreTemplateCards ? 'true' : 'false');

            // 4. Save Map Config
            localStorage.setItem(`TRELLO_MARKER_RULES_${selectedBoardId}`, JSON.stringify(markerRules.filter(r => r.labelId)));

            // 5. Save User Settings (CRITICAL: Populate selectedLists for Dashboard.jsx)
            // Flatten all lists assigned to blocks
            const assignedLists = blocks.flatMap(b => b.listIds.map(lId => allLists.find(l => l.id === lId))).filter(Boolean);

            const storedData = JSON.parse(localStorage.getItem('trelloUserData') || '{}');
            storedData[user.id] = {
                ...storedData[user.id],
                settings: {
                    boardId: selectedBoardId,
                    boardName: selectedBoard ? selectedBoard.name : 'Trello Board',
                    selectedLists: assignedLists, // THIS FIXES THE "NO BOARD CONFIG" ERROR
                    enableMapView,
                    mapGeocodeMode
                }
            };
            localStorage.setItem('trelloUserData', JSON.stringify(storedData));

            onSave();
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

    // Helper: Get Unassigned Lists
    const assignedListIds = new Set(blocks.flatMap(b => b.listIds));
    const unassignedLists = allLists.filter(l => !assignedListIds.has(l.id));

    const selectedBoard = boards.find(b => b.id === selectedBoardId);

    return (
        <div className="settings-container">
            <h2>Dashboard Settings</h2>

            {/* SECTION 1: BOARD */}
            <div className="admin-section">
                <h3>1. Choose your Trello Board</h3>
                <select value={selectedBoardId} onChange={handleBoardChange} className="board-select">
                    <option value="">-- Choose a Board --</option>
                    {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
            </div>

            {selectedBoard && (
                <>
                    {/* SECTION 2: BLOCKS */}
                    <div className="admin-section">
                        <h3>2. Manage your Trellops Blocks</h3>
                        <p style={{ fontSize: '0.9em', color: '#666', marginTop: '-10px' }}>Create sections for your dashboard.</p>
                        {blocks.map(block => (
                            <div key={block.id} style={{ display: 'flex', gap: '10px', marginBottom: '8px', alignItems: 'center' }}>
                                <input
                                    type="text"
                                    value={block.name}
                                    onChange={(e) => handleUpdateBlockName(block.id, e.target.value)}
                                    className="block-name-input"
                                />
                                <button onClick={() => handleRemoveBlock(block.id)} style={{ color: 'red' }}>Remove</button>
                            </div>
                        ))}
                        <button className="add-block-button" onClick={handleAddBlock}>+ Add Block</button>
                    </div>

                    {/* SECTION 3: ASSIGN TILES */}
                    <div className="admin-section">
                        <h3>3. Assign Tiles to your Blocks</h3>
                        <p style={{ fontSize: '0.9em', color: '#666', marginTop: '-10px' }}>Drag lists into blocks. Configure list colors and order.</p>

                        <DragDropContext onDragEnd={onDragEnd}>
                            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', marginTop: '15px' }}>
                                {/* UNASSIGNED */}
                                <div style={{ flex: 1, background: '#f8f9fa', padding: '10px', borderRadius: '6px', border: '1px solid #dee2e6' }}>
                                    <h4>Available Lists</h4>
                                    <Droppable droppableId="unassigned">
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

                                {/* BLOCKS */}
                                <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                    {blocks.map(block => (
                                        <div key={block.id} style={{ background: '#e7f5ff', padding: '10px', borderRadius: '6px', border: '1px solid #a5d8ff' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <h4 style={{ margin: 0 }}>{block.name}</h4>

                                                {/* Block-level Map Icon */}
                                                {(block.includeOnMap !== false) && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.8em' }}>
                                                        Block Marker:
                                                        <IconPicker selectedIcon={block.mapIcon} onChange={icon => handleUpdateBlockProp(block.id, 'mapIcon', icon)} />
                                                    </div>
                                                )}
                                            </div>

                                            <Droppable droppableId={block.id}>
                                                {(provided) => (
                                                    <div ref={provided.innerRef} {...provided.droppableProps} style={{ minHeight: '50px', marginTop: '10px' }}>
                                                        {block.listIds.map((listId, index) => {
                                                            const list = allLists.find(l => l.id === listId);
                                                            if (!list) return null;

                                                            const color = listColors[listId] || 'blue';

                                                            return (
                                                                <Draggable key={listId} draggableId={listId} index={index}>
                                                                    {(provided) => (
                                                                        <div
                                                                            ref={provided.innerRef}
                                                                            {...provided.draggableProps}
                                                                            {...provided.dragHandleProps}
                                                                            style={{ padding: '8px', margin: '4px 0', background: 'white', borderLeft: `5px solid ${color}`, borderRadius: '4px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...provided.draggableProps.style }}
                                                                        >
                                                                            <span>{list.name}</span>
                                                                            {/* List Color Picker */}
                                                                            <ColorPicker selectedColor={color} onChange={c => setListColors({ ...listColors, [listId]: c })} />
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
                        </DragDropContext>
                    </div>

                    {/* SECTION 4: OTHER */}
                    <div className="admin-section">
                        <h3>4. Other Dashboard Settings for {selectedBoard.name}</h3>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '30px' }}>
                            <div>
                                <label>Refresh Interval</label>
                                <div style={{ marginTop: '5px' }}>
                                    <input type="number" min="1" value={refreshValue} onChange={e => setRefreshValue(e.target.value)} style={{ width: '50px', padding: '5px' }} />
                                    <select value={refreshUnit} onChange={e => setRefreshUnit(e.target.value)} style={{ padding: '5px' }}>
                                        <option value="minutes">Minutes</option>
                                        <option value="hours">Hours</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label>Features</label>
                                <div style={{ marginTop: '5px' }}>
                                    <label style={{ display: 'block' }}><input type="checkbox" checked={showClock} onChange={e => setShowClock(e.target.checked)} /> Show Clock</label>
                                    <label style={{ display: 'block' }}><input type="checkbox" checked={ignoreTemplateCards} onChange={e => setIgnoreTemplateCards(e.target.checked)} /> Ignore Template Cards</label>
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: '20px', padding: '10px', background: '#fff', border: '1px solid #eee', borderRadius: '4px' }}>
                            <h5>Block Display Options</h5>
                            {blocks.map(b => (
                                <div key={b.id} style={{ marginBottom: '5px', fontSize: '0.9em', display: 'flex', gap: '15px' }}>
                                    <span style={{ fontWeight: 'bold', width: '150px' }}>{b.name}:</span>
                                    <label><input type="checkbox" checked={b.ignoreFirstCard} onChange={e => handleUpdateBlockProp(b.id, 'ignoreFirstCard', e.target.checked)} /> Ignore First Card</label>
                                    <label><input type="checkbox" checked={b.displayFirstCardDescription} onChange={e => handleUpdateBlockProp(b.id, 'displayFirstCardDescription', e.target.checked)} /> Show Desc</label>
                                    <label><input type="checkbox" checked={b.includeOnMap} onChange={e => handleUpdateBlockProp(b.id, 'includeOnMap', e.target.checked)} /> Show on Map</label>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* SECTION 5: MAP */}
                    <div className="admin-section">
                        <h3>5. Map view for {selectedBoard.name}</h3>
                        <div className="settings-row">
                            <label className="switch">
                                <input type="checkbox" checked={enableMapView} onChange={e => setEnableMapView(e.target.checked)} />
                                <span className="slider round"></span>
                            </label>
                            <span style={{ marginLeft: '10px' }}>Enable Map View</span>
                        </div>

                        {enableMapView && (
                            <div style={{ marginTop: '15px' }}>
                                <h4>Marker Variants</h4>
                                <div className="rules-list">
                                    {markerRules.map((rule, idx) => (
                                        <div key={rule.id} className="rule-item" style={{ display: 'flex', gap: '10px', alignItems: 'center', background: '#fff', padding: '5px', marginBottom: '5px', border: '1px solid #eee' }}>
                                            <strong>#{idx + 1}</strong>
                                            <select value={rule.labelId} onChange={e => handleUpdateRule(rule.id, 'labelId', e.target.value)}>
                                                <option value="">-- Label --</option>
                                                {boardLabels.map(l => <option key={l.id} value={l.id}>{l.name || l.color}</option>)}
                                            </select>
                                            <label><input type="radio" checked={rule.overrideType === 'color'} onChange={() => handleUpdateRule(rule.id, 'overrideType', 'color')} /> Color</label>
                                            <label><input type="radio" checked={rule.overrideType === 'icon'} onChange={() => handleUpdateRule(rule.id, 'overrideType', 'icon')} /> Icon</label>

                                            {rule.overrideType === 'color' ?
                                                <ColorPicker selectedColor={rule.overrideValue} onChange={v => handleUpdateRule(rule.id, 'overrideValue', v)} /> :
                                                <IconPicker selectedIcon={rule.overrideValue} onChange={v => handleUpdateRule(rule.id, 'overrideValue', v)} />
                                            }

                                            <div style={{ marginLeft: 'auto' }}>
                                                <button onClick={() => moveRule(idx, 'up')}>↑</button>
                                                <button onClick={() => moveRule(idx, 'down')}>↓</button>
                                                <button onClick={() => removeRule(rule.id)} style={{ color: 'red' }}>X</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <button onClick={handleAddRule} style={{ marginTop: '10px' }}>+ Add Rule</button>
                            </div>
                        )}
                    </div>
                </>
            )}

            {error && <div className="error">{error}</div>}

            <div className="actions-container">
                <button className="save-layout-button" onClick={handleSave}>Save Settings</button>
                <button className="button-secondary" onClick={onClose}>Cancel</button>
                <button className="button-secondary" onClick={() => setShowMoreOptions(true)}>More...</button>
            </div>

            {showMoreOptions && <MoreOptionsModal onClose={() => setShowMoreOptions(false)} onReset={handleClearBoardConfig} boardName={selectedBoard?.name} />}
        </div>
    );
};

export default SettingsScreen;
