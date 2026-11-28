import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';
import '../../styles/board-select.css';

/**
 * Board picker. A native <select> cannot style single options (bold text,
 * pills), so this is a small listbox that behaves like one: click or
 * Enter/Space/ArrowDown to open, arrows to move, Enter to choose, Escape to
 * close, and typing filters the list.
 *
 * Boards are grouped by workspace, then "Personal Boards", sorted by name.
 * Boards for which isCovered(board) is true are shown in bold with a "Pro"
 * pill, and a "Trial" pill when the member's Pro is a trial.
 */

const PERSONAL = 'Personal Boards';

const groupBoards = (boards) => {
    const groups = new Map();
    const personal = [];
    boards.forEach((b) => {
        if (b.organization) {
            const org = b.organization.displayName || b.organization.name;
            if (!groups.has(org)) groups.set(org, []);
            groups.get(org).push(b);
        } else {
            personal.push(b);
        }
    });
    const byName = (a, b) => (a.name || '').localeCompare(b.name || '');
    const result = [...groups.keys()]
        .sort((a, b) => a.localeCompare(b))
        .map((label) => ({ label, boards: groups.get(label).sort(byName) }));
    if (personal.length) result.push({ label: PERSONAL, boards: personal.sort(byName) });
    return result;
};

export const PlanPills = ({ covered, trial }) => {
    if (!covered) return null;
    return (
        <span className="board-pills">
            <span className="plan-pill is-pro">Pro</span>
            {trial && <span className="plan-pill is-trial">Trial</span>}
        </span>
    );
};

const BoardSelect = ({
    boards = [],
    value = '',
    onChange,
    isCovered = () => false,
    trial = false,
    placeholder = 'Choose a board',
    id = 'board-select',
}) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(-1);
    const rootRef = useRef(null);
    const listRef = useRef(null);
    const searchRef = useRef(null);
    const buttonRef = useRef(null);

    const selected = boards.find((b) => b.id === value);
    const showSearch = boards.length > 8;

    const groups = useMemo(() => {
        const q = query.trim().toLowerCase();
        const filtered = q
            ? boards.filter((b) => {
                const org = b.organization ? (b.organization.displayName || b.organization.name || '') : PERSONAL;
                return (b.name || '').toLowerCase().includes(q) || org.toLowerCase().includes(q);
            })
            : boards;
        return groupBoards(filtered);
    }, [boards, query]);
    const flat = useMemo(() => groups.flatMap((g) => g.boards), [groups]);

    // Open: focus the search (or list) and start on the current board.
    useEffect(() => {
        if (!open) return;
        const idx = flat.findIndex((b) => b.id === value);
        setActive(idx >= 0 ? idx : 0);
        (showSearch ? searchRef.current : listRef.current)?.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Keep the active row in view.
    useEffect(() => {
        if (!open || active < 0) return;
        listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
    }, [active, open]);

    // Close on an outside click.
    useEffect(() => {
        if (!open) return;
        const onDown = (e) => {
            if (rootRef.current && !rootRef.current.contains(e.target)) close(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const close = (refocus = true) => {
        setOpen(false);
        setQuery('');
        if (refocus) buttonRef.current?.focus();
    };

    const choose = (board) => {
        if (board && board.id !== value) onChange?.(board.id);
        close();
    };

    const onListKey = (e) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setActive((i) => Math.min(flat.length - 1, i + 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
                break;
            case 'Home':
                if (e.target === searchRef.current) break;
                e.preventDefault();
                setActive(0);
                break;
            case 'End':
                if (e.target === searchRef.current) break;
                e.preventDefault();
                setActive(flat.length - 1);
                break;
            case 'Enter':
                e.preventDefault();
                choose(flat[active]);
                break;
            case 'Escape':
                e.preventDefault();
                close();
                break;
            case 'Tab':
                close(false);
                break;
            default:
        }
    };

    const onButtonKey = (e) => {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
            e.preventDefault();
            setOpen(true);
        }
    };

    const listId = `${id}-list`;
    const activeId = open && flat[active] ? `${id}-opt-${flat[active].id}` : undefined;
    let index = -1;

    return (
        <div className={`board-select-menu${open ? ' is-open' : ''}`} ref={rootRef}>
            <button
                type="button"
                id={id}
                ref={buttonRef}
                className="board-select-trigger"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() => (open ? close() : setOpen(true))}
                onKeyDown={onButtonKey}
            >
                {selected ? (
                    <span className={`board-select-value${isCovered(selected) ? ' is-covered' : ''}`}>
                        <span className="board-select-name">{selected.name}</span>
                        <PlanPills covered={isCovered(selected)} trial={trial} />
                    </span>
                ) : (
                    <span className="board-select-placeholder">{placeholder}</span>
                )}
                <ChevronDown size={16} className="board-select-chevron" aria-hidden="true" />
            </button>

            {open && (
                <div className="board-select-popover">
                    {showSearch && (
                        <div className="board-select-search">
                            <Search size={15} aria-hidden="true" />
                            <input
                                ref={searchRef}
                                type="text"
                                value={query}
                                placeholder="Find a board"
                                aria-label="Find a board"
                                aria-controls={listId}
                                aria-activedescendant={activeId}
                                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                                onKeyDown={onListKey}
                            />
                        </div>
                    )}
                    <div
                        className="board-select-list"
                        id={listId}
                        role="listbox"
                        ref={listRef}
                        tabIndex={showSearch ? -1 : 0}
                        aria-labelledby={id}
                        aria-activedescendant={activeId}
                        onKeyDown={onListKey}
                    >
                        {flat.length === 0 && <div className="board-select-empty">No boards match.</div>}
                        {groups.map((g) => (
                            <div role="group" aria-label={g.label} key={g.label}>
                                <div className="board-select-group" aria-hidden="true">{g.label}</div>
                                {g.boards.map((b) => {
                                    index += 1;
                                    const i = index;
                                    const covered = isCovered(b);
                                    const isSel = b.id === value;
                                    return (
                                        <div
                                            key={b.id}
                                            id={`${id}-opt-${b.id}`}
                                            role="option"
                                            aria-selected={isSel}
                                            data-index={i}
                                            className={`board-select-option${i === active ? ' is-active' : ''}${covered ? ' is-covered' : ''}${isSel ? ' is-selected' : ''}`}
                                            onMouseEnter={() => setActive(i)}
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => choose(b)}
                                        >
                                            <span className="board-select-name">{b.name}</span>
                                            <PlanPills covered={covered} trial={trial} />
                                            {isSel && <Check size={15} className="board-select-check" aria-hidden="true" />}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default BoardSelect;
