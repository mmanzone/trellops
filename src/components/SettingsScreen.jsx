import React, { useState, useEffect } from 'react';
import { trelloFetch } from '/src/api/trello';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import MoreOptionsModal from './common/MoreOptionsModal';
import IconPicker from './common/IconPicker';
import ColorPicker from './common/ColorPicker';
import '/src/styles/settings.css';

const SettingsScreen = ({ user, onClose, onSave }) => {
    // --- State ---
    const [boards, setBoards] = useState([]); // Fetch internally
    const [selectedBoardId, setSelectedBoardId] = useState('');
    const [lists, setLists] = useState([]);
    const [loadingLists, setLoadingLists] = useState(false);
    const [boardLabels, setBoardLabels] = useState([]); // New: For Rules

    // Settings State
    const [blocks, setBlocks] = useState([]); // { id, name, listIds, includeOnMap, mapIcon, ... }
    const [enableMapView, setEnableMapView] = useState(true);
    const [mapGeocodeMode, setMapGeocodeMode] = useState('store');

    // New: Marker Rules
    const [markerRules, setMarkerRules] = useState([]);

    const [error, setError] = useState('');
    const [showMoreOptions, setShowMoreOptions] = useState(false);

    // Initial Load
    useEffect(() => {
        const loadInitialSettings = async () => {
            if (!user) return;
            try {
                // 1. Fetch Boards
                try {
                    const boardsData = await trelloFetch('/members/me/boards?fields=id,name,url', user.token);
                    setBoards(boardsData);
                } catch (e) {
                    console.warn("Failed to fetch boards", e);
                    setError("Failed to load boards.");
                    return;
                }

                const storedData = JSON.parse(localStorage.getItem('trelloUserData') || '{}');
                const userSettings = storedData[user.id]?.settings;

                if (userSettings?.boardId) {
                    setSelectedBoardId(userSettings.boardId);

                    // Load Blocks/Layout
                    const layoutKey = `TRELLO_DASHBOARD_LAYOUT_${userSettings.boardId}`;
                    const savedLayout = localStorage.getItem(layoutKey);
                    if (savedLayout) {
                        setBlocks(JSON.parse(savedLayout));
                    }

                    // Load Marker Rules
                    const rulesKey = `TRELLO_MARKER_RULES_${userSettings.boardId}`;
                    const savedRules = localStorage.getItem(rulesKey);
                    if (savedRules) {
                        setMarkerRules(JSON.parse(savedRules));
                    }

                    if (userSettings.enableMapView !== undefined) setEnableMapView(userSettings.enableMapView);
                    if (userSettings.mapGeocodeMode) setMapGeocodeMode(userSettings.mapGeocodeMode);

                    // Fetch Lists & Labels
                    await fetchBoardData(userSettings.boardId);
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
            // 1. Fetch Lists
            const listsData = await trelloFetch(`/boards/${boardId}/lists?cards=none&fields=id,name`, user.token);
            setLists(listsData);

            // 2. Fetch Labels
            const labelsData = await trelloFetch(`/boards/${boardId}/labels`, user.token);
            setBoardLabels(labelsData);

        } catch (e) {
            setError('Failed to load board lists/labels.');
        } finally {
            setLoadingLists(false);
        }
    };

    const handleBoardChange = async (e) => {
        const boardId = e.target.value;
        setSelectedBoardId(boardId);
        setBlocks([]);
        setMarkerRules([]); // Reset rules on board switch
        if (boardId) {
            await fetchBoardData(boardId);
        } else {
            setLists([]);
            setBoardLabels([]);
        }
    };

    // --- Block Management ---
    const handleAddBlock = () => {
        const newBlock = {
            id: `block-${Date.now()}`,
            name: 'New Block',
            listIds: [],
            expanded: true,
            includeOnMap: true,
            mapIcon: 'map-marker', // Default
            ignoreFirstCard: false
        };
        setBlocks([...blocks, newBlock]);
    };

    const handleUpdateBlock = (id, field, value) => {
        setBlocks(blocks.map(b => b.id === id ? { ...b, [field]: value } : b));
    };

    const handleRemoveBlock = (id) => {
        if (window.confirm("Delete this block configuration?")) {
            setBlocks(blocks.filter(b => b.id !== id));
        }
    };

    const handleDragEnd = (result) => {
        if (!result.destination) return;
        const items = Array.from(blocks);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);
        setBlocks(items);
    };

    // --- Marker Rules Management ---
    const handleAddRule = () => {
        const newRule = {
            id: `rule-${Date.now()}`,
            labelId: '',
            overrideType: 'color', // 'icon' or 'color'
            overrideValue: 'red' // default
        };
        setMarkerRules([...markerRules, newRule]);
    };

    const handleUpdateRule = (id, field, value) => {
        setMarkerRules(markerRules.map(r => r.id === id ? { ...r, [field]: value } : r));
    };

    const removeRule = (id) => {
        setMarkerRules(markerRules.filter(r => r.id !== id));
    };

    const moveRule = (index, direction) => {
        if (direction === 'up' && index > 0) {
            const newRules = [...markerRules];
            [newRules[index], newRules[index - 1]] = [newRules[index - 1], newRules[index]];
            setMarkerRules(newRules);
        } else if (direction === 'down' && index < markerRules.length - 1) {
            const newRules = [...markerRules];
            [newRules[index], newRules[index + 1]] = [newRules[index + 1], newRules[index]];
            setMarkerRules(newRules);
        }
    };

    // --- Save ---
    const handleSave = () => {
        if (!selectedBoardId) {
            setError("Please select a board.");
            return;
        }
        if (blocks.length === 0) {
            if (!window.confirm("No dashboard blocks defined. Are you sure?")) return;
        }

        const selectedBoard = boards.find(b => b.id === selectedBoardId);

        try {
            // 1. Save Layout
            const layoutKey = `TRELLO_DASHBOARD_LAYOUT_${selectedBoardId}`;
            localStorage.setItem(layoutKey, JSON.stringify(blocks));

            // 2. Save Rules
            const rulesKey = `TRELLO_MARKER_RULES_${selectedBoardId}`;
            const cleanRules = markerRules.filter(r => r.labelId); // Remove empty label rules
            localStorage.setItem(rulesKey, JSON.stringify(cleanRules));

            // 3. Save User Settings
            const storedData = JSON.parse(localStorage.getItem('trelloUserData') || '{}');
            storedData[user.id] = {
                ...storedData[user.id],
                settings: {
                    boardId: selectedBoardId,
                    boardName: selectedBoard ? selectedBoard.name : 'Trello Board',
                    enableMapView,
                    mapGeocodeMode
                }
            };
            localStorage.setItem('trelloUserData', JSON.stringify(storedData));

            onSave();
        } catch (e) {
            console.error("Save failed", e);
            setError("Failed to save settings.");
        }
    };

    // --- Data Import/Export Callbacks ---
    const handleExportConfig = () => {
        if (!selectedBoardId) return;
        const config = {
            boardId: selectedBoardId,
            blocks: blocks,
            markerRules: markerRules,
            enableMapView,
            mapGeocodeMode,
            version: 2 // Increment version for new schema
        };
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trello-dashboard-config-${selectedBoardId}.json`;
        a.click();
    };

    const handleImportConfig = (file) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const config = JSON.parse(e.target.result);
                if (config.boardId === selectedBoardId) {
                    if (config.blocks) setBlocks(config.blocks);
                    if (config.markerRules) setMarkerRules(config.markerRules);
                    if (config.enableMapView !== undefined) setEnableMapView(config.enableMapView);
                    if (config.mapGeocodeMode) setMapGeocodeMode(config.mapGeocodeMode);
                    alert("Configuration imported successfully! Click Save to apply.");
                } else {
                    alert("Warning: Config file is for a different board ID.");
                }
            } catch (err) {
                alert("Invalid config file.");
            }
        };
        reader.readAsText(file);
    };

    const handleClearBoardConfig = () => {
        if (window.confirm("Reset all settings for this board?")) {
            setBlocks([]);
            setMarkerRules([]);
            setEnableMapView(true);
            setMapGeocodeMode('store');
        }
    };


    const selectedBoard = boards.find(b => b.id === selectedBoardId);

    return (
        <div className="settings-container">
            <h2>Dashboard Settings</h2>

            <div className="settings-row">
                <label>Select Board:</label>
                <select value={selectedBoardId} onChange={handleBoardChange} className="board-select">
                    <option value="">-- Choose a Board --</option>
                    {boards.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
            </div>

            {selectedBoard && (
                <>
                    <div className="admin-section">
                        <h3>1. Blocks Configuration</h3>
                        <p style={{ marginTop: '-10px', fontSize: '0.9em', color: 'var(--text-secondary)' }}>
                            Configure how lists are grouped into dashboard blocks. Drag to reorder.
                        </p>

                        <DragDropContext onDragEnd={handleDragEnd}>
                            <Droppable droppableId="blocks-list">
                                {(provided) => (
                                    <div {...provided.droppableProps} ref={provided.innerRef} className="blocks-list">
                                        {blocks.map((block, index) => (
                                            <Draggable key={block.id} draggableId={block.id} index={index}>
                                                {(provided) => (
                                                    <div
                                                        ref={provided.innerRef}
                                                        {...provided.draggableProps}
                                                        className="block-config-item"
                                                        style={{ ...provided.draggableProps.style }}
                                                    >
                                                        <div className="block-header">
                                                            <div {...provided.dragHandleProps} className="drag-handle">::</div>
                                                            <input
                                                                type="text"
                                                                value={block.name}
                                                                onChange={(e) => handleUpdateBlock(block.id, 'name', e.target.value)}
                                                                placeholder="Block Name"
                                                                className="block-name-input"
                                                            />
                                                            <button className="remove-block-btn" onClick={() => handleRemoveBlock(block.id)}>✕</button>
                                                        </div>

                                                        {/* Lists Selection */}
                                                        <div className="block-lists-select">
                                                            <label>Lists in this block:</label>
                                                            <div className="lists-checkboxes">
                                                                {loadingLists ? <span>Loading...</span> : lists.map(list => (
                                                                    <label key={list.id} className="list-checkbox">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={block.listIds.includes(list.id)}
                                                                            onChange={(e) => {
                                                                                const newIds = e.target.checked
                                                                                    ? [...block.listIds, list.id]
                                                                                    : block.listIds.filter(id => id !== list.id);
                                                                                handleUpdateBlock(block.id, 'listIds', newIds);
                                                                            }}
                                                                        />
                                                                        {list.name}
                                                                    </label>
                                                                ))}
                                                            </div>

                                                            <div className="block-options" style={{ marginTop: '10px', padding: '10px', background: 'rgba(0,0,0,0.02)', borderRadius: '4px' }}>
                                                                <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9em', cursor: 'pointer' }}>
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={block.ignoreFirstCard}
                                                                            onChange={(e) => handleUpdateBlock(block.id, 'ignoreFirstCard', e.target.checked)}
                                                                        />
                                                                        Ignore 1st card (Header)
                                                                    </label>

                                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9em', cursor: 'pointer' }}>
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={block.includeOnMap !== false} // default true
                                                                            onChange={(e) => handleUpdateBlock(block.id, 'includeOnMap', e.target.checked)}
                                                                        />
                                                                        Show on Map
                                                                    </label>
                                                                </div>

                                                                {/* NEW: Block Icon Selector */}
                                                                {block.includeOnMap !== false && (
                                                                    <div style={{ marginTop: '10px' }}>
                                                                        <label style={{ fontSize: '0.9em', fontWeight: 'bold' }}>Map Marker Icon:</label>
                                                                        <IconPicker
                                                                            selectedIcon={block.mapIcon || 'map-marker'}
                                                                            onChange={(icon) => handleUpdateBlock(block.id, 'mapIcon', icon)}
                                                                            color="#555"
                                                                        />
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </Draggable>
                                        ))}
                                        {provided.placeholder}
                                    </div>
                                )}
                            </Droppable>
                        </DragDropContext>

                        <button className="add-block-button" onClick={handleAddBlock}>+ Add Block</button>
                    </div>

                    <div className="admin-section">
                        <h3>5. Map View for "{selectedBoard.name}"</h3>
                        <p style={{ marginTop: '-10px', fontSize: '0.9em', color: 'var(--text-secondary)' }}>
                            Map settings are saved per-board.
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
                                        <strong>Warning:</strong> Updates Trello card coordinates on Trello.
                                    </div>
                                )}

                                {/* NEW: Marker Variants (Rules) */}
                                <div style={{ marginTop: '25px', paddingTop: '15px', borderTop: '1px solid var(--border-color)' }}>
                                    <h4 style={{ marginBottom: '5px' }}>Marker Customization (Label Rules)</h4>
                                    <p style={{ fontSize: '0.9em', color: '#666', marginBottom: '15px' }}>
                                        Override marker colors or icons when a card has specific labels. Rules are applied in order (top to bottom).
                                    </p>

                                    <div className="rules-list">
                                        {markerRules.map((rule, idx) => {
                                            const labelInfo = boardLabels.find(l => l.id === rule.labelId);
                                            return (
                                                <div key={rule.id} className="rule-item" style={{
                                                    background: 'var(--bg-primary)',
                                                    border: '1px solid var(--border-color)',
                                                    padding: '12px',
                                                    borderRadius: '6px',
                                                    marginBottom: '10px',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '10px'
                                                }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <strong>Rule #{idx + 1}</strong>
                                                        <div style={{ display: 'flex', gap: '5px' }}>
                                                            <button onClick={() => moveRule(idx, 'up')} disabled={idx === 0} style={{ padding: '2px 6px' }}>↑</button>
                                                            <button onClick={() => moveRule(idx, 'down')} disabled={idx === markerRules.length - 1} style={{ padding: '2px 6px' }}>↓</button>
                                                            <button onClick={() => removeRule(rule.id)} style={{ marginLeft: '10px', color: 'red' }}>✕</button>
                                                        </div>
                                                    </div>

                                                    <div className="rule-config" style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'flex-start' }}>
                                                        <div style={{ flex: 1, minWidth: '200px' }}>
                                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.85em' }}>If Label is:</label>
                                                            <select
                                                                value={rule.labelId}
                                                                onChange={e => handleUpdateRule(rule.id, 'labelId', e.target.value)}
                                                                style={{ width: '100%', padding: '6px' }}
                                                            >
                                                                <option value="">-- Select Label --</option>
                                                                {boardLabels.map(l => (
                                                                    <option key={l.id} value={l.id}>
                                                                        {l.name ? l.name : `(${l.color} - No Name)`}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                            {/* Preview Label */}
                                                            {labelInfo && (
                                                                <div style={{ marginTop: '5px' }}>
                                                                    <span className={`trello-label trello-label-${labelInfo.color || 'light'}`} style={{ padding: '2px 6px', borderRadius: '3px', fontSize: '0.8em' }}>
                                                                        {labelInfo.name || labelInfo.color}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div style={{ flex: 1, minWidth: '200px' }}>
                                                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.85em' }}>Override:</label>
                                                            <div style={{ display: 'flex', gap: '15px', marginBottom: '8px' }}>
                                                                <label style={{ cursor: 'pointer' }}>
                                                                    <input type="radio" checked={rule.overrideType === 'color'} onChange={() => handleUpdateRule(rule.id, 'overrideType', 'color')} /> Color
                                                                </label>
                                                                <label style={{ cursor: 'pointer' }}>
                                                                    <input type="radio" checked={rule.overrideType === 'icon'} onChange={() => handleUpdateRule(rule.id, 'overrideType', 'icon')} /> Icon
                                                                </label>
                                                            </div>

                                                            {rule.overrideType === 'color' ? (
                                                                <ColorPicker
                                                                    selectedColor={rule.overrideValue}
                                                                    onChange={val => handleUpdateRule(rule.id, 'overrideValue', val)}
                                                                />
                                                            ) : (
                                                                <IconPicker
                                                                    selectedIcon={rule.overrideValue}
                                                                    onChange={val => handleUpdateRule(rule.id, 'overrideValue', val)}
                                                                />
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <button className="button-secondary" onClick={handleAddRule} style={{ marginTop: '10px' }}>
                                        + Add Marker Variant
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}

            {error && <div className="error">{error}</div>}

            <div className="actions-container">
                <button className="save-layout-button" onClick={handleSave}>
                    Save Settings
                </button>
                <button className="button-secondary" onClick={onClose}>
                    Cancel
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

// Helper for Toggle
const handleToggleEnableMapView = (val) => {
    // handled by state setter in component
};

export default SettingsScreen;
