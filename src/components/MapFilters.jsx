import React, { useState, useEffect } from 'react';
import { ICONS } from './common/IconPicker';

const MapFilters = ({
    blocks,
    lists,
    allLabels,
    cards,
    markerRules,
    visibleListIds,
    visibleRuleIds,
    onToggleList,
    onToggleBlock,
    onToggleRule,
    // onToggleAll, // Removed
    onToggleAllBlocks,
    onToggleAllRules,
    homeLocation,
    showHomeLocation,
    onToggleHome
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
        const mappedCards = cards.filter(c => c.coordinates && c.coordinates.lat);
        if (isDefault) {
            return mappedCards.filter(c => {
                for (const r of markerRules) {
                    if (c.labels && c.labels.some(l => l.id === r.labelId)) return false;
                }
                return true;
            }).length;
        }
        return mappedCards.filter(c => c.labels && c.labels.some(l => l.id === rule.labelId)).length;
    };


    // Helpers to render icons/dots
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
            'orange': '#ffa94d', 'yellow': '#ffd43b', 'grey': '#868e96', 'black': '#343a40',
            'purple': '#9c27b0'
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

    // --- Header Checkbox Logic ---
    // Blocks
    const allBlockListIds = blocks.filter(b => b.includeOnMap !== false).flatMap(b => b.listIds);
    const allBlocksVisible = allBlockListIds.length > 0 && allBlockListIds.every(id => visibleListIds.has(id));
    const someBlocksVisible = allBlockListIds.some(id => visibleListIds.has(id));

    // Rules
    const allRuleIds = markerRules.map(r => r.id).concat(['default']);
    const allRulesVisible = allRuleIds.every(id => visibleRuleIds.has(id));
    const someRulesVisible = allRuleIds.some(id => visibleRuleIds.has(id));

    return (
        <div className="map-filters-overlay expanded">
            <div className="filters-header" onClick={() => setIsExpanded(false)}>
                <h3>Filters</h3>
                <span className="close-filters">▼</span>
            </div>

            <div className="filters-content">

                {/* BLOCKS SECTION */}
                <div className="filter-section">
                    <div className="section-header-row">
                        <h4>Blocks</h4>
                    </div>

                    {blocks.filter(b => b.includeOnMap !== false).map(block => {
                        const relevantLists = block.listIds;
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
                    <div className="section-header-row">
                        <h4>Marker Variants</h4>
                    </div>

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

                    {markerRules.map(rule => (
                        <div key={rule.id} className="filter-row">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={visibleRuleIds.has(rule.id)}
                                    onChange={() => onToggleRule(rule.id)}
                                />
                                <span className="label-text">
                                    {rule.overrideType === 'color' ? renderColorDot(rule.overrideValue) : renderIcon(rule.overrideValue)}
                                    {(() => {
                                        const label = allLabels ? allLabels.find(l => l.id === rule.labelId) : null;
                                        return label ? label.name : (rule.labelName || 'Unknown Label');
                                    })()}
                                    <span style={{ opacity: 0.6, marginLeft: '4px' }}>({getRuleCount(rule, false)})</span>
                                </span>
                            </label>
                        </div>
                    ))}
                </div>

                {/* HOME LOCATION SECTION */}
                {homeLocation && (
                    <div className="filter-section" style={{ borderTop: '1px solid #eee', paddingTop: '10px' }}>
                        <div className="filter-row">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={showHomeLocation}
                                    onChange={onToggleHome}
                                />
                                <span className="label-text">
                                    {renderIcon(homeLocation.icon)}
                                    <strong>Home</strong>
                                </span>
                            </label>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MapFilters;
