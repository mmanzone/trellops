import React, { useState, useEffect } from 'react';
import { ICONS } from './common/IconPicker';

const MapFilters = ({
    blocks,
    lists,
    allLabels, // NEW: For label lookups
    cards, // NEW: For counting
    markerRules,
    visibleListIds,
    visibleRuleIds,
    onToggleList,
    onToggleBlock,
    onToggleRule,
    onToggleAll
}) => {
    const [isExpanded, setIsExpanded] = useState(false);

    // Count Helpers
    const getListCount = (listId) => {
        if (!cards) return 0;
        return cards.filter(c => c.idList === listId && c.coordinates && c.coordinates.lat).length;
    };

    const getBlockCount = (block) => {
        if (!cards || !block) return 0;
        return cards.filter(c => block.listIds.includes(c.idList) && c.coordinates && c.coordinates.lat).length;
    };

    const getRuleCount = (rule, isDefault) => {
        if (!cards) return 0;

        // Filter for mapped cards first
        const mappedCards = cards.filter(c => c.coordinates && c.coordinates.lat);

        if (isDefault) {
            // Count cards that match NO rule
            return mappedCards.filter(c => {
                for (const r of markerRules) {
                    if (c.labels && c.labels.some(l => l.id === r.labelId)) return false;
                }
                return true;
            }).length;
        }

        // Count cards matching specific rule
        // Note: A card might match multiple rules if it has multiple labels.
        // The display logic in MapView prioritizes them, but for filtering "Variant X", 
        // we likely want to count all cards having Label X, as unchecking it hides them (if that rule was active).
        // MapView logic: Active Rules = All matching rules + default.
        // If I uncheck Rule A, cards matching Rule A hide? 
        // Logic in MapView: "if(config.activeRuleIds.some(id => !visibleRuleIds.has(id))) return false;"
        // So yes, if a card has Label A, and Rule A is unchecked, it hides.
        return mappedCards.filter(c => c.labels && c.labels.some(l => l.id === rule.labelId)).length;
    };


    // Helpers to render icons
    const renderIcon = (iconName) => (
        <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{ marginRight: '6px', verticalAlign: 'middle' }}
            dangerouslySetInnerHTML={{ __html: ICONS[iconName ? iconName.toLowerCase() : 'map-marker'] || ICONS['map-marker'] }}
        />
    );

    const renderColorDot = (color) => {
        const colorMap = {
            'blue': '#3388ff', 'red': '#ff6b6b', 'green': '#51cf66',
            'orange': '#ffa94d', 'yellow': '#ffd43b', 'grey': '#868e96', 'black': '#343a40'
        };
        const bg = colorMap[color] || color;
        return (
            <span style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: bg,
                display: 'inline-block',
                marginRight: '8px',
                verticalAlign: 'middle',
                border: '1px solid rgba(0,0,0,0.2)'
            }}></span>
        );
    };

    if (!isExpanded) {
        return (
            <div className="map-filters-overlay collapsed" onClick={() => setIsExpanded(true)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="filter-icon">
                    <path d="M3 6H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M7 12H17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M10 18H14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Filters
            </div>
        );
    }

    // Determine default/no-rule checkbox state
    // We assume 'default' rule ID is 'default'

    return (
        <div className="map-filters-overlay expanded">
            <div className="filters-header" onClick={() => setIsExpanded(false)}>
                <h3>Filters</h3>
                <span className="close-filters">▼</span>
            </div>

            <div className="filters-content">
                <div className="filters-actions">
                    <button onClick={() => onToggleAll(true)}>Show All</button>
                    <button onClick={() => onToggleAll(false)}>Hide All</button>
                </div>

                {/* BLOCKS SECTION */}
                <div className="filter-section">
                    <h4>Blocks & Lists</h4>
                    {blocks.filter(b => b.includeOnMap !== false).map(block => {
                        // Check if all lists in this block are visible
                        const relevantLists = block.listIds; // All list IDs in this block
                        const allVisible = relevantLists.every(id => visibleListIds.has(id));
                        const someVisible = relevantLists.some(id => visibleListIds.has(id));

                        return (
                            <div key={block.id} className="filter-group">
                                <div className="filter-row block-row">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={allVisible}
                                            ref={input => { if (input) input.indeterminate = someVisible && !allVisible; }}
                                            onChange={(e) => onToggleBlock(block.id, e.target.checked)}
                                        />
                                        <span className="label-text">
                                            {renderIcon(block.mapIcon)}
                                            {block.name} <span style={{ opacity: 0.6, marginLeft: '4px' }}>({getBlockCount(block)})</span>
                                        </span>
                                    </label>
                                </div>
                                <div className="nested-lists">
                                    {block.listIds.map(listId => {
                                        const list = lists.find(l => l.id === listId);
                                        if (!list) return null;
                                        return (
                                            <div key={listId} className="filter-row list-row">
                                                <label>
                                                    <input
                                                        type="checkbox"
                                                        checked={visibleListIds.has(listId)}
                                                        onChange={() => onToggleList(listId)}
                                                    />
                                                    <span className="label-text">{list.name} <span style={{ opacity: 0.6, marginLeft: '4px' }}>({getListCount(listId)})</span></span>
                                                </label>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* VARIANTS SECTION */}
                <div className="filter-section">
                    <h4>Marker Variants</h4>

                    {/* Default Variant */}
                    <div className="filter-row">
                        <label>
                            <input
                                type="checkbox"
                                checked={visibleRuleIds.has('default')}
                                onChange={() => onToggleRule('default')}
                            />
                            <span className="label-text">
                                {renderColorDot('blue')}
                                Default / No Rule <span style={{ opacity: 0.6, marginLeft: '4px' }}>({getRuleCount(null, true)})</span>
                            </span>
                        </label>
                    </div>

                    {markerRules.map(rule => {
                        // Resolve label name if available?
                        // For now just show "Variant X" or rule description?
                        // User requirement: "All icons keep same size". "list of variant should be displayed"
                        // Rule usually maps a Label to an Icon/Color override.
                        // Display format: [Icon/Color] Rule Name (Label Name)

                        // We need access to label names? MapView doesn't pass them to us easily yet.
                        // Assuming simple display for now.

                        return (
                            <div key={rule.id} className="filter-row">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={visibleRuleIds.has(rule.id)}
                                        onChange={() => onToggleRule(rule.id)}
                                    />
                                    <span className="label-text">
                                        {rule.overrideType === 'color' ? renderColorDot(rule.overrideValue) : renderIcon(rule.overrideValue)}
                                        {/* Look up label name */}
                                        {(() => {
                                            const label = allLabels ? allLabels.find(l => l.id === rule.labelId) : null;
                                            return label ? label.name : (rule.labelName || 'Unknown Label');
                                        })()}
                                        <span style={{ opacity: 0.6, marginLeft: '4px' }}>({getRuleCount(rule, false)})</span>
                                    </span>
                                </label>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default MapFilters;
