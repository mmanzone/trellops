import React, { useState, useEffect, useMemo, useRef } from 'react';
import { ChevronDown, Clock, Check, UserRound } from 'lucide-react';
import { fetchAllTasksData } from '../api/trello';
import DigitalClock from './common/DigitalClock';
import LabelFilter from './common/LabelFilter';
import '../styles/index.css';
import '../styles/map.css';
import { formatDynamicCountdown } from '../utils/helpers';
import HamburgerMenu from './common/HamburgerMenu';
import { ThemeToggleButton, ScreenLockButton, PageTitle } from './common/HeaderControls';

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
                <PageTitle>Tasks for {user.fullName || user.username}</PageTitle>

                <div className="map-header-actions" style={{ flexGrow: 1, justifyContent: 'flex-end', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    {/* FILTERS - visible/shrinkable */}
                    <div className="header-filters" style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'nowrap', flexShrink: 1 }}>
                        <MultiSelectFilter
                            label="Workspace"
                            options={Array.from(new Set(processedTasks.map(t => t.orgId))).map(orgId => ({ id: orgId, name: processedTasks.find(t => t.orgId === orgId)?.orgName || 'Unknown' })).sort(safeSort)}
                            selectedIds={selectedWorkspaceIds}
                            onChange={(ids) => { setSelectedWorkspaceIds(ids); setSelectedBoardIds(null); }}
                        />

                        <MultiSelectFilter
                            label="Boards"
                            options={Array.from(new Set(processedTasks.filter(t => selectedWorkspaceIds === null || selectedWorkspaceIds.has(t.orgId)).map(t => t.boardId))).map(boardId => ({ id: boardId, name: processedTasks.find(t => t.boardId === boardId)?.boardName || 'Unknown' })).sort(safeSort)}
                            selectedIds={selectedBoardIds}
                            onChange={setSelectedBoardIds}
                        />

                        <select
                            value={sortBy}
                            onChange={e => setSortBy(e.target.value)}
                            className="time-filter-select" // Reuse for shrinking
                        >
                            <option value="board">Sort: Board</option>
                            <option value="due">Sort: Due</option>
                        </select>

                        {/* Checkboxes - hide on very small screens? or wrap? */}
                        <div className="desktop-only chip-group">
                            <label className={`chip-toggle${filterAssigned ? ' is-on' : ''}`}><input type="checkbox" checked={filterAssigned} onChange={e => setFilterAssigned(e.target.checked)} /> Assigned to me</label>
                            <label className={`chip-toggle${filterMember ? ' is-on' : ''}`}><input type="checkbox" checked={filterMember} onChange={e => setFilterMember(e.target.checked)} /> Member of</label>
                            <label className={`chip-toggle${filterComplete ? ' is-on' : ''}`}><input type="checkbox" checked={filterComplete} onChange={e => setFilterComplete(e.target.checked)} /> Done</label>
                        </div>
                    </div>

                    <div className="desktop-only">
                        <ThemeToggleButton style={{ marginLeft: '10px' }} />
                    </div>

                    {/* MOBILE HAMBURGER MENU */}
                    <div className="mobile-only" style={{ marginLeft: '5px' }}>
                        <HamburgerMenu>
                            {/* Section 1: Filters (Moved before Actions) */}
                            <div className="hamburger-section" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', marginBottom: '15px' }}>
                                <strong>Filters</strong>
                                {/* LabelFilter removed on mobile as requested */}

                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px', padding: '0 10px', width: '100%', boxSizing: 'border-box' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '0.9em', width: '100%' }}>
                                        <input type="checkbox" checked={filterAssigned} onChange={e => setFilterAssigned(e.target.checked)} style={{ marginRight: '10px', transform: 'scale(1.2)' }} />
                                        Assigned to Me
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '0.9em', width: '100%' }}>
                                        <input type="checkbox" checked={filterMember} onChange={e => setFilterMember(e.target.checked)} style={{ marginRight: '10px', transform: 'scale(1.2)' }} />
                                        Member
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '0.9em', width: '100%' }}>
                                        <input type="checkbox" checked={filterComplete} onChange={e => setFilterComplete(e.target.checked)} style={{ marginRight: '10px', transform: 'scale(1.2)' }} />
                                        Show Completed
                                    </label>
                                </div>
                            </div>

                            {/* Section 2: Actions */}
                            <div className="hamburger-section">
                                <strong>Actions</strong>
                                <button className="menu-link" onClick={() => onMainView ? onMainView() : onClose()}>
                                    Dashboard View
                                </button>

                                <button className="menu-link" onClick={onShowSettings}>
                                    Settings
                                </button>

                                <button className="menu-link" onClick={onLogout}>
                                    Log Out
                                </button>
                            </div>

                            {/* Theme Toggle at Bottom */}
                            <div className="hamburger-section" style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
                                <ThemeToggleButton />
                            </div>
                        </HamburgerMenu>
                    </div>
                </div>
            </div>

            {/* CONTENT */}
            <div className="task-content">
                {/* ... content ... */}
                {Object.keys(groupedData).length === 0 ? (
                    <div className="empty-state">No tasks found matching filters.</div>
                ) : (
                    Object.entries(groupedData).map(([orgId, orgData]) => (
                        <div key={orgId} className="workspace-section">
                            <h2 className="workspace-title">{orgData.name}</h2>
                            {/* ... */}
                            <div className="boards-grid">
                                {Object.entries(orgData.boards).map(([boardId, boardData]) => (
                                    <div key={boardId} className="board-card">
                                        <h3 className="board-card-title">
                                            {boardData.name} <span className="board-card-count">{boardData.tasks.length}</span>
                                        </h3>
                                        <div className="tasks-list-vertical">
                                            {boardData.tasks.map(task => (
                                                <div key={task.type === 'card' ? `card-${task.cardId}` : task.id} className={`task-card ${task.checkItems && task.checkItems.length > 0 ? 'task-card-checklist' : 'task-card-member'}`}>
                                                    {/* Card details */}
                                                    <div style={{ marginBottom: '8px' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                            <a href={task.cardUrl} target="_blank" rel="noopener noreferrer" className="task-card-name">{task.cardName}</a>
                                                            {task.isMember && <span title="Member" className="task-card-member-icon"><UserRound size={15} aria-label="Member" /></span>}
                                                        </div>
                                                        {task.labels && task.labels.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>{task.labels.map(l => <span key={l.id} className="task-label" style={{ backgroundColor: l.color ? getLabelColor(l.color) : '#b3bac5', color: l.color ? '#fff' : '#15171c' }}>{l.name}</span>)}</div>}
                                                        {task.due && <div className={`task-due${new Date(task.due) < new Date() && !task.isCompleted ? ' is-overdue' : ''}`}><Clock size={14} aria-hidden="true" />{new Date(task.due).toLocaleDateString()} {new Date(task.due).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {task.isCompleted && <span className="task-done"><Check size={14} aria-hidden="true" /> Done</span>}</div>}
                                                    </div>
                                                    {task.checkItems && task.checkItems.length > 0 && <div className="task-checklist"><div className="task-checklist-title">Your Tasks</div>{task.checkItems.map(item => <div key={item.id} className={`task-check-item${item.state === 'complete' ? ' is-complete' : ''}`}><span className="task-check-box">{item.state === 'complete' && <Check size={12} strokeWidth={3} aria-hidden="true" />}</span><span className="task-check-text">{item.name}</span></div>)}</div>}
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

            {/* FOOTER */}
            <div className="map-footer">
                <div className="map-footer-left"></div>
                <div className="map-footer-right" style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    <button className="button-secondary" onClick={() => { setRefreshCountdown(60); loadData(true); }}>
                        Refresh {formatDynamicCountdown(refreshCountdown)}
                    </button>

                    <div className="desktop-only" style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                        <div style={{ position: 'relative' }}>
                            <div className="split-button">
                                <button className="button-secondary" onClick={() => onMainView ? onMainView() : onClose()}>Dashboard View</button>
                                <button className="button-secondary dropdown-arrow" aria-label="More options" onClick={() => setShowDashboardDropdown(!showDashboardDropdown)}><ChevronDown size={16} /></button>
                            </div>
                            {showDashboardDropdown && <div className="context-menu"><div className="menu-item" onClick={() => { window.open('/dashboard', '_blank'); setShowDashboardDropdown(false); }}>Open in New Tab</div></div>}
                        </div>
                        <button className="button-secondary" onClick={onShowSettings}>Settings</button>
                        <button className="button-secondary" onClick={onLogout}>Log Out</button>
                    </div>
                </div>
            </div>
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
const MultiSelectFilter = ({ label, options, selectedIds, onChange, className }) => {
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
            onChange(newSet);
        }
    };

    const hasSelection = !isAll && selectedIds.size > 0;

    return (
        <div className={`filter-dropdown${className ? ' ' + className : ''}`} ref={dropdownRef}>
            <button
                type="button"
                className={`filter-trigger${isOpen ? ' is-open' : ''}${hasSelection ? ' is-filtered' : ''}`}
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                aria-haspopup="true"
            >
                <span className="filter-trigger-label">{label}</span>
                {hasSelection && <span className="count-badge">{selectedIds.size}</span>}
                <ChevronDown size={16} className="filter-trigger-chevron" aria-hidden="true" />
            </button>

            {isOpen && (
                <div className="filter-popover" style={{ minWidth: '220px', maxHeight: '400px' }}>
                    <div className="filter-popover-head">
                        <span>{label}</span>
                        <div className="filter-popover-links">
                            <button type="button" className="link-button" onClick={() => onChange(null)}>All</button>
                            <button type="button" className="link-button link-button-muted" onClick={() => onChange(new Set())}>None</button>
                        </div>
                    </div>
                    <div className="filter-popover-list">
                        {options.map(opt => {
                            const isChecked = isAll || selectedIds.has(opt.id);
                            return (
                                <label key={opt.id} className="filter-option">
                                    <input type="checkbox" checked={isChecked} onChange={() => toggleOption(opt.id)} />
                                    <span className="filter-option-text">{opt.name}</span>
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
