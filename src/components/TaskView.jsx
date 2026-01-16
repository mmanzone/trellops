import React, { useState, useEffect, useMemo, useRef } from 'react';
import { fetchAllTasksData } from '../api/trello';
import { useDarkMode } from '../context/DarkModeContext';
import DigitalClock from './common/DigitalClock';
import '../styles/index.css';
import '../styles/index.css';
import '../styles/map.css';
import '../styles/map.css';
// import { formatCountdown } from '../utils/timeUtils'; // Removed
import { formatDynamicCountdown } from '../utils/helpers';
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
    const [sortBy, setSortBy] = useState('board'); // 'board', 'due'

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
            const rawOrg = orgMap.get(orgId);

            let finalOrgName = rawOrg?.displayName || rawOrg?.name || 'External Workspaces';
            let finalOrgId = rawOrg?.id || 'external_combined';

            // Force grouping for all "External" (missing org) items
            if (finalOrgName === 'External Workspaces') {
                finalOrgId = 'external_combined';
            }

            // SETTINGS FILTER
            // For external_combined, we check if the original orgId (if any) or the new ID is enabled?
            // If the user's settings didn't capture 'external_combined' yet, they might disappear.
            // But 'taskViewWorkspaces' usually contains IDs.
            // If the user hasn't selected 'external_combined' explicitly, it might hide.
            // However, "No Workspace" items previously had 'unknown'.
            // Let's assume for now we allow them if strict filtering isn't blocking 'external_combined'.
            // Actually, better to skip this filter if it's external, OR ensure 'external_combined' is in the default list.
            // For now, let's proceed with standard logic:
            if (taskViewWorkspaces.length > 0 && finalOrgId !== 'external_combined' && !taskViewWorkspaces.includes(orgId)) {
                return;
            }

            const baseProps = {
                cardId: card.id,
                cardName: card.name,
                cardUrl: card.url,
                boardId: card.idBoard,
                boardName: board?.name || 'Unknown Board',
                orgId: finalOrgId,
                orgName: finalOrgName,
                isCompleted: card.dueComplete || false,
                due: card.due,
                labels: card.labels || []
            };

            // 1. Identify User's Assigned Checklist Items
            const myChecklistItems = [];
            if (card.checklists && card.checklists.length > 0) {
                card.checklists.forEach(cl => {
                    cl.checkItems.forEach(ci => {
                        const assignedToMe = (ci.idMember && ci.idMember === user.id) || (ci.idMembers && ci.idMembers.includes(user.id));
                        if (assignedToMe) {
                            myChecklistItems.push({
                                id: ci.id,
                                name: ci.name,
                                state: ci.state,
                                due: ci.due
                            });
                        }
                    });
                });
            }

            // 2. Identify Card Membership
            const isMember = card.idMembers && card.idMembers.includes(user.id);

            // 3. Visibility Logic
            // - Member: Show Card
            // - Not Member but Assigned Items: Show Card (as context) + Items
            // - Member AND Assigned Items: Show Card + Indented Items
            if (isMember || myChecklistItems.length > 0) {
                tasks.push({
                    ...baseProps,
                    // We treat the "Principal" task as the card itself.
                    // If strict "Assigned Only" filter is on, we might need adjustments,
                    // but usually "Assigned" means "I have work here".
                    type: 'card',
                    isMember: isMember,
                    checkItems: myChecklistItems
                });
            }
        });

        return tasks;
    }, [data, user.id, taskViewWorkspaces]);

    // --- Filtering & Sorting ---
    const displayedTasks = useMemo(() => {
        let result = processedTasks;

        // 1. Filter Type (Assignments vs Membership)
        if (!filterAssigned && !filterMember) return [];

        result = result.filter(t => {
            // If I want assigned tasks: Include if I have assigned items (regardless of membership)
            // If I want membership tasks: Include if I am member (regardless of items)

            // Logic:
            // - filterAssigned=T, filterMember=T -> Show All (Member OR Assigned)
            // - filterAssigned=T, filterMember=F -> Show only if t.checkItems.length > 0
            // - filterAssigned=F, filterMember=T -> Show only if t.isMember

            const hasAssignments = t.checkItems.length > 0;
            const isMember = t.isMember;

            if (filterAssigned && filterMember) return hasAssignments || isMember;
            if (filterAssigned) return hasAssignments;
            if (filterMember) return isMember;
            return false;
        });

        // 2. Filter Workspace
        if (selectedWorkspaceIds && selectedWorkspaceIds.size > 0) {
            result = result.filter(t => selectedWorkspaceIds.has(t.orgId));
        }

        // 3. Filter Board
        if (selectedBoardIds && selectedBoardIds.size > 0) {
            result = result.filter(t => selectedBoardIds.has(t.boardId));
        }

        // 4. Filter Completed
        if (!filterComplete) {
            // Hide if Card is complete AND (All assigned items are complete OR no items)
            result = result.filter(t => {
                const cardDone = t.isCompleted;
                const allItemsDone = t.checkItems.length === 0 || t.checkItems.every(i => i.state === 'complete');
                return !(cardDone && allItemsDone);
            });
        }

        const safeStr = (s) => s || '';

        // 5. Sorting
        result.sort((a, b) => {
            if (sortBy === 'due') {
                if (!a.due) return 1;
                if (!b.due) return -1;
                return new Date(a.due) - new Date(b.due);
            }

            // Primary Sort: Organization (Pinned "External Combined" to bottom)
            const isExtA = a.orgId === 'external_combined';
            const isExtB = b.orgId === 'external_combined';

            if (isExtA && !isExtB) return 1; // A (external) goes AFTER B
            if (!isExtA && isExtB) return -1; // A (normal) goes BEFORE B

            // If same group (both external or both normal), sort by Org Name then Board Name
            const orgCompare = safeStr(a.orgName).localeCompare(safeStr(b.orgName));
            if (orgCompare !== 0) return orgCompare;

            // Secondary Sort: Board Name
            return safeStr(a.boardName).localeCompare(safeStr(b.boardName)) || safeStr(a.cardName).localeCompare(safeStr(b.cardName));
        });

        return result;
    }, [processedTasks, filterAssigned, filterMember, filterComplete, selectedWorkspaceIds, selectedBoardIds, sortBy]);


    // --- Grouping for "All" View ---
    const groupedData = useMemo(() => {
        const groups = {}; // Map<orgId, { name, boards: Map<boardId, { name, tasks: [] }> }>
        // We want to process them in the Sorted Order defined by displayedTasks
        // displayedTasks is already sorted by User/External -> Org Name -> Board Name.
        // So iterating it linearly preserves order.

        displayedTasks.forEach(task => {
            if (!groups[task.orgId]) {
                groups[task.orgId] = {
                    name: task.orgName,
                    boards: {} // Insert order might not be preserved in object keys, but often is in modern JS. 
                    // For safety, we can rely on Object.entries later sorting automatically? 
                    // Actually, displayedTasks loop order determines insertion order.
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

    // Helper helper for safe sorting in render
    const safeSort = (a, b) => (a.name || '').localeCompare(b.name || '');

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
                                .sort(safeSort)
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
                                .sort(safeSort)
                            }
                            selectedIds={selectedBoardIds}
                            onChange={setSelectedBoardIds}
                        />

                        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.9em', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
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
                                <input type="checkbox" checked={filterComplete} onChange={e => setFilterComplete(e.target.checked)} style={{ marginRight: '4px' }} /> Completed
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

                            {/* Layout Updated: Grid of Boards, Vertical List of Tasks per Board */}
                            <div className="boards-grid" style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
                                gap: '30px',
                                alignItems: 'start'
                            }}>
                                {Object.entries(orgData.boards).map(([boardId, boardData]) => (
                                    <div key={boardId} className="board-card" style={{
                                        background: 'var(--bg-secondary)',
                                        borderRadius: '8px',
                                        padding: '15px',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        maxHeight: '600px'
                                    }}>
                                        <h3 style={{ marginTop: 0, fontSize: '1.1em', marginBottom: '15px', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color, #eee)', paddingBottom: '8px' }}>
                                            {boardData.name} <span style={{ fontSize: '0.8em', fontWeight: 'normal', color: 'var(--text-secondary)' }}>({boardData.tasks.length})</span>
                                        </h3>

                                        <div className="tasks-list-vertical" style={{
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '15px',
                                            overflowY: 'auto',
                                            paddingRight: '5px' // Space for scrollbar
                                        }}>
                                            {boardData.tasks.map(task => (
                                                <div key={task.type === 'card' ? `card-${task.cardId}` : task.id} className="task-card" style={{
                                                    background: 'var(--bg-primary)',
                                                    padding: '12px',
                                                    borderRadius: '6px',
                                                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                                                    borderLeft: task.checkItems && task.checkItems.length > 0 ? '4px solid #0079bf' : '4px solid #ff9f1a', // Blue for items, Orange for just card
                                                    color: 'var(--text-primary)',
                                                    display: 'flex',
                                                    flexDirection: 'column'
                                                }}>
                                                    {/* Card Header (The "Card" itself) */}
                                                    <div style={{ marginBottom: '8px' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                            <a href={task.cardUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'var(--text-primary)', fontWeight: '600', fontSize: '1em', lineHeight: '1.3', wordBreak: 'break-word' }}>
                                                                {task.cardName}
                                                            </a>
                                                            {task.isMember && (
                                                                <span title="You are a member of this card" style={{ fontSize: '0.9em', marginLeft: '5px', opacity: 0.7 }}>👤</span>
                                                            )}
                                                        </div>

                                                        {/* Labels */}
                                                        {task.labels && task.labels.length > 0 && (
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
                                                                {task.labels.map(l => (
                                                                    <span key={l.id} style={{
                                                                        fontSize: '0.7em',
                                                                        padding: '2px 6px',
                                                                        borderRadius: '3px',
                                                                        backgroundColor: l.color ? getLabelColor(l.color) : '#ccc',
                                                                        color: l.color ? '#fff' : '#000',
                                                                        fontWeight: '500'
                                                                    }}>
                                                                        {l.name}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {/* Card Due Date */}
                                                        {task.due && (
                                                            <div style={{
                                                                fontSize: '0.85em',
                                                                marginTop: '8px',
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

                                                    {/* Checklist Items (Indented) */}
                                                    {task.checkItems && task.checkItems.length > 0 && (
                                                        <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid var(--border-color, #eee)' }}>
                                                            <div style={{ fontSize: '0.75em', color: 'var(--text-secondary)', marginBottom: '5px', textTransform: 'uppercase', fontWeight: 'bold' }}>Your Tasks:</div>
                                                            {task.checkItems.map(item => (
                                                                <div key={item.id} style={{
                                                                    display: 'flex',
                                                                    alignItems: 'flex-start',
                                                                    padding: '4px 0',
                                                                    paddingLeft: '10px', // INDENTATION
                                                                    borderLeft: '2px solid #ddd',
                                                                    fontSize: '0.9em',
                                                                    marginBottom: '4px'
                                                                }}>
                                                                    <div style={{
                                                                        width: '16px',
                                                                        height: '16px',
                                                                        borderRadius: '3px',
                                                                        border: '1px solid #ccc',
                                                                        marginRight: '8px',
                                                                        marginTop: '2px', // Align with text top
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        justifyContent: 'center',
                                                                        background: item.state === 'complete' ? '#5ba4cf' : 'transparent',
                                                                        flexShrink: 0
                                                                    }}>
                                                                        {item.state === 'complete' && <span style={{ color: 'white', fontSize: '11px' }}>✓</span>}
                                                                    </div>
                                                                    <span style={{
                                                                        color: item.state === 'complete' ? '#888' : 'var(--text-primary)',
                                                                        textDecoration: item.state === 'complete' ? 'line-through' : 'none',
                                                                        lineHeight: '1.4'
                                                                    }}>
                                                                        {item.name}
                                                                    </span>
                                                                </div>
                                                            ))}
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
                    <button className="button-secondary" onClick={() => {
                        const minutes = refreshIntervalSetting.unit === 'hours' ? refreshIntervalSetting.value * 60 : refreshIntervalSetting.value;
                        const totalSeconds = Math.max(60, minutes * 60);
                        setRefreshCountdown(totalSeconds);
                        loadData(true);
                    }}>
                        Refresh {formatDynamicCountdown(refreshCountdown)}
                    </button>

                    {/* DASHBOARD BUTTON WITH DROPDOWN */}
                    <div style={{ position: 'relative' }}>
                        <div style={{ display: 'flex' }}>
                            <button className="button-secondary" onClick={() => onMainView ? onMainView() : onClose()}>
                                Dashboard and Map View
                            </button>
                            <button className="button-secondary dropdown-arrow" style={{ marginLeft: '-1px', padding: '0 5px', borderLeft: 'none' }} onClick={() => setShowDashboardDropdown(!showDashboardDropdown)}>
                                ▼
                            </button>
                        </div>
                        {showDashboardDropdown && (
                            <div className="context-menu" style={{ position: 'absolute', bottom: '100%', left: 0, background: 'var(--bg-primary)', border: '1px solid #ccc', borderRadius: '4px', padding: '5px', minWidth: '150px' }}>
                                <div className="menu-item" onClick={() => { window.open('/dashboard', '_blank'); setShowDashboardDropdown(false); }}>Open in New Tab</div>
                            </div>
                        )}
                    </div>

                    {/* MAP VIEW BUTTON REMOVED */}


                    <button className="button-secondary" onClick={onShowSettings}>
                        Settings
                    </button>
                    <button className="button-secondary" onClick={onLogout}>
                        Logout
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

// Helper for label colors
const getLabelColor = (colorName) => {
    const colors = {
        green: '#61bd4f',
        yellow: '#f2d600',
        orange: '#ff9f1a',
        red: '#eb5a46',
        purple: '#c377e0',
        blue: '#0079bf',
        sky: '#00c2e0',
        lime: '#51e898',
        pink: '#ff78cb',
        black: '#344563',
        none: '#b3bac5'
    };
    return colors[colorName] || '#b3bac5';
};

// Generic Multi-Select Component (Internal)
const MultiSelectFilter = ({ label, options, selectedIds, onChange }) => {
    const { theme } = useDarkMode();
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
