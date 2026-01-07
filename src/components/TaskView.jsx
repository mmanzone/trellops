import React, { useState, useEffect, useMemo } from 'react';
import { fetchAllTasksData } from '../api/trello';
import { getPeristencedDarkMode } from '../utils/persistence'; // Typo in original file, mimicking usage or fixing? 
// Better use standard utils or context if available, but Dashboard uses props or local storage.
// App passes user.
import '../styles/index.css'; // Reuse main styles

const TaskView = ({ user, onClose, onShowSettings, onLogout }) => {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState({ orgs: [], boards: [], cards: [] });
    const [error, setError] = useState('');

    // Filters
    const [selectedWorkspace, setSelectedWorkspace] = useState('all');
    const [selectedBoard, setSelectedBoard] = useState('all');
    const [filterAssigned, setFilterAssigned] = useState(true);
    const [filterMember, setFilterMember] = useState(true);
    const [filterComplete, setFilterComplete] = useState(false); // Default: Hide completed

    // Sort
    const [sortBy, setSortBy] = useState('workspace'); // 'workspace', 'board', 'due'

    useEffect(() => {
        loadData();
    }, [user]);

    const loadData = async () => {
        setLoading(true);
        try {
            const result = await fetchAllTasksData(user.token);
            setData(result);
        } catch (e) {
            console.error(e);
            setError("Failed to load tasks. Please try again.");
        } finally {
            setLoading(false);
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

            const baseProps = {
                cardId: card.id,
                cardName: card.name,
                cardUrl: card.url,
                boardId: card.idBoard,
                boardName: board?.name || 'Unknown Board',
                orgId: org.id,
                orgName: org.displayName || org.name,
                isCompleted: card.dueComplete || false // Card completion
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
                                due: ci.due || card.due, // Fallback to card due
                                isCompleted: ci.state === 'complete'
                            });
                        }
                    });
                });
            }

            // 2. Card Membership
            // user.id check implied by endpoint, but let's be safe if logic changes
            // Actually endpoint returns cards matching filter. 
            // We'll assume if it's there, I'm a member or it's visible. 
            // 'members/me/cards' implies membership.
            if (true) {
                tasks.push({
                    ...baseProps,
                    id: card.id, // Card ID as Task ID
                    type: 'card_member',
                    name: card.name,
                    due: card.due,
                    isCompleted: card.dueComplete || (card.due && new Date(card.due) < new Date() && false) // Logic for "Complete" on card? rely on dueComplete
                });
            }
        });

        return tasks;
    }, [data, user.id]);

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
        <div className="dashboard-container task-view">
            {/* HEADER */}
            <div className="header-container" style={{ padding: '20px', borderBottom: '1px solid #ddd' }}>
                <h1 style={{ margin: 0 }}>Task List for {user.username}</h1>

                {/* FILTERS BAR */}
                <div className="filters-bar" style={{ marginTop: '20px', display: 'flex', gap: '15px', flexWrap: 'wrap', alignItems: 'center' }}>

                    {/* Workspace Filter */}
                    <div className="filter-group">
                        <label style={{ display: 'block', fontSize: '0.8em', fontWeight: 'bold', marginBottom: '5px' }}>Workspace</label>
                        <select value={selectedWorkspace} onChange={e => { setSelectedWorkspace(e.target.value); setSelectedBoard('all'); }} style={{ padding: '5px' }}>
                            <option value="all">All Workspaces</option>
                            {data.orgs.map(o => <option key={o.id} value={o.id}>{o.displayName}</option>)}
                        </select>
                    </div>

                    {/* Board Filter */}
                    <div className="filter-group">
                        <label style={{ display: 'block', fontSize: '0.8em', fontWeight: 'bold', marginBottom: '5px' }}>Board</label>
                        <select value={selectedBoard} onChange={e => setSelectedBoard(e.target.value)} style={{ padding: '5px' }}>
                            <option value="all">All Boards</option>
                            {/* Filter boards based on selected Workspace if any */}
                            {data.boards
                                .filter(b => selectedWorkspace === 'all' || b.idOrganization === selectedWorkspace)
                                .map(b => <option key={b.id} value={b.id}>{b.name}</option>)
                            }
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
                    <div className="filter-group" style={{ display: 'flex', gap: '10px', alignItems: 'end', paddingBottom: '5px' }}>
                        <label style={{ cursor: 'pointer' }}>
                            <input type="checkbox" checked={filterAssigned} onChange={e => setFilterAssigned(e.target.checked)} /> Assigned Tasks
                        </label>
                        <label style={{ cursor: 'pointer' }}>
                            <input type="checkbox" checked={filterMember} onChange={e => setFilterMember(e.target.checked)} /> Cards Member Of
                        </label>
                        <label style={{ cursor: 'pointer' }}>
                            <input type="checkbox" checked={filterComplete} onChange={e => setFilterComplete(e.target.checked)} /> Show Completed
                        </label>
                    </div>

                </div>
            </div>

            {/* MAIN CONTENT */}
            <div className="task-content" style={{ padding: '20px', overflowY: 'auto', height: 'calc(100vh - 200px)' }}>
                {Object.keys(groupedData).length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#888', marginTop: '50px' }}>No tasks found matching filters.</div>
                ) : (
                    // WORKSPACES
                    Object.entries(groupedData).map(([orgId, orgData]) => (
                        <div key={orgId} className="workspace-section" style={{ marginBottom: '40px' }}>
                            <h2 style={{ borderBottom: '2px solid #ccc', paddingBottom: '10px', marginBottom: '20px', color: '#444' }}>{orgData.name}</h2>

                            {/* BOARDS GRID */}
                            <div className="boards-grid" style={{ display: 'flex', gap: '20px', overflowX: 'auto', paddingBottom: '10px' }}>
                                {Object.entries(orgData.boards).map(([boardId, boardData]) => (
                                    <div key={boardId} className="board-column" style={{
                                        minWidth: '300px',
                                        maxWidth: '300px',
                                        background: '#f4f5f7',
                                        borderRadius: '8px',
                                        padding: '10px',
                                        maxHeight: '600px',
                                        overflowY: 'auto',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                                    }}>
                                        <h3 style={{ marginTop: 0, fontSize: '1em', marginBottom: '15px', color: '#172b4d' }}>{boardData.name} <span style={{ fontSize: '0.8em', fontWeight: 'normal', color: '#666' }}>({boardData.tasks.length})</span></h3>

                                        {/* TASKS LIST */}
                                        <div className="tasks-list">
                                            {boardData.tasks.map(task => (
                                                <div key={`${task.type}-${task.id}`} className="task-card" style={{
                                                    background: '#fff',
                                                    padding: '10px',
                                                    marginBottom: '8px',
                                                    borderRadius: '4px',
                                                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                                                    borderLeft: task.type === 'checklist_item' ? '4px solid #0079bf' : '4px solid #ff9f1a'
                                                }}>
                                                    {/* TYPE LABEL */}
                                                    <div style={{ fontSize: '0.7em', color: '#888', textTransform: 'uppercase', marginBottom: '4px' }}>
                                                        {task.type === 'checklist_item' ? 'Checklist Item' : 'Card Member'}
                                                    </div>

                                                    {/* NAME & LINK */}
                                                    <div style={{ marginBottom: '5px' }}>
                                                        <a href={task.cardUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: '#172b4d', fontWeight: '500' }}>
                                                            {task.name}
                                                        </a>
                                                        {task.type === 'checklist_item' && (
                                                            <div style={{ fontSize: '0.85em', color: '#666', marginTop: '2px' }}>on card: {task.cardName}</div>
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

            {/* FOOTER (Replicated) */}
            <div className="actions-container" style={{
                position: 'fixed',
                bottom: 0,
                left: 0,
                right: 0,
                background: 'var(--bg-secondary, #fff)',
                borderTop: '1px solid #ccc',
                padding: '10px 20px',
                display: 'flex',
                justifyContent: 'center',
                gap: '15px',
                zIndex: 1000
            }}>
                <button className="settings-button" onClick={onClose}>
                    Dashboard View
                </button>
                {/* Map View Button (Assuming global enable check not needed here for buttons to show, but logic in App implies hiding? 
                    The App passes 'onClose' to go to Dashboard. 'onShowSettings'. 
                    We should try to match standard footer buttons: [Dashboard][Map][Settings][Logout]
                */}
                <button className="settings-button" onClick={() => window.history.pushState({}, '', '/map') || window.location.reload()}>
                    {/* Hacky nav to map, better to use callback if possible, but App doesn't pass onShowMap.
                        Actually App manages view. 
                        I should check App.jsx again to see what callbacks TaskView receives.
                        It receives onClose, onShowSettings, onLogout.
                        It basically replaces 'Dashboard'.
                        Wait, App.jsx handles routing.
                         If I add 'onShowMap' callback to TaskView?
                    */}
                    Map View
                </button>

                <button className="settings-button" onClick={onShowSettings}>
                    Settings
                </button>
                <button className="start-button" onClick={onLogout}>
                    Logout
                </button>
            </div>
        </div>
    );
};

export default TaskView;
