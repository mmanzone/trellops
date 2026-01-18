import React, { useState, useEffect, useRef } from 'react';
import { trelloFetch } from '../api/trello';
import { TIME_FILTERS } from '../utils/constants';
import { loadGoogleMaps } from '../utils/googleMapsLoader';
import LabelFilter from './common/LabelFilter';
import { useDarkMode } from '../context/DarkModeContext';

const StatisticsView = ({ user, settings, onShowSettings, onGoToDashboard, onLogout }) => {
    const [cards, setCards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const { theme } = useDarkMode();

    // Filters
    const [createdFilter, setCreatedFilter] = useState('this_week');
    const [selectedLabelIds, setSelectedLabelIds] = useState(null); // null = All
    const [granularity, setGranularity] = useState('day'); // 'day', 'hour', 'month'

    // Data for charts
    const [allLabels, setAllLabels] = useState([]);

    // Map Config
    const enableMapView = settings?.enableMapView;
    // Map Logic variables removed (geoStats, setGeoStats)

    const boardId = settings?.boardId;
    const boardName = settings?.boardName;

    // Chart Refs
    const lineChartRef = useRef(null);
    const pieChartRef = useRef(null);
    const lineChartInstance = useRef(null);
    const pieChartInstance = useRef(null);

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
                const cardsData = await trelloFetch(`/boards/${boardId}/cards?fields=id,name,labels,idList,due,dueComplete,dateLastActivity,desc,pos,coordinates&pluginData=true`, user.token);

                // Decorate cards with coords
                const processedCards = cardsData.map(c => {
                    let coords = null;
                    if (c.coordinates) {
                        const { latitude, longitude } = c.coordinates;
                        if (latitude && longitude) coords = { lat: latitude, lng: longitude };
                    }
                    return { ...c, coordinates: coords };
                });

                // Filter based on Settings (Archived / Lists)
                const statsSettings = settings?.statistics || {};
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
    }, [boardId, user.token, settings?.statistics]);


    // --- HELPERS ---
    const getCreationDate = (id) => new Date(1000 * parseInt(id.substring(0, 8), 16));

    const isDateInFilter = (date, filterKey) => {
        if (filterKey === 'all') return true;
        const f = TIME_FILTERS[filterKey];
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

        // Register Plugin if available
        if (window.ChartDataLabels) {
            try {
                window.Chart.register(window.ChartDataLabels);
            } catch (e) { }
        }

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
        // Filter: Must be completed, AND Completion Date must be in 'createdFilter' range.
        const filteredCompleted = cards.filter(c => {
            if (!c.dueComplete || !c.due) return false;
            return isDateInFilter(new Date(c.due), createdFilter); // Use 'createdFilter' for range
        });

        filteredCompleted.forEach(c => {
            const date = new Date(c.due);
            const key = formatDateBucket(date, granularity);
            if (!bucketMap.has(key)) bucketMap.set(key, { created: 0, completed: 0, sortDate: date.getTime() });
            bucketMap.get(key).completed++;
        });

        // Sort Keys
        const sortedKeys = Array.from(bucketMap.keys()).sort((a, b) => {
            const itemA = bucketMap.get(a);
            const itemB = bucketMap.get(b);
            return itemA.sortDate - itemB.sortDate;
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
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top' },
                    datalabels: { display: false } // Disable datalabels for Line Chart
                },
                scales: {
                    x: { title: { display: true, text: granularity === 'hour' ? 'Hour' : 'Date' } },
                    y: { title: { display: true, text: 'Count' }, beginAtZero: true }
                }
            }
        });


        // 2. Pie Chart (Labels)
        const labelCombinations = {};

        let pieCards = cards;
        if (selectedLabelIds && selectedLabelIds.size > 0) {
            pieCards = cards.filter(c => {
                if (!c.labels) return false;
                return c.labels.some(l => selectedLabelIds.has(l.id));
            });
        }

        pieCards.forEach(c => {
            if (!c.labels || c.labels.length === 0) {
                const key = "No Label";
                labelCombinations[key] = (labelCombinations[key] || 0) + 1;
            } else {
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
                maintainAspectRatio: false,
                layout: { padding: 30 },
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        color: '#000',
                        anchor: 'end',
                        align: 'end',
                        offset: 10,
                        backgroundColor: 'rgba(255,255,255,0.8)',
                        borderRadius: 4,
                        padding: 4,
                        formatter: (value, ctx) => {
                            const label = ctx.chart.data.labels[ctx.dataIndex];
                            return `${label}\\n(${value})`;
                        },
                        font: { weight: 'bold', size: 11 }
                    }
                }
            }
        });

    }, [cards, createdFilter, granularity, selectedLabelIds]);


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

                </div>
            )}

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
