import React, { useState, useEffect } from 'react';
import { ICONS } from './common/IconPicker';

const MapFilters = ({
    blocks,
    lists,
    markerRules,
    visibleListIds,
    visibleRuleIds,
    onToggleList,
    onToggleBlock,
    onToggleRule,
    onToggleAll
}) => {
    const [isExpanded, setIsExpanded] = useState(false);

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
                <span className="filter-icon">🌪️</span> Filters
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
                                            {block.name}
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
                                                    <span className="label-text">{list.name}</span>
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
                                Default / No Rule
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
                                        {/* Ideally show the Label Name here if possible, passed as prop or just "Custom Rule" */}
                                        {rule._labelName ? rule._labelName : `Variant (${rule.overrideType})`}
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
