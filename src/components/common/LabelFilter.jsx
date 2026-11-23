import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

const LabelFilter = ({ title, labels, selectedLabelIds, onChange, labelLogic, onLabelLogicChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

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

    const hasSelection = !isAll && selectedLabelIds.size > 0;

    return (
        <div className="filter-dropdown" style={{ marginLeft: '10px' }} ref={dropdownRef}>
            <button
                type="button"
                className={`filter-trigger${isOpen ? ' is-open' : ''}${hasSelection ? ' is-filtered' : ''}`}
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                aria-haspopup="true"
            >
                <span className="filter-trigger-label">{title || 'Labels'}</span>
                {hasSelection && <span className="count-badge">{selectedLabelIds.size}</span>}
                {!isAll && selectedLabelIds.size === 0 && <span className="filter-trigger-note">(None)</span>}
                <ChevronDown size={16} className="filter-trigger-chevron" aria-hidden="true" />
            </button>

            {isOpen && (
                <div className="filter-popover" style={{ width: '320px' }}>
                    <div className="filter-popover-head">
                        <span>Filter by {title || 'Labels'}</span>
                        <div className="filter-popover-links">
                            <button type="button" className="link-button" onClick={() => onChange(null)}>All</button>
                            <button type="button" className="link-button link-button-muted" onClick={() => onChange(new Set())}>None</button>
                        </div>
                    </div>

                    {/* Logic Toggle */}
                    <div className="filter-popover-logic">
                        <div className="segmented" role="radiogroup" aria-label="Match">
                            <label className={labelLogic === 'OR' ? 'is-active' : ''}>
                                <input
                                    type="radio"
                                    name="labelLogic"
                                    value="OR"
                                    checked={labelLogic === 'OR'}
                                    onChange={() => onLabelLogicChange('OR')}
                                />
                                Match any
                            </label>
                            <label className={labelLogic === 'AND' ? 'is-active' : ''}>
                                <input
                                    type="radio"
                                    name="labelLogic"
                                    value="AND"
                                    checked={labelLogic === 'AND'}
                                    onChange={() => onLabelLogicChange('AND')}
                                />
                                Match all
                            </label>
                        </div>
                    </div>

                    <div className="filter-popover-list">
                        {labels.map(label => {
                            // If isAll, check everything. If not, check if in set.
                            const isChecked = isAll || selectedLabelIds.has(label.id);

                            return (
                                <label key={label.id} className="filter-option">
                                    <input
                                        type="checkbox"
                                        checked={isChecked}
                                        onChange={() => toggleLabel(label.id)}
                                    />
                                    <span className="label-dot" style={{ backgroundColor: label.color || '#b3bac5' }}></span>
                                    <span className="filter-option-text">{label.name || (label.color ? label.color : 'No Name')}</span>
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
