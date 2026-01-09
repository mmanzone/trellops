import React, { useState, useEffect, useRef } from 'react';
import { useDarkMode } from '../../context/DarkModeContext';

const LabelFilter = ({ labels, selectedLabelIds, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);
    const { theme } = useDarkMode();

    // selectedLabelIds: Set<string> | null. 
    // If null, it means "All Selected".
    const isAll = selectedLabelIds === null || selectedLabelIds === undefined;

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleLabel = (id) => {
        if (isAll) {
            // If currently ALL, and we toggle one:
            // We want "All EXCEPT this one".
            const allOtherIds = new Set(labels.filter(l => l.id !== id).map(l => l.id));
            onChange(allOtherIds);
        } else {
            const newSet = new Set(selectedLabelIds);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            onChange(newSet);
        }
    };

    return (
        <div style={{ position: 'relative', display: 'inline-block', marginLeft: '10px' }} ref={dropdownRef}>
            <button
                className="settings-button"
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    fontSize: '0.9em'
                }}
            >
                Labels
                {!isAll && selectedLabelIds.size > 0 && (
                    <span style={{
                        background: 'var(--accent-color)',
                        color: 'white',
                        borderRadius: '10px',
                        padding: '0 6px',
                        fontSize: '0.8em'
                    }}>
                        {selectedLabelIds.size}
                    </span>
                )}
                {!isAll && selectedLabelIds.size === 0 && (
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
                    width: '320px',
                    display: 'flex',
                    flexDirection: 'column',
                    maxHeight: '500px'
                }}>
                    <div style={{
                        padding: '10px',
                        borderBottom: '1px solid var(--border-color)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '0.9em',
                        fontWeight: 'bold',
                        color: 'var(--text-primary)'
                    }}>
                        <span>Filter by Labels</span>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                onClick={() => onChange(null)} // Select All
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--accent-color)',
                                    cursor: 'pointer',
                                    fontSize: '0.9em',
                                    textDecoration: 'underline'
                                }}
                            >
                                All
                            </button>
                            <button
                                onClick={() => onChange(new Set())} // Select None
                                style={{
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    fontSize: '0.9em',
                                    textDecoration: 'underline'
                                }}
                            >
                                None
                            </button>
                        </div>
                    </div>

                    <div style={{ overflowY: 'auto', padding: '10px', flex: 1 }}>
                        {labels.map(label => {
                            // If isAll, check everything.
                            // If not, check if in set.
                            const isChecked = isAll || selectedLabelIds.has(label.id);

                            return (
                                <label key={label.id} style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '6px 0',
                                    cursor: 'pointer',
                                    color: 'var(--text-primary)'
                                }}>
                                    <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => toggleLabel(label.id)}
                                        style={{ marginRight: '10px' }}
                                    />
                                    <span style={{
                                        display: 'inline-block',
                                        width: '12px',
                                        height: '12px',
                                        borderRadius: '50%',
                                        backgroundColor: label.color || '#ccc',
                                        marginRight: '8px'
                                    }}></span>
                                    <span style={{ fontSize: '0.9em' }}>{label.name || (label.color ? label.color : 'No Name')}</span>
                                </label>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default LabelFilter;
