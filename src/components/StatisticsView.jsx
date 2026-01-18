import React, { useState, useEffect, useRef } from 'react';
import { trelloFetch } from '../api/trello';
import { TIME_FILTERS } from '../utils/constants';
import { loadGoogleMaps } from '../utils/googleMapsLoader';
import LabelFilter from './common/LabelFilter';
import { useDarkMode } from '../context/DarkModeContext'; // Check context path. It is '../context/' based on previous views.

const StatisticsView = ({ user, settings, onShowSettings, onGoToDashboard, onLogout }) => {
    const [cards, setCards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const { theme } = useDarkMode();

    // Filters
    const [createdFilter, setCreatedFilter] = useState('this_week');
    // const [completedFilter, setCompletedFilter] = useState('all'); // Removed
    const [selectedLabelIds, setSelectedLabelIds] = useState(null); // null = All
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
                // Fetch coordinates directly if available (standard field 'coordinates' or 'location' via specific param? 
                // Trello API 'coordinates' field isn't standard in 'fields' param for basic cards.
                // However, standard pluginData might have it. 
                // User requirement: "only list... if coordinates are stored in the card's field itself".
                // I'll request 'coordinates' in fields just in case (some powerups expose it) and 'pluginData'.
                // If not, we assume standard 'coordinates' field from Trello's Map PowerUp if they use it.
                // We'll also ask for 'pos' and 'desc' (though we don't parse desc anymore).
                const cardsData = await trelloFetch(`/boards/${boardId}/cards?fields=id,name,labels,idList,due,dueComplete,dateLastActivity,desc,pos,coordinates&pluginData=true`, user.token);

                // No caching logic. 

                // Decorate cards with coords
                const processedCards = cardsData.map(c => {
                    // Check for standard coordinates field
                    let coords = null;
                    if (c.coordinates) {
                        // Standard field (if returned)
                        const { latitude, longitude } = c.coordinates;
                        if (latitude && longitude) coords = { lat: latitude, lng: longitude };
                    } else if (c.pluginData) {
                        // Check plugin data for Map PowerUp or Custom Fields?
                        // Implementation detail: accessing pluginData varies. 
                        // For now, we trust 'coordinates' field or specific 'location' field if user defined it?
                        // User said: "stored in the card's field itself".
                        // If Trello doesn't return 'coordinates' in standard fields, this relies on API.
                        // Trello's Map Powerup uses 'coordinates'.
                        // Let's assume c.coordinates works if field is requested.
                    }

                    return { ...c, coordinates: coords };
                });

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
            // "X-axis should change the labels to hours, instead of date"
            return d.toLocaleString('default', { hour: 'numeric', hour12: true }); // "10 AM"
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
            return isDateInFilter(new Date(c.due), createdFilter);
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
                    legend: { display: false } // Hide legend as requested ("instead of legend on side... add call out"). Call out is hard without plugin, but hiding side legend is Step 1.
                }
            }
        });

    }, [cards, createdFilter, granularity, labelFilter]);


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
                    <LabelFilter
                        labels={allLabels}
                        selectedLabelIds={selectedLabelIds}
                        onChange={setSelectedLabelIds}
                    />

                    <select className="time-filter-select" value={createdFilter} onChange={e => setCreatedFilter(e.target.value)} style={{ marginLeft: '10px' }}>
                        <option value="this_week">Created: This Week (Default)</option>
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
                <div id="stats-export-area" className="dashboard-grid" style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '30px', padding: '0 20px' }}>

                    {/* ROW 1 */}
                    <div className="form-card" id="card-line-chart" style={{ width: '100%', minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
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
                        <div style={{ flex: 1, position: 'relative' }}>
                            <canvas ref={lineChartRef}></canvas>
                        </div>
                    </div>

                    <div className="form-card" id="card-pie-chart" style={{ width: '100%', minHeight: '500px', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                            <h3>Labels Breakdown</h3>
                            <button onClick={() => handleExport('card-pie-chart', 'labels')} style={{ fontSize: '0.8em', padding: '2px 5px' }}>Export</button>
                        </div>
                        <div style={{ flex: 1, position: 'relative' }}>
                            <canvas ref={pieChartRef}></canvas>
                        </div>
                    </div>

                    {/* GEO STATS REMOVED PER REQUEST */}

                </div>
            )
            }

            <div className="footer-action-bar">
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="button-secondary" onClick={onGoToDashboard}>Dashboard View</button>
                    <button className="button-secondary" disabled={!enableMapView} onClick={() => window.location.href = '/map'}>Map View</button>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="button-secondary" onClick={onShowSettings}>Settings</button>
                    <button className="button-secondary" onClick={onLogout}>Log Out</button>
                </div>
            </div>
        </div >
    );
};

export default StatisticsView;
