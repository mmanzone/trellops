import React, { useState, useEffect, useMemo, useRef } from 'react';
import { fetchAllTasksData } from '../api/trello';
import { useDarkMode } from '../context/DarkModeContext';
import '../styles/index.css';

const TaskView = ({ user, settings, onClose, onShowSettings, onLogout, onShowTasks }) => {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState({ orgs: [], boards: [], cards: [] });
    const [error, setError] = useState('');
    const [refreshCountdown, setRefreshCountdown] = useState(null);

    // Filters
    const [selectedWorkspace, setSelectedWorkspace] = useState('all');
    const [selectedBoard, setSelectedBoard] = useState('all');
    const [filterAssigned, setFilterAssigned] = useState(true);
    const [filterMember, setFilterMember] = useState(true);
    const [filterComplete, setFilterComplete] = useState(false);

    // Sort
    const [sortBy, setSortBy] = useState('workspace'); // 'workspace', 'board', 'due'

    // Theme (using Context if available, mimicking Dashboard usage)
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
        // Clear existing
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (countdownRef.current) clearInterval(countdownRef.current);

        const minutes = refreshIntervalSetting.unit === 'hours' ? refreshIntervalSetting.value * 60 : refreshIntervalSetting.value;
        const totalSeconds = Math.max(60, minutes * 60); // Min 1 minute (60s)

        setRefreshCountdown(totalSeconds);

        // Countdown Timer
        countdownRef.current = setInterval(() => {
            setRefreshCountdown(prev => {
                if (prev <= 1) return totalSeconds; // Reset happens after fetch trigger usually, but let's sync
                return prev - 1;
            });
        }, 1000);

        // Fetch Interval
        intervalRef.current = setInterval(() => {
            loadData(true); // Is Refresh
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

        // Helper maps
        const orgMap = new Map(data.orgs.map(o => [o.id, o]));
        const boardMap = new Map(data.boards.map(b => [b.id, b]));

        data.cards.forEach(card => {
            const board = boardMap.get(card.idBoard);
            const orgId = board?.idOrganization;
            const org = orgMap.get(orgId) || { id: 'unknown', displayName: 'No Workspace', name: 'Unknown' };

            // SETTINGS FILTER: Filter by Workspace if configured
            if (taskViewWorkspaces.length > 0 && orgId && !taskViewWorkspaces.includes(orgId)) {
                return; // Skip this card
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
            if (card.checklists && card.checklists.length > 0) {
                card.checklists.forEach(cl => {
                    cl.checkItems.forEach(ci => {
                        if (ci.idMember === user.id) {
                            tasks.push({
                                ...baseProps,
                                id: ci.id,
                                type: 'checklist_item',
                                name: ci.name,
                                due: ci.due || card.due,
                                isCompleted: ci.state === 'complete'
                            });
                        }
                    });
                });
            }

            // 2. Card Membership
            if (true) {
                tasks.push({
                    ...baseProps,
                    id: card.id,
                    type: 'card_member',
                    name: card.name,
                    due: card.due,
                    isCompleted: card.dueComplete
                });
            }
        });

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

        // 3. Filter Workspace
        if (selectedWorkspace !== 'all') {
            result = result.filter(t => t.orgId === selectedWorkspace);
        }

        // 4. Filter Board
        if (selectedBoard !== 'all') {
            result = result.filter(t => t.boardId === selectedBoard);
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
    }, [processedTasks, filterAssigned, filterMember, filterComplete, selectedWorkspace, selectedBoard, sortBy]);


    // --- Grouping for "All" View ---
    const groupedData = useMemo(() => {
        // Group by Workspace -> Board
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


    if (loading) return <div className="container" style={{ textAlign: 'center', marginTop: 50 }}>Loading Tasks...</div>;
    if (error) return <div className="container error">{error}</div>;

    return (
        <div className="container">
            {/* HEADER (Matching Dashboard Style) */}
            <div className="header">
                <div className="header-title-area">
                    <h1>Task List for {user.username}</h1>
                </div>
                <div className="header-actions-top">
                    {/* Theme Toggle Button */}
                    <button className="theme-toggle-button" onClick={() => toggleTheme()}>
                        {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
                    </button>
                </div>
            </div>

            {/* FILTERS & CONTENT CONTAINER */}
            <div className="dashboard-container task-view" style={{ marginTop: '0px', padding: '0 20px' }}>

                {/* FILTERS BAR */}
                <div className="filters-bar" style={{ marginTop: '10px', display: 'flex', gap: '15px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '20px', padding: '10px', background: 'rgba(0,0,0,0.03)', borderRadius: '8px' }}>

                    {/* Workspace Filter */}
                    <div className="filter-group">
                        <label style={{ display: 'block', fontSize: '0.8em', fontWeight: 'bold', marginBottom: '5px' }}>Workspace</label>
                        <select value={selectedWorkspace} onChange={e => { setSelectedWorkspace(e.target.value); setSelectedBoard('all'); }} style={{ padding: '5px' }}>
                            <option value="all">All Workspaces</option>
                            {/* Only show workspaces present in data (which respects settings) */}
                            {Array.from(new Set(processedTasks.map(t => t.orgId))).map(orgId => {
                                const orgName = processedTasks.find(t => t.orgId === orgId)?.orgName || 'Unknown';
                                return <option key={orgId} value={orgId}>{orgName}</option>;
                            })}
                        </select>
                    </div>

                    {/* Board Filter */}
                    <div className="filter-group">
                        <label style={{ display: 'block', fontSize: '0.8em', fontWeight: 'bold', marginBottom: '5px' }}>Board</label>
                        <select value={selectedBoard} onChange={e => setSelectedBoard(e.target.value)} style={{ padding: '5px' }}>
                            <option value="all">All Boards</option>
                            {/* Filter boards based on selected Workspace if any */}
                            {Array.from(new Set(processedTasks
                                .filter(t => selectedWorkspace === 'all' || t.orgId === selectedWorkspace)
                                .map(t => t.boardId)
                            )).map(boardId => {
                                const boardName = processedTasks.find(t => t.boardId === boardId)?.boardName || 'Unknown';
                                return <option key={boardId} value={boardId}>{boardName}</option>;
                            })}
                        </select>
                    </div>

                    {/* Sort */}
                    <div className="filter-group">
                        <label style={{ display: 'block', fontSize: '0.8em', fontWeight: 'bold', marginBottom: '5px' }}>Sort By</label>
                        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: '5px' }}>
                            <option value="workspace">Workspace</option>
                            <option value="board">Board Name</option>
                            <option value="due">Due Date</option>
                        </select>
                    </div>

                    {/* Toggles */}
                    <div className="filter-group" style={{ display: 'flex', gap: '15px', alignItems: 'center', paddingTop: '18px' }}>
                        <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                            <input type="checkbox" checked={filterAssigned} onChange={e => setFilterAssigned(e.target.checked)} style={{ marginRight: '5px' }} /> Assigned Tasks
                        </label>
                        <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                            <input type="checkbox" checked={filterMember} onChange={e => setFilterMember(e.target.checked)} style={{ marginRight: '5px' }} /> Cards Member Of
                        </label>
                        <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                            <input type="checkbox" checked={filterComplete} onChange={e => setFilterComplete(e.target.checked)} style={{ marginRight: '5px' }} /> Show Completed
                        </label>
                    </div>
                </div>

                {/* MAIN CONTENT */}
                <div className="task-content" style={{ paddingBottom: '80px' }}>
                    {Object.keys(groupedData).length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#888', marginTop: '50px' }}>No tasks found matching filters.</div>
                    ) : (
                        // WORKSPACES
                        Object.entries(groupedData).map(([orgId, orgData]) => (
                            <div key={orgId} className="workspace-section" style={{ marginBottom: '40px' }}>
                                <h2 style={{ borderBottom: '2px solid #ccc', paddingBottom: '10px', marginBottom: '20px', color: 'var(--text-primary)' }}>{orgData.name}</h2>

                                {/* BOARDS GRID */}
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

                                            {/* TASKS LIST */}
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
                                                        {/* TYPE LABEL */}
                                                        <div style={{ fontSize: '0.7em', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '4px' }}>
                                                            {task.type === 'checklist_item' ? 'Checklist Item' : 'Card Member'}
                                                        </div>

                                                        {/* NAME & LINK */}
                                                        <div style={{ marginBottom: '5px' }}>
                                                            <a href={task.cardUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'var(--text-primary)', fontWeight: '500' }}>
                                                                {task.name}
                                                            </a>
                                                            {task.type === 'checklist_item' && (
                                                                <div style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginTop: '2px' }}>on card: {task.cardName}</div>
                                                            )}
                                                        </div>

                                                        {/* DUE DATE */}
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
            </div>

            {/* FIXED FOOTER Action Bar (Matches Dashboard) */}
            <div className="footer-action-bar">
                <span className="countdown">Next refresh in {refreshCountdown}s</span>
                <button className="refresh-button" onClick={() => loadData(true)}>Refresh</button>

                <button className="settings-button" onClick={onClose}>
                    Dashboard View
                </button>

                <button className="settings-button" onClick={() => window.open('/map', '_blank')}>
                    Map View
                </button>

                <button className="settings-button" onClick={onShowSettings}>
                    Settings
                </button>
                <button className="logout-button" onClick={onLogout}>
                    Log Out
                </button>
            </div>
        </div>
    );
};

export default TaskView;
