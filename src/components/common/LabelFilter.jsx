import React, { useState, useEffect, useRef } from 'react';
import { useDarkMode } from '../../context/DarkModeContext';
import { getLabelTextColor } from '../../utils/helpers';

const LabelFilter = ({ labels, selectedLabelIds, onApply }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [tempSelection, setTempSelection] = useState(new Set(selectedLabelIds));
    const dropdownRef = useRef(null);
    const { theme } = useDarkMode();

    useEffect(() => {
        setTempSelection(new Set(selectedLabelIds));
    }, [selectedLabelIds, isOpen]); // Reset when opening/prop change

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
        const newSet = new Set(tempSelection);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setTempSelection(newSet);
    };

    const handleSelectAll = () => {
        setTempSelection(new Set()); // Empty set means ALL
    };

    const handleApply = () => {
        onApply(tempSelection);
        setIsOpen(false);
    };

    const handleCancel = () => {
        setIsOpen(false);
    };

    const isAllSelected = tempSelection.size === 0;

    return (
        <div style={{ position: 'relative', display: 'inline-block', marginLeft: '10px' }} ref={dropdownRef}>
            <button
                className="settings-button"
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px', // Slight adjustment to match other inputs
                    fontSize: '0.9em'
                }}
            >
                Labels
                {tempSelection.size > 0 && (
                    <span style={{
                        background: 'var(--accent-color)',
                        color: 'white',
                        borderRadius: '10px',
                        padding: '0 6px',
                        fontSize: '0.8em'
                    }}>
                        {tempSelection.size}
                    </span>
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
                    maxHeight: '400px'
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
                        <button
                            onClick={handleSelectAll}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--accent-color)',
                                cursor: 'pointer',
                                fontSize: '0.9em',
                                textDecoration: 'underline'
                            }}
                        >
                            Select All
                        </button>
                    </div>

                    <div style={{ overflowY: 'auto', padding: '10px', flex: 1 }}>
                        {labels.map(label => {
                            const isSelected = isAllSelected || tempSelection.has(label.id);
                            // If "All Selected" (size 0), visually show all checked? 
                            // Or show none checked but imply "All"?
                            // User "select by default All labels".
                            // Usually "All" means either everything is checked or "All" option is checked.
                            // Let's implement: Empty Set = All. Visually check everything?
                            // No, typically if All is active, you see everything selected.
                            // If I click one, "All" logic breaks and only that one is selected.
                            // Let's visual check: (isAllSelected || tempSelection.has(label.id)) ?
                            // Wait, if I'm in "All" mode (empty set), and I toggle one, I probably want to switch to "Specific" mode.

                            // Better Logic:
                            // `tempSelection` of size 0 -> Display as "All Checked".
                            // Clicking a checkbox when "All Checked":
                            //   -> Initialize set with ALL IDs, then Toggle target (Deselect).
                            //   -> OR: Just set to [target] (Select Only this one).
                            // Standard pattern: "All" is a separate toggle or implied.
                            // Let's go with: Checkbox reflects state. 
                            // If isAllSelected, checkbox is checked.
                            // OnChange: If isAllSelected, convert to Set(allLabels) then toggle.
                            const isChecked = isAllSelected || tempSelection.has(label.id);

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
                                        onChange={() => {
                                            if (isAllSelected) {
                                                // Switch from All to Specific (Everything minus this one)
                                                // Actually usually people want to Filter TO something, not filter FROM everything.
                                                // But let's support "Filter To".
                                                // If I click "Label A", do I want ONLY A?
                                                // Let's assume standard toggle behavior relative to visual state.
                                                // If visually checked, uncheck it.
                                                const allIds = new Set(labels.map(l => l.id));
                                                allIds.delete(label.id);
                                                setTempSelection(allIds);
                                            } else {
                                                toggleLabel(label.id);
                                            }
                                        }}
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

                    <div style={{
                        padding: '10px',
                        borderTop: '1px solid var(--border-color)',
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: '10px',
                        background: 'var(--bg-secondary)',
                        borderRadius: '0 0 6px 6px'
                    }}>
                        <button
                            onClick={handleCancel}
                            style={{
                                padding: '6px 12px',
                                background: 'transparent',
                                border: '1px solid var(--border-color)',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                color: 'var(--text-secondary)'
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleApply}
                            style={{
                                padding: '6px 12px',
                                background: 'var(--accent-color)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                color: 'white',
                                fontWeight: 'bold'
                            }}
                        >
                            Apply
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LabelFilter;
