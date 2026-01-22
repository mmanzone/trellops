import HamburgerMenu from './common/HamburgerMenu';
import { formatDynamicCountdown } from '../utils/helpers';
// ... imports

// ...

{/* HEADER - Strict MapView Style */ }
<div className="map-header">
    <div className="map-header-title-area">
        <h1>Tasks for {user.fullName || user.username}</h1>
    </div>

    <div className="map-header-actions" style={{ flexGrow: 1, justifyContent: 'flex-end', display: 'flex', alignItems: 'center', gap: '5px' }}>
        {/* FILTERS - visible/shrinkable */}
        <div className="header-filters" style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'nowrap', overflow: 'hidden', flexShrink: 1 }}>
            <MultiSelectFilter
                label="WS"
                options={Array.from(new Set(processedTasks.map(t => t.orgId))).map(orgId => ({ id: orgId, name: processedTasks.find(t => t.orgId === orgId)?.orgName || 'Unknown' })).sort(safeSort)}
                selectedIds={selectedWorkspaceIds}
                onChange={(ids) => { setSelectedWorkspaceIds(ids); setSelectedBoardIds(null); }}
                className="time-filter-select" // Reuse for size
            />

            <MultiSelectFilter
                label="Boards"
                options={Array.from(new Set(processedTasks.filter(t => selectedWorkspaceIds === null || selectedWorkspaceIds.has(t.orgId)).map(t => t.boardId))).map(boardId => ({ id: boardId, name: processedTasks.find(t => t.boardId === boardId)?.boardName || 'Unknown' })).sort(safeSort)}
                selectedIds={selectedBoardIds}
                onChange={setSelectedBoardIds}
                className="time-filter-select"
            />

            <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                className="time-filter-select" // Reuse for shrinking
                style={{ borderRadius: '4px', border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
            >
                <option value="board">Sort: Board</option>
                <option value="due">Sort: Due</option>
            </select>

            {/* Checkboxes - hide on very small screens? or wrap? */}
            <div className="desktop-only" style={{ display: 'flex', gap: '10px', alignItems: 'center', fontSize: '0.9em' }}>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}><input type="checkbox" checked={filterAssigned} onChange={e => setFilterAssigned(e.target.checked)} style={{ marginRight: '4px' }} /> Me</label>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}><input type="checkbox" checked={filterMember} onChange={e => setFilterMember(e.target.checked)} style={{ marginRight: '4px' }} /> Mem</label>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}><input type="checkbox" checked={filterComplete} onChange={e => setFilterComplete(e.target.checked)} style={{ marginRight: '4px' }} /> Done</label>
            </div>
        </div>

        <button className="theme-toggle-button" onClick={() => toggleTheme()} style={{ flexShrink: 0 }}>
            {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        {/* MOBILE HAMBURGER MENU */}
        <div className="mobile-only" style={{ marginLeft: '5px' }}>
            <HamburgerMenu>
                <div className="hamburger-section">
                    <strong>Actions</strong>

                    <button className="menu-link" onClick={() => onMainView ? onMainView() : onClose()}>
                        Dashboard View
                    </button>

                    <button className="menu-link" onClick={onShowSettings}>
                        Settings
                    </button>

                    <button className="menu-link" onClick={onLogout}>
                        Logout
                    </button>

                    <div style={{ marginTop: '10px', borderTop: '1px solid #eee', paddingTop: '10px' }}>
                        <strong>Filters</strong>
                        <label style={{ display: 'flex', padding: '5px 0' }}><input type="checkbox" checked={filterAssigned} onChange={e => setFilterAssigned(e.target.checked)} style={{ marginRight: '8px' }} /> Assigned to Me</label>
                        <label style={{ display: 'flex', padding: '5px 0' }}><input type="checkbox" checked={filterMember} onChange={e => setFilterMember(e.target.checked)} style={{ marginRight: '8px' }} /> Member</label>
                        <label style={{ display: 'flex', padding: '5px 0' }}><input type="checkbox" checked={filterComplete} onChange={e => setFilterComplete(e.target.checked)} style={{ marginRight: '8px' }} /> Show Completed</label>
                    </div>
                </div>
            </HamburgerMenu>
        </div>
    </div>
</div>

{/* CONTENT */ }
<div className="task-content" style={{ flex: 1, overflowY: 'auto', padding: '20px', paddingBottom: '80px', background: 'var(--bg-canvas)', position: 'relative', zIndex: 1 }}>
    {/* ... content ... */}
    {Object.keys(groupedData).length === 0 ? (
        <div style={{ textAlign: 'center', color: '#888', marginTop: '50px' }}>No tasks found matching filters.</div>
    ) : (
        Object.entries(groupedData).map(([orgId, orgData]) => (
            <div key={orgId} className="workspace-section" style={{ marginBottom: '40px' }}>
                <h2 style={{ borderBottom: '2px solid var(--border-color, #ccc)', paddingBottom: '10px', marginBottom: '20px', color: 'var(--text-primary)' }}>{orgData.name}</h2>
                {/* ... */}
                <div className="boards-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px', alignItems: 'start' }}>
                    {Object.entries(orgData.boards).map(([boardId, boardData]) => (
                        <div key={boardId} className="board-card" style={{ background: 'var(--bg-secondary)', borderRadius: '8px', padding: '15px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', maxHeight: '600px' }}>
                            <h3 style={{ marginTop: 0, fontSize: '1.1em', marginBottom: '15px', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color, #eee)', paddingBottom: '8px' }}>
                                {boardData.name} <span style={{ fontSize: '0.8em', fontWeight: 'normal', color: 'var(--text-secondary)' }}>({boardData.tasks.length})</span>
                            </h3>
                            <div className="tasks-list-vertical" style={{ display: 'flex', flexDirection: 'column', gap: '15px', overflowY: 'auto', paddingRight: '5px' }}>
                                {boardData.tasks.map(task => (
                                    <div key={task.type === 'card' ? `card-${task.cardId}` : task.id} className="task-card" style={{ background: 'var(--bg-primary)', padding: '12px', borderRadius: '6px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)', borderLeft: task.checkItems && task.checkItems.length > 0 ? '4px solid #0079bf' : '4px solid #ff9f1a', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column' }}>
                                        {/* Card details */}
                                        <div style={{ marginBottom: '8px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                <a href={task.cardUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'var(--text-primary)', fontWeight: '600', fontSize: '1em', lineHeight: '1.3', wordBreak: 'break-word' }}>{task.cardName}</a>
                                                {task.isMember && <span title="Member" style={{ fontSize: '0.9em', marginLeft: '5px', opacity: 0.7 }}>👤</span>}
                                            </div>
                                            {task.labels && task.labels.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>{task.labels.map(l => <span key={l.id} style={{ fontSize: '0.7em', padding: '2px 6px', borderRadius: '3px', backgroundColor: l.color ? getLabelColor(l.color) : '#ccc', color: l.color ? '#fff' : '#000', fontWeight: '500' }}>{l.name}</span>)}</div>}
                                            {task.due && <div style={{ fontSize: '0.85em', marginTop: '8px', color: new Date(task.due) < new Date() && !task.isCompleted ? '#eb5a46' : '#5ba4cf', display: 'flex', alignItems: 'center' }}><span style={{ marginRight: '4px' }}>🕒</span>{new Date(task.due).toLocaleDateString()} {new Date(task.due).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {task.isCompleted && <span style={{ marginLeft: '5px', color: 'green' }}>✓ Done</span>}</div>}
                                        </div>
                                        {task.checkItems && task.checkItems.length > 0 && <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: '1px solid var(--border-color, #eee)' }}><div style={{ fontSize: '0.75em', color: 'var(--text-secondary)', marginBottom: '5px', textTransform: 'uppercase', fontWeight: 'bold' }}>Your Tasks:</div>{task.checkItems.map(item => <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', padding: '4px 0', paddingLeft: '10px', borderLeft: '2px solid #ddd', fontSize: '0.9em', marginBottom: '4px' }}><div style={{ width: '16px', height: '16px', borderRadius: '3px', border: '1px solid #ccc', marginRight: '8px', marginTop: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: item.state === 'complete' ? '#5ba4cf' : 'transparent', flexShrink: 0 }}>{item.state === 'complete' && <span style={{ color: 'white', fontSize: '11px' }}>✓</span>}</div><span style={{ color: item.state === 'complete' ? '#888' : 'var(--text-primary)', textDecoration: item.state === 'complete' ? 'line-through' : 'none', lineHeight: '1.4' }}>{item.name}</span></div>)}</div>}
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

{/* FOOTER */ }
<div className="map-footer">
    <div className="map-footer-left"></div>
    <div className="map-footer-right" style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
        <button className="button-secondary" onClick={() => { setRefreshCountdown(60); loadData(true); }}>
            Refresh {formatDynamicCountdown(refreshCountdown)}
        </button>

        <div className="desktop-only" style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
                <div style={{ display: 'flex' }}>
                    <button className="button-secondary" onClick={() => onMainView ? onMainView() : onClose()}>Dashboard View</button>
                    <button className="button-secondary dropdown-arrow" style={{ marginLeft: '-1px', padding: '0 5px', borderLeft: 'none' }} onClick={() => setShowDashboardDropdown(!showDashboardDropdown)}>▼</button>
                </div>
                {showDashboardDropdown && <div className="context-menu" style={{ position: 'absolute', bottom: '100%', left: 0, background: 'var(--bg-primary)', border: '1px solid #ccc', borderRadius: '4px', padding: '5px', minWidth: '150px' }}><div className="menu-item" onClick={() => { window.open('/dashboard', '_blank'); setShowDashboardDropdown(false); }}>Open in New Tab</div></div>}
            </div>
            <button className="button-secondary" onClick={onShowSettings}>Settings</button>
            <button className="button-secondary" onClick={onLogout}>Logout</button>
        </div>
    </div>
</div>

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
