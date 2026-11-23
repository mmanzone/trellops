import React, { useState, useEffect, useRef, useMemo } from 'react';
import { trelloFetch } from '../api/trello';
import { TIME_FILTERS, STORAGE_KEYS } from '../utils/constants';
import LabelFilter from './common/LabelFilter';
import { Sparkles, Loader2 } from 'lucide-react';
import DigitalClock from './common/DigitalClock';
import HamburgerMenu from './common/HamburgerMenu';
import { ThemeToggleButton, ScreenLockButton, PageTitle } from './common/HeaderControls';
import { renderMarkdown } from '../utils/markdown';
import { getTerminology } from '../utils/terminology';
import { useAISummary } from '../hooks/useAISummary';

const StatisticsView = ({ user, settings, onShowSettings, onGoToDashboard, onLogout, keepScreenOn, onToggleScreenLock }) => {
    const [cards, setCards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    
    // Naming config
    const terms = getTerminology(settings);
    const CardsTerm = terms.cards;
    const LabelsTerm = terms.labels ? terms.labels.charAt(0).toUpperCase() + terms.labels.slice(1) : 'Labels';
    
    // AI Summary State
    const { summaryText, isGenerating: isGeneratingSummary, source: summarySource, generate: generateSummary } = useAISummary();
    const summaryHtml = useMemo(() => renderMarkdown(summaryText), [summaryText]);

    // Filters
    const [createdFilter, setCreatedFilter] = useState('this_week');
    const [customRange, setCustomRange] = useState({ start: null, end: null });
    const [showCustomRange, setShowCustomRange] = useState(false);

    const [selectedLabelIds, setSelectedLabelIds] = useState(null); // null = All
    const [labelLogic, setLabelLogic] = useState('OR'); // 'AND' or 'OR'

    const [granularity, setGranularity] = useState('day'); // 'day', 'hour', 'month', 'cumulative_hour'

    // Data for charts
    const [allLabels, setAllLabels] = useState([]);
    const [members, setMembers] = useState([]);

    // Map Config
    const enableMapView = settings?.enableMapView;

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
                // Fetch labels, members and cards in parallel (previously sequential).
                // pluginData was dropped from the cards request: it is not used here and inflates the payload.
                const [labelsData, membersData, cardsData] = await Promise.all([
                    trelloFetch(`/boards/${boardId}/labels`, user.token),
                    trelloFetch(`/boards/${boardId}/members?fields=id,fullName`, user.token),
                    trelloFetch(`/boards/${boardId}/cards?fields=id,name,labels,idList,due,dueComplete,dateLastActivity,desc,pos,coordinates,badges,idMembers&actions=commentCard`, user.token),
                ]);
                setAllLabels(labelsData);
                setMembers(membersData);

                // Process coords (omitted for brevity as map logs are gone, but we keep structure)
                const processedCards = cardsData.map(c => {
                    let coords = null;
                    if (c.coordinates) {
                        const { latitude, longitude } = c.coordinates;
                        if (latitude && longitude) coords = { lat: latitude, lng: longitude };
                    }
                    return { ...c, coordinates: coords };
                });

                // Filter based on Settings
                const statsSettings = settings?.statistics || {};
                const includedLists = statsSettings.includedLists || [];
                const includedSet = new Set(includedLists);

                let finalCards = processedCards;
                if (includedLists.length > 0) {
                    finalCards = finalCards.filter(c => includedSet.has(c.idList));
                }

                const enableIgnoreKeywords = localStorage.getItem(STORAGE_KEYS.ENABLE_IGNORE_KEYWORDS + boardId) === 'true';
                const ignoreKeywords = localStorage.getItem(STORAGE_KEYS.IGNORE_KEYWORDS + boardId) || '';

                if (enableIgnoreKeywords && ignoreKeywords) {
                    const keywords = ignoreKeywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k);
                    if (keywords.length > 0) {
                        finalCards = finalCards.filter(c => !keywords.some(k => c.name.toLowerCase().includes(k)));
                    }
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
        if (filterKey === 'custom') {
            if (!customRange.start) return true;
            return date >= new Date(customRange.start) && (!customRange.end || date <= new Date(customRange.end));
        }

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

    const getFilterRange = (filterKey) => {
        if (filterKey === 'custom' && customRange.start) {
            return { start: new Date(customRange.start), end: customRange.end ? new Date(customRange.end) : new Date() };
        }

        if (filterKey === 'all') return null; // Unbounded

        const f = TIME_FILTERS[filterKey];
        if (!f) return null;

        if (f.type === 'relative') {
            const start = new Date();
            start.setMinutes(start.getMinutes() - f.minutes);
            return { start, end: new Date() };
        }
        if (f.type === 'calendar') {
            return { start: f.start, end: f.end || new Date() };
        }
        return null;
    };

    const formatDateBucket = (date, gran) => {
        const d = new Date(date);
        if (gran === 'hour') {
            return d.toLocaleString('default', { month: 'short', day: 'numeric', hour: 'numeric', hour12: true }); // "Jan 1, 10 AM"
        }
        if (gran === 'cumulative_hour') {
            return d.toLocaleString('default', { hour: 'numeric', hour12: true }); // "10 AM" (buckets all days together)
        }
        if (gran === 'month') {
            return d.toLocaleString('default', { month: 'short', year: 'numeric' }); // Jan 2026
        }
        // day
        return d.toLocaleDateString();
    };

    const matchesLabelFilter = (card) => {
        if (!selectedLabelIds || selectedLabelIds.size === 0) return true;
        if (!card.labels || card.labels.length === 0) return false; // If filtering by labels, card must have them

        const cardLabelIds = new Set(card.labels.map(l => l.id));

        if (labelLogic === 'AND') {
            // Card must have ALL selected labels
            for (let id of selectedLabelIds) {
                if (!cardLabelIds.has(id)) return false;
            }
            return true;
        } else {
            // OR: Card must have AT LEAST ONE selected label
            for (let id of selectedLabelIds) {
                if (cardLabelIds.has(id)) return true;
            }
            return false;
        }
    };


    // --- DERIVED STATE ---
    let filterLabelText = "";
    if (createdFilter === 'custom') {
        filterLabelText = `${new Date(customRange.start).toLocaleDateString()} - ${customRange.end ? new Date(customRange.end).toLocaleDateString() : 'Now'}`;
    } else {
        const f = TIME_FILTERS[createdFilter];
        filterLabelText = f ? f.label : createdFilter;
    }

    // Add Label Info
    let labelInfo = "";
    if (selectedLabelIds && selectedLabelIds.size > 0) {
        const labelNames = allLabels.filter(l => selectedLabelIds.has(l.id)).map(l => l.name || l.color);
        labelInfo = ` - Labels: ${labelNames.join(', ')}`;
        if (labelInfo.length > 50) labelInfo = ` - Labels: ${selectedLabelIds.size} selected`;
    }

    // --- CHART RENDERING ---
    useEffect(() => {
        if (loading || cards.length === 0) return;

        // Cleanup
        if (lineChartInstance.current) lineChartInstance.current.destroy();
        if (pieChartInstance.current) pieChartInstance.current.destroy();

        if (!window.Chart) return;

        if (window.ChartDataLabels) {
            try { window.Chart.register(window.ChartDataLabels); } catch (e) { }
        }

        try {

            // ==========================
            // 1. LINE CHART DATA
            // ==========================
            // Requirements: 
            // - X-Axis: Time (buckets). 
            // - Filter 1: Date Filter (Created Date Range).
            // - Filter 2: Labels (apply selections to the line chart too).
            // - Granularity: Day, Hour, Month, Cumulative Hour.

            // A. Filter Dataset first (Cross-filtering: Apply Label Filter to Line Chart)
            const lineChartCards = cards.filter(matchesLabelFilter);

            // B. Determine Range for Zero-Filling
            // If "hour" or "day", we want to show 0s.
            const range = getFilterRange(createdFilter);

            const bucketMap = new Map(); // key -> { created: 0, completed: 0, sortDate: ts }

            // Initialize Buckets for Zero-Filling if range exists
            if (range && (granularity === 'hour' || granularity === 'day' || granularity === 'cumulative_hour')) {
                let current = new Date(range.start);
                const end = new Date(range.end);

                // Safety: Don't infinite loop if range is bad
                if (current < end) {
                    while (current <= end) {
                        const key = formatDateBucket(current, granularity);
                        // For cumulative, key is just "10 AM".
                        // We need a sort index. For cumulative, 0-23.
                        // For others, timestamp.
                        let sortDate = current.getTime();
                        if (granularity === 'cumulative_hour') {
                            sortDate = current.getHours();
                        }

                        if (!bucketMap.has(key)) bucketMap.set(key, { created: 0, completed: 0, sortDate });

                        // Increment
                        if (granularity === 'hour' || granularity === 'cumulative_hour') current.setHours(current.getHours() + 1);
                        else current.setDate(current.getDate() + 1);
                    }
                }
                // For cumulative hour, strictly ensure 0-23 buckets exist?
                if (granularity === 'cumulative_hour') {
                    for (let h = 0; h < 24; h++) {
                        const dateSim = new Date(); dateSim.setHours(h, 0, 0, 0);
                        const key = formatDateBucket(dateSim, 'cumulative_hour');
                        if (!bucketMap.has(key)) bucketMap.set(key, { created: 0, completed: 0, sortDate: h });
                    }
                }
            }

            // C. Process Created (using filtered cards)
            // Only count if Created Date in filter
            const validCreatedCards = lineChartCards.filter(c => isDateInFilter(getCreationDate(c.id), createdFilter));
            validCreatedCards.forEach(c => {
                const date = getCreationDate(c.id);
                const key = formatDateBucket(date, granularity);

                let sortDate = date.getTime();
                if (granularity === 'cumulative_hour') sortDate = date.getHours();

                if (!bucketMap.has(key)) bucketMap.set(key, { created: 0, completed: 0, sortDate });
                bucketMap.get(key).created++;
            });

            // D. Process Completed
            // Only count if Completed Date in filter (same filter)
            const validCompletedCards = lineChartCards.filter(c => {
                if (!c.dueComplete || !c.due) return false;
                return isDateInFilter(new Date(c.due), createdFilter);
            });

            validCompletedCards.forEach(c => {
                const date = new Date(c.due);
                const key = formatDateBucket(date, granularity);

                let sortDate = date.getTime();
                if (granularity === 'cumulative_hour') sortDate = date.getHours();

                if (!bucketMap.has(key)) bucketMap.set(key, { created: 0, completed: 0, sortDate });
                bucketMap.get(key).completed++;
            });

            // Sort
            const sortedKeys = Array.from(bucketMap.keys()).sort((a, b) => {
                return bucketMap.get(a).sortDate - bucketMap.get(b).sortDate;
            });

            // Calculate Totals for Title
            const totalCreated = bucketMap && Array.from(bucketMap.values()).reduce((acc, val) => acc + val.created, 0);
            const totalCompleted = bucketMap && Array.from(bucketMap.values()).reduce((acc, val) => acc + val.completed, 0);





            const ctxLine = lineChartRef.current.getContext('2d');
            lineChartInstance.current = new window.Chart(ctxLine, {
                type: 'line',
                data: {
                    labels: sortedKeys,
                    datasets: [
                        {
                            label: `Created (${totalCreated})`,
                            data: sortedKeys.map(k => bucketMap.get(k).created),
                            borderColor: '#0079bf',
                            backgroundColor: '#0079bf',
                            tension: 0.1
                        },
                        {
                            label: `Completed (${totalCompleted})`,
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
                        title: {
                            display: true,
                            text: `${totalCreated} ${CardsTerm.toLowerCase()} created / ${totalCompleted} Completed - ${filterLabelText}${labelInfo}`,
                            font: { size: 16 }
                        },
                        datalabels: { display: false }
                    },
                    scales: {
                        x: { title: { display: true, text: granularity.includes('hour') ? 'Hour' : 'Date' } },
                        y: { title: { display: true, text: 'Count' }, beginAtZero: true }
                    }
                }
            });


            // ==========================
            // 2. PIE CHART (LABELS)
            // ==========================
            // Requirements:
            // - Filter 1: Label Filters (Standard).
            // - Filter 2: Date Filter (Bucketing). apply Date Filter to Pie Chart too?
            // Req: "the ceated date filter should also apply to the Labels breakdown chart."

            // A. Filter by Date first
            const pieCardsDateFiltered = cards.filter(c => isDateInFilter(getCreationDate(c.id), createdFilter));

            // B. Apply Label Filter logic (AND/OR) for visualization
            // Wait, normally Pie Chart shows distribution OF labels.
            // If I filter by "Label A", do I show only "Label A" slice?
            // Reuse matchesLabelFilter?
            // If I select "Label A" and "Label B" (OR), I expect to see distribution of cards having A or B.
            // The slices will represent label combinations or individual labels?
            // Previous logic: Slices = Unique Combinations of labels on cards.

            const validPieCards = pieCardsDateFiltered.filter(matchesLabelFilter);

            const labelCombinations = {};

            validPieCards.forEach(c => {
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
                    layout: { padding: 50 }, // Increased padding from 30 to 50
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
                                // Return array for newline support
                                return [label, `(${value})`];
                            },
                            font: { weight: 'bold', size: 11 }
                        }
                    }
                }
            });



        } catch (err) {
            console.error("Chart error:", err);
        }

    }, [cards, createdFilter, granularity, selectedLabelIds, labelLogic, customRange]); // Dependencies

    // --- HANDLERS ---
    const handleExport = (elementId, name) => {
        if (!window.html2canvas) { alert("Export library not loaded."); return; }
        const el = elementId ? document.getElementById(elementId) : document.querySelector('.dashboard-grid');
        window.html2canvas(el).then(canvas => {
            const link = document.createElement('a');
            link.download = `${boardName}-stats-${name || 'all'}.png`;
            link.href = canvas.toDataURL();
            link.click();
        });
    };

    const buildSummaryPayload = () => {
        const range = getFilterRange(createdFilter);
        const diffDays = range && range.end && range.start ? (range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24) : 0;

        const labelled = cards.filter(matchesLabelFilter);
        const uniqueCardsMap = new Map();
        labelled
            .filter(c => isDateInFilter(getCreationDate(c.id), createdFilter))
            .forEach(c => uniqueCardsMap.set(c.id, { card: c, created: true }));
        labelled
            .filter(c => c.dueComplete && c.due && isDateInFilter(new Date(c.due), createdFilter))
            .forEach(c => {
                const existing = uniqueCardsMap.get(c.id);
                if (existing) existing.completed = true;
                else uniqueCardsMap.set(c.id, { card: c, completed: true });
            });

        const memberNames = new Map(members.map(m => [m.id, m.fullName]));

        const cardsData = Array.from(uniqueCardsMap.values()).map(({ card: c, created, completed }) => {
            const out = { name: c.name };
            if (c.desc) out.desc = c.desc.replace(/\s+/g, ' ').substring(0, 80).trim();
            if (c.labels?.length) out.labels = c.labels.map(l => l.name || l.color);
            if (c.idMembers?.length) out.members = c.idMembers.map(id => memberNames.get(id) || id);
            const comments = (c.actions || []).filter(a => a.type === 'commentCard' && a.data?.text);
            // Newest few comments as snippets, plus the true total.
            if (comments.length) out.comments = comments.slice(0, 3).map(a => a.data.text.substring(0, 100));
            const commentsCount = Math.max(c.badges?.comments || 0, comments.length);
            if (commentsCount) out.commentsCount = commentsCount;
            if (c.coordinates) out.coords = {
                lat: Math.round(c.coordinates.lat * 1000) / 1000,
                lng: Math.round(c.coordinates.lng * 1000) / 1000
            };
            if (created) out.created = true;
            if (completed) out.completed = true;
            return out;
        });

        return {
            cardsData,
            periodLabel: filterLabelText,
            diffDays: Math.round(diffDays),
            customPromptContext: settings?.statistics?.customAIPrompt || ''
        };
    };

    const showClock = localStorage.getItem(STORAGE_KEYS.CLOCK_SETTING + boardId) !== 'false';

    const handleGenerateSummary = (force = false) => generateSummary(buildSummaryPayload(), { force });

    return (
        <div className="statistics-view" style={{ width: '100%', minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-primary)' }}>
            <div className="map-header">
                <PageTitle clock={showClock && <DigitalClock boardId={boardId} />}>
                    {boardName} <span className="page-title-suffix">Statistics</span>
                </PageTitle>
                <div className="map-header-actions" style={{ display: 'flex', alignItems: 'center' }}>
                    {/* Desktop Actions - Hidden on Mobile */}
                    <div className="desktop-only" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <LabelFilter
                            title={LabelsTerm}
                            labels={allLabels}
                            selectedLabelIds={selectedLabelIds}
                            onChange={setSelectedLabelIds}
                            labelLogic={labelLogic}
                            onLabelLogicChange={setLabelLogic}
                        />
                        <select id="stats-period-filter" className="time-filter-select" value={createdFilter} onChange={e => {
                            const val = e.target.value;
                            setCreatedFilter(val);
                            if (val === 'custom') setShowCustomRange(true);
                            else setShowCustomRange(false);
                        }} style={{ margin: 0 }}>
                            <option value="this_week">Created: This Week</option>
                            {Object.keys(TIME_FILTERS).filter(k => k !== 'all').map(k => (
                                <option key={k} value={k}>{TIME_FILTERS[k].label}</option>
                            ))}
                            <option value="custom">Custom Range</option>
                        </select>
                        {createdFilter === 'custom' && (
                            <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                                <input type="date" value={customRange.start || ''} onChange={e => setCustomRange({ ...customRange, start: e.target.value })} />
                                <span>to</span>
                                <input type="date" value={customRange.end || ''} onChange={e => setCustomRange({ ...customRange, end: e.target.value })} />
                            </div>
                        )}

                        <ScreenLockButton keepScreenOn={keepScreenOn} onToggle={onToggleScreenLock} />
                        <ThemeToggleButton />
                    </div>

                    <div className="mobile-only">
                        <HamburgerMenu>
                            {/* Section 1: Filters */}
                            <div className="hamburger-section" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', marginBottom: '15px' }}>
                                <strong>Filters</strong>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px', width: '100%', alignItems: 'center' }}>
                                    <div style={{ width: '85%', textAlign: 'center' }}>
                                        <LabelFilter
                                            title={LabelsTerm}
                                            labels={allLabels}
                                            selectedLabelIds={selectedLabelIds}
                                            onChange={setSelectedLabelIds}
                                            labelLogic={labelLogic}
                                            onLabelLogicChange={setLabelLogic}
                                        />
                                    </div>

                                    <select className="time-filter-select" value={createdFilter} onChange={e => {
                                        const val = e.target.value;
                                        setCreatedFilter(val);
                                        if (val === 'custom') setShowCustomRange(true);
                                        else setShowCustomRange(false);
                                    }} style={{ width: '85%', margin: 0 }}>
                                        <option value="this_week">Created: This Week</option>
                                        {Object.keys(TIME_FILTERS).filter(k => k !== 'all').map(k => (
                                            <option key={k} value={k}>{TIME_FILTERS[k].label}</option>
                                        ))}
                                        <option value="custom">Custom Range</option>
                                    </select>

                                    {createdFilter === 'custom' && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', width: '85%' }}>
                                            <input type="date" value={customRange.start || ''} onChange={e => setCustomRange({ ...customRange, start: e.target.value })} style={{ width: '100%' }} />
                                            <span style={{ textAlign: 'center' }}>to</span>
                                            <input type="date" value={customRange.end || ''} onChange={e => setCustomRange({ ...customRange, end: e.target.value })} style={{ width: '100%' }} />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Section 2: Actions */}
                            <div className="hamburger-section">
                                <strong>Actions</strong>
                                <button className="menu-link" onClick={onGoToDashboard}>
                                    Dashboard View
                                </button>
                                <button className="menu-link" disabled={!enableMapView} onClick={() => window.location.href = '/map'}>
                                    Map View
                                </button>
                                <button className="menu-link" onClick={onShowSettings}>
                                    Settings
                                </button>
                                <button className="menu-link" onClick={onLogout}>
                                    Log Out
                                </button>
                            </div>

                            {/* Theme Toggle at Bottom */}
                            <div className="hamburger-section" style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
                                <ThemeToggleButton />
                            </div>
                        </HamburgerMenu>
                    </div>
                </div>
            </div>
            <div className="container" style={{ flex: 1, paddingBottom: '80px' }}>

                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '400px', fontSize: '1.2em', color: '#666' }}>
                        Generating stats...
                    </div>
                ) : (
                    <div id="stats-export-area" className="dashboard-grid" style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '30px', padding: '0 20px' }}>

                        {/* AI Summary Section */}
                        <div className="form-card" style={{ width: '100%', display: 'flex', flexDirection: 'column', border: '1px solid var(--accent-light)', background: 'var(--bg-secondary)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: summaryText ? '15px' : '0' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent)' }}>
                                    <Sparkles size={20} />
                                    <h3 style={{ margin: 0, color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}>
                                        AI Summary for the period
                                        <span style={{ marginLeft: '10px', fontSize: '0.65em', padding: '2px 8px', backgroundColor: '#0052cc', color: 'white', borderRadius: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>Beta</span>
                                    </h3>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                    <button 
                                        className="button-link"
                                        onClick={onShowSettings}
                                        style={{ fontSize: '0.85em', textDecoration: 'underline', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                    >
                                        Create your custom prompt
                                    </button>
                                    <button 
                                        id="stats-generate-summary"
                                        className="button-primary" 
                                        onClick={() => handleGenerateSummary(false)}
                                        disabled={isGeneratingSummary}
                                        style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', fontSize: '0.9em' }}
                                    >
                                        {isGeneratingSummary ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                                        {isGeneratingSummary ? 'Generating...' : 'Generate Summary'}
                                    </button>
                                </div>
                            </div>
                            
                            {summaryText && (
                                <div 
                                    className="markdown-content ai-summary-content" 
                                    style={{ fontSize: '1.05em', lineHeight: '1.6', color: 'var(--text-primary)' }}
                                    dangerouslySetInnerHTML={{ __html: summaryHtml }}
                                />
                            )}
                            {summaryText && !isGeneratingSummary && (summarySource === 'browser' || summarySource === 'server') && (
                                <div style={{ marginTop: '8px', fontSize: '0.8em', color: 'var(--text-secondary)' }}>
                                    Cached summary for this data.{' '}
                                    <button
                                        className="button-link"
                                        onClick={() => handleGenerateSummary(true)}
                                        style={{ fontSize: '1em', textDecoration: 'underline', color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                                    >
                                        Regenerate
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="form-card" id="card-line-chart" style={{ width: '100%', minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                                <h3 style={{ textTransform: 'capitalize' }}>{CardsTerm} Created / Completed</h3>
                                <div style={{ display: 'flex', gap: '5px' }}>
                                    <select value={granularity} onChange={e => setGranularity(e.target.value)} style={{ padding: '2px', fontSize: '0.9em' }}>
                                        <option value="day">By Day</option>
                                        <option value="hour">By Hour</option>
                                        <option value="cumulative_hour">Per Hour (Cumulative)</option>
                                        <option value="month">By Month</option>
                                    </select>
                                    <button className="button-secondary" onClick={() => handleExport('card-line-chart', 'timeline')}>Export</button>
                                </div>
                            </div>
                            <div style={{ flex: 1, position: 'relative' }}>
                                <canvas ref={lineChartRef}></canvas>
                            </div>
                        </div>

                        <div className="form-card" id="card-pie-chart" style={{ width: '100%', minHeight: '500px', display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                                <h3>{LabelsTerm} Breakdown - {filterLabelText}</h3>
                                <button className="button-secondary" onClick={() => handleExport('card-pie-chart', 'labels')}>Export</button>
                            </div>
                            <div style={{ flex: 1, position: 'relative' }}>
                                <canvas ref={pieChartRef}></canvas>
                            </div>
                        </div>

                    </div>
                )}

            </div>
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
