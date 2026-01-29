import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { trelloFetch } from '/src/api/trello';
import { getPersistentLayout } from '/src/utils/persistence';
import { useDarkMode } from '/src/context/DarkModeContext';
import { STORAGE_KEYS } from '/src/utils/constants';
import { convertIntervalToSeconds, getLabelTextColor, formatDynamicCountdown } from '/src/utils/helpers';
import DigitalClock from './common/DigitalClock';
import { ICONS } from './common/IconPicker';
import MapFilters from './MapFilters';
import { loadGoogleMaps } from '/src/utils/googleMapsLoader';
import { marked } from 'marked';
import Dashboard from './Dashboard'; // For Slideshow
import HamburgerMenu from './common/HamburgerMenu';
import '/src/styles/map.css';

// --- CUSTOM MAP STYLES ---
const DARK_MODE_STYLE = [
    { elementType: "geometry", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#242f3e" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#746855" }] },
    {
        featureType: "poi",
        stylers: [{ visibility: "off" }],
    },
    {
        featureType: "administrative.locality",
        elementType: "labels.text.fill",
        stylers: [{ color: "#d59563" }],
    },
    {
        featureType: "poi",
        elementType: "labels.text.fill",
        stylers: [{ color: "#d59563" }],
    },
    {
        featureType: "poi.park",
        elementType: "geometry",
        stylers: [{ color: "#263c3f" }],
    },
    {
        featureType: "poi.park",
        elementType: "labels.text.fill",
        stylers: [{ color: "#6b9a76" }],
    },
    {
        featureType: "road",
        elementType: "geometry",
        stylers: [{ color: "#38414e" }],
    },
    {
        featureType: "road",
        elementType: "geometry.stroke",
        stylers: [{ color: "#212a37" }],
    },
    {
        featureType: "road",
        elementType: "labels.text.fill",
        stylers: [{ color: "#9ca5b3" }],
    },
    {
        featureType: "road.highway",
        elementType: "geometry",
        stylers: [{ color: "#746855" }],
    },
    {
        featureType: "road.highway",
        elementType: "geometry.stroke",
        stylers: [{ color: "#1f2835" }],
    },
    {
        featureType: "road.highway",
        elementType: "labels.text.fill",
        stylers: [{ color: "#f3d19c" }],
    },
    {
        featureType: "transit",
        elementType: "geometry",
        stylers: [{ color: "#2f3948" }],
    },
    {
        featureType: "transit.station",
        elementType: "labels.text.fill",
        stylers: [{ color: "#d59563" }],
    },
    {
        featureType: "water",
        elementType: "geometry",
        stylers: [{ color: "#17263c" }],
    },
    {
        featureType: "water",
        elementType: "labels.text.fill",
        stylers: [{ color: "#515c6d" }],
    },
    {
        featureType: "water",
        elementType: "labels.text.stroke",
        stylers: [{ color: "#17263c" }],
    },
];

// --- ICONS LOGIC ---
const getGoogleMarkerIcon = (markerConfig) => {
    const colorMap = {
        'blue': '#3388ff', 'red': '#ff6b6b', 'green': '#51cf66',
        'orange': '#ffa94d', 'yellow': '#ffd43b', 'grey': '#868e96', 'black': '#343a40',
        'purple': '#9c27b0'
    };
    const markerColor = colorMap[markerConfig.color] || colorMap['blue'];
    const iconName = (markerConfig.icon || 'map-marker').toLowerCase();
    const svgPath = ICONS[iconName] || ICONS['map-marker'];
    const pinPath = `<path d="M14 0C8 0 3 5 3 11c0 8 11 21 11 21s11-13 11-21C25 5 20 0 14 0z" fill="${markerColor}"/>`;
    const innerIconGroup = `<g transform="translate(7, 4) scale(0.58)" fill="#fff">${svgPath}</g>`;
    const svg = `
    <svg width="28" height="42" viewBox="0 0 28 42" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 3px 4px rgba(0,0,0,0.4));">
        ${pinPath}
        ${innerIconGroup}
    </svg>`;
    const url = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
    return {
        url: url,
        scaledSize: new window.google.maps.Size(28, 42),
        anchor: new window.google.maps.Point(14, 42),
        labelOrigin: new window.google.maps.Point(14, 15)
    };
};

const getMarkerConfig = (card, block, markerRules) => {
    let icon = block.mapIcon || 'map-marker';
    let color = 'blue';
    const activeRuleIds = ['default'];
    let iconSet = false;
    let colorSet = false;
    if (markerRules && markerRules.length > 0) {
        for (const rule of markerRules) {
            if (iconSet && colorSet) break;
            if (card.labels && card.labels.some(l => l.id === rule.labelId)) {
                if (rule.overrideType === 'icon' && !iconSet) {
                    icon = rule.overrideValue;
                    iconSet = true;
                    activeRuleIds.push(rule.id);
                } else if (rule.overrideType === 'color' && !colorSet) {
                    color = rule.overrideValue;
                    colorSet = true;
                    activeRuleIds.push(rule.id);
                }
            }
        }
    }
    if (activeRuleIds.length > 1) {
        const index = activeRuleIds.indexOf('default');
        if (index > -1) activeRuleIds.splice(index, 1);
    }
    return { icon, color, activeRuleIds };
};

// --- GEOCODING UTILS ---
function expandAbbreviations(address) {
    if (!address) return address;
    let expanded = address;
    expanded = expanded.replace(/^(?:CNR|Corner)\s+/i, 'Corner of ');
    const replacements = [
        [/\bRd\b/gi, 'Road'], [/\bAv\b/gi, 'Avenue'], [/\bAve\b/gi, 'Avenue'],
        [/\bSt\b/gi, 'Street'], [/\bDr\b/gi, 'Drive'], [/\bLn\b/gi, 'Lane'],
        [/\bCt\b/gi, 'Court'], [/\bPl\b/gi, 'Place'], [/\bCres\b/gi, 'Crescent'],
        [/\bBlvd\b/gi, 'Boulevard'], [/\bPde\b/gi, 'Parade'], [/\bHwy\b/gi, 'Highway'],
        [/\bFwy\b/gi, 'Freeway'],
    ];
    replacements.forEach(([regex, replacement]) => { expanded = expanded.replace(regex, replacement); });
    return expanded;
}

const parseAddressFromDescription = (desc) => {
    if (!desc || !desc.trim()) return null;
    const mapsPlaceMatch = desc.match(/https?:\/\/(?:www\.)?google\.[^\/\s]+\/maps\/place\/([^\s)]+)/i);
    if (mapsPlaceMatch) {
        const placePart = mapsPlaceMatch[1];
        try { return decodeURIComponent(placePart.replace(/\+/g, ' ')); } catch (e) { return placePart.replace(/\+/g, ' '); }
    }
    const coordMatch = desc.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    if (coordMatch) return `${coordMatch[1]},${coordMatch[2]}`;
    const addressPatterns = [
        /^\d+\s+[A-Za-z\s]+(?:St|Street|Ave|Avenue|Rd|Road|Ln|Lane|Dr|Drive|Way|Court|Ct|Place|Pl|Parkway|Crescent|Cres|Boulevard|Blvd)[^\n]*/i,
        /(?:CNR|Corner)\s+[A-Za-z\s]+[&\/]\s+[A-Za-z\s]+[^\n]*/i,
        /[A-Za-z\s]+(?:VIC|NSW|QLD|SA|WA|TAS|ACT)\s+\d{4}/i
    ];
    for (const pattern of addressPatterns) {
        const match = desc.match(pattern);
        if (match) {
            const address = match[0].trim();
            if (address.length > 5) return address;
        }
    }
    const lines = desc.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length > 0 && lines[0].length > 5) {
        if (!/^S\d+|^[A-Z]{2}\d+/.test(lines[0])) return lines[0];
    }
    return null;
};

