import React, { useState, useEffect, useMemo, useRef } from 'react';
import { fetchAllTasksData } from '../api/trello';
import { useDarkMode } from '../context/DarkModeContext';
import DigitalClock from './common/DigitalClock';
import '../styles/index.css';
import '../styles/index.css';
import '../styles/map.css';
import { formatCountdown } from '../utils/timeUtils';
import LabelFilter from './common/LabelFilter'; // Reusing for generic multi-select? No, implies "Labels". 
// We should create a generic MultiSelectDropdown or copy logic.
// Let's create a generic "MultiSelectFilter" inside TaskView or common.
// For now, I'll define a local MultiSelect component or reuse LabelFilter logic inline? 
// Better: Generic MultiSelect. but I'll make it local to save steps or just custom UI in header.

// SVG Icons for Map Header style compatibility if needed
// Assuming they are available via CSS or we use emojis as placeholders for now to match MapView
// MapView uses specific SVG classes. TaskView should match standard dashboard style requested to MATCH Map View.
// MapView Header: <div className="map-header">...</div>

const TaskView = ({ user, settings, onClose, onShowSettings, onLogout, onShowMap, onMainView }) => {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState({ orgs: [], boards: [], cards: [] });
    const [error, setError] = useState('');
    const [refreshCountdown, setRefreshCountdown] = useState(null);

    // Footer Dropdowns
    const [showDashboardDropdown, setShowDashboardDropdown] = useState(false);
    const [showMapDropdown, setShowMapDropdown] = useState(false);

    // Filters
    // Filters (Multi-select)
    const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState(null); // null = All
    const [selectedBoardIds, setSelectedBoardIds] = useState(null); // null = All
    const [filterAssigned, setFilterAssigned] = useState(true);
    const [filterMember, setFilterMember] = useState(true);
    const [filterComplete, setFilterComplete] = useState(false);

    // Sort
    const [sortBy, setSortBy] = useState('workspace'); // 'workspace', 'board', 'due'

    // Theme
    const { theme, toggleTheme } = useDarkMode();

    // Settings
    const taskViewWorkspaces = settings?.taskViewWorkspaces || [];
    const refreshIntervalSetting = settings?.taskViewRefreshInterval || { value: 5, unit: 'minutes' };

    const intervalRef = useRef(null);
    const countdownRef = useRef(null);

    useEffect(() => {
        loadData();
    }, [user]); // Initial load

    // Auto-Refresh Logic
    useEffect(() => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (countdownRef.current) clearInterval(countdownRef.current);

        const minutes = refreshIntervalSetting.unit === 'hours' ? refreshIntervalSetting.value * 60 : refreshIntervalSetting.value;
        const totalSeconds = Math.max(60, minutes * 60);

        setRefreshCountdown(totalSeconds);

        countdownRef.current = setInterval(() => {
            setRefreshCountdown(prev => {
                if (prev <= 1) return totalSeconds;
                return prev - 1;
            });
        }, 1000);

        intervalRef.current = setInterval(() => {
            loadData(true);
            setRefreshCountdown(totalSeconds);
        }, totalSeconds * 1000);

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (countdownRef.current) clearInterval(countdownRef.current);
        }
    }, [refreshIntervalSetting.value, refreshIntervalSetting.unit]);


    const loadData = async (isRefresh = false) => {
        if (!isRefresh) setLoading(true);
        try {
            const result = await fetchAllTasksData(user.token);
            setData(result);
        } catch (e) {
            console.error(e);
            if (!isRefresh) setError("Failed to load tasks. Please try again.");
        } finally {
            if (!isRefresh) setLoading(false);
        }
    };

    // --- Data Processing ---
    const processedTasks = useMemo(() => {
        if (!data.cards.length) return [];

        let tasks = [];

        const orgMap = new Map(data.orgs.map(o => [o.id, o]));
        const boardMap = new Map(data.boards.map(b => [b.id, b]));

        data.cards.forEach(card => {
            const board = boardMap.get(card.idBoard);
            const orgId = board?.idOrganization;
            const org = orgMap.get(orgId) || { id: 'unknown', displayName: 'No Workspace', name: 'Unknown' };

            // SETTINGS FILTER (Global "Task View Workspaces")
            // This is "What workspaces to INCLUDE in the VIEW context".
            if (taskViewWorkspaces.length > 0 && orgId && !taskViewWorkspaces.includes(orgId)) {
                return;
            }

            const baseProps = {
                cardId: card.id,
                cardName: card.name,
                cardUrl: card.url,
                boardId: card.idBoard,
                boardName: board?.name || 'Unknown Board',
                orgId: org.id,
                orgName: org.displayName || org.name,
                isCompleted: card.dueComplete || false
            };

            // 1. Checklist Items Assigned to Me
            // Logic: iterate checklists. If checkItem.idMember == user.id OR checkItem.idMembers includes user.id
            if (card.checklists && card.checklists.length > 0) {
                card.checklists.forEach(cl => {
                    cl.checkItems.forEach(ci => {
                        // Support both idMember (old/singular) and idMembers (new/plural)
                        const assignedToMe = (ci.idMember && ci.idMember === user.id) || (ci.idMembers && ci.idMembers.includes(user.id));

                        if (assignedToMe) {
                            tasks.push({
                                ...baseProps,
                                id: ci.id,
                                type: 'checklist_item',
                                name: ci.name,
                                due: ci.due || card.due, // Checklist item due or Card due? Usually item due.
                                isCompleted: ci.state === 'complete'
                            });
                        }
                    });
                });
            }

            // 2. Card Membership
            // We want to avoid duplicates if I am BOTH assigned a task AND on the card? 
            // Usually separate. "Assigned Task" is granular. "Card Member" is general.
            // Let's keep both, but maybe user wants distinct lists.
            // If I filter 'Assigned Tasks', I see checklist items.
            // If I filter 'Card Member', I see cards I am on.
            // If I am on card, I see it as 'Card Member'.

            // Check if user is actually member of card (not just implicit via checklist)
            // members/me/cards ensures membership usually.
            tasks.push({
                ...baseProps,
                id: card.id,
                type: 'card_member',
                name: card.name,
                due: card.due,
                isCompleted: card.dueComplete
            });
        });



        // Debug log for missing items
        // console.log("Processed Tasks Count:", tasks.length);

        return tasks;
    }, [data, user.id, taskViewWorkspaces]);

    // --- Filtering & Sorting ---
    const displayedTasks = useMemo(() => {
        let result = processedTasks;

        // 1. Filter Type
        if (!filterAssigned && !filterMember) return [];
        if (!filterAssigned) result = result.filter(t => t.type !== 'checklist_item');
        if (!filterMember) result = result.filter(t => t.type !== 'card_member');

        // 2. Filter Status
        if (!filterComplete) {
            result = result.filter(t => !t.isCompleted);
        }

        // 3. Filter Workspace (Multi-select)
        if (selectedWorkspaceIds !== null && selectedWorkspaceIds.size > 0) {
            result = result.filter(t => selectedWorkspaceIds.has(t.orgId));
        }

        // 4. Filter Board (Multi-select)
        if (selectedBoardIds !== null && selectedBoardIds.size > 0) {
            result = result.filter(t => {
                // If I filtered WOrkspaces, I only see boards from those workspaces anyway?
                // But if I want specific boards.
                return selectedBoardIds.has(t.boardId);
            });
        }

        // 5. Sorting
        result.sort((a, b) => {
            if (sortBy === 'due') {
                if (!a.due) return 1;
                if (!b.due) return -1;
                return new Date(a.due) - new Date(b.due);
            }
            if (sortBy === 'board') {
                return a.boardName.localeCompare(b.boardName) || a.name.localeCompare(b.name);
            }
            // Default Workspace
            return a.orgName.localeCompare(b.orgName) || a.boardName.localeCompare(b.boardName);
        });

        return result;
    }, [processedTasks, filterAssigned, filterMember, filterComplete, selectedWorkspaceIds, selectedBoardIds, sortBy]);


    // --- Grouping for "All" View ---
    const groupedData = useMemo(() => {
        const groups = {};
        displayedTasks.forEach(task => {
            if (!groups[task.orgId]) {
                groups[task.orgId] = {
                    name: task.orgName,
                    boards: {}
                };
            }
            if (!groups[task.orgId].boards[task.boardId]) {
                groups[task.orgId].boards[task.boardId] = {
                    name: task.boardName,
                    tasks: []
                };
            }
            groups[task.orgId].boards[task.boardId].tasks.push(task);
        });
        return groups;
    }, [displayedTasks]);

    // Styling constants from MapView (approximate)
    const headerStyle = {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 20px',
        backgroundColor: 'var(--bg-secondary)', // Use variable or fallback
        borderBottom: '1px solid var(--border-color, #ccc)',
        height: '60px',
        boxSizing: 'border-box'
    };

    if (loading) return <div className="container" style={{ textAlign: 'center', marginTop: 50 }}>Loading Tasks...</div>;
    if (error) return <div className="container error">{error}</div>;

    return (
        <div className="map-container">
            {/* HEADER - Strict MapView Style */}
            <div className="map-header">
                <div className="map-header-title-area">
                    <h1>Tasks for {user.fullName || user.username}</h1>
                </div>

                <div className="map-header-actions" style={{ flexGrow: 1, justifyContent: 'flex-end', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {/* FILTERS */}
                    <div className="header-filters" style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {/* WORKSPACE MULTI-SELECT */}
                        <MultiSelectFilter
                            label="Workspaces"
                            options={Array.from(new Set(processedTasks.map(t => t.orgId)))
                                .map(orgId => ({
                                    id: orgId,
                                    name: processedTasks.find(t => t.orgId === orgId)?.orgName || 'Unknown'
                                }))
                                .sort((a, b) => a.name.localeCompare(b.name))
                            }
                            selectedIds={selectedWorkspaceIds}
                            onChange={(ids) => {
                                setSelectedWorkspaceIds(ids);
                                setSelectedBoardIds(null); // Reset boards when WS changes? Or keep? Reset is safer.
                            }}
                        />

                        {/* BOARD MULTI-SELECT (Filtered by Selected Workspaces) */}
                        <MultiSelectFilter
                            label="Boards"
                            options={Array.from(new Set(processedTasks
                                .filter(t => selectedWorkspaceIds === null || selectedWorkspaceIds.has(t.orgId))
                                .map(t => t.boardId)
                            ))
                                .map(boardId => ({
                                    id: boardId,
                                    name: processedTasks.find(t => t.boardId === boardId)?.boardName || 'Unknown'
                                }))
                                .sort((a, b) => a.name.localeCompare(b.name))
                            }
                            selectedIds={selectedBoardIds}
                            onChange={setSelectedBoardIds}
                        />

                        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.9em', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
                            <option value="workspace">Sort: Workspace</option>
                            <option value="board">Sort: Board</option>
                            <option value="due">Sort: Due Date</option>
                        </select>

                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', fontSize: '0.9em' }}>
                            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                                <input type="checkbox" checked={filterAssigned} onChange={e => setFilterAssigned(e.target.checked)} style={{ marginRight: '4px' }} /> Assigned
                            </label>
                            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                                <input type="checkbox" checked={filterMember} onChange={e => setFilterMember(e.target.checked)} style={{ marginRight: '4px' }} /> Member
                            </label>
                            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                                <input type="checkbox" checked={filterComplete} onChange={e => setFilterComplete(e.target.checked)} style={{ marginRight: '4px' }} /> Done
                            </label>
                        </div>
                    </div>

                    <button className="theme-toggle-button" onClick={() => toggleTheme()}>
                        {theme === 'dark' ? '☀️' : '🌙'}
                    </button>
                </div>
            </div>

            {/* CONTENT */}
            <div className="task-content" style={{ flex: 1, overflowY: 'auto', padding: '20px', paddingBottom: '80px', background: 'var(--bg-canvas)', position: 'relative', zIndex: 1 }}>
                {Object.keys(groupedData).length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#888', marginTop: '50px' }}>No tasks found matching filters.</div>
                ) : (
                    Object.entries(groupedData).map(([orgId, orgData]) => (
                        <div key={orgId} className="workspace-section" style={{ marginBottom: '40px' }}>
                            <h2 style={{ borderBottom: '2px solid var(--border-color, #ccc)', paddingBottom: '10px', marginBottom: '20px', color: 'var(--text-primary)' }}>{orgData.name}</h2>

                            <div className="boards-grid" style={{ display: 'flex', gap: '20px', overflowX: 'auto', paddingBottom: '15px' }}>
                                {Object.entries(orgData.boards).map(([boardId, boardData]) => (
                                    <div key={boardId} className="board-column" style={{
                                        minWidth: '300px',
                                        maxWidth: '300px',
                                        background: 'var(--bg-secondary)',
                                        borderRadius: '8px',
                                        padding: '10px',
                                        maxHeight: '600px',
                                        overflowY: 'auto',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                                    }}>
                                        <h3 style={{ marginTop: 0, fontSize: '1em', marginBottom: '15px', color: 'var(--text-primary)' }}>{boardData.name} <span style={{ fontSize: '0.8em', fontWeight: 'normal', color: 'var(--text-secondary)' }}>({boardData.tasks.length})</span></h3>

                                        <div className="tasks-list">
                                            {boardData.tasks.map(task => (
                                                <div key={`${task.type}-${task.id}`} className="task-card" style={{
                                                    background: 'var(--bg-primary)',
                                                    padding: '10px',
                                                    marginBottom: '8px',
                                                    borderRadius: '4px',
                                                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                                                    borderLeft: task.type === 'checklist_item' ? '4px solid #0079bf' : '4px solid #ff9f1a',
                                                    color: 'var(--text-primary)'
                                                }}>
                                                    <div style={{ fontSize: '0.7em', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '4px' }}>
                                                        {task.type === 'checklist_item' ? 'Checklist Item' : 'Card Member'}
                                                    </div>

                                                    <div style={{ marginBottom: '5px' }}>
                                                        <a href={task.cardUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'var(--text-primary)', fontWeight: '500' }}>
                                                            {task.name}
                                                        </a>
                                                        {task.type === 'checklist_item' && (
                                                            <div style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginTop: '2px' }}>on card: {task.cardName}</div>
                                                        )}
                                                    </div>

                                                    {task.due && (
                                                        <div style={{
                                                            fontSize: '0.8em',
                                                            marginTop: '5px',
                                                            color: new Date(task.due) < new Date() && !task.isCompleted ? '#eb5a46' : '#5ba4cf',
                                                            display: 'flex',
                                                            alignItems: 'center'
                                                        }}>
                                                            <span style={{ marginRight: '4px' }}>🕒</span>
                                                            {new Date(task.due).toLocaleDateString()} {new Date(task.due).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                            {task.isCompleted && <span style={{ marginLeft: '5px', color: 'green' }}>✓ Done</span>}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* FOOTER - Strict MapView Style */}
            <div className="map-footer">
                <div className="map-footer-left"></div>
                <div className="map-footer-right" style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    <span className="countdown" style={{ fontSize: '0.9em', color: 'var(--text-secondary)', marginRight: '10px' }}>
                        Next refresh in {formatCountdown(refreshCountdown)}
                    </span>

                    <button className="refresh-button" onClick={() => loadData(true)}>Refresh</button>

                    {/* DASHBOARD BUTTON WITH DROPDOWN */}
                    <div style={{ position: 'relative' }}>
                        <div style={{ display: 'flex' }}>
                            <button className="settings-button" onClick={() => onMainView ? onMainView() : onClose()}>
                                Dashboard View
                            </button>
                            <button className="settings-button dropdown-arrow" style={{ marginLeft: '-2px', padding: '0 5px' }} onClick={() => setShowDashboardDropdown(!showDashboardDropdown)}>
                                ▼
                            </button>
                        </div>
                        {showDashboardDropdown && (
                            <div className="context-menu" style={{ position: 'absolute', bottom: '100%', left: 0, background: 'var(--bg-primary)', border: '1px solid #ccc', borderRadius: '4px', padding: '5px', minWidth: '150px' }}>
                                <div className="menu-item" onClick={() => { window.open('/dashboard', '_blank'); setShowDashboardDropdown(false); }}>Open in New Tab</div>
                            </div>
                        )}
                    </div>

                    {/* MAP VIEW BUTTON */}
                    {settings?.enableMapView && (
                        <div style={{ position: 'relative' }}>
                            <div style={{ display: 'flex' }}>
                                <button className="settings-button" onClick={onShowMap}>
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


                    <button className="settings-button" onClick={onShowSettings}>
                        Settings
                    </button>
                    <button className="logout-button" onClick={onLogout}>
                        Log Out
                    </button>
                </div>
            </div>

            {/* Click Outside to Close Dropdowns */}
            {(showDashboardDropdown || showMapDropdown) && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={() => { setShowDashboardDropdown(false); setShowMapDropdown(false); }} />
            )}
        </div>
    );
};

// Generic Multi-Select Component (Internal)
const MultiSelectFilter = ({ label, options, selectedIds, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);
    const isAll = selectedIds === null || selectedIds === undefined;

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleOption = (id) => {
        if (isAll) {
            const allOtherIds = new Set(options.filter(o => o.id !== id).map(o => o.id));
            onChange(allOtherIds);
        } else {
            const newSet = new Set(selectedIds);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            // If newSet.size === options.length -> we could switch to null (All)?
            // Optional optimization.
            onChange(newSet);
        }
    };

    return (
        <div style={{ position: 'relative', display: 'inline-block' }} ref={dropdownRef}>
            <button
                className="settings-button"
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    fontSize: '0.9em',
                    backgroundColor: theme === 'dark' ? 'var(--bg-secondary)' : '#ffffff',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border-color)'
                }}
            >
                {label}
                {!isAll && selectedIds.size > 0 && (
                    <span style={{
                        background: 'var(--accent-color)',
                        color: 'white',
                        borderRadius: '10px',
                        padding: '0 6px',
                        fontSize: '0.8em'
                    }}>
                        {selectedIds.size}
                    </span>
                )}
                {!isAll && selectedIds.size === 0 && (
                    <span style={{ fontSize: '0.8em', color: 'var(--text-secondary)' }}>(None)</span>
                )}
                <span style={{ fontSize: '0.8em' }}>▼</span>
            </button>

            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: '5px',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    boxShadow: '0 4px 12px var(--shadow-color)',
                    zIndex: 1000,
                    width: '250px',
                    display: 'flex',
                    flexDirection: 'column',
                    maxHeight: '400px'
                }}>
                    <div style={{
                        padding: '8px',
                        borderBottom: '1px solid var(--border-color)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '0.85em',
                        fontWeight: 'bold',
                        color: 'var(--text-primary)'
                    }}>
                        <span>{label}</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => onChange(null)} style={{ background: 'transparent', border: 'none', color: 'var(--accent-color)', cursor: 'pointer', textDecoration: 'underline' }}>All</button>
                            <button onClick={() => onChange(new Set())} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', textDecoration: 'underline' }}>None</button>
                        </div>
                    </div>
                    <div style={{ overflowY: 'auto', padding: '8px', flex: 1 }}>
                        {options.map(opt => {
                            const isChecked = isAll || selectedIds.has(opt.id);
                            return (
                                <label key={opt.id} style={{ display: 'flex', alignItems: 'center', padding: '4px 0', cursor: 'pointer', color: 'var(--text-primary)', fontSize: '0.9em' }}>
                                    <input type="checkbox" checked={isChecked} onChange={() => toggleOption(opt.id)} style={{ marginRight: '8px' }} />
                                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt.name}</span>
                                </label>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default TaskView;
