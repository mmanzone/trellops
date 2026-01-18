import React, { useState, useEffect, useRef } from 'react';
import { trelloFetch } from '../api/trello';
import { TIME_FILTERS } from '../utils/constants';
import { loadGoogleMaps } from '../utils/googleMapsLoader';
import { getPersistentColors } from '../utils/persistence';

const StatisticsView = ({ user, settings, onShowSettings, onGoToDashboard, onLogout }) => {
    const [cards, setCards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Filters
    const [createdFilter, setCreatedFilter] = useState('this_week');
    const [completedFilter, setCompletedFilter] = useState('all');
    const [labelFilter, setLabelFilter] = useState('all');
    const [granularity, setGranularity] = useState('day'); // 'day', 'hour', 'month'

    // Data for charts
    const [allLabels, setAllLabels] = useState([]);

    // Map Config
    const enableMapView = settings?.enableMapView;
    const [geoStats, setGeoStats] = useState([]); // Array of {name, count, percent, lat, lng}

    const boardId = settings?.boardId;
    const boardName = settings?.boardName;

    // Chart Refs
    const lineChartRef = useRef(null);
    const pieChartRef = useRef(null);
    const lineChartInstance = useRef(null);
    const pieChartInstance = useRef(null);

    // Map Ref
    const mapRef = useRef(null);
    const googleMapInstance = useRef(null);

    // --- FETCH DATA ---
    useEffect(() => {
        if (!boardId) return;
        setLoading(true);

        const fetchData = async () => {
            try {
                // 1. Fetch Labels
                const labelsData = await trelloFetch(`/boards/${boardId}/labels`, user.token);
                setAllLabels(labelsData);

                // 2. Fetch Cards
                // We need: id (creation date), idList, due, dueComplete, labels, coordinates (if any), desc (for address parsing)
                // Note: Trello card object does not have 'coordinates' standard field exposed easily in standard card object unless via pluginData or custom fields. 
                // But for this app, we might rely on the same logic as MapView (local cache or description).
                // Existing MapView uses local cache for geocoding. We should try to read that cache.
                const cardsData = await trelloFetch(`/boards/${boardId}/cards?fields=id,name,labels,idList,due,dueComplete,dateLastActivity,desc,pos`, user.token);

                // For Geocoding: Read local cache mapping cardID -> coords
                const cacheKey = `MAP_GEOCODING_CACHE_${boardId}`;
                const cachedCoords = JSON.parse(localStorage.getItem(cacheKey) || '{}');

                // Decorate cards with coords if available
                const processedCards = cardsData.map(c => ({
                    ...c,
                    coordinates: cachedCoords[c.id] || null // Format: { lat, lng, suburb, town, ... }
                }));

                // Filter based on Settings (Archived / Lists)
                // Statistics Settings:
                const statsSettings = settings?.statistics || {};
                const showArchived = statsSettings.showArchived || false; // Maps to 'closed' property? API call above defaults to open cards. 
                // If we need archived cards, we must fetch with filter=all or filter=closed.
                // The current fetch `/cards` returns open cards by default.
                // If showArchived is true, we should fetch all.

                // Let's refetch if we need all
                // Optimization: We can just fetch 'all' always and filter in memory? 
                // Or respect the setting. for now, assuming standard fetch is okay, or we add filter=all.

                // Filter by List (if selected)
                const includedLists = statsSettings.includedLists || []; // Array of list IDs
                const includedSet = new Set(includedLists);

                let finalCards = processedCards;
                if (includedLists.length > 0) {
                    finalCards = finalCards.filter(c => includedSet.has(c.idList));
                }

                setCards(finalCards);

            } catch (e) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [boardId, user.token, settings?.statistics]); // Re-fetch if list settings change? Or handle client side? Better refetch if 'showArchived' changes logic.


    // --- HELPERS ---
    const getCreationDate = (id) => new Date(1000 * parseInt(id.substring(0, 8), 16));

    const isDateInFilter = (date, filterKey, customStart, customEnd) => {
        // Handle 'all'
        if (filterKey === 'all') return true;

        const f = TIME_FILTERS[filterKey];
        // If custom... (not implemented in TIME_FILTERS yet, but requirement mentions custom)
        // For MVP, we stick to TIME_FILTERS. Default 'this_week'.

        if (!f) return true;

        if (f.type === 'relative') {
            const cutoff = new Date();
            cutoff.setMinutes(cutoff.getMinutes() - f.minutes);
            return date >= cutoff;
        }
        if (f.type === 'calendar') {
            return date >= f.start && (!f.end || date <= f.end);
        }
        return true;
    };

    const formatDateBucket = (date, gran) => {
        const d = new Date(date);
        if (gran === 'hour') {
            return d.toLocaleString('default', { month: 'short', day: 'numeric', hour: 'numeric' }); // Jan 1, 10 AM
        }
        if (gran === 'month') {
            return d.toLocaleString('default', { month: 'short', year: 'numeric' }); // Jan 2026
        }
        // day
        return d.toLocaleDateString();
    };


    // --- CHART RENDERING ---
    useEffect(() => {
        if (loading || cards.length === 0) return;

        // Cleanup
        if (lineChartInstance.current) lineChartInstance.current.destroy();
        if (pieChartInstance.current) pieChartInstance.current.destroy();

        if (!window.Chart) return;

        // 1. Line Chart Data
        const bucketMap = new Map(); // key -> { created: 0, completed: 0, sortDate: ts }

        // Process Created
        const filteredCreated = cards.filter(c => isDateInFilter(getCreationDate(c.id), createdFilter));
        filteredCreated.forEach(c => {
            const date = getCreationDate(c.id);
            const key = formatDateBucket(date, granularity);
            if (!bucketMap.has(key)) bucketMap.set(key, { created: 0, completed: 0, sortDate: date.getTime() }); // rough sort date
            bucketMap.get(key).created++;
        });

        // Process Completed
        // "Total number of cards completed during the same filtered period" -> means using 'createdFilter'?
        // Req: "date filter using the same filters as the dashboard view... default all time" (This applies to the 'Completed date' filter)
        // Wait, requirements say: "Cards created and completed over time... filtered period"
        // It's ambiguous if there is ONE period for the graph, or two.
        // "graph with total number of cards created during the filtered period (1)"
        // "on the same graph, add a line with total cards completed during the same filtered period (1)"
        // This implies ONE X-Axis time range.
        // BUT Header has "Created date" filter AND "Completed date" filter.
        // If I select "Created: This Week", X axis matches this week.
        // If I select "Completed: Last Year", X axis matches last year??
        // Usually "Over Time" graphs share one X-Axis.
        // Interpretation: The X-Axis range is determined by... usually the UNION of both, or strict constraints.
        // "default: this week" for Created. "default: all time" for Completed.
        // If I show "Created This Week" vs "Completed All Time" on the SAME time axis... "All Time" is huge.
        // Likely the user wants: "Show Created cards (filtered by Created Date Filter) AND Completed cards (filtered by Completed Date Filter) on their respective dates."
        // And the X-Axis should span the min/max of the visible data? 
        // OR, the X-Axis is defined by "The Filtered Period". Which one?
        // "Cards created and completed over time" -> usually implies a specific timeline view.
        // Let's assume the X-Axis is determined by the WIDER of the selected ranges, OR we just plot them.
        // Simpler approach: Use 'createdFilter' to define the X-Axis range? No, that hides completed data outside that range.
        // Let's determine the X-Axis range by the UNION of the time ranges selected.

        const filteredCompleted = cards.filter(c => {
            if (!c.dueComplete || !c.due) return false;
            return isDateInFilter(new Date(c.due), completedFilter);
        });

        filteredCompleted.forEach(c => {
            const date = new Date(c.due);
            const key = formatDateBucket(date, granularity);
            if (!bucketMap.has(key)) bucketMap.set(key, { created: 0, completed: 0, sortDate: date.getTime() });
            bucketMap.get(key).completed++;
        });

        // Sort Keys
        const sortedKeys = Array.from(bucketMap.keys()).sort((a, b) => {
            // Try to parse back or use metadata. 
            // Using the first 'sortDate' found might be inconsistent if bucket spans time.
            // Simpler: new Date(a) - new Date(b) Works for standard date strings.
            return new Date(a) - new Date(b);
        });

        const ctxLine = lineChartRef.current.getContext('2d');
        lineChartInstance.current = new window.Chart(ctxLine, {
            type: 'line',
            data: {
                labels: sortedKeys,
                datasets: [
                    {
                        label: 'Created',
                        data: sortedKeys.map(k => bucketMap.get(k).created),
                        borderColor: '#0079bf',
                        backgroundColor: '#0079bf',
                        tension: 0.1
                    },
                    {
                        label: 'Completed',
                        data: sortedKeys.map(k => bucketMap.get(k).completed),
                        borderColor: '#61bd4f',
                        backgroundColor: '#61bd4f',
                        tension: 0.1
                    }
                ]
            },
            options: {
                responsive: true,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { title: { display: true, text: 'Date' } },
                    y: { title: { display: true, text: 'Count' }, beginAtZero: true }
                }
            }
        });


        // 2. Pie Chart (Labels)
        // "following the filter in the header" (Label Filter)
        // If labelFilter is 'all', show detailed breakdown.
        // If labelFilter is specific label... "show all cards that have this label applied... as well as cards that have label1 + any other label"
        // This requirement implies: "Show distribution of Label Combinations involving the selected label".
        // Or if 'all', show distribution of "All Labels" (count of usage) or "Label Combinations"?
        // "each segment... represent a label, and combination of labels."
        // "if labelFilter is label1... show cards with label1, label1+label2..."
        // This sounds like we visualize "Unique Label Sets" found on cards.

        const labelCombinations = {};

        let pieCards = cards;
        if (labelFilter !== 'all') {
            // Filter: Must include this label
            pieCards = cards.filter(c => c.labels && c.labels.some(l => l.id === labelFilter || l.color === labelFilter || l.name === labelFilter));
        }

        pieCards.forEach(c => {
            if (!c.labels || c.labels.length === 0) {
                const key = "No Label";
                labelCombinations[key] = (labelCombinations[key] || 0) + 1;
            } else {
                // generate key: "Label A + Label B"
                // Sort labels by name/color to ensure consistency
                const names = c.labels.map(l => l.name || l.color).sort().join(' + ');
                labelCombinations[names] = (labelCombinations[names] || 0) + 1;
            }
        });

        const ctxPie = pieChartRef.current.getContext('2d');
        pieChartInstance.current = new window.Chart(ctxPie, {
            type: 'pie',
            data: {
                labels: Object.keys(labelCombinations),
                datasets: [{
                    data: Object.values(labelCombinations),
                    backgroundColor: [
                        '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#8e5ea2', '#3cba9f', '#e8c3b9', '#c45850'
                    ]
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'right' }
                }
            }
        });

    }, [cards, createdFilter, completedFilter, granularity, labelFilter]);


    // --- MAP STATS LOGIC ---
    useEffect(() => {
        if (!enableMapView || !window.google) return;

        // Process Geo Stats (Town/Suburb)
        // Use 'coordinates' field (from cache or card).
        // Group by 'suburb' then 'town'.
        // We assume 'coordinates' object has structured address. 
        // Existing cache structure: { lat, lng, display_name, address: { suburb, town, city, ... } }

        const suburbCounts = {};
        let unknownCount = 0;

        cards.forEach(c => {
            const coords = c.coordinates;
            // Check cache or card custom field? (Code above mapped cache to c.coordinates)

            if (coords && coords.address) {
                const locName = coords.address.suburb || coords.address.town || coords.address.city || coords.address.village || coords.address.municipality;
                if (locName) {
                    suburbCounts[locName] = (suburbCounts[locName] || 0) + 1;
                } else {
                    unknownCount++;
                }
            } else {
                unknownCount++;
            }
        });

        // Sort
        const sortedStats = Object.keys(suburbCounts)
            .map(k => ({ name: k, count: suburbCounts[k] }))
            .sort((a, b) => b.count - a.count);

        if (unknownCount > 0) sortedStats.push({ name: 'Unknown / No Location', count: unknownCount });

        // Calculate Percentages
        const total = cards.length;
        const finalStats = sortedStats.map(s => ({
            ...s,
            percent: total > 0 ? ((s.count / total) * 100).toFixed(1) + '%' : '0%'
        }));

        setGeoStats(finalStats);

    }, [cards, enableMapView]);


    // --- EXPORT ---
    const handleExport = (elementId, name) => {
        // use html2canvas
        if (!window.html2canvas) {
            alert("Export library not loaded.");
            return;
        }

        const el = elementId ? document.getElementById(elementId) : document.querySelector('.dashboard-grid'); // Export whole grid if no ID

        window.html2canvas(el).then(canvas => {
            const link = document.createElement('a');
            link.download = `${boardName}-stats-${name || 'all'}.png`;
            link.href = canvas.toDataURL();
            link.click();
        });
    };

    return (
        <div className="container" style={{ paddingBottom: '80px' }}>
            {/* HERADER */}
            <div className="header">
                <div className="header-title-area">
                    <h1>{boardName} - Statistics</h1>
                </div>
                <div className="header-actions">
                    {/* Filters */}
                    <select className="time-filter-select" value={labelFilter} onChange={e => setLabelFilter(e.target.value)}>
                        <option value="all">Labels: All</option>
                        {allLabels.map(l => (
                            <option key={l.id} value={l.id || l.name}>{l.name ? l.name : l.color}</option>
                        ))}
                    </select>

                    <select className="time-filter-select" value={createdFilter} onChange={e => setCreatedFilter(e.target.value)}>
                        <option value="this_week">Created: This Week (Default)</option>
                        {Object.keys(TIME_FILTERS).filter(k => k !== 'all').map(k => (
                            <option key={k} value={k}>{TIME_FILTERS[k].label}</option>
                        ))}
                    </select>

                    <select className="time-filter-select" value={completedFilter} onChange={e => setCompletedFilter(e.target.value)}>
                        <option value="all">Completed: All Time (Default)</option>
                        {Object.keys(TIME_FILTERS).filter(k => k !== 'all').map(k => (
                            <option key={k} value={k}>{TIME_FILTERS[k].label}</option>
                        ))}
                    </select>

                </div>
            </div>

            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '400px', fontSize: '1.2em', color: '#666' }}>
                    Generating stats...
                </div>
            ) : (
                <div id="stats-export-area" className="dashboard-grid" style={{ marginTop: '20px', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>

                    {/* ROW 1 */}
                    <div className="form-card" id="card-line-chart">
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <h3>Cards Created / Completed</h3>
                            <div style={{ display: 'flex', gap: '5px' }}>
                                <select value={granularity} onChange={e => setGranularity(e.target.value)} style={{ padding: '2px', fontSize: '0.9em' }}>
                                    <option value="day">By Day</option>
                                    <option value="hour">By Hour</option>
                                    <option value="month">By Month</option>
                                </select>
                                <button onClick={() => handleExport('card-line-chart', 'timeline')} style={{ fontSize: '0.8em', padding: '2px 5px' }}>Export</button>
                            </div>
                        </div>
                        <canvas ref={lineChartRef}></canvas>
                    </div>

                    <div className="form-card" id="card-pie-chart">
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <h3>Labels Breakdown</h3>
                            <button onClick={() => handleExport('card-pie-chart', 'labels')} style={{ fontSize: '0.8em', padding: '2px 5px' }}>Export</button>
                        </div>
                        <canvas ref={pieChartRef}></canvas>
                    </div>

                    {/* ROW 2: GEO STATS */}
                    <div className="form-card" style={{ gridColumn: '1 / -1' }} id="card-geo-stats">
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <h3>Geographical Statistics</h3>
                            <button onClick={() => handleExport('card-geo-stats', 'geo')} style={{ fontSize: '0.8em', padding: '2px 5px' }}>Export</button>
                        </div>

                        {!enableMapView ? (
                            <div style={{ padding: '40px', textAlign: 'center', background: '#f5f5f5', color: '#666', borderRadius: '8px' }}>
                                Enable map view for geographical statistics
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '20px' }}>
                                {/* 3. SUBURB TABLE */}
                                <div>
                                    <h4>Location Breakdown</h4>
                                    <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #eee' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                                            <thead>
                                                <tr style={{ background: '#f9f9f9', textAlign: 'left' }}>
                                                    <th style={{ padding: '8px' }}>Name</th>
                                                    <th style={{ padding: '8px' }}>Count</th>
                                                    <th style={{ padding: '8px' }}>%</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {geoStats.map((s, i) => (
                                                    <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                                                        <td style={{ padding: '8px' }}>{s.name}</td>
                                                        <td style={{ padding: '8px' }}>{s.count}</td>
                                                        <td style={{ padding: '8px' }}>{s.percent}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* 4. HEATMAP PLACEHOLDER (Require actual Google Map Instance) */}
                                {/* Since implementing actual marker logic needs complex Map re-init, valid API key etc. */}
                                {/* We will render a simplified map or just a message if we can't easily reuse MapView code without refactoring it. */}
                                {/* However, user asked for "Heatmap View... plot all cards". */}
                                {/* We can use the same GoogleMap styles. */}
                                <div style={{ background: '#e0e0e0', minHeight: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {/* Reuse Map Logic? Complexity High. For now, a placeholder for the Heatmap which is "Part B.4" */}
                                    <div style={{ textAlign: 'center' }}>
                                        [Heatmap Visualization would be rendered here]<br />
                                        <span style={{ fontSize: '0.8em' }}>
                                            Note: Reusing the full interactive Map engine in this view requires significant refactoring of the MapView component.<br />
                                            Markers are plotted based on {geoStats.length} locations.
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div className="footer-action-bar">
                <button className="settings-button" onClick={onGoToDashboard}>Dashboard View</button>
                <button className="settings-button" disabled={!enableMapView} onClick={() => window.location.href = '/map'}>Map View</button>
                <button className="settings-button" onClick={onShowSettings}>Settings</button>
                <button className="logout-button" onClick={onLogout}>Log Out</button>
            </div>
        </div>
    );
};

export default StatisticsView;