// --- HELPER FUNCTIONS ---
// --- HELPER FUNCTIONS ---
/* formatCountdown removed - using formatDynamicCountdown from helpers */

// --- ERROR TOAST ---
const GeocodingErrorToast = ({ error, onDismiss, onApply, onIgnore }) => {
    const [manualAddress, setManualAddress] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const autocompleteService = useRef(null);
    useEffect(() => {
        if (window.google && window.google.maps && window.google.maps.places) {
            autocompleteService.current = new window.google.maps.places.AutocompleteService();
        }
    }, []);
    const handleManualAddressChange = (e) => {
        const val = e.target.value;
        setManualAddress(val);
        if (!val || val.length < 3) { setSearchResults([]); return; }
        if (autocompleteService.current) {
            autocompleteService.current.getPlacePredictions({ input: val }, (predictions, status) => {
                if (status === window.google.maps.places.PlacesServiceStatus.OK && predictions) setSearchResults(predictions);
                else setSearchResults([]);
            });
        }
    };
    const handleSelectResult = (prediction) => {
        const geocoder = new window.google.maps.Geocoder();
        geocoder.geocode({ placeId: prediction.place_id }, (results, status) => {
            if (status === 'OK' && results[0]) {
                const loc = results[0].geometry.location;
                onApply(error.cardId, { lat: loc.lat(), lng: loc.lng(), display_name: results[0].formatted_address });
            } else alert("Failed to get details for this location.");
        });
    };

    // Truncate description for display
    const descriptionPreview = error.cardDesc
        ? (error.cardDesc.length > 100 ? error.cardDesc.substring(0, 100) + '...' : error.cardDesc)
        : 'No description';

    return (
        <div className="status-message error-toast" style={{ borderColor: '#ff6b6b', width: '350px', flexDirection: 'column', alignItems: 'flex-start', padding: '12px', gap: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', marginBottom: '10px', animation: 'slideIn 0.3s ease-out', pointerEvents: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ color: '#c92a2a', fontWeight: 'bold', fontSize: '0.95em' }}>Geocoding Error</span>
                    {error.cardUrl ? (
                        <a href={error.cardUrl} target="_blank" rel="noreferrer" style={{ color: '#0057d9', fontWeight: 'bold', textDecoration: 'none', fontSize: '1em' }}>
                            {error.cardName || 'View Card'}
                        </a>
                    ) : (
                        <span style={{ fontWeight: 'bold' }}>{error.cardName || 'Unknown Card'}</span>
                    )}
                </div>
                <button onClick={() => onDismiss(error.cardId)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5em', lineHeight: '1', color: '#888' }}>&times;</button>
            </div>

            <div style={{ fontSize: '0.85em', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.03)', padding: '6px', borderRadius: '4px', width: '100%', marginTop: '4px' }}>
                {descriptionPreview}
            </div>

            <div style={{ fontSize: '0.9em', color: '#c92a2a', marginTop: '4px' }}>Failed Address: {error.failedAddress}</div>

            <div style={{ width: '100%', marginTop: '8px', display: 'flex', gap: '8px' }}>
                <button
                    onClick={() => onIgnore(error.cardId)}
                    style={{
                        flex: 1,
                        padding: '6px',
                        background: '#f8f9fa',
                        border: '1px solid #ced4da',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '0.85em',
                        color: '#495057'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = '#e9ecef'}
                    onMouseLeave={e => e.currentTarget.style.background = '#f8f9fa'}
                >
                    Do not show on map
                </button>
            </div>

            <div style={{ width: '100%', marginTop: '8px', borderTop: '1px solid #eee', paddingTop: '8px' }}>
                <label style={{ fontSize: '0.85em', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>Manual Fix (Search):</label>
                <div style={{ position: 'relative' }}>
                    <input type="text" value={manualAddress} onChange={handleManualAddressChange} placeholder="Search address..." style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }} />
                    {searchResults.length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 3000, background: 'white', border: '1px solid #ccc', borderRadius: '4px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', maxHeight: '150px', overflowY: 'auto', color: 'black' }}>
                            {searchResults.map((p) => (
                                <div key={p.place_id} onClick={() => handleSelectResult(p)} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #eee', fontSize: '0.9em' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f0f0f0'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'white'}>{p.description}</div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// --- POPUP COMPONENT ---
const CardPopup = ({ card, listName, blockName, blocks, lists, onMove, enableStreetView, onZoom, onFixAddress }) => {
    // Group lists by Block
    const groupedLists = blocks.reduce((acc, block) => {
        if (block.includeOnMap === false) return acc;
        acc[block.id] = { name: block.name, lists: [] };
        const blockListIds = block.listIds;
        lists.forEach(l => {
            if (blockListIds.includes(l.id)) {
                acc[block.id].lists.push(l);
            }
        });
        return acc;
    }, {});

    const creationDate = new Date(1000 * parseInt(card.id.substring(0, 8), 16));
    const now = new Date();
    const diffMs = now - creationDate;
    const diffMins = Math.floor(diffMs / 60000);
    let timeText = '';
    if (diffMins < 60) {
        timeText = `${diffMins} min${diffMins !== 1 ? 's' : ''}`;
    } else if (diffMins < 1440) {
        const hours = Math.round(diffMins / 60);
        timeText = `${hours} hour${hours !== 1 ? 's' : ''}`;
    } else {
        const days = Math.round(diffMins / 1440);
        timeText = `${days} day${days !== 1 ? 's' : ''}`;
    }

    return (
        <div style={{ padding: '5px', minWidth: '240px', maxWidth: '300px', fontFamily: 'sans-serif' }}>
            <a href={card.shortUrl} target="_blank" rel="noreferrer" style={{ fontSize: '1.2em', display: 'block', marginBottom: '4px', color: 'var(--text-color)', fontWeight: 'bold', textDecoration: 'none' }}>
                {card.name} ↗
            </a>
            <div style={{ fontSize: '1.05em', color: '#555', marginBottom: '8px', fontWeight: '500' }}>
                {blockName ? <span style={{ fontWeight: '700' }}>{blockName} &rsaquo; </span> : ''}
                {listName}
            </div>

            {/* Description (Markdown) */}
            {/* Description (Markdown) */}
            {card.desc && card.desc.trim() !== "" && (
                <div
                    className="popup-desc"
                    style={{ marginBottom: '10px', fontSize: '0.95em', color: '#111', lineHeight: '1.5' }}
                    dangerouslySetInnerHTML={{ __html: marked.parse(card.desc) }}
                />
            )}

            {/* Labels */}
            {card.labels && card.labels.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
                    {card.labels.map(l => (
                        <span key={l.id} style={{
                            backgroundColor: l.color ? (l.color === 'sky' ? '#00c2e0' : l.color) : '#ccc',
                            color: getLabelTextColor(l.color),
                            padding: '3px 8px', borderRadius: '12px', fontSize: '0.75em', fontWeight: 'bold',
                            border: '1px solid rgba(0,0,0,0.1)'
                        }}>{l.name}</span>
                    ))}
                </div>
            )}

            {/* Creation Date instead of Due Date */}
            <div style={{ fontSize: '0.9em', color: '#555', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span style={{ fontWeight: 'bold' }}>Active for:</span> {timeText}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #eee' }}>
                {/* View Street View Button */}
                <div style={{ display: 'flex', gap: '10px' }}>
                    {card.coordinates && enableStreetView && (
                        <button
                            title="Open in Street View"
                            onClick={() => window.open(`https://www.google.com/maps?layer=c&cbll=${card.coordinates.lat},${card.coordinates.lng}`, '_blank')}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', padding: '4px' }}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: ICONS['street-view'] }} />
                        </button>
                    )}
                    {/* Zoom to Card Button */}
                    <button
                        title="Zoom to Card"
                        onClick={() => onZoom && onZoom(card)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', padding: '4px' }}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="22" y1="12" x2="18" y2="12" />
                            <line x1="6" y1="12" x2="2" y2="12" />
                            <line x1="12" y1="6" x2="12" y2="2" />
                            <line x1="12" y1="22" x2="12" y2="18" />
                        </svg>
                    </button>
                    {/* Fix Address Button */}
                    <button
                        title="Fix Address"
                        onClick={() => onFixAddress && onFixAddress(card)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', padding: '4px' }}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                    </button>
                </div>

                {/* Move Action */}
                {
                    onMove && lists.length > 0 && (
                        <select
                            onChange={(e) => onMove(card.id, e.target.value)}
                            value=""
                            style={{ maxWidth: '140px', fontSize: '0.9em', padding: '4px', borderRadius: '4px', borderColor: '#dfe1e6' }}
                        >
                            <option value="" disabled>Move to...</option>
                            {Object.values(groupedLists).map(group => (
                                group.lists.length > 0 && (
                                    <optgroup key={group.name} label={group.name}>
                                        {group.lists.map(l => (
                                            <option key={l.id} value={l.id}>{l.name}</option>
                                        ))}
                                    </optgroup>
                                )
                            ))}
                        </select>
                    )
                }
            </div >
        </div >
    );
};


const MapView = ({ user, settings, onClose, onShowSettings, onLogout, onShowTasks, onShowDashboard, isEmbedded, slideshowContent, onStopSlideshow, onStartSlideshow }) => {
    const [cards, setCards] = useState([]);
    const [lists, setLists] = useState([]);
    const [boardLabels, setBoardLabels] = useState([]);
    const [status, setStatus] = useState('');
    const [loading, setLoading] = useState(true);
    const [geocodingQueue, setGeocodingQueue] = useState([]);
    const [blocks, setBlocks] = useState([]);

    const [ignoredCards, setIgnoredCards] = useState(new Set());

    const [visibleListIds, setVisibleListIds] = useState(new Set());
    const [visibleRuleIds, setVisibleRuleIds] = useState(new Set(['default']));
    const [showHomeLocation, setShowHomeLocation] = useState(true);

    const [baseMap, setBaseMap] = useState('roadmap');
    const [errors, setErrors] = useState([]);
    const [markerRules, setMarkerRules] = useState([]);
    const [homeLocation, setHomeLocation] = useState(null);
    const [countdown, setCountdown] = useState(null);
    const [mapLoaded, setMapLoaded] = useState(false);
    const [initialFitDone, setInitialFitDone] = useState(false);

    // --- NEW: Single InfoWindow Ref & Currently Open Card ---
    const infoWindowRef = useRef(null);
    const currentOpenCardId = useRef(null);

    // --- NEW: Track Previous Card Count for Fit Bounds ---
    const prevValidCardCount = useRef(0);

    const { theme, toggleTheme } = useDarkMode();
    const mapRef = useRef(null);
    const googleMapRef = useRef(null);
    const markersRef = useRef({});
    const homeMarkerRef = useRef(null);
    const geocoderRef = useRef(null);

    // --- SETTINGS ---
    const getStoredSettings = () => {
        if (!user) return {};
        try { return JSON.parse(localStorage.getItem('trelloUserData') || '{}')[user.id]?.settings || {}; } catch (e) { return {}; }
    };
    const storedSettings = getStoredSettings();
    const boardId = settings?.boardId || storedSettings.boardId;
    const boardName = (settings && settings.boardName) ? settings.boardName : (storedSettings.boardName || 'Trello Board');
    const mapGeocodeMode = (settings && settings.mapGeocodeMode) || storedSettings?.mapGeocodeMode || 'store';
    const ignoreTemplateCards = localStorage.getItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + boardId) !== 'false';
    const ignoreCompletedCards = localStorage.getItem(STORAGE_KEYS.IGNORE_COMPLETED_CARDS + boardId) === 'true';
    const ignoreNoDescCards = localStorage.getItem(STORAGE_KEYS.IGNORE_NO_DESC_CARDS + boardId) === 'true';

    const updateTrelloCoordinates = localStorage.getItem('updateTrelloCoordinates_' + boardId) === 'true';
    const enableCardMove = localStorage.getItem('enableCardMove_' + boardId) === 'true';
    const enableStreetView = localStorage.getItem('enableStreetView_' + boardId) === 'true';

    const savedRefresh = localStorage.getItem(STORAGE_KEYS.REFRESH_INTERVAL + boardId);
    const defaultRefreshSetting = { value: 1, unit: 'minutes' };
    const refreshSetting = savedRefresh ? JSON.parse(savedRefresh) : defaultRefreshSetting;
    const refreshIntervalSeconds = convertIntervalToSeconds(refreshSetting.value, refreshSetting.unit);
    const showClock = localStorage.getItem(STORAGE_KEYS.CLOCK_SETTING + boardId) !== 'false';

    // Initialize shared InfoWindow
    useEffect(() => {
        if (!mapLoaded) return;
        infoWindowRef.current = new window.google.maps.InfoWindow();
        infoWindowRef.current.addListener('closeclick', () => {
            currentOpenCardId.current = null;
        });
    }, [mapLoaded]);

    const fitMapBounds = () => {
        if (!googleMapRef.current) return;
        const bounds = new window.google.maps.LatLngBounds();
        let count = 0;
        Object.values(markersRef.current).forEach(marker => {
            if (marker.getMap()) {
                bounds.extend(marker.getPosition());
                count++;
            }
        });
        if (homeMarkerRef.current && homeMarkerRef.current.getMap()) {
            bounds.extend(homeMarkerRef.current.getPosition());
            count++;
        }

        if (count === 1) {
            // Single marker (Home or Card) -> Zoom to it specifically
            googleMapRef.current.setCenter(bounds.getCenter());
            googleMapRef.current.setZoom(14);
        } else if (count > 1) {
            // Multiple markers -> Fit bounds with padding
            googleMapRef.current.fitBounds(bounds, { top: 80, bottom: 80, left: 50, right: 50 });
        } else {
            // Fallback: No markers visible
            if (homeLocation && homeLocation.coords) {
                // Zoom to Home Address even if not shown
                googleMapRef.current.setCenter({ lat: homeLocation.coords.lat, lng: homeLocation.coords.lon });
                googleMapRef.current.setZoom(14);
            } else {
                // Fallback: Australia
                googleMapRef.current.setCenter({ lat: -25.2744, lng: 133.7751 }); // Center of Australia
                googleMapRef.current.setZoom(4);
            }
        }
    };

    // --- TRAFFIC LAYER MANAGEMENT ---
    const trafficLayerRef = useRef(null);

    useEffect(() => {
        if (!googleMapRef.current || !mapLoaded) return;

        if (baseMap === 'traffic') {
            googleMapRef.current.setMapTypeId('roadmap');
            if (!trafficLayerRef.current) {
                trafficLayerRef.current = new window.google.maps.TrafficLayer();
            }
            trafficLayerRef.current.setMap(googleMapRef.current);
        } else {
            if (trafficLayerRef.current) {
                trafficLayerRef.current.setMap(null);
            }
            // Map 'satellite' to 'satellite', 'roadmap' to 'roadmap', 'terrain' to 'terrain', 'hybrid' to 'hybrid'
            // 'dark' is custom styled roadmap usually, handled by map options?
            // Wait, existing code handles 'dark' via stylized map options?
            // Let's check where baseMap is used. It's used in this useEffect technically if we add it.
            // Actually, the previous implementation of baseMap switching might be missing?
            // Let me check if there was an existing baseMap effect.
            // I don't see one in the previous `view_file`.
            // Wait, line 890 sets `baseMap`. But where is it USED?
            // I might have missed it.
            // If it wasn't used, then "Roadmap/Topo/Sat" wasn't working?
            // Ah, I need to check if there is an existing effect for `baseMap`.
            // If not, I should add it.
            // I'll assume I need to add it.

            // For 'dark', usually we set options.
            // But for standard types:
            if (baseMap !== 'dark' && baseMap !== 'traffic') {
                googleMapRef.current.setMapTypeId(baseMap);
            } else if (baseMap === 'dark') {
                // Use the registered 'dark_mode' map type
                googleMapRef.current.setMapTypeId('dark_mode');
            }
        }
    }, [baseMap, mapLoaded]);


    // --- INIT MAP ---
    const [showDashboardDropdown, setShowDashboardDropdown] = useState(false);
    const [showTaskDropdown, setShowTaskDropdown] = useState(false);
    const [visibleMarkersCount, setVisibleMarkersCount] = useState(0);
    const [refreshVersion, setRefreshVersion] = useState(0);

    useEffect(() => {
        loadGoogleMaps().then((maps) => {
            if (!mapRef.current) return;
            // Default styles to hide POIs
            const defaultStyles = [
                { featureType: "poi", stylers: [{ visibility: "off" }] }
            ];

            const mapOptions = {
                center: { lat: 0, lng: 0 },
                zoom: 2,
                mapTypeControl: false,
                streetViewControl: false,
                fullscreenControl: false,
                styles: defaultStyles,
                gestureHandling: 'cooperative'
            };
            const map = new maps.Map(mapRef.current, mapOptions);
            map.addListener("click", () => {
                if (infoWindowRef.current) infoWindowRef.current.close();
                currentOpenCardId.current = null;
            });

            googleMapRef.current = map;
            geocoderRef.current = new maps.Geocoder();
            setMapLoaded(true);
            const styledMapType = new maps.StyledMapType(DARK_MODE_STYLE, { name: "Dark" });
            map.mapTypes.set("dark_mode", styledMapType);
        }).catch(console.error);
    }, []);

    // Global Escape Key Listener
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (infoWindowRef.current) infoWindowRef.current.close();
                currentOpenCardId.current = null;
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);



    // --- DATA LOADING ---
    const isFetchingRef = useRef(false);
    const loadData = useCallback(async (isRefresh = false) => {
        if (!user || !boardId || isFetchingRef.current) return;
        isFetchingRef.current = true;
        if (!isRefresh) { setLoading(true); setStatus('Loading cards...'); }
        try {
            const currentLayout = getPersistentLayout(user.id, boardId);
            setBlocks(currentLayout);
            const rulesKey = `TRELLO_MARKER_RULES_${boardId}`;
            const savedRules = localStorage.getItem(rulesKey);
            if (savedRules) setMarkerRules(JSON.parse(savedRules)); else setMarkerRules([]);

            const enableHome = localStorage.getItem(`enableHomeLocation_${boardId}`) === 'true';
            if (enableHome) {
                const homeCoords = JSON.parse(localStorage.getItem(`homeCoordinates_${boardId}`) || 'null');
                const homeIcon = localStorage.getItem(`homeIcon_${boardId}`) || 'home';
                const homeAddress = localStorage.getItem(`homeAddress_${boardId}`) || '';
                if (homeCoords) setHomeLocation({ coords: homeCoords, icon: homeIcon, address: homeAddress }); else setHomeLocation(null);
            } else setHomeLocation(null);

            if (!isRefresh) {
                const allListIds = currentLayout.filter(b => b.includeOnMap !== false).flatMap(b => b.listIds);
                setVisibleListIds(new Set(allListIds));
                const allRuleIds = (savedRules ? JSON.parse(savedRules) : []).map(r => r.id).concat(['default']);
                setVisibleRuleIds(new Set(allRuleIds));

                // Load Ignored Cards
                const ignored = JSON.parse(localStorage.getItem(STORAGE_KEYS.IGNORE_CARDS + boardId) || '[]');
                setIgnoredCards(new Set(ignored));
            }

            const [listsData, labelsData, cardsData] = await Promise.all([
                trelloFetch(`/boards/${boardId}/lists?cards=none&fields=id,name`, user.token),
                trelloFetch(`/boards/${boardId}/labels`, user.token),
                trelloFetch(`/boards/${boardId}/cards?fields=id,name,desc,idList,labels,shortUrl,isTemplate,pos,coordinates,due,dueComplete&_=${Date.now()}`, user.token)
            ]);
            setLists(listsData);
            setBoardLabels(labelsData);

            const cacheKey = `MAP_GEOCODING_CACHE_${boardId}`;
            const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');
            const ignoreCompletedCards = localStorage.getItem(STORAGE_KEYS.IGNORE_COMPLETED_CARDS + boardId) === 'true';
            const ignoreNoDescCards = localStorage.getItem('IGNORE_NO_DESC_CARDS_' + boardId) === 'true';

            // Calculate Absolute First Card (Min Pos) Per List - BEFORE filtering
            const absoluteMinPosByList = {};
            cardsData.forEach(c => {
                if (absoluteMinPosByList[c.idList] === undefined || c.pos < absoluteMinPosByList[c.idList]) {
                    absoluteMinPosByList[c.idList] = c.pos;
                }
            });

            const processedCards = cardsData.filter(c => {
                if (ignoreTemplateCards && c.isTemplate) return false;
                if (ignoreTemplateCards && c.isTemplate) return false;
                if (ignoreCompletedCards && c.dueComplete) return false;
                if (ignoreNoDescCards && (!c.desc || !c.desc.trim())) return false; // Basic catch, specific logic in geocoding
                // Note: We don't filter `ignoredCards` here because we need them in the `cards` state to manage them (un-ignore?) 
                // OR we filter them here so they don't show up at all?
                // Request says "ignore for decoding... do not show on map". 
                // If we filter here, they won't even be in `cards` list for other stats? 
                // Usually map-only filters should be applied in geocoding or render.
                // Let's keep them in `cards` but skip in geocoding and map rendering.
                return true;
            }).map(c => {
                let coords = null;
                if (c.coordinates) {
                    if (typeof c.coordinates === 'string' && c.coordinates.includes(',')) {
                        const parts = c.coordinates.split(',');
                        if (parts.length === 2) coords = { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) };
                    } else if (typeof c.coordinates === 'object') {
                        const lat = c.coordinates.lat || c.coordinates.latitude;
                        const lng = c.coordinates.lng || c.coordinates.long || c.coordinates.longitude;
                        if (lat && lng) coords = { lat: parseFloat(lat), lng: parseFloat(lng) };
                    }
                }
                if ((!coords || !coords.lat) && cache[c.id]) coords = cache[c.id];
                const isFirstInList = c.pos === absoluteMinPosByList[c.idList];
                return { ...c, coordinates: coords, isFirstInList };
            });
            setCards(processedCards);
        } catch (e) {
            console.error(e); setStatus(`Error: ${e.message}`);
        } finally {
            isFetchingRef.current = false;
            if (isRefresh) {
                setRefreshVersion(v => v + 1);
            } else {
                setLoading(false);
                setStatus('');
            }
        }
    }, [user, boardId, ignoreTemplateCards]);

    // --- BUILD GEOCODING QUEUE ---
    useEffect(() => {
        if (!cards.length) return;

        const missingAddressCards = [];

        const newQueue = cards.filter(c => {
            // 1. Check if card belongs to a block allowed on map
            const block = blocks.find(b => b.listIds.includes(c.idList));
            if (!block || block.includeOnMap === false) return false;

            // 2. Ignore first card logic
            if (block.ignoreFirstCard && c.isFirstInList) return false;

            // 2.5 Check if card is manually ignored
            if (ignoredCards.has(c.id)) return false;

            // 3. Ignore if description is empty (Explicitly for Geocoding)
            // If empty desc, we can't parse address. Should we flag error?
            // Usually empty desc means "no address intent". Let's skip error for purely empty desc?
            // User request implies they want to match Dashboard count.
            // If Dashboard counts empty desc cards (unless filtered), we should probably flag them too?
            // But 'ignoreNoDescCards' handles that globally.
            // If passed global filter, it implies it SHOULD be mapped.
            if (!c.desc || !c.desc.trim()) {
                // If we are here, it means 'ignoreNoDescCards' is FALSE.
                // So user wants to see it. But we can't map it.
                // Add to missing?
                missingAddressCards.push({ cardId: c.id, cardName: c.name, cardDesc: c.desc, cardUrl: c.shortUrl, failedAddress: "No description found" });
                return false;
            }

            // 4. Find cards WITHOUT coordinates
            const hasCoords = c.coordinates && c.coordinates.lat;
            if (hasCoords) return false;

            // 5. ... but WITH a potential address in description
            const address = parseAddressFromDescription(c.desc);
            if (!address) {
                missingAddressCards.push({ cardId: c.id, cardName: c.name, cardDesc: c.desc, cardUrl: c.shortUrl, failedAddress: "No valid address found" });
                return false;
            }
            return true;
        });

        if (newQueue.length > 0) {
            setGeocodingQueue(newQueue);
        }

        // Add missing address cards to errors if not already present
        if (missingAddressCards.length > 0) {
            setErrors(prev => {
                const newErrors = [...prev];
                let changed = false;
                missingAddressCards.forEach(m => {
                    if (!newErrors.some(e => e.cardId === m.cardId)) {
                        newErrors.push(m);
                        changed = true;
                    }
                });
                return changed ? newErrors : prev;
            });
        }
    }, [cards, blocks]);


    // --- PROCESS GEOCODING QUEUE ---
    useEffect(() => {
        if (geocodingQueue.length === 0) {
            // If we just finished geocoding and added cards, fit bounds will happen in main effect if cards updated
            // But geocoding effect updates cards incrementally.
            return;
        }
        if (!mapLoaded) return;

        const processQueue = async () => {
            const card = geocodingQueue[0];
            const address = parseAddressFromDescription(card.desc);
            const cleanAddress = expandAbbreviations(address);

            // Truncate status
            const statusText = `Geocoding: ${card.name}`;
            setStatus(statusText.length > 30 ? statusText.substring(0, 30) + '...' : statusText);

            if (geocoderRef.current) {
                geocoderRef.current.geocode({ address: cleanAddress }, async (results, status) => {
                    if (status === 'OK' && results[0]) {
                        const loc = results[0].geometry.location;
                        const coords = { lat: loc.lat(), lng: loc.lng(), display_name: results[0].formatted_address };

                        // Update State & Cache
                        setCards(prev => prev.map(c => c.id === card.id ? { ...c, coordinates: coords } : c));

                        const cacheKey = `MAP_GEOCODING_CACHE_${boardId}`;
                        const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');
                        cache[card.id] = coords;
                        localStorage.setItem(cacheKey, JSON.stringify(cache));

                        if (updateTrelloCoordinates) {
                            try {
                                await trelloFetch(`/cards/${card.id}`, user.token, {
                                    method: 'PUT',
                                    body: JSON.stringify({ coordinates: `${coords.lat},${coords.lng}` }),
                                    headers: { 'Content-Type': 'application/json' }
                                });
                            } catch (e) { console.error("Trello update failed", e); }
                        }

                    } else {
                        console.warn(`Geocoding failed for ${card.name}: ${status}`); // DEBUG
                        if (status === 'OVER_QUERY_LIMIT') {
                            setStatus(`Rate limited. Retrying in 2s...`);
                            await new Promise(r => setTimeout(r, 2000));
                            // Force re-try by creating new reference to same queue
                            setGeocodingQueue(prev => [...prev]);
                            return; // EXIT HERE so we don't slice
                        } else {
                            setErrors(prev => [...prev, { cardId: card.id, cardName: card.name, cardDesc: card.desc, cardUrl: card.shortUrl, failedAddress: cleanAddress }]);
                        }
                    }

                    setGeocodingQueue(prev => prev.slice(1));
                    if (geocodingQueue.length === 1) setStatus(''); // Clear on last
                });
            }
        };

        const timer = setTimeout(processQueue, 1200);
        return () => clearTimeout(timer);
    }, [geocodingQueue, mapLoaded, updateTrelloCoordinates, boardId, user, cards]);


    // --- REFRESH LOOP ---
    const intervalRef = useRef(null);
    const countdownRef = useRef(null);
    useEffect(() => { loadData(false); }, [loadData]);
    useEffect(() => {
        if (countdownRef.current) clearInterval(countdownRef.current);
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (geocodingQueue.length === 0 && !loading) {
            setCountdown(refreshIntervalSeconds);
            countdownRef.current = setInterval(() => setCountdown(p => (p !== null && p > 0) ? p - 1 : p), 1000);
            intervalRef.current = setInterval(() => { loadData(true); setCountdown(refreshIntervalSeconds); }, refreshIntervalSeconds * 1000);
        } else { setCountdown(null); }
        return () => { clearInterval(countdownRef.current); clearInterval(intervalRef.current); };
    }, [geocodingQueue.length, loading, refreshIntervalSeconds, loadData]);

    const handleApplyResult = async (cardId, coords) => {
        setCards(prev => prev.map(c => c.id === cardId ? { ...c, coordinates: coords } : c));
        const cacheKey = `MAP_GEOCODING_CACHE_${boardId}`;
        const cache = JSON.parse(localStorage.getItem(cacheKey) || '{}');
        cache[cardId] = coords;
        localStorage.setItem(cacheKey, JSON.stringify(cache));
        setErrors(prev => prev.filter(e => e.cardId !== cardId));

        if (updateTrelloCoordinates) {
            try {
                await trelloFetch(`/cards/${cardId}`, user.token, {
                    method: 'PUT',
                    body: JSON.stringify({ coordinates: `${coords.lat},${coords.lng}` }),
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (e) { console.error("Trello manual update failed", e); }
        }
    };
    const handleDismissError = (id) => setErrors(prev => prev.filter(e => e.cardId !== id));

    const handleToggleList = (listId) => {
        const next = new Set(visibleListIds);
        if (next.has(listId)) next.delete(listId); else next.add(listId);
        setVisibleListIds(next);
    };
    const handleToggleBlock = (blockId, isChecked) => {
        const block = blocks.find(b => b.id === blockId);
        if (!block) return;
        const next = new Set(visibleListIds);
        block.listIds.forEach(id => isChecked ? next.add(id) : next.delete(id));
        setVisibleListIds(next);
    };
    const handleToggleAllBlocks = (isChecked) => {
        const next = new Set(visibleListIds);
        const allListIds = blocks.filter(b => b.includeOnMap !== false).flatMap(b => b.listIds);
        allListIds.forEach(id => isChecked ? next.add(id) : next.delete(id));
        setVisibleListIds(next);
    };
    const handleToggleRule = (ruleId) => {
        const next = new Set(visibleRuleIds);
        if (next.has(ruleId)) next.delete(ruleId); else next.add(ruleId);
        setVisibleRuleIds(next);
    };
    const handleToggleAllRules = (isChecked) => {
        const allRuleIds = markerRules.map(r => r.id).concat(['default']);
        const next = new Set(isChecked ? allRuleIds : []);
        setVisibleRuleIds(next);
    };

    // --- MOVE CARD ---
    const handleMoveCard = async (cardId, newListId) => {
        if (!enableCardMove) return;
        try {
            await trelloFetch(`/cards/${cardId}`, user.token, {
                method: 'PUT',
                body: JSON.stringify({ idList: newListId }),
                headers: { 'Content-Type': 'application/json' }
            });
            // Update local state
            setCards(prev => prev.map(c => c.id === cardId ? { ...c, idList: newListId } : c));

            // Refresh Popup Logic
            // If the moved card is currently open, we must re-render the popup to show the new list name.
            if (currentOpenCardId.current === cardId && markersRef.current[cardId] && infoWindowRef.current) {
                // Close and Re-open to refresh content
                // Or better: Re-render content.
                // We re-trigger the click handler indirectly or just update the content?
                // Since `createRoot` is one-off, we need to manually trigger.
                // Simplest: Close it. User asked to "refresh", but closing is safer to reset state.
                // Re-opening automatically might be jarring if position shifts or List Name changed prominently.
                // Let's RE-RENDER it.
                const card = cards.find(c => c.id === cardId);
                const updatedCard = { ...card, idList: newListId };
                const list = lists.find(l => l.id === newListId);
                const listName = list ? list.name : 'Unknown';
                const block = blocks.find(b => b.listIds.includes(newListId));
                const blockName = block ? block.name : '';

                const div = document.createElement('div');
                const root = createRoot(div);
                root.render(
                    <CardPopup
                        card={updatedCard}
                        listName={listName}
                        blockName={blockName}
                        blocks={blocks}
                        lists={lists}
                        onMove={handleMoveCard}
                        enableStreetView={enableStreetView}
                        onFixAddress={handleFixAddress}
                    />
                );
                infoWindowRef.current.setContent(div);
            }

        } catch (e) {
            console.error("Failed to move card", e);
            alert("Failed to move card.");
        }
    };


    // --- HANDLERS ---
    const handleIgnoreCard = (cardId) => {
        setIgnoredCards(prev => {
            const next = new Set(prev);
            next.add(cardId);
            localStorage.setItem(STORAGE_KEYS.IGNORE_CARDS + boardId, JSON.stringify(Array.from(next)));
            return next;
        });

        // Remove from cards list if we strictly don't want to see it? 
        // Or just remove coordinates so it doesn't show pin?
        // If we just remove coordinates, we need to update state.
        setCards(prev => prev.map(c => c.id === cardId ? { ...c, coordinates: null } : c));

        // Remove from errors if present
        setErrors(prev => prev.filter(e => e.cardId !== cardId));

        // Remove from queue if present
        setGeocodingQueue(prev => prev.filter(c => c.id !== cardId));
    };

    const handleFixAddress = useCallback((card) => {
        // Open the geocoding error toast for this card, effectively acting as "Manual Fix" mode
        // Check if already in errors
        setErrors(prev => {
            if (prev.some(e => e.cardId === card.id)) return prev;
            return [...prev, {
                cardId: card.id,
                cardName: card.name,
                cardDesc: card.desc,
                cardUrl: card.shortUrl,
                failedAddress: parseAddressFromDescription(card.desc) || "Manual Fix Requested"
            }];
        });
        if (infoWindowRef.current) infoWindowRef.current.close();
    }, []);


    // --- MARKERS RENDER ---
    const prevRefreshVersion = useRef(0);
    const [totalFilteredCards, setTotalFilteredCards] = useState(0); // State for header

    useEffect(() => {
        if (!googleMapRef.current || !mapLoaded) return;
        const map = googleMapRef.current;

        // 1. FILTER ALL CARDS (Regardless of Coords)
        let droppedByGlobal = 0;
        let droppedByList = 0;
        let droppedByRule = 0;
        let droppedByFirstCard = 0;



        const allPotentialCards = cards.filter(c => {
            // Global Settings Filters
            if (ignoreTemplateCards && c.isTemplate) { droppedByGlobal++; return false; }
            if (ignoreCompletedCards && c.dueComplete) { droppedByGlobal++; return false; }
            if (ignoreNoDescCards && (!c.desc || !c.desc.trim())) { droppedByGlobal++; return false; }

            if (!visibleListIds.has(c.idList)) {
                droppedByList++;
                // console.log(`Dropped by List: ${c.name} (${c.idList})`);
                return false;
            }
            const block = blocks.find(b => b.listIds.includes(c.idList));
            if (!block) return true; // Unassigned lists

            // Ignore First Card Check
            if (block.ignoreFirstCard && c.isFirstInList) {
                droppedByFirstCard++;
                return false;
            }

            // Rules check? (Technically rules are for markers, but filtering usually applies if rules are unchecked?)
            // If I uncheck "Red", cards that would be Red are hidden.
            const { activeRuleIds } = getMarkerConfig(c, block, markerRules);
            const isVisibleRule = [...activeRuleIds].some(id => visibleRuleIds.has(id));
            if (!isVisibleRule) droppedByRule++;
            return isVisibleRule;
        });

        console.log(`[MapView Debug] Total: ${cards.length} | Potential: ${allPotentialCards.length} | Dropped: Global=${droppedByGlobal}, List=${droppedByList}, Rule=${droppedByRule}`);

        setTotalFilteredCards(allPotentialCards.length);

        // 2. GET MAPPED CARDS (Must have coords)
        const validCards = allPotentialCards.filter(c => c.coordinates && c.coordinates.lat);

        // DEBUG: Log Missing Cards
        const missingCards = allPotentialCards.filter(c => !c.coordinates || !c.coordinates.lat);
        if (missingCards.length > 0) {
            console.log(`[MapView Debug] Missing Coordinates for ${missingCards.length} cards:`);
            missingCards.forEach(c => {
                const parsed = parseAddressFromDescription(c.desc);
                console.log(` - "${c.name}" (ID: ${c.id}) | Desc len: ${c.desc ? c.desc.length : 0} | Parsed Addr: "${parsed}" | Queue Status: ${geocodingQueue.some(q => q.id === c.id) ? 'In Queue' : 'Not in Queue'} | Error Status: ${errors.some(e => e.cardId === c.id) ? 'Has Error' : 'No Error'}`);
            });
        }

        setVisibleMarkersCount(validCards.length);

        const visibleCards = validCards; // Logic already applied above

        const newMarkers = {};
        visibleCards.forEach(c => {
            const block = blocks.find(b => b.listIds.includes(c.idList)) || { mapIcon: 'map-marker', name: 'Other' };
            const markerConfig = getMarkerConfig(c, block, markerRules);
            const googleIcon = getGoogleMarkerIcon(markerConfig);
            const position = { lat: c.coordinates.lat, lng: c.coordinates.lng };

            if (markersRef.current[c.id]) {
                const m = markersRef.current[c.id];
                m.setPosition(position);
                m.setIcon(googleIcon);
                m.set('cardData', c);
                newMarkers[c.id] = m;
            } else {
                const m = new window.google.maps.Marker({ position, map, icon: googleIcon, title: c.name });
                m.set('cardData', c);

                m.addListener("click", () => {
                    const currentCard = m.get('cardData');
                    // Close existing if specific one open? (Handled by shared InfoWindow)
                    // Just Render content
                    const div = document.createElement('div');
                    const root = createRoot(div);
                    const list = lists.find(l => l.id === currentCard.idList);
                    const listName = list ? list.name : 'Unknown List';
                    const parentBlock = blocks.find(b => b.listIds.includes(currentCard.idList));
                    const blockName = parentBlock ? parentBlock.name : '';

                    currentOpenCardId.current = currentCard.id;

                    root.render(
                        <CardPopup
                            card={currentCard}
                            listName={listName}
                            blockName={blockName}
                            blocks={blocks}
                            lists={enableCardMove ? lists : []}
                            onMove={handleMoveCard}
                            enableStreetView={enableStreetView}
                            onFixAddress={handleFixAddress}
                            onZoom={(c) => {
                                if (googleMapRef.current && c.coordinates) {
                                    googleMapRef.current.setCenter({ lat: c.coordinates.lat, lng: c.coordinates.lng });
                                    const currentZoom = googleMapRef.current.getZoom();
                                    googleMapRef.current.setZoom(Math.min(currentZoom + 2, 21)); // Zoom 2 levels deeper, max 21
                                }
                            }}
                        />
                    );

                    infoWindowRef.current.setContent(div);
                    infoWindowRef.current.open(map, m);
                });

                newMarkers[c.id] = m;
            }
        });
        setVisibleMarkersCount(Object.keys(newMarkers).length);

        Object.keys(markersRef.current).forEach(id => {
            if (!newMarkers[id]) markersRef.current[id].setMap(null);
        });
        markersRef.current = newMarkers;

        if (homeLocation && homeLocation.coords && showHomeLocation) {
            const pos = { lat: homeLocation.coords.lat, lng: homeLocation.coords.lon };
            const icon = getGoogleMarkerIcon({ icon: homeLocation.icon || 'home', color: 'purple' });
            if (homeMarkerRef.current) { homeMarkerRef.current.setPosition(pos); homeMarkerRef.current.setIcon(icon); homeMarkerRef.current.setMap(map); }
            else {
                const homeM = new window.google.maps.Marker({ position: pos, map, icon: icon, zIndex: 1000, title: 'Home Location' });
                homeM.addListener("click", () => {
                    const content = `
                        <div style="padding: 5px;">
                            <strong>Home Address</strong><br/>
                            ${homeLocation.address || homeLocation.coords.display_name || 'No address set'}
                        </div>
                    `;
                    infoWindowRef.current.setContent(content);
                    infoWindowRef.current.open(map, homeM);
                });
                homeMarkerRef.current = homeM;
            }
        } else if (homeMarkerRef.current) { homeMarkerRef.current.setMap(null); }

        if (visibleCards.length > 0 && !initialFitDone) {
            fitMapBounds();
            setInitialFitDone(true);
            prevValidCardCount.current = validCards.length;
            prevRefreshVersion.current = refreshVersion;
        } else if (refreshVersion !== prevRefreshVersion.current) {
            // Force Refresh
            if (visibleCards.length > 0) fitMapBounds();
            prevRefreshVersion.current = refreshVersion;
            prevValidCardCount.current = validCards.length;
        } else if (initialFitDone && validCards.length !== prevValidCardCount.current) {
            // New cards added or removed -> Re-fit bounds
            fitMapBounds();
            prevValidCardCount.current = validCards.length;
        }

    }, [cards, visibleListIds, visibleRuleIds, blocks, markerRules, homeLocation, showHomeLocation, mapLoaded, lists, refreshVersion]);

    // EMBEDDED MODE
    if (isEmbedded) {
        return (
            <div style={{ flex: 1, position: 'relative', height: '100%', overflow: 'hidden' }}>
                {/* Internal Floating Filters for Embedded Map */}
                <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 5 }}>
                    <MapFilters
                        lists={lists} cards={cards} allLabels={boardLabels}
                        visibleListIds={visibleListIds} onToggleList={handleToggleList}
                        blocks={blocks} onToggleBlock={handleToggleBlock} onToggleAllBlocks={handleToggleAllBlocks}
                        markerRules={markerRules} visibleRuleIds={visibleRuleIds} onToggleRule={handleToggleRule} onToggleAllRules={handleToggleAllRules}
                        homeLocation={homeLocation} showHomeLocation={showHomeLocation} onToggleHome={() => setShowHomeLocation(!showHomeLocation)}
                    />
                </div>
                {/* Fit Map Button (Custom Overlay) */}
                <div
                    style={{
                        position: 'absolute',
                        top: '5px',
                        right: '20px',
                        zIndex: 800,
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        borderRadius: '8px',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                        padding: '8px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#333'
                    }}
                    onClick={fitMapBounds}
                    title="Fit Map to Markers"
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="22" y1="12" x2="18" y2="12" />
                        <line x1="6" y1="12" x2="2" y2="12" />
                        <line x1="12" y1="6" x2="12" y2="2" />
                        <line x1="12" y1="22" x2="12" y2="18" />
                    </svg>
                </div>
                <div style={{ flexGrow: 1, position: 'relative', background: '#e0e0e0', height: '100%' }}>
                    <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
                    {!mapLoaded && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>Loading Google Maps...</div>}
                </div>
            </div>
        );
    }

    return (
        <div className="map-view-container">
            {/* Header */}
            <div className="map-header">
                <div className="map-header-title-area">
                    {showClock && <DigitalClock boardId={boardId} />}
                    <h1 style={{ marginLeft: showClock ? '15px' : '0' }}>
                        {boardName}
                    </h1>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '15px' }}>
                    {!mapLoaded && <span className="spinner"></span>}

                    {/* DESKTOP HEADER ACTIONS */}
                    <div className="desktop-only" style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <span style={{ fontSize: '0.9em', color: 'var(--text-secondary)', marginRight: '5px' }}>
                            Mapped: {visibleMarkersCount} / {totalFilteredCards}
                        </span>

                        {!onStopSlideshow && (
                            <>
                                {/* Base Layer */}
                                <select
                                    value={baseMap}
                                    onChange={e => setBaseMap(e.target.value)}
                                    className="time-filter-select"
                                >
                                    <option value="roadmap">Roadmap</option>
                                    <option value="traffic">Traffic</option>
                                    <option value="satellite">Satellite</option>
                                    <option value="hybrid">Hybrid</option>
                                    <option value="terrain">Terrain</option>
                                    <option value="dark">Dark Mode</option>
                                </select>
                            </>
                        )}

                        <button
                            className="theme-toggle-button"
                            onClick={() => toggleTheme()}
                        >
                            {theme === 'dark' ? '☀️' : '🌙'}
                        </button>
                    </div>

                    {/* MOBILE HAMBURGER MENU */}
                    <div className="mobile-only">
                        <HamburgerMenu>
                            {/* Section 0: Mapped Stats (Moved to Top) */}
                            <div className="hamburger-section" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', marginBottom: '15px' }}>
                                <div style={{ fontSize: '0.9em', color: 'var(--text-secondary)' }}>
                                    Mapped: {visibleMarkersCount} / {totalFilteredCards} cards
                                </div>
                            </div>

                            {/* Section 1: Map Controls */}
                            <div className="hamburger-section" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', marginBottom: '15px' }}>
                                <strong>Map Settings</strong>
                                <select
                                    value={baseMap}
                                    onChange={e => setBaseMap(e.target.value)}
                                    className="time-filter-select"
                                    style={{ width: '100%', margin: '10px 0 0 0' }}
                                >
                                    <option value="roadmap">Roadmap</option>
                                    <option value="traffic">Traffic</option>
                                    <option value="satellite">Satellite</option>
                                    <option value="hybrid">Hybrid</option>
                                    <option value="terrain">Terrain</option>
                                    <option value="dark">Dark Mode</option>
                                </select>
                            </div>

                            {/* Section 2: Actions */}
                            <div className="hamburger-section">
                                <strong>Actions</strong>
                                {!onStopSlideshow && (
                                    <>
                                        <button className="menu-link" onClick={() => onClose()}>
                                            Dashboard View
                                        </button>
                                        <button className="menu-link" onClick={() => onShowTasks()}>
                                            Tasks View
                                        </button>
                                        <button className="menu-link" onClick={() => onShowSettings('board')}>
                                            Settings
                                        </button>
                                        <button className="menu-link" onClick={onLogout}>
                                            Logout
                                        </button>
                                    </>
                                )}
                            </div>
                            {/* Theme Toggle at Bottom */}
                            <div className="hamburger-section" style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-color)' }}>
                                <button
                                    className="theme-toggle-button"
                                    onClick={() => toggleTheme()}
                                    title="Toggle Theme"
                                    style={{ background: 'transparent', fontSize: '1.5em', cursor: 'pointer', border: 'none' }}
                                >
                                    {theme === 'dark' ? '☀️' : '🌙'}
                                </button>
                            </div>
                        </HamburgerMenu>
                    </div>
                </div>
            </div>

            <div style={{ position: 'fixed', top: '80px', right: '20px', zIndex: 9999, pointerEvents: 'none' }}>
                <div style={{ pointerEvents: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    {errors.map(err => <GeocodingErrorToast key={err.cardId} error={err} onDismiss={handleDismissError} onApply={handleApplyResult} onIgnore={handleIgnoreCard} />)}
                </div>
            </div>

            {/* MAIN CONTENT: Map or Dashboard Slideshow */}
            <div style={{ display: 'flex', flexGrow: 1, position: 'relative' }}>
                {slideshowContent === 'dashboard' ? (
                    <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
                        <Dashboard isEmbedded={true} user={user} settings={settings} />
                    </div>
                ) : (
                    <>
                        {/* Fit Map Button (Custom Overlay - Absolute to this relative container) */}
                        <div
                            style={{
                                position: 'absolute',
                                top: '5px',
                                right: '20px',
                                zIndex: 800,
                                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                borderRadius: '8px',
                                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                                padding: '8px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#333'
                            }}
                            onClick={fitMapBounds}
                            title="Fit Map to Markers"
                        >
                            <svg width="60" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="22" y1="12" x2="18" y2="12" />
                                <line x1="6" y1="12" x2="2" y2="12" />
                                <line x1="12" y1="6" x2="12" y2="2" />
                                <line x1="12" y1="22" x2="12" y2="18" />
                            </svg>
                        </div>
                        <div className="map-sidebar">
                            <MapFilters
                                lists={lists} cards={cards} allLabels={boardLabels}
                                visibleListIds={visibleListIds} onToggleList={handleToggleList}
                                blocks={blocks} onToggleBlock={handleToggleBlock} onToggleAllBlocks={handleToggleAllBlocks}
                                markerRules={markerRules} visibleRuleIds={visibleRuleIds} onToggleRule={handleToggleRule} onToggleAllRules={handleToggleAllRules}
                                homeLocation={homeLocation} showHomeLocation={showHomeLocation} onToggleHome={() => setShowHomeLocation(!showHomeLocation)}
                            />
                        </div>
                        <div style={{ flexGrow: 1, position: 'relative', background: '#e0e0e0' }}>
                            <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
                            {!mapLoaded && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>Loading Google Maps...</div>}
                        </div>
                    </>
                )}
            </div>

            <div className="map-footer">
                <div className="map-footer-left">
                    <div style={{ fontSize: '0.8em', color: '#888' }}>Powered by Google Maps & Trello</div>
                </div>

                {/* CENTER: Stop Slideshow */}
                {onStopSlideshow && (
                    <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
                        <button
                            onClick={onStopSlideshow}
                            style={{ backgroundColor: '#d32f2f', color: 'white', border: 'none', padding: '5px 15px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                        >
                            Stop Slideshow
                        </button>
                    </div>
                )}
                <div className="map-footer-right">
                    {!onStopSlideshow && (
                        <span className="desktop-only" style={{ marginRight: '20px', fontWeight: '500', color: 'var(--text-color)' }}>
                            {status || 'Ready'} {geocodingQueue.length > 0 && <span>(Geocoding {geocodingQueue.length}...)</span>}
                        </span>
                    )}

                    <button className="button-secondary" onClick={() => { setCountdown(refreshIntervalSeconds); loadData(true); }}>
                        Refresh {formatDynamicCountdown(countdown)}
                    </button>

                    {!onStopSlideshow && (
                        <div className="desktop-only" style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                            <div style={{ position: 'relative' }}>
                                <div style={{ display: 'flex' }}>
                                    <button className="button-secondary" onClick={() => onClose()}>
                                        Dashboard View
                                    </button>
                                    <button className="button-secondary dropdown-arrow" style={{ marginLeft: '-1px', borderLeft: 'none', padding: '0 5px' }} onClick={() => setShowDashboardDropdown(!showDashboardDropdown)}>
                                        ▼
                                    </button>
                                </div>
                                {showDashboardDropdown && (
                                    <div className="context-menu" style={{ position: 'absolute', bottom: '100%', left: 0, background: 'var(--bg-primary)', border: '1px solid #ccc', borderRadius: '4px', padding: '10px', minWidth: '250px', boxShadow: '0 4px 15px rgba(0,0,0,0.2)' }}>
                                        <div className="menu-item" style={{ marginBottom: '8px', padding: '4px', cursor: 'pointer', borderRadius: '4px' }} onClick={() => { window.open('/dashboard', '_blank'); setShowDashboardDropdown(false); }}>Open in New Tab</div>
                                        {onStartSlideshow && !onStopSlideshow && (
                                            <div className="menu-item" style={{ padding: '4px', cursor: 'pointer', borderRadius: '4px' }} onClick={() => { onStartSlideshow(); setShowDashboardDropdown(false); }}>Start Slideshow ({settings?.slideshowInterval || 10}s)</div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div style={{ position: 'relative' }}>
                                <div style={{ display: 'flex' }}>
                                    <button className="button-secondary" onClick={() => onShowTasks()}>
                                        Tasks View
                                    </button>
                                    <button className="button-secondary dropdown-arrow" style={{ marginLeft: '-1px', borderLeft: 'none', padding: '0 5px' }} onClick={() => setShowTaskDropdown(!showTaskDropdown)}>
                                        ▼
                                    </button>
                                </div>
                                {showTaskDropdown && (
                                    <div className="context-menu" style={{ position: 'absolute', bottom: '100%', left: 0, background: 'var(--bg-primary)', border: '1px solid #ccc', borderRadius: '4px', padding: '5px', minWidth: '150px' }}>
                                        <div className="menu-item" onClick={() => { window.open('/tasks', '_blank'); setShowTaskDropdown(false); }}>Open in New Tab</div>
                                    </div>
                                )}
                            </div>

                            <button className="button-secondary" onClick={() => onShowSettings('board')}>Settings</button>
                            <button className="button-secondary" onClick={onLogout}>Logout</button>
                        </div>
                    )}
                </div>
            </div>
            {/* Click Outside to Close Dropdowns */}
            {(showDashboardDropdown || showTaskDropdown) && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 99 }} onClick={() => { setShowDashboardDropdown(false); setShowTaskDropdown(false); }} />
            )}
        </div>
    );
};

export default MapView;
