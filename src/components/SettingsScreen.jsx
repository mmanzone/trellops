import React, { useState, useEffect, useMemo } from 'react';
import { trelloFetch, trelloAuth } from '../api/trello';
import { serverSessionReady } from '../api/session';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import MoreOptionsModal from './common/MoreOptionsModal';
import { requestTour } from '../hooks/useTourStatus';
import IconPicker from './common/IconPicker';
import ColorPicker from './common/ColorPicker';
import { getPersistentLayout } from '../utils/persistence';
import { STORAGE_KEYS, DEFAULT_LAYOUT } from '../utils/constants';
import { setPersistentColors, getPersistentColors, setPersistentLayout } from '../utils/persistence';
import { Copy, Sparkles, Loader2, GripVertical, Trash2, Plus, CircleCheck, TriangleAlert, ChevronDown, ChevronRight, LayoutGrid, Map as MapIcon, ChartColumn, SlidersHorizontal, Check, Info, CreditCard } from 'lucide-react';
import { encodeBase64Utf8 } from '../utils/helpers';
import CharityRequestModal from './common/CharityRequestModal';
import { ProLock, ProTag, PlanPill } from './common/PlanGate';
import BillingPanel from './common/BillingPanel';
import { useEntitlements } from '../context/EntitlementsContext';
import BoardSelect from './common/BoardSelect';
import { createShareLink, registerBoardWithLimit, saveServerConfig, loadServerConfig } from '../api/entitlements';
import '../styles/settings.css';

const ShareConfigModal = ({ config, onClose, boardName, enforced }) => {
    const [copied, setCopied] = useState(false);
    // Legacy link: the whole config Base64-encoded in the URL (UTF-8 safe).
    const legacyUrl = () => `${window.location.protocol}//${window.location.host}${window.location.pathname}?config=${encodeURIComponent(encodeBase64Utf8(JSON.stringify(config)))}`;
    // Short link stored on the server (/?share=<id>), which checks the plan of whoever opens it.
    const [shareUrl, setShareUrl] = useState('');
    const [shareError, setShareError] = useState('');
    useEffect(() => {
        let alive = true;
        createShareLink(config.boardId, config).then((res) => {
            if (!alive) return;
            if (res.url) setShareUrl(res.url);
            else if (enforced) setShareError(res.error);
            else setShareUrl(legacyUrl()); // Server not set up yet: keep the old link working.
        });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleCopy = () => {
        navigator.clipboard.writeText(shareUrl).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '600px' }}>
                <h3>Share Configuration</h3>
                <p>Copy the link below to share this configuration with others:</p>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                    <input
                        type="text"
                        readOnly
                        value={shareError || shareUrl || 'Creating link...'}
                        style={{ flex: 1 }}
                        onClick={(e) => e.target.select()}
                    />
                    <button onClick={handleCopy} className="button-primary" disabled={!shareUrl}>
                        {copied ? 'Copied!' : 'Copy'}
                    </button>
                </div>
                <div className="notice notice-warning">
                    <strong>Note:</strong> The recipient of this link needs Trellops Pro, a Trello account and access to the board <strong>{boardName || 'specified'}</strong> to be able to display it. Features requiring extended write permissions will have to be granted by the recipients of this link.
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}>
                    <button className="button-secondary" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
};

// Shows the Trello board id (needed for board plans and charity requests).
const BoardIdCopy = ({ boardId }) => {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard?.writeText(boardId).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }).catch(() => { });
    };
    return (
        <p className="board-id-row">
            <span className="board-id-label">Board ID</span>
            <code className="board-id-value">{boardId}</code>
            <button type="button" className="button-secondary board-id-copy" onClick={handleCopy} aria-label="Copy board ID">
                {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy'}
            </button>
        </p>
    );
};

const SettingsScreen = ({ user, initialTab = 'dashboard', onClose, onSave, onLogout, importedConfig = null, onClearImportConfig = () => { }, viewMode = 'default', onManageTasks, onGoToStats, accountNotice = null, isAdmin = false, onOpenAdmin }) => {
    // viewMode: 'default' (Board Settings) | 'tasks' (Task Settings Only)

    // --- State ---
    const [boards, setBoards] = useState([]);
    const { entitlements, can, refresh: refreshEntitlements, requestBoardLimit, boards: planBoards, boardPlanBoards } = useEntitlements();
    // Boards a plan covers, for the bold name and pills in the board picker:
    // a Board plan on the board itself, or the member's own Pro (paid, granted
    // or trial) on the boards counted towards their Pro board limit.
    const boardPlanFor = useMemo(() => {
        const withBoardPlan = new Set((boardPlanBoards || []).map((id) => String(id).toLowerCase()));
        const memberPro = entitlements?.plan === 'pro' && !entitlements?.offline;
        const proBoards = new Set(memberPro ? (planBoards || []).map((id) => String(id).toLowerCase()) : []);
        const trial = entitlements?.planSource === 'trial';
        return (board) => {
            const id = String(board?.id || '').toLowerCase();
            if (withBoardPlan.has(id)) return { trial: false };
            if (proBoards.has(id)) return { trial };
            return null;
        };
    }, [boardPlanBoards, planBoards, entitlements?.plan, entitlements?.planSource, entitlements?.offline]);
    const minRefreshSeconds = entitlements?.minRefreshSeconds || 15;
    const refreshFixed = entitlements?.enforced && minRefreshSeconds >= 3600; // Free: fixed 60 minutes
    const syncToAccount = entitlements?.plan === 'pro' && can('sync');
    const [selectedBoardId, setSelectedBoardId] = useState('');
    const [allLists, setAllLists] = useState([]); // All fetched lists
    const [boardLabels, setBoardLabels] = useState([]);

    // Configuration State
    const [blocks, setBlocks] = useState([]); // { id, name, listIds, includeOnMap, mapIcon, ... }
    const [listColors, setListColors] = useState({}); // { listId: hexColor }

    // Other Settings
    const [refreshValue, setRefreshValue] = useState(1);
    const [refreshUnit, setRefreshUnit] = useState('minutes');
    const [showClock, setShowClock] = useState(true);
    const [ignoreTemplateCards, setIgnoreTemplateCards] = useState(true);
    const [ignoreCompletedCards, setIgnoreCompletedCards] = useState(false);
    const [ignoreNoDescCards, setIgnoreNoDescCards] = useState(false); // NEW
    const [enableIgnoreKeywords, setEnableIgnoreKeywords] = useState(false);
    const [ignoreKeywords, setIgnoreKeywords] = useState('');

    // Map View
    const [enableMapView, setEnableMapView] = useState(false);
    const [mapGeocodeMode, setMapGeocodeMode] = useState('store');
    const [updateTrelloCoordinates, setUpdateTrelloCoordinates] = useState(false);
    const [enableCardMove, setEnableCardMove] = useState(false); // NEW
    const [enableTaskView, setEnableTaskView] = useState(false);
    const [taskViewWorkspaces, setTaskViewWorkspaces] = useState(null); // Array of Org IDs (null = all default pending)
    const [taskViewRefreshInterval, setTaskViewRefreshInterval] = useState({ value: 5, unit: 'minutes' });
    const [userOrgs, setUserOrgs] = useState([]); // For multi-select

    const [enableHomeLocation, setEnableHomeLocation] = useState(false); // NEW HOME LOCATION
    const [homeAddress, setHomeAddress] = useState('');
    const [homeCoordinates, setHomeCoordinates] = useState(null);
    const [homeIcon, setHomeIcon] = useState('home');
    const [validatingAddress, setValidatingAddress] = useState(false);


    // NOMINATIM AUTOCOMPLETE STATE
    // State for Marker Rules


    const [markerRules, setMarkerRules] = useState([]);
    const [hasWritePermission, setHasWritePermission] = useState(false);

    const [error, setError] = useState('');
    const [showMoreOptions, setShowMoreOptions] = useState(false);
    const [loadingLists, setLoadingLists] = useState(false);
    // False until the saved settings (boards, lists, layout) have been read
    // back into this screen. Saving before then would write the empty
    // defaults over the real configuration.
    const [initialLoadDone, setInitialLoadDone] = useState(false);
    const [activeTab, setActiveTab] = useState(initialTab === 'tasks' ? 'dashboard' : initialTab);
    const [expandedSection, setExpandedSection] = useState(viewMode === 'tasks' ? 'tasks' : 'board');

    // Force expanded section based on viewMode


    useEffect(() => {
        if (viewMode === 'tasks') {
            setExpandedSection('tasks');
        } else {
            setExpandedSection('board');
        }
    }, [viewMode]);


    const [showShareModal, setShowShareModal] = useState(false);
    const [showCharityModal, setShowCharityModal] = useState(false);
    const [pendingImport, setPendingImport] = useState(null);
    const [showResetSection, setShowResetSection] = useState(false); // Collapsible Danger Zone toggle

    // Initial check on mount
    useEffect(() => {
        if (importedConfig) {
            // Show banner instead of popup
            setPendingImport(importedConfig);
        } else if (user?.token) {
            trelloAuth.checkTokenScopes(user.token).then(scopes => {
                const canWrite = scopes.includes('write');
                setHasWritePermission(canWrite);
                if (!canWrite) {
                    setUpdateTrelloCoordinates(false);
                    setEnableCardMove(false);
                }
            });
        }
    }, [user, importedConfig]);

    const [enableStreetView, setEnableStreetView] = useState(false);

    // Statistics Settings
    const [enableStats, setEnableStats] = useState(false);
    const [statsShowArchived, setStatsShowArchived] = useState(true);
    const [statsIncludedLists, setStatsIncludedLists] = useState([]);
    const [statsCustomPrompt, setStatsCustomPrompt] = useState('');
    const [isImprovingPrompt, setIsImprovingPrompt] = useState(false);

    // Naming Configuration
    const [namingCard, setNamingCard] = useState('');
    const [namingList, setNamingList] = useState('');
    const [namingBoard, setNamingBoard] = useState('');
    const [namingLabel, setNamingLabel] = useState('');

    // Slideshow Settings
    const [slideshowInterval, setSlideshowInterval] = useState(10);
    useEffect(() => {
        if (expandedSection === 'tasks' && boards.length > 0) {
            if (userOrgs.length === 0 && user && user.token) {
                // Fetch direct organizations
                trelloFetch('/members/me/organizations?fields=id,displayName,name', user.token)
                    .then(fetchedOrgs => {
                        // MERGE with organizations derived from boards (to include boards where user is just a member)
                        const allOrgsMap = new Map();
                        fetchedOrgs.forEach(o => allOrgsMap.set(o.id, o));

                        // Extract orgs from boards
                        if (boards && boards.length > 0) {
                            boards.forEach(b => {
                                if (b.idOrganization && b.organization) {
                                    if (!allOrgsMap.has(b.idOrganization)) {
                                        allOrgsMap.set(b.idOrganization, {
                                            id: b.idOrganization,
                                            displayName: b.organization.displayName || b.organization.name,
                                            name: b.organization.name
                                        });
                                    }
                                }
                            });
                        }

                        const uniqueOrgs = Array.from(allOrgsMap.values()).sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name));

                        setUserOrgs(uniqueOrgs);

                        // Default to ALL if not set (null or empty from init, but null distinguishes initial load)
                        if (taskViewWorkspaces === null || (Array.isArray(taskViewWorkspaces) && taskViewWorkspaces.length === 0)) {
                            // Note: If user saved specifically "empty", it might contest this.
                            // But since we just changed init to null, saved "[]" would be loaded as "[]".
                            // So if strictly null, we default.
                            setTaskViewWorkspaces(uniqueOrgs.map(o => o.id));
                        }
                    })
                    .catch(e => console.warn("Failed to fetch orgs for settings", e));
            }
        }
    }, [expandedSection, user, boards]);

    // GOOGLE MAPS AUTOCOMPLETE STATE
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const wrapperRef = React.useRef(null);
    const autocompleteService = React.useRef(null);
    const geocoderRef = React.useRef(null);

    useEffect(() => {
        // Ensure Google Maps is loaded for Settings Screen
        import('../utils/googleMapsLoader').then(({ loadGoogleMaps }) => {
            loadGoogleMaps().then(maps => {
                if (!autocompleteService.current) {
                    autocompleteService.current = new maps.places.AutocompleteService();
                    geocoderRef.current = new maps.Geocoder();
                }
            }).catch(e => console.warn("Google Maps not loaded for Settings:", e));
        });
    }, []);

    const handleHomeAddressChange = (e) => {
        const val = e.target.value;
        setHomeAddress(val);

        if (!val || val.length < 3) {
            setSearchResults([]);
            return;
        }

        if (autocompleteService.current) {
            setIsSearching(true);
            autocompleteService.current.getPlacePredictions({ input: val }, (predictions, status) => {
                console.log("[GoogleMaps] Autocomplete status:", status);
                console.log("[GoogleMaps] Autocomplete predictions:", predictions);
                setIsSearching(false);
                if (status === window.google.maps.places.PlacesServiceStatus.OK && predictions) {
                    setSearchResults(predictions);
                } else {
                    console.warn("[GoogleMaps] Autocomplete failed or empty:", status);
                    setSearchResults([]);
                }
            });
        }
    };

    const handleSelectResult = (prediction) => {
        setHomeAddress(prediction.description);
        setSearchResults([]);

        if (geocoderRef.current) {
            geocoderRef.current.geocode({ placeId: prediction.place_id }, (results, status) => {
                if (status === 'OK' && results[0]) {
                    const loc = results[0].geometry.location;
                    setHomeCoordinates({
                        lat: loc.lat(),
                        lon: loc.lng(),
                        display_name: prediction.description
                    });
                }
            });
        }
    };

    const applyImportedConfig = () => {
        if (!pendingImport) return;
        const config = pendingImport;

        // 1. Pre-populate board selection
        if (config.boardId) {
            const existingBoard = boards.find(b => b.id === config.boardId);
            if (!existingBoard && config.boardName) {
                // Board not yet in list — fetch it
            }
            setSelectedBoardId(config.boardId);
            fetchBoardData(config.boardId);
        }

        // 2. Dashboard layout
        if (config.blocks) setBlocks(config.blocks);
        if (config.listColors) setListColors(config.listColors);

        // 3. Other board settings
        if (config.refreshValue) setRefreshValue(config.refreshValue);
        if (config.refreshUnit) setRefreshUnit(config.refreshUnit);
        if (config.showClock !== undefined) setShowClock(config.showClock);
        if (config.ignoreTemplateCards !== undefined) setIgnoreTemplateCards(config.ignoreTemplateCards);
        if (config.ignoreCompletedCards !== undefined) setIgnoreCompletedCards(config.ignoreCompletedCards);
        if (config.ignoreNoDescCards !== undefined) setIgnoreNoDescCards(config.ignoreNoDescCards);
        if (config.enableIgnoreKeywords !== undefined) setEnableIgnoreKeywords(config.enableIgnoreKeywords);
        if (config.ignoreKeywords !== undefined) setIgnoreKeywords(config.ignoreKeywords);
        if (config.slideshowInterval !== undefined) setSlideshowInterval(config.slideshowInterval);

        // 4. Map settings
        if (config.enableMapView !== undefined) setEnableMapView(config.enableMapView);
        if (config.mapGeocodeMode) setMapGeocodeMode(config.mapGeocodeMode);
        if (config.updateTrelloCoordinates !== undefined) setUpdateTrelloCoordinates(config.updateTrelloCoordinates);
        if (config.enableCardMove !== undefined) setEnableCardMove(config.enableCardMove);
        if (config.enableStreetView !== undefined) setEnableStreetView(config.enableStreetView);
        if (config.enableHomeLocation !== undefined) setEnableHomeLocation(config.enableHomeLocation);
        if (config.homeAddress !== undefined) setHomeAddress(config.homeAddress);
        if (config.homeCoordinates !== undefined) setHomeCoordinates(config.homeCoordinates);
        if (config.homeIcon !== undefined) setHomeIcon(config.homeIcon);
        if (config.markerRules) setMarkerRules(config.markerRules);

        // 5. Statistics settings (nested object)
        if (config.statistics) {
            if (config.statistics.enabled !== undefined) setEnableStats(config.statistics.enabled);
            if (config.statistics.showArchived !== undefined) setStatsShowArchived(config.statistics.showArchived);
            if (config.statistics.includedLists !== undefined) setStatsIncludedLists(config.statistics.includedLists);
            if (config.statistics.customAIPrompt !== undefined) setStatsCustomPrompt(config.statistics.customAIPrompt);
        }

        // 6. Naming / terminology
        if (config.naming) {
            if (config.naming.card !== undefined) setNamingCard(config.naming.card || '');
            if (config.naming.list !== undefined) setNamingList(config.naming.list || '');
            if (config.naming.board !== undefined) setNamingBoard(config.naming.board || '');
            if (config.naming.label !== undefined) setNamingLabel(config.naming.label || '');
        }

        // 7. Task view
        if (config.enableTaskView !== undefined) setEnableTaskView(config.enableTaskView);
        if (config.taskViewWorkspaces !== undefined) setTaskViewWorkspaces(config.taskViewWorkspaces);
        if (config.taskViewRefreshInterval !== undefined) setTaskViewRefreshInterval(config.taskViewRefreshInterval);

        // Clear pending state
        setPendingImport(null);
        onClearImportConfig();
    };

    const dismissImport = () => {
        setPendingImport(null);
        onClearImportConfig();
    }

    useEffect(() => {
        setActiveTab(initialTab);
        if (initialTab === 'map' && user?.token) {
            checkPermissions();
        }
    }, [initialTab, user]);

    const checkPermissions = async () => {
        if (!user?.token) return;
        const scopes = await trelloAuth.checkTokenScopes(user.token);
        const canWrite = scopes.includes('write');
        setHasWritePermission(canWrite);
        console.log("Token scopes:", scopes, "Can write:", canWrite);

        // If user doesn't have write permission, uncheck the update toggle
        if (!canWrite) {
            setUpdateTrelloCoordinates(false);
            setEnableCardMove(false);
        }
    };

    // Helper: Load Settings for a Specific Board
    const loadBoardSettings = async (boardId) => {
        if (!boardId || !user) return;
        setLoadingLists(true);
        setError('');

        try {
            // 1. Fetch Board Data
            await fetchBoardData(boardId);

            // 2. Load Layout
            const allUserData = JSON.parse(localStorage.getItem('trelloUserData') || '{}');
            const savedLayout = allUserData[user.id]?.dashboardLayout?.[boardId];

            if (savedLayout) {
                setBlocks(savedLayout);
            } else {
                const legacyKey = `TRELLO_DASHBOARD_LAYOUT_${boardId}`;
                const legacyLayout = localStorage.getItem(legacyKey);
                if (legacyLayout) setBlocks(JSON.parse(legacyLayout));
                else {
                    setBlocks([]); // Clear if nothing found
                    // Pro on a new device: offer the copy saved on the account.
                    if (syncToAccount) {
                        loadServerConfig(boardId).then((cfg) => {
                            if (cfg) setPendingImport({ ...cfg, fromAccount: true });
                        });
                    }
                }
            }

            // 3. Load Colors
            const savedColors = getPersistentColors(user.id)?.[boardId] || {};
            setListColors(savedColors);

            // 4. Load Other Settings
            const savedRefresh = localStorage.getItem(STORAGE_KEYS.REFRESH_INTERVAL + boardId);
            if (savedRefresh) {
                const parsed = JSON.parse(savedRefresh);
                setRefreshValue(parsed.value);
                setRefreshUnit(parsed.unit);
            } else {
                setRefreshValue(1);
                setRefreshUnit('minutes');
            }

            const savedClock = localStorage.getItem(STORAGE_KEYS.CLOCK_SETTING + boardId);
            setShowClock(savedClock !== 'false');

            const savedIgnore = localStorage.getItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + boardId);
            setIgnoreTemplateCards(savedIgnore !== 'false'); // Default true

            const savedIgnoreCompleted = localStorage.getItem(STORAGE_KEYS.IGNORE_COMPLETED_CARDS + boardId);
            setIgnoreCompletedCards(savedIgnoreCompleted === 'true'); // Default false

            const savedIgnoreNoDesc = localStorage.getItem('IGNORE_NO_DESC_CARDS_' + boardId);
            setIgnoreNoDescCards(savedIgnoreNoDesc === 'true'); // Default false

            const savedEnableIgnoreKeywords = localStorage.getItem(STORAGE_KEYS.ENABLE_IGNORE_KEYWORDS + boardId);
            setEnableIgnoreKeywords(savedEnableIgnoreKeywords === 'true');

            const savedIgnoreKeywords = localStorage.getItem(STORAGE_KEYS.IGNORE_KEYWORDS + boardId);
            setIgnoreKeywords(savedIgnoreKeywords || '');

            // 5. Load Map Config
            const rulesKey = `TRELLO_MARKER_RULES_${boardId}`;
            const savedRules = localStorage.getItem(rulesKey);
            if (savedRules) setMarkerRules(JSON.parse(savedRules));
            else setMarkerRules([]);

            const userSettings = allUserData[user.id]?.settings;
            if (userSettings) {
                // Global-ish settings that might be per-board in future or just last-used
                // For now, these are somewhat global but applied on load. 
                // If we want per-board map enable, we'd need to change schema or key.
                // The request implies "previously saved settings for Board A would come back".
                // The current persistence saves 'enableMapView' in 'trelloUserData[uid].settings', effectively global/last-used.
                // To strictly follow "per board settings", we rely on what IS saved per board.

                // Tasks View Logic
                if (userSettings.enableTaskView !== undefined) setEnableTaskView(userSettings.enableTaskView);
                if (userSettings.taskViewWorkspaces !== undefined) setTaskViewWorkspaces(userSettings.taskViewWorkspaces);
                if (userSettings.taskViewRefreshInterval !== undefined) setTaskViewRefreshInterval(userSettings.taskViewRefreshInterval);

                // Most map settings ARE per board in local storage keys below.
            }

            // Map Persistent Keys
            const savedUpdateTrello = localStorage.getItem('updateTrelloCoordinates_' + boardId);
            setUpdateTrelloCoordinates(savedUpdateTrello === 'true');

            const savedEnableCardMove = localStorage.getItem('enableCardMove_' + boardId);
            setEnableCardMove(savedEnableCardMove === 'true');

            setEnableHomeLocation(localStorage.getItem(`enableHomeLocation_${boardId}`) === 'true');
            setHomeAddress(localStorage.getItem(`homeAddress_${boardId}`) || '');
            const savedHomeCoords = localStorage.getItem(`homeCoordinates_${boardId}`);
            setHomeCoordinates(savedHomeCoords ? JSON.parse(savedHomeCoords) : null);
            setHomeIcon(localStorage.getItem(`homeIcon_${boardId}`) || 'home');
            setHomeCoordinates(savedHomeCoords ? JSON.parse(savedHomeCoords) : null);
            setHomeIcon(localStorage.getItem(`homeIcon_${boardId}`) || 'home');

            const savedEnableStreetView = localStorage.getItem('enableStreetView_' + boardId);
            setEnableStreetView(savedEnableStreetView === 'true');

            // 6. Load Statistics Config
            const statsSettings = userSettings?.statistics || {};
            setEnableStats(!!statsSettings.enabled);
            setStatsShowArchived(statsSettings.includeArchived !== undefined ? statsSettings.includeArchived : true);
            setStatsIncludedLists(statsSettings.includedLists || []);
            setStatsCustomPrompt(statsSettings.customAIPrompt || '');

            // Naming Configuration
            const namingSettings = userSettings?.naming || {};
            setNamingCard(namingSettings.card || '');
            setNamingList(namingSettings.list || '');
            setNamingBoard(namingSettings.board || '');
            setNamingLabel(namingSettings.label || '');

            // Slideshow
            if (userSettings?.slideshowInterval) setSlideshowInterval(userSettings.slideshowInterval);
            else setSlideshowInterval(10);


        } catch (e) {
            console.warn("Error loading board settings", e);
            setError("Failed to load settings for this board.");
        } finally {
            setLoadingLists(false);
        }
    };

    // Initial Load
    useEffect(() => {
        const loadInitialSettings = async () => {
            if (!user) return;
            try {
                // 1. Fetch Boards (including Organization data for grouping)
                const boardsData = await trelloFetch('/members/me/boards?fields=id,name,url,idOrganization&organization=true&organization_fields=displayName,name', user.token);
                setBoards(boardsData);
                refreshEntitlements?.({ boardIds: (boardsData || []).map((b) => b.id) });

                const storedData = JSON.parse(localStorage.getItem('trelloUserData') || '{}');
                const userSettings = storedData[user.id]?.settings;

                if (userSettings?.boardId) {
                    const bId = userSettings.boardId;
                    setSelectedBoardId(bId);

                    // Use helper to load everything
                    await loadBoardSettings(bId);

                    // Global map enables (legacy fallback or global pref)
                    if (userSettings.enableMapView !== undefined) setEnableMapView(userSettings.enableMapView);
                    if (userSettings.mapGeocodeMode) setMapGeocodeMode(userSettings.mapGeocodeMode);
                }

                // Task view settings don't depend on a board, so load them even
                // when no board is configured (tasks-only users).
                if (userSettings) {
                    if (userSettings.enableTaskView !== undefined) setEnableTaskView(userSettings.enableTaskView);
                    if (userSettings.taskViewWorkspaces !== undefined) setTaskViewWorkspaces(userSettings.taskViewWorkspaces);
                    if (userSettings.taskViewRefreshInterval !== undefined) setTaskViewRefreshInterval(userSettings.taskViewRefreshInterval);
                }

                // Also check if 'tasks' view was active in previous session or generic settings 
                // (Actually task view enabled is per user, so userSettings check above is good)
                setInitialLoadDone(true);
            } catch (e) {
                console.warn("Error loading settings", e);
                setError("Couldn't load your settings from Trello. Please try again in a moment.");
            }
        };
        loadInitialSettings();
    }, [user]);

    const fetchBoardData = async (boardId) => {
        setLoadingLists(true);
        setError('');
        try {
            // Fetch lists with 1 card limit to support "first card" preview
            const listsData = await trelloFetch(`/boards/${boardId}/lists?cards=open&card_fields=name&card_limit=1&fields=id,name`, user.token);
            setAllLists(listsData);
            const labelsData = await trelloFetch(`/boards/${boardId}/labels`, user.token);
            setBoardLabels(labelsData);
        } catch (e) {
            setError('Failed to load board lists.');
        } finally {
            setLoadingLists(false);
        }
    };

    const handleBoardChange = async (e) => {
        const boardId = e.target.value;
        setSelectedBoardId(boardId);

        if (boardId) {
            await loadBoardSettings(boardId);
        } else {
            setBlocks([]);
            setListColors({});
            setMarkerRules([]);
            setAllLists([]);
        }
    };

    // --- Actions ---

    const handleAddBlock = () => {
        setBlocks([...blocks, {
            id: `block-${Date.now()}`,
            name: 'New Block',
            listIds: [],
            includeOnMap: false,
            mapIcon: 'map-marker',
            ignoreFirstCard: false,
            displayFirstCardDescription: false
        }]);
    };

    const handleRemoveBlock = (blockId) => {
        if (window.confirm("Delete this block? Assigned lists will be unassigned.")) {
            setBlocks(blocks.filter(b => b.id !== blockId));
        }
    };

    const handleUpdateBlockName = (id, name) => {
        setBlocks(blocks.map(b => b.id === id ? { ...b, name } : b));
    };

    const handleUpdateBlockProp = (id, prop, val) => {
        setBlocks(blocks.map(b => b.id === id ? { ...b, [prop]: val } : b));
    };

    // Drag and Drop Logic
    const onDragEnd = (result) => {
        const { source, destination, draggableId, type } = result;
        if (!destination) return;

        // RULE REORDERING
        if (type === 'RULE') {
            const newRules = Array.from(markerRules);
            const [movedRule] = newRules.splice(source.index, 1);
            newRules.splice(destination.index, 0, movedRule);
            setMarkerRules(newRules);
            return;
        }

        // BLOCK REORDERING
        if (type === 'BLOCK') {
            const newBlocks = Array.from(blocks);
            const [movedBlock] = newBlocks.splice(source.index, 1);
            newBlocks.splice(destination.index, 0, movedBlock);
            setBlocks(newBlocks);
            return;
        }

        // LIST ASSIGNMENT
        const listId = draggableId;
        const sourceId = source.droppableId;
        const destId = destination.droppableId;

        const removeListFromBlock = (blockId, lId) => {
            const block = blocks.find(b => b.id === blockId);
            const newListIds = block.listIds.filter(id => id !== lId);
            return { ...block, listIds: newListIds };
        };

        const addListToBlock = (blockId, lId, index) => {
            const block = blocks.find(b => b.id === blockId);
            const newListIds = Array.from(block.listIds);
            newListIds.splice(index, 0, lId);
            return { ...block, listIds: newListIds };
        };

        // Case 1: Reordering within same block
        if (sourceId === destId && sourceId !== 'unassigned') {
            const block = blocks.find(b => b.id === sourceId);
            const newListIds = Array.from(block.listIds);
            newListIds.splice(source.index, 1);
            newListIds.splice(destination.index, 0, listId);
            setBlocks(blocks.map(b => b.id === sourceId ? { ...b, listIds: newListIds } : b));
            return;
        }

        let newBlocks = [...blocks];

        // Case 2: Moving from Block A to Block B (or Unassigned)
        if (sourceId !== 'unassigned') {
            newBlocks = newBlocks.map(b => b.id === sourceId ? removeListFromBlock(sourceId, listId) : b);
        }

        // Case 3: Moving to Block B
        if (destId !== 'unassigned') {
            newBlocks = newBlocks.map(b => b.id === destId ? addListToBlock(destId, listId, destination.index) : b);
        }

        setBlocks(newBlocks);
    };

    // Rule Management
    const handleAddRule = () => setMarkerRules([...markerRules, { id: `rule-${Date.now()}`, labelId: '', overrideType: 'color', overrideValue: 'red' }]);
    const handleUpdateRule = (id, f, v) => setMarkerRules(markerRules.map(r => r.id === id ? { ...r, [f]: v } : r));
    const removeRule = (id) => setMarkerRules(markerRules.filter(r => r.id !== id));

    const settingsReady = initialLoadDone && !loadingLists;

    const handleSave = async () => {
        // Don't save while the saved configuration is still loading: the form
        // still holds empty defaults and would wipe the board's layout.
        if (!settingsReady) return;

        // Board limit: adding a board beyond the plan opens the "remove a board" dialog.
        if (selectedBoardId && entitlements?.enforced) {
            const check = await registerBoardWithLimit(selectedBoardId, user.token);
            if (!check.ok) {
                requestBoardLimit?.(check.limit);
                setError('Your plan\'s board limit is reached. Remove a board, then save again.');
                window.scrollTo(0, 0);
                return;
            }
        }

        // VALIDATION: Slideshow Interval
        if (slideshowInterval < 10) {
            alert("Slideshow interval must be at least 10 seconds.");
            return;
        }

        // VALIDATION: Refresh Interval 
        const refreshSeconds = { seconds: 1, minutes: 60, hours: 3600 }[refreshUnit] * (parseInt(refreshValue) || 0);
        if (!refreshFixed && refreshSeconds < minRefreshSeconds) {
            setError(minRefreshSeconds >= 60
                ? `Refresh interval must be at least ${minRefreshSeconds / 60} minute${minRefreshSeconds === 60 ? '' : 's'} on your plan. Use the Refresh button for live data.`
                : `Refresh interval must be at least ${minRefreshSeconds} seconds.`);
            window.scrollTo(0, 0);
            return;
        }

        // VALIDATION: Must have Board OR Task View enabled
        if (!selectedBoardId && !enableTaskView) {
            return alert("You must either enable the tasks view, or choose a Trello board to configure as a dashboard to use Trellops.");
        }

        const selectedBoard = boards.find(b => b.id === selectedBoardId);

        try {
            // ONLY SAVE BOARD SPECIFIC SETTINGS IF BOARD IS SELECTED
            if (selectedBoardId) {
                // 1. Save Blocks Layout (Correct Persistence)
                setPersistentLayout(user.id, selectedBoardId, blocks);

                // 2. Save Colors
                setPersistentColors(user.id, selectedBoardId, listColors);

                // 3. Save Other Settings
                localStorage.setItem(STORAGE_KEYS.REFRESH_INTERVAL + selectedBoardId, JSON.stringify({ value: refreshValue, unit: refreshUnit }));
                localStorage.setItem(STORAGE_KEYS.CLOCK_SETTING + selectedBoardId, showClock ? 'true' : 'false');
                localStorage.setItem(STORAGE_KEYS.IGNORE_TEMPLATE_CARDS + selectedBoardId, ignoreTemplateCards ? 'true' : 'false');
                localStorage.setItem(STORAGE_KEYS.IGNORE_COMPLETED_CARDS + selectedBoardId, ignoreCompletedCards ? 'true' : 'false');
                localStorage.setItem(STORAGE_KEYS.IGNORE_NO_DESC_CARDS + selectedBoardId, ignoreNoDescCards ? 'true' : 'false');
                localStorage.setItem(STORAGE_KEYS.ENABLE_IGNORE_KEYWORDS + selectedBoardId, enableIgnoreKeywords ? 'true' : 'false');
                localStorage.setItem(STORAGE_KEYS.IGNORE_KEYWORDS + selectedBoardId, ignoreKeywords);

                // 4. Save Map Config
                localStorage.setItem(`TRELLO_MARKER_RULES_${selectedBoardId}`, JSON.stringify(markerRules.filter(r => r.labelId))); // Clean empty rules

                localStorage.setItem(`enableHomeLocation_${selectedBoardId}`, enableHomeLocation);
                localStorage.setItem(`homeAddress_${selectedBoardId}`, homeAddress);
                localStorage.setItem(`homeCoordinates_${selectedBoardId}`, JSON.stringify(homeCoordinates));
                localStorage.setItem(`homeIcon_${selectedBoardId}`, homeIcon);

                // Only allow saving true if permission exists
                const safeUpdateTrello = updateTrelloCoordinates && hasWritePermission;
                localStorage.setItem('updateTrelloCoordinates_' + selectedBoardId, safeUpdateTrello ? 'true' : 'false');

                const safeEnableCardMove = enableCardMove && hasWritePermission;
                localStorage.setItem('enableCardMove_' + selectedBoardId, safeEnableCardMove ? 'true' : 'false');
                localStorage.setItem('enableStreetView_' + selectedBoardId, enableStreetView ? 'true' : 'false');

                // If enabling Trello updates, reset the cache to force decoding and updating
                if (safeUpdateTrello) {
                    const cacheKey = `MAP_GEOCODING_CACHE_${selectedBoardId}`;
                    if (localStorage.getItem(cacheKey)) {
                        localStorage.removeItem(cacheKey);
                        console.log("Cache cleared due to Trello Update enablement.");
                    }
                }
            }

            // 5. Update User Settings (CRITICAL: Populate selectedLists for Dashboard.jsx)
            // Flatten all lists assigned to blocks
            // If the board's lists couldn't be fetched (e.g. Trello rate limit),
            // fall back to the names saved last time, then to the bare id, so the
            // dashboard never loses its lists because of a failed request.
            const previousLists = JSON.parse(localStorage.getItem('trelloUserData') || '{}')[user.id]?.settings?.selectedLists || [];
            const assignedLists = blocks.flatMap(b => b.listIds).map(lId => {
                const list = allLists.find(l => l.id === lId) || previousLists.find(l => l.id === lId);
                return list ? { id: list.id, name: list.name } : { id: lId, name: '' };
            });

            const newSettings = {
                boardId: selectedBoardId || null,
                boardName: selectedBoard ? selectedBoard.name : (selectedBoardId ? 'Unknown Board' : null),
                selectedLists: assignedLists, // THIS FIXES THE "NO BOARD CONFIG" ERROR
                enableMapView,
                mapGeocodeMode,
                enableCardMove: enableCardMove && hasWritePermission,
                enableStreetView,
                enableTaskView,
                taskViewWorkspaces,
                taskViewRefreshInterval,
                slideshowInterval: parseInt(slideshowInterval) || 10,
                statistics: {
                    enabled: enableStats,
                    showArchived: statsShowArchived,
                    includedLists: statsIncludedLists,
                    customAIPrompt: statsCustomPrompt
                },
                naming: {
                    card: namingCard.trim() || undefined,
                    list: namingList.trim() || undefined,
                    board: namingBoard.trim() || undefined,
                    label: namingLabel.trim() || undefined
                }
            };

            const storedData = JSON.parse(localStorage.getItem('trelloUserData') || '{}');
            storedData[user.id] = {
                ...storedData[user.id],
                settings: newSettings
            };
            localStorage.setItem('trelloUserData', JSON.stringify(storedData));

            // Pro: keep a copy on the account so the dashboard follows the member to other devices.
            if (selectedBoardId && syncToAccount) saveServerConfig(selectedBoardId, getConfigObject());

            // Call onSave with newSettings to update App.jsx state IMMEDIATELY
            onSave(newSettings);
        } catch (e) {
            console.error(e);
            setError("Failed to save settings.");
        }
    };

    const handleSaveTasks = () => {
        if (!settingsReady) return;
        try {
            const newSettings = {
                // Keep existing board settings? No, we are updating user.settings which mixes both.
                // We need to fetch existing settings to preserve board specific stuff if we aren't careful?
                // Actually, our persistence model replaces `user.settings`.
                // We need to construct the full object.
                // To be safe, we should probably read the current state for board stuff OR just update the specific keys in `storedData`.

                // STRATEGY: Update only specific keys in localStorage 'trelloUserData'
                ...user.settings, // Start with current settings
                enableTaskView,
                taskViewWorkspaces,
                taskViewRefreshInterval
            };

            const storedData = JSON.parse(localStorage.getItem('trelloUserData') || '{}');
            const currentUserData = storedData[user.id] || {};

            storedData[user.id] = {
                ...currentUserData,
                settings: {
                    ...(currentUserData.settings || {}),
                    enableTaskView,
                    taskViewWorkspaces,
                    taskViewRefreshInterval
                }
            };

            localStorage.setItem('trelloUserData', JSON.stringify(storedData));

            // Notify Parent
            // We pass the full new settings object to update local state in App.jsx
            // We can mix current state + new task settings
            // Pass the full stored settings (board included) back to App.jsx.
            // `user` has no settings field, so spreading user.settings here
            // dropped the board and made the dashboard ask to be configured.
            onSave({
                ...(currentUserData.settings || {}),
                enableTaskView,
                taskViewWorkspaces,
                taskViewRefreshInterval
            });

            // alert("Task View settings saved!");
            // Simply close/redirect
            if (onManageTasks) {
                // If we are in default mode, logic might differ, but typically this is called in 'tasks' mode
                // Actually, if we are in 'tasks' mode, onClose usually redirects to Dashboard.
                // Request says "load the /tasks view".
                // We should check if onClose handles this or if we need a specific nav.
                // App.jsx: onClose -> setView('dashboard').
                // We want to go to /tasks.
                if (viewMode === 'tasks') {
                    // We don't have a direct "GoToTasks" prop other than onManageTasks which goes to settings.
                    // But wait, the parent App passes onClose.
                    // If we want to go strictly to /tasks, we might need a new prop or rely on window location?
                    // Ideally, onSave updates state, then we call something else.
                    // Let's modify App.jsx to handle this? Or just use window.location for now to be safe/easy?
                    // Actually, simply redirecting via window.location.href = '/tasks' works but is a full reload.
                    // Using history is better.
                    window.history.pushState({}, '', '/tasks');
                    window.dispatchEvent(new Event('popstate'));
                } else {
                    onClose();
                }
            } else {
                if (viewMode === 'tasks') {
                    window.history.pushState({}, '', '/tasks');
                    window.dispatchEvent(new Event('popstate'));
                } else {
                    onClose();
                }
            }

        } catch (e) {
            console.error("Failed to save task settings", e);
            alert("Failed to save task settings");
        }
    };

    const handleImprovePrompt = async () => {
        if (!statsCustomPrompt.trim()) return;
        setIsImprovingPrompt(true);
        try {
            await serverSessionReady(); // the route needs the session cookie
            const res = await fetch(`/api/improvePrompt${selectedBoardId ? `?board=${selectedBoardId}` : ''}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rawPrompt: statsCustomPrompt })
            });
            const data = await res.json();
            if (res.ok) {
                setStatsCustomPrompt(data.improvedPrompt);
            } else {
                alert(`Error improving prompt: ${data.error}`);
            }
        } catch (e) {
            alert(`Error improving prompt: ${e.message}`);
        } finally {
            setIsImprovingPrompt(false);
        }
    };

    const handleClearBoardConfig = () => {
        if (window.confirm("Clear all settings?")) {
            setBlocks([]);
            setListColors({});
            setMarkerRules([]);
        }
    };

    const getConfigObject = () => {
        if (!selectedBoardId) return null;
        const boardName = boards.find(b => b.id === selectedBoardId)?.name;

        return {
            // Identity
            boardId: selectedBoardId,
            boardName,

            // Dashboard layout
            blocks,
            listColors,

            // Other board settings
            refreshValue,
            refreshUnit,
            showClock,
            ignoreTemplateCards,
            ignoreCompletedCards,
            ignoreNoDescCards,
            enableIgnoreKeywords,
            ignoreKeywords,
            slideshowInterval,

            // Map settings
            enableMapView,
            mapGeocodeMode,
            updateTrelloCoordinates,
            enableCardMove,
            enableStreetView,
            enableHomeLocation,
            homeAddress,
            homeCoordinates,
            homeIcon,
            markerRules,

            // Statistics settings
            statistics: {
                enabled: enableStats,
                showArchived: statsShowArchived,
                includedLists: statsIncludedLists,
                customAIPrompt: statsCustomPrompt,
            },

            // Naming / terminology
            naming: {
                card: namingCard.trim() || undefined,
                list: namingList.trim() || undefined,
                board: namingBoard.trim() || undefined,
                label: namingLabel.trim() || undefined,
            },

            // Task view
            enableTaskView,
            taskViewWorkspaces,
            taskViewRefreshInterval,
        };
    };

    const handleExportConfig = () => {
        const config = getConfigObject();
        if (!config) return;

        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trellops-config-${selectedBoardId}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleImportConfig = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const config = JSON.parse(evt.target.result);
                if (config.boardId && config.boardId !== selectedBoardId) {
                    if (!window.confirm(`This config is for board ${config.boardId}, but you are on ${selectedBoardId}. Import anyway?`)) return;

                    // Pre-populate board selection if available
                    // We need to set selectedBoardId to the one in config
                    // Ideally, we shoudl check if the user has access to this board in 'boards' list
                    const targetBoard = boards.find(b => b.id === config.boardId);
                    if (targetBoard) {
                        setSelectedBoardId(config.boardId);
                        // We might want to trigger a fetch here or let the effect handle it?
                        // Since we are setting state directly below, we might skip a fetch or need one for lists.
                        // Ideally: Set ID -> Fetch Data -> Apply Config.
                        // But applyConfig is synchronous here.
                        // Let's rely on handleBoardChange logic or manual fetch?
                        // Better: just set the ID. The effect 'loadBoardSettings' or 'fetchBoardData' might trigger if we added it to dependency array, but we didn't.
                        // Let's manually trigger fetch to ensure lists are loaded for the config to map correctly.
                        fetchBoardData(config.boardId);
                    } else {
                        // User might not have this board loaded or access to it.
                        console.warn("Imported config for unknown board:", config.boardId);
                        // Still set it? Or let user stay on current?
                        // Request says "pre-populate all fields including board name".
                        // Use config.boardId as selectedBoardId even if name unknown?
                        setSelectedBoardId(config.boardId);
                        // We can TRY to fetch it.
                        fetchBoardData(config.boardId);
                    }
                }

                if (config.blocks) setBlocks(config.blocks);
                if (config.listColors) setListColors(config.listColors);
                if (config.markerRules) setMarkerRules(config.markerRules);
                if (config.refreshValue) setRefreshValue(config.refreshValue);
                if (config.refreshUnit) setRefreshUnit(config.refreshUnit);
                if (config.showClock !== undefined) setShowClock(config.showClock);
                if (config.ignoreTemplateCards !== undefined) setIgnoreTemplateCards(config.ignoreTemplateCards);
                if (config.ignoreCompletedCards !== undefined) setIgnoreCompletedCards(config.ignoreCompletedCards);
                if (config.ignoreNoDescCards !== undefined) setIgnoreNoDescCards(config.ignoreNoDescCards);
                if (config.enableIgnoreKeywords !== undefined) setEnableIgnoreKeywords(config.enableIgnoreKeywords);
                if (config.ignoreKeywords !== undefined) setIgnoreKeywords(config.ignoreKeywords);
                if (config.slideshowInterval !== undefined) setSlideshowInterval(config.slideshowInterval);

                // Map settings
                if (config.enableMapView !== undefined) setEnableMapView(config.enableMapView);
                if (config.mapGeocodeMode) setMapGeocodeMode(config.mapGeocodeMode);
                if (config.updateTrelloCoordinates !== undefined) setUpdateTrelloCoordinates(config.updateTrelloCoordinates);
                if (config.enableCardMove !== undefined) setEnableCardMove(config.enableCardMove);
                if (config.enableStreetView !== undefined) setEnableStreetView(config.enableStreetView);
                if (config.enableHomeLocation !== undefined) setEnableHomeLocation(config.enableHomeLocation);
                if (config.homeAddress !== undefined) setHomeAddress(config.homeAddress);
                if (config.homeCoordinates !== undefined) setHomeCoordinates(config.homeCoordinates);
                if (config.homeIcon !== undefined) setHomeIcon(config.homeIcon);

                // Statistics settings (nested object)
                if (config.statistics) {
                    if (config.statistics.enabled !== undefined) setEnableStats(config.statistics.enabled);
                    if (config.statistics.showArchived !== undefined) setStatsShowArchived(config.statistics.showArchived);
                    if (config.statistics.includedLists !== undefined) setStatsIncludedLists(config.statistics.includedLists);
                    if (config.statistics.customAIPrompt !== undefined) setStatsCustomPrompt(config.statistics.customAIPrompt);
                }

                // Naming / terminology
                if (config.naming) {
                    if (config.naming.card !== undefined) setNamingCard(config.naming.card || '');
                    if (config.naming.list !== undefined) setNamingList(config.naming.list || '');
                    if (config.naming.board !== undefined) setNamingBoard(config.naming.board || '');
                    if (config.naming.label !== undefined) setNamingLabel(config.naming.label || '');
                }

                // Task view
                if (config.enableTaskView !== undefined) setEnableTaskView(config.enableTaskView);
                if (config.taskViewWorkspaces !== undefined) setTaskViewWorkspaces(config.taskViewWorkspaces);
                if (config.taskViewRefreshInterval !== undefined) setTaskViewRefreshInterval(config.taskViewRefreshInterval);

                alert("Configuration imported! Click Save to persist changes.");

            } catch (err) {
                console.error(err);
                alert("Failed to parse configuration file.");
            }
        };
        reader.readAsText(file);
    };

    // Helper: Get Unassigned Lists
    const assignedListIds = new Set(blocks.flatMap(b => b.listIds));
    const unassignedLists = allLists.filter(l => !assignedListIds.has(l.id));

    const selectedBoard = boards.find(b => b.id === selectedBoardId);

    // Reuse Switch Component - Modified to allow click-through to parent container
    const ToggleSwitch = ({ checked, onChange, id }) => (
        <label className="switch" htmlFor={id} style={{ pointerEvents: 'none' }}>
            <input
                type="checkbox"
                checked={checked}
                onChange={onChange}
                id={id}
            />
            <span className="slider round"></span>
        </label>
    );

    return (
        <div className="settings-container settings-page">
            {viewMode === 'default' && (
                <>
                    <div className="settings-title-row">
                        <div className="settings-title-left">
                            <h2 className="settings-page-title">Dashboard Settings</h2>
                            <PlanPill onClick={() => setActiveTab('billing')} />
                        </div>
                        {isAdmin && onOpenAdmin && (
                            <button type="button" className="button-secondary" onClick={onOpenAdmin}>Admin dashboard</button>
                        )}
                    </div>


                    {accountNotice?.show && (
                        <div className="notice notice-info account-scope-notice" role="status">
                            <strong>Reconnect Trello to finish setting up your account.</strong>
                            <span className="notice-sub">Trellops now asks Trello for your email address so we can link plans and support requests to your account. Your boards and settings stay as they are.</span>
                            <div className="notice-actions">
                                <button className="button-primary notice-action" onClick={accountNotice.onReconnect}>Reconnect Trello</button>
                                <button className="button-secondary notice-action" onClick={accountNotice.onDismiss}>Not now</button>
                            </div>
                        </div>
                    )}

                    {/* BOARD SELECTOR (GLOBAL) */}
                    <div className="admin-section board-picker">
                        <h3>Choose your Trello Board</h3>
                        <p className="section-hint">
                            Boards are pulled directly from your Trello account, across all workspaces.
                        </p>
                        <div id="board-selection-container" className="board-select-row">
                        <BoardSelect
                            boards={boards}
                            value={selectedBoardId}
                            onChange={(boardId) => handleBoardChange({ target: { value: boardId } })}
                            planFor={boardPlanFor}
                        />
                        {selectedBoardId && <BoardIdCopy boardId={selectedBoardId} />}
                        </div>
                        {selectedBoardId && (
                            <p className="charity-link-row">
                                Charity or NGO?{' '}
                                <button type="button" className="link-button" onClick={() => setShowCharityModal(true)}>
                                    Request a free board plan
                                </button>
                            </p>
                        )}
                        {showCharityModal && (
                            <CharityRequestModal
                                boardId={selectedBoardId}
                                boardName={boards.find(b => b.id === selectedBoardId)?.name}
                                onClose={() => setShowCharityModal(false)}
                            />
                        )}
                    </div>

                    {/* TABS HEADER */}
                    <div className="settings-tabs" role="tablist">
                        <button
                            className={`tab-button ${activeTab === 'dashboard' ? 'active' : ''}`}
                            onClick={() => setActiveTab('dashboard')}
                        >
                            <LayoutGrid size={16} aria-hidden="true" /> Dashboard View Settings
                        </button>
                        <button
                            id="settings-tab-map"
                            className={`tab-button ${activeTab === 'map' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveTab('map');
                                checkPermissions();
                            }}
                        >
                            <MapIcon size={16} aria-hidden="true" /> Map View Settings
                        </button>
                        <button
                            className={`tab-button ${activeTab === 'statistics' ? 'active' : ''}`}
                            onClick={() => setActiveTab('statistics')}
                        >
                            <ChartColumn size={16} aria-hidden="true" /> Statistics Settings
                        </button>
                        <button
                            id="settings-tab-other"
                            className={`tab-button ${activeTab === 'other' ? 'active' : ''}`}
                            onClick={() => setActiveTab('other')}
                        >
                            <SlidersHorizontal size={16} aria-hidden="true" /> Other Board settings
                        </button>
                        <button
                            id="settings-tab-billing"
                            className={`tab-button ${activeTab === 'billing' ? 'active' : ''}`}
                            onClick={() => setActiveTab('billing')}
                        >
                            <CreditCard size={16} aria-hidden="true" /> Plan and billing
                        </button>
                    </div>
                </>
            )}

            {error && <div className="error-banner notice notice-danger">{error}</div>}

            {pendingImport && (
                <div className="info-banner notice notice-info notice-row">
                    <div>
                        {pendingImport.fromAccount
                            ? <><strong>Saved settings found:</strong> your account has settings for <strong>{pendingImport.boardName || pendingImport.boardId}</strong> from another device.</>
                            : <><strong>Configuration Loaded:</strong> Shared settings available for board <strong>{pendingImport.boardName || pendingImport.boardId}</strong>.</>}
                        <div style={{ fontSize: '0.9em', marginTop: '4px' }}>Unsaved changes will be lost if you apply this configuration.</div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button className="button-primary" onClick={applyImportedConfig}>Apply</button>
                        <button className="button-secondary" onClick={dismissImport}>Dismiss</button>
                    </div>
                </div>
            )}



            <DragDropContext onDragEnd={onDragEnd}>
                {/* BOARD SETTINGS ONLY SHOW IF VIEWMODE IS DEFAULT */}
                {viewMode === 'default' && (
                    <div className="settings-tab-panel">
                        {/* TAB CONTENT: DASHBOARD */}
                        {activeTab === 'dashboard' && (
                            <div className="tab-content">

                                {/* SECTION 1: BLOCK MANAGEMENT (Renumbered) */}
                                {selectedBoard ? (
                                    <>
                                        {/* SECTION 1: BLOCKS */}
                                        <div className="admin-section" id="section-2">
                                            <h3>1. Manage your Trellops blocks</h3>
                                            <p className="section-hint">
                                                A block is a group of tiles representing each Trello list (or column). You will be able to assign one or multiple tiles to each block. Blocks can be shown or hidden on demand on the dashboard.
                                            </p>
                                            <Droppable droppableId="blocks-list" type="BLOCK">
                                                {(provided) => (
                                                    <div ref={provided.innerRef} {...provided.droppableProps}>
                                                        {blocks.map((block, index) => (
                                                            <Draggable key={block.id} draggableId={block.id} index={index}>
                                                                {(provided) => (
                                                                    <div
                                                                        ref={provided.innerRef}
                                                                        {...provided.draggableProps}
                                                                        className="block-row"
                                                                        style={provided.draggableProps.style}
                                                                    >
                                                                        <div {...provided.dragHandleProps} className="drag-handle" aria-label="Drag to reorder"><GripVertical size={18} /></div>
                                                                        <input
                                                                            type="text"
                                                                            value={block.name}
                                                                            onChange={(e) => handleUpdateBlockName(block.id, e.target.value)}
                                                                            className="block-name-input"
                                                                        />
                                                                        <button
                                                                            type="button"
                                                                            className="icon-button icon-button-danger"
                                                                            onClick={() => handleRemoveBlock(block.id)}
                                                                            title="Remove Block"
                                                                            aria-label="Remove Block"
                                                                        >
                                                                            <Trash2 size={17} />
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </Draggable>
                                                        ))}
                                                        {provided.placeholder}
                                                    </div>
                                                )}
                                            </Droppable>
                                            <button className="add-block-button" onClick={handleAddBlock}><Plus size={16} aria-hidden="true" /> Add Block</button>
                                        </div>

                                        {/* SECTION 2: ASSIGN TILES (Renumbered) */}
                                        <div className="admin-section" id="section-3">
                                            <h3>2. Assign tiles to your blocks</h3>
                                            <p className="section-hint">
                                                Tiles show the total count of cards in each Trello list, automatically updating as the cards are created or moved. Choose from the Unassigned pool on the left, the lists you want to create as a tile in the respective block on the right. Then customise each tile position and colour.
                                            </p>

                                            <div className="tiles-layout">
                                                {/* UNASSIGNED */}
                                                <div id="unassigned-lists-container" className="tiles-pool">
                                                    <h4 className="tiles-column-title">Available Lists</h4>
                                                    <Droppable droppableId="unassigned" type="LIST">
                                                        {(provided) => (
                                                            <div ref={provided.innerRef} {...provided.droppableProps} className="tiles-dropzone">
                                                                {unassignedLists.map((list, index) => (
                                                                    <Draggable key={list.id} draggableId={list.id} index={index}>
                                                                        {(provided) => (
                                                                            <div
                                                                                ref={provided.innerRef}
                                                                                {...provided.draggableProps}
                                                                                {...provided.dragHandleProps}
                                                                                className="tile-row tile-row-pool"
                                                                                style={provided.draggableProps.style}
                                                                            >
                                                                                {list.name}
                                                                            </div>
                                                                        )}
                                                                    </Draggable>
                                                                ))}
                                                                {provided.placeholder}
                                                            </div>
                                                        )}
                                                    </Droppable>
                                                </div>

                                                {/* BLOCKS TARGETS */}
                                                <div className="tiles-blocks">
                                                    {blocks.map(block => (
                                                        <div key={block.id} className="tiles-block">
                                                            <h4 className="tiles-column-title">{block.name}</h4>

                                                            {/* Block Options Inside Section 3 */}
                                                            <div className="tiles-block-options">
                                                                <div className="tiles-block-options-row">
                                                                    <div
                                                                        className="toggle-row"
                                                                        onClick={() => handleUpdateBlockProp(block.id, 'ignoreFirstCard', !block.ignoreFirstCard)}
                                                                    >
                                                                        <ToggleSwitch checked={block.ignoreFirstCard} onChange={e => handleUpdateBlockProp(block.id, 'ignoreFirstCard', e.target.checked)} />
                                                                        <span>Do not count the first card in the total</span>
                                                                    </div>
                                                                    {block.ignoreFirstCard && (
                                                                        <div
                                                                            className="toggle-row"
                                                                            onClick={() => handleUpdateBlockProp(block.id, 'displayFirstCardDescription', !block.displayFirstCardDescription)}
                                                                        >
                                                                            <ToggleSwitch checked={block.displayFirstCardDescription} onChange={e => handleUpdateBlockProp(block.id, 'displayFirstCardDescription', e.target.checked)} />
                                                                            <span>Display the first card as tile description</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            <Droppable droppableId={block.id} type="LIST">
                                                                {(provided) => (
                                                                    <div ref={provided.innerRef} {...provided.droppableProps} className="tiles-dropzone tiles-dropzone-block">
                                                                        {block.listIds.map((listId, index) => {
                                                                            const list = allLists.find(l => l.id === listId);
                                                                            if (!list) return null;
                                                                            const color = listColors[listId] || '#0079bf';
                                                                            return (
                                                                                <Draggable key={listId} draggableId={listId} index={index}>
                                                                                    {(provided) => (
                                                                                        <div
                                                                                            ref={provided.innerRef}
                                                                                            {...provided.draggableProps}
                                                                                            {...provided.dragHandleProps}
                                                                                            className="tile-row"
                                                                                            style={{ '--tile-color': color, ...provided.draggableProps.style }}
                                                                                        >
                                                                                            <span className="tile-row-name">{list.name}</span>

                                                                                            {block.ignoreFirstCard && block.displayFirstCardDescription && list.cards && list.cards.length > 0 && (
                                                                                                <span className="tile-row-first" style={{
                                                                                                    width: '20%',
                                                                                                    textAlign: 'right',
                                                                                                    fontSize: '0.85em',
                                                                                                    color: 'var(--text-secondary)',
                                                                                                    fontStyle: 'italic',
                                                                                                    overflow: 'hidden',
                                                                                                    textOverflow: 'ellipsis',
                                                                                                    whiteSpace: 'nowrap',
                                                                                                    flexShrink: 0
                                                                                                }}>
                                                                                                    [{list.cards[0].name}]
                                                                                                </span>
                                                                                            )}

                                                                                            <input
                                                                                                type="color"
                                                                                                value={color}
                                                                                                onChange={e => setListColors({ ...listColors, [listId]: e.target.value })}
                                                                                                className="color-swatch-input"
                                                                                                title="Tile Colour"
                                                                                            />
                                                                                        </div>
                                                                                    )}
                                                                                </Draggable>
                                                                            );
                                                                        })}
                                                                        {provided.placeholder}
                                                                    </div>
                                                                )}
                                                            </Droppable>


                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="empty-state">Select a board to configure blocks</div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* TAB CONTENT: MAP */}
                {activeTab === 'map' && (
                    <div className="tab-content">
                        {selectedBoard ? (
                            <div className="admin-section" id="section-5">
                                <h3>Map View Settings for {selectedBoard.name}</h3>
                                <p className="section-hint">
                                    Map settings are saved per-board. Choose whether Map View is enabled and how geocoding should behave for cards on this board.
                                </p>
                                {!can('map') && <ProLock feature="map" />}
                                <div id="map-enable-toggle" className={`settings-row toggle-row toggle-row-main${can('map') ? '' : ' locked-control'}`} onClick={() => setEnableMapView(!enableMapView)}>
                                    <ToggleSwitch checked={enableMapView} onChange={e => setEnableMapView(e.target.checked)} />
                                    <span>Enable Map View{!can('map') && <ProTag />}</span>
                                </div>

                                {enableMapView && (
                                    <div style={{ marginTop: '15px' }}>
                                        <div className="subpanel">
                                            <label className="subpanel-title">Geocoding behavior</label>

                                            {/* Option 1: Always Read (Visual Confirmation) */}
                                            <div className="toggle-row is-locked">
                                                <ToggleSwitch checked={true} onChange={() => { }} />
                                                <span className="toggle-text">
                                                    Read the coordinates from the Trello card "Location" field to display the card location
                                                </span>
                                            </div>

                                            {/* Option 2: Enable Local Geocoding (Nominatim) */}
                                            <div
                                                className="toggle-row"
                                                onClick={() => {
                                                    const newVal = mapGeocodeMode === 'disabled' ? 'store' : 'disabled';
                                                    setMapGeocodeMode(newVal);
                                                    if (newVal === 'disabled') setUpdateTrelloCoordinates(false);
                                                }}
                                            >
                                                <ToggleSwitch
                                                    checked={mapGeocodeMode !== 'disabled'}
                                                    onChange={e => {
                                                        const newVal = e.target.checked ? 'store' : 'disabled';
                                                        setMapGeocodeMode(newVal);
                                                        if (newVal === 'disabled') setUpdateTrelloCoordinates(false);
                                                    }}
                                                />
                                                <span className="toggle-text">
                                                    If no coordinates are present in the card, parse the card description to decode the coordinates for the card. (experimental)<br />
                                                    <span className="field-hint">
                                                        Note: this will use Google Maps Geocoding API, and will store the coordinates locally on your browser cache
                                                    </span>
                                                    <span className="field-hint">
                                                        Note: Cards without a description will be skipped.
                                                    </span>
                                                </span>
                                            </div>

                                            {/* Option 3: Update Trello Cards (Nested with Upsell) */}
                                            <div className="toggle-nested">
                                                <div
                                                    className={`toggle-row${mapGeocodeMode === 'disabled' ? ' is-disabled' : ''}`}
                                                    onClick={() => setUpdateTrelloCoordinates(!updateTrelloCoordinates)}
                                                >
                                                    <ToggleSwitch
                                                        checked={updateTrelloCoordinates}
                                                        onChange={e => setUpdateTrelloCoordinates(e.target.checked)}
                                                    />
                                                    <span className="toggle-text">
                                                        Update the Trello card coordinates using the decoded address from Google Maps (beta).<br />
                                                        <span className="field-hint">
                                                            It is recommended to only have one dashboard enabled with this feature for each Trello board
                                                        </span>
                                                    </span>
                                                </div>

                                                {/* Permission Upsell Banner */}
                                                {updateTrelloCoordinates && !hasWritePermission && (
                                                    <div className="notice notice-info">
                                                        <strong>Permission Required:</strong> To update card coordinates, you must grant Trello "Write" access.<br />
                                                        <span className="notice-sub">The location cache on your computer will be reset for the cards to be decoded again.</span>
                                                        <button className="button-primary notice-action" onClick={() => trelloAuth.login('read,write,account')}>
                                                            Authorize Write Access (Re-Login)
                                                        </button>
                                                    </div>
                                                )}

                                                {/* Success Indicator */}
                                                {updateTrelloCoordinates && hasWritePermission && (
                                                    <div className="status-line status-success">
                                                        <CircleCheck size={16} aria-hidden="true" /> Write permissions successfully granted.
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* DUPLICATED BLOCK LIST FOR MAP SETTINGS */}
                                        <h4 className="subsection-title">Block Map Options</h4>
                                        <p className="section-hint">
                                            Choose which blocks appear on the map and customize their markers.
                                        </p>
                                        <div id="map-block-options" className="stack">
                                            {blocks.map(block => (
                                                <div key={block.id} className="subpanel">
                                                    <div className="subpanel-head">
                                                        <h4>{block.name}</h4>
                                                        <div className="toggle-row" onClick={() => handleUpdateBlockProp(block.id, 'includeOnMap', !block.includeOnMap)}>
                                                            <ToggleSwitch checked={block.includeOnMap} onChange={e => handleUpdateBlockProp(block.id, 'includeOnMap', e.target.checked)} />
                                                            <span>Show on map</span>
                                                        </div>
                                                    </div>

                                                    {block.includeOnMap && (
                                                        <div className="subpanel-body">
                                                            <label className="field-label">Icon</label>
                                                            <div style={{ width: '100%' }}>
                                                                <IconPicker selectedIcon={block.mapIcon} onChange={icon => handleUpdateBlockProp(block.id, 'mapIcon', icon)} />
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>

                                        <div id="map-marker-rules" className="admin-section">
                                            <h3>Marker Variants</h3>
                                            <p className="section-hint">
                                                Choose alternative display options for cards based on their Trello label value. You can choose to display a marker with a different colour or icon. In case of conflicts, the rule higher in the list will be applied.
                                            </p>

                                            <Droppable droppableId="marker-rules" type="RULE">
                                                {(provided) => (
                                                    <div ref={provided.innerRef} {...provided.droppableProps} className="rules-list">
                                                        {markerRules.map((rule, idx) => (
                                                            <Draggable key={rule.id} draggableId={rule.id} index={idx}>
                                                                {(provided) => (
                                                                    <div
                                                                        ref={provided.innerRef}
                                                                        {...provided.draggableProps}
                                                                        className="rule-item"
                                                                        style={provided.draggableProps.style}
                                                                    >
                                                                        <div {...provided.dragHandleProps} className="drag-handle" aria-label="Drag to reorder"><GripVertical size={18} /></div>
                                                                        <select value={rule.labelId} onChange={e => handleUpdateRule(rule.id, 'labelId', e.target.value)}>
                                                                            <option value="">-- Label --</option>
                                                                            {boardLabels.map(l => <option key={l.id} value={l.id}>{l.name || l.color}</option>)}
                                                                        </select>
                                                                        <div className="radio-inline">
                                                                            <label><input type="radio" checked={rule.overrideType === 'color'} onChange={() => handleUpdateRule(rule.id, 'overrideType', 'color')} /> Color</label>
                                                                            <label><input type="radio" checked={rule.overrideType === 'icon'} onChange={() => handleUpdateRule(rule.id, 'overrideType', 'icon')} /> Icon</label>
                                                                        </div>

                                                                        <div style={{ flex: 1, minWidth: '200px' }}>
                                                                            {rule.overrideType === 'color' ?
                                                                                <ColorPicker selectedColor={rule.overrideValue} onChange={v => handleUpdateRule(rule.id, 'overrideValue', v)} /> :
                                                                                <div style={{ width: '100%' }}>
                                                                                    <IconPicker selectedIcon={rule.overrideValue} onChange={v => handleUpdateRule(rule.id, 'overrideValue', v)} />
                                                                                </div>
                                                                            }
                                                                        </div>

                                                                        <button type="button" className="icon-button icon-button-danger" onClick={() => removeRule(rule.id)} title="Remove rule" aria-label="Remove rule"><Trash2 size={17} /></button>
                                                                    </div>
                                                                )}
                                                            </Draggable>
                                                        ))}
                                                        {provided.placeholder}
                                                    </div>
                                                )}
                                            </Droppable>
                                            <button className="add-block-button" onClick={handleAddRule}><Plus size={16} aria-hidden="true" /> Add Rule</button>
                                        </div>

                                        {/* STREET VIEW SETTING */}
                                        <div className="admin-section">
                                            <div className="toggle-row" onClick={() => setEnableStreetView(!enableStreetView)}>
                                                <ToggleSwitch
                                                    checked={enableStreetView}
                                                    onChange={e => setEnableStreetView(e.target.checked)}
                                                />
                                                <span className="toggle-text">
                                                    <strong>Show street view</strong><br />
                                                    <span className="field-hint">
                                                        Enable to add a link to a Google Street View of the address that will open in a new window
                                                    </span>
                                                </span>
                                            </div>
                                        </div>

                                        {/* MOVING CARDS SETTING */}
                                        <div className="admin-section">
                                            <div className="toggle-row" onClick={() => setEnableCardMove(!enableCardMove)}>
                                                <ToggleSwitch
                                                    checked={enableCardMove}
                                                    onChange={e => {
                                                        if (e.target.checked && !hasWritePermission) {
                                                            // Logic handled by banner display
                                                        }
                                                        setEnableCardMove(e.target.checked);
                                                    }}
                                                />
                                                <span className="toggle-text">
                                                    <strong>Enable card move from the map view</strong><br />
                                                    <span className="field-hint">
                                                        Display a dropdown allowing to move a card to another list from the visible block directly from a marker on the map. This requires "write" access to your Trello board for Trellops to move the cards on your behalf
                                                    </span>
                                                </span>
                                            </div>

                                            {enableCardMove && !hasWritePermission && (
                                                <div className="notice notice-info">
                                                    <strong>Permission Required:</strong> To move cards, you must grant Trello "Write" access.<br />
                                                    <button className="button-primary notice-action" onClick={() => trelloAuth.login('read,write,account')}>
                                                        Authorize Write Access (Re-Login)
                                                    </button>
                                                </div>
                                            )}

                                            {enableCardMove && hasWritePermission && (
                                                <div className="status-line status-success">
                                                        <CircleCheck size={16} aria-hidden="true" /> Write permissions successfully granted.
                                                </div>
                                            )}
                                        </div>

                                        {/* HOME LOCATION SETTING */}
                                        <div className="admin-section">
                                            <div className="toggle-row" onClick={() => setEnableHomeLocation(!enableHomeLocation)}>
                                                <ToggleSwitch
                                                    checked={enableHomeLocation}
                                                    onChange={e => setEnableHomeLocation(e.target.checked)}
                                                />
                                                <span className="toggle-text">
                                                    <strong>Set home location</strong><br />
                                                    <span className="field-hint">
                                                        Set a home address that will be permanently displayed on the map for this board.
                                                    </span>
                                                </span>
                                            </div>

                                            {enableHomeLocation && (
                                                <div className="toggle-nested">

                                                    <div className="field" ref={wrapperRef}>
                                                        <label className="field-label">Home Address</label>
                                                        <div style={{ position: 'relative' }}>
                                                            <input
                                                                type="text"
                                                                value={homeAddress}
                                                                onChange={handleHomeAddressChange}
                                                                placeholder="Start typing your address..."
                                                                className="input-full"
                                                            />
                                                            {isSearching && (
                                                                <div className="input-status">
                                                                    Searching...
                                                                </div>
                                                            )}
                                                            {searchResults.length > 0 && (
                                                                <div className="autocomplete-list">
                                                                    {searchResults.map((result, idx) => (
                                                                        <div
                                                                            key={idx}
                                                                            onClick={() => handleSelectResult(result)}
                                                                            className="autocomplete-item"
                                                                        >
                                                                            {result.description}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                        {homeCoordinates && !isSearching && searchResults.length === 0 && (
                                                            <div className="status-line status-success">
                                                                Resolved: {homeCoordinates.display_name}
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="field">
                                                        <label className="field-label">Marker Icon</label>
                                                        <IconPicker selectedIcon={homeIcon} onChange={setHomeIcon} />
                                                    </div>
                                                </div>
                                            )}
                                        </div>


                                        {/* RESET CACHE SECTION */}
                                        <div className="admin-section">
                                            <h3>Reset coordinates cache</h3>
                                            <p className="section-hint">
                                                Use this button to remove all card coordinates on your local computer. This is to be used for troubleshooting purposes and will trigger a re-fetch using Nominatim
                                            </p>
                                            <button
                                                className="button-secondary button-danger-outline"
                                                onClick={() => {
                                                    if (window.confirm("Are you sure you want to clear the local geocoding cache? This will force addresses to be re-fetched from Nominatim.")) {
                                                        try {
                                                            const key = `MAP_GEOCODING_CACHE_${selectedBoard.id}`;
                                                            localStorage.removeItem(key);
                                                            // Also clear ignored cards so they can be re-attempted
                                                            localStorage.removeItem(STORAGE_KEYS.IGNORE_CARDS + selectedBoard.id);
                                                            alert('Cache and ignored cards cleared successfully.');
                                                        } catch (e) {
                                                            alert('Failed to clear cache');
                                                        }
                                                    }
                                                }}
                                            >
                                                Reset Location Cache
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="empty-state">Select a board to configure map settings</div>
                        )}
                    </div>
                )
                }

                {/* TAB CONTENT: STATISTICS */}
                {activeTab === 'statistics' && (
                    <div className="tab-content">
                        {selectedBoard ? (
                            <div className="admin-section" id="section-stats">
                                <h3>Statistics View Settings for {selectedBoard.name}</h3>
                                <p className="section-hint">
                                    Configure the historical data analysis view.
                                </p>

                                {!can('stats') && <ProLock feature="stats" />}
                                <div id="stats-enable-toggle" className={`settings-row toggle-row toggle-row-main${can('stats') ? '' : ' locked-control'}`} onClick={() => setEnableStats(!enableStats)}>
                                    <ToggleSwitch checked={enableStats} onChange={e => setEnableStats(e.target.checked)} />
                                    <span>Enable Statistics View{!can('stats') && <ProTag />}</span>
                                </div>

                                {enableStats && (
                                    <div className="toggle-nested">
                                        <div className="toggle-row" onClick={() => setStatsShowArchived(!statsShowArchived)}>
                                            <ToggleSwitch checked={statsShowArchived} onChange={e => setStatsShowArchived(e.target.checked)} />
                                            <span>Show output for Archived cards</span>
                                        </div>

                                        <div id="stats-included-lists" className="field">
                                            <label className="field-label">Lists to include in reports</label>
                                            <p className="field-hint">Uncheck to exclude specific lists (e.g. "Done" or "Backlog") from statistics.</p>
                                            <div className="check-list-box">
                                                {(() => {
                                                    const layout = getPersistentLayout(user.id, selectedBoardId) || DEFAULT_LAYOUT;
                                                    // Group lists by Block
                                                    const grouped = {};
                                                    const processedListIds = new Set();

                                                    layout.forEach(block => {
                                                        const relevantLists = allLists.filter(l => block.listIds.includes(l.id));
                                                        if (relevantLists.length > 0) {
                                                            grouped[block.name] = relevantLists;
                                                            relevantLists.forEach(l => processedListIds.add(l.id));
                                                        }
                                                    });

                                                    // Others
                                                    const otherLists = allLists.filter(l => !processedListIds.has(l.id));
                                                    if (otherLists.length > 0) {
                                                        grouped['Other Lists'] = otherLists;
                                                    }

                                                    if (Object.keys(grouped).length === 0) return <div className="empty-state">No lists found.</div>;

                                                    return Object.entries(grouped).map(([blockName, lists]) => (
                                                        <div key={blockName} className="check-list-group">
                                                            <div className="check-list-group-title">{blockName}</div>
                                                            {lists.map(list => (
                                                                <div key={list.id} className="check-row">
                                                                    <input
                                                                        type="checkbox"
                                                                        id={`stat-list-${list.id}`}
                                                                        checked={statsIncludedLists.length === 0 || statsIncludedLists.includes(list.id)}
                                                                        onChange={(e) => {
                                                                            if (e.target.checked) {
                                                                                // Add
                                                                                setStatsIncludedLists(prev => [...prev, list.id]);
                                                                            } else {
                                                                                // Remove
                                                                                // If empty, previously implied ALL. If we uncheck one, we must populate with all OTHERS.
                                                                                if (statsIncludedLists.length === 0) {
                                                                                    // Was All.
                                                                                    const newSet = allLists.map(l => l.id).filter(id => id !== list.id);
                                                                                    setStatsIncludedLists(newSet);
                                                                                } else {
                                                                                    setStatsIncludedLists(prev => prev.filter(id => id !== list.id));
                                                                                }
                                                                            }
                                                                        }}
                                                                    />
                                                                    <label htmlFor={`stat-list-${list.id}`}>{list.name}</label>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ));
                                                })()}
                                            </div>
                                            <button
                                                className="link-button"
                                                onClick={() => setStatsIncludedLists([])}
                                            >
                                                Select All (Clear Filter)
                                            </button>
                                        </div>

                                        <div className="subpanel subpanel-accent">
                                            <div className="subpanel-head subpanel-head-start">
                                                <Sparkles size={18} className="accent-icon" aria-hidden="true" />
                                                <label className="subpanel-title">Custom AI Prompt (Optional)</label>
                                                <span className="beta-badge">Beta</span>
                                            </div>
                                            <p className="field-hint">Provide additional context or specific instructions to the AI when generating a summary for this board. This context will be added to the core system instructions.</p>
                                            <textarea 
                                                id="stats-ai-prompt"
                                                value={statsCustomPrompt} 
                                                onChange={(e) => setStatsCustomPrompt(e.target.value)}
                                                placeholder="E.g., Write the summary as a pirate..."
                                                className="input-full"
                                                style={{ minHeight: '96px', resize: 'vertical' }}
                                            />
                                            <button 
                                                className="button-secondary" 
                                                onClick={handleImprovePrompt}
                                                disabled={isImprovingPrompt || !statsCustomPrompt.trim()}
                                                style={{ marginTop: '12px' }}
                                            >
                                                {isImprovingPrompt ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                                                {isImprovingPrompt ? 'Improving...' : 'Improve Prompt with AI'}
                                            </button>
                                        </div>



                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="empty-state">Select a board to configure settings</div>
                        )}
                    </div>
                )}

                {
                    activeTab === 'other' && (
                        <div className="tab-content">
                            {selectedBoard ? (
                                <>
                                    <div className="admin-section" id="section-4">
                                        <h3>Other Settings for {selectedBoard.name}</h3>
                                    <p className="section-hint">
                                        These settings are saved separately for each Trello board. Auto-refresh must be at least {minRefreshSeconds >= 60 ? `${minRefreshSeconds / 60} minute${minRefreshSeconds === 60 ? '' : 's'}` : `${minRefreshSeconds} seconds`} on your plan; use the Refresh button for live data. The digital clock appears in the top-left corner of the screen and follows the local computer time format. Template Cards in Trello can be excluded from the count (recommended); completed cards can also be excluded.
                                    </p>
                                    <div className="form-stack">
                                        <div className="field">
                                            <label className="field-label">Refresh Interval</label>
                                            {refreshFixed && <ProLock feature="refresh" compact />}
                                            <div className={`input-group${refreshFixed ? ' locked-control' : ''}`}>
                                                <input type="number" min={refreshUnit === 'seconds' ? Math.max(15, minRefreshSeconds) : 1} value={refreshFixed ? 60 : refreshValue} onChange={e => setRefreshValue(e.target.value)} className="input-number" disabled={refreshFixed} />
                                                <select value={refreshFixed ? 'minutes' : refreshUnit} onChange={e => setRefreshUnit(e.target.value)} disabled={refreshFixed}>
                                                    <option value="seconds">Seconds</option>
                                                    <option value="minutes">Minutes</option>
                                                    <option value="hours">Hours</option>
                                                </select>
                                            </div>
                                            <p className="field-hint">{refreshFixed ? 'The Free plan refreshes every 60 minutes. Pro can refresh every minute.' : 'How often the data is retrieved from Trello.'}</p>
                                        </div>
                                        <div className="field">
                                            <label className="field-label">Slideshow Interval (Seconds)</label>
                                            <input
                                                type="number"
                                                min="10"
                                                value={slideshowInterval}
                                                onChange={e => {
                                                    setSlideshowInterval(e.target.value);
                                                }}
                                                className="input-number"
                                            />
                                            {slideshowInterval < 10 && (
                                                <span className="inline-error">Minimum 10 seconds required</span>
                                            )}
                                            <p className="field-hint">
                                                Slideshow mode will cycle between the Dashboard and Map views at regular intervals, minimum 10 seconds. Start the slideshow using the arrows next to the Dashboard or Map button in the footer.
                                            </p>
                                        </div>
                                        <div className="field">
                                            <label className="field-label">Features</label>
                                            <div className="toggle-list">
                                                <div className="toggle-row" onClick={() => setShowClock(!showClock)}>
                                                    <ToggleSwitch checked={showClock} onChange={e => setShowClock(e.target.checked)} />
                                                    <span>Show Clock</span>
                                                    {showClock && (
                                                        <span className="clock-preview">
                                                            {new Date().toLocaleTimeString()}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="toggle-row" onClick={() => setIgnoreTemplateCards(!ignoreTemplateCards)}>
                                                    <ToggleSwitch checked={ignoreTemplateCards} onChange={e => setIgnoreTemplateCards(e.target.checked)} />
                                                    <span>Ignore Template Cards</span>
                                                </div>
                                                <div className="setting-item-row toggle-row" onClick={() => setIgnoreNoDescCards(!ignoreNoDescCards)}>
                                                    <div>
                                                        <ToggleSwitch
                                                            id="ignoreNoDescCards"
                                                            checked={ignoreNoDescCards}
                                                            onChange={(e) => setIgnoreNoDescCards(e.target.checked)}
                                                        />
                                                    </div>
                                                    <div className="toggle-text">
                                                        <label htmlFor="ignoreNoDescCards">Ignore Cards without Description</label>
                                                        <span className="field-hint">
                                                            If enabled, cards with empty descriptions will not be counted in dashboard or placed on the map.
                                                            (First card description usage is unaffected).
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="setting-item-row toggle-row" onClick={() => setIgnoreCompletedCards(!ignoreCompletedCards)}>
                                                    <ToggleSwitch
                                                        id="ignoreCompletedCards"
                                                        checked={ignoreCompletedCards}
                                                        onChange={(e) => setIgnoreCompletedCards(e.target.checked)}
                                                    />
                                                    <label htmlFor="ignoreCompletedCards" className="toggle-text">Ignore Completed Cards (Due Complete)</label>
                                                </div>
                                                <div className="setting-item-row toggle-row" onClick={() => setEnableIgnoreKeywords(!enableIgnoreKeywords)}>
                                                    <ToggleSwitch
                                                        id="enableIgnoreKeywords"
                                                        checked={enableIgnoreKeywords}
                                                        onChange={(e) => setEnableIgnoreKeywords(e.target.checked)}
                                                    />
                                                    <label htmlFor="enableIgnoreKeywords" className="toggle-text">Ignore cards containing specific keywords</label>
                                                </div>
                                                {enableIgnoreKeywords && (
                                                    <div className="toggle-nested">
                                                        <input 
                                                            type="text" 
                                                            value={ignoreKeywords} 
                                                            onChange={e => setIgnoreKeywords(e.target.value)} 
                                                            placeholder="Enter keywords separated by commas (e.g. archive, done)" 
                                                            className="input-full"
                                                        />
                                                        <span className="field-hint">
                                                            Cards containing any of these keywords in their title will be ignored.
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="admin-section" id="section-naming">
                                    <h3>Naming configuration</h3>
                                    <p className="section-hint">
                                        Customize the terminology used across your Dashboard, Map, and Statistics views. By default, it will use "Card", "List", and "Board". Leave empty to use defaults.
                                    </p>
                                    
                                    <div className="naming-grid">
                                        <div className="field">
                                            <label className="field-label">"Card" is called...</label>
                                            <input 
                                                type="text" 
                                                value={namingCard} 
                                                onChange={e => setNamingCard(e.target.value)} 
                                                placeholder="e.g. Task, Job, Ticket"
                                            />
                                        </div>
                                        
                                        <div className="field">
                                            <label className="field-label">"List" is called...</label>
                                            <input 
                                                type="text" 
                                                value={namingList} 
                                                onChange={e => setNamingList(e.target.value)} 
                                                placeholder="e.g. Phase, Stage, Status"
                                            />
                                        </div>
                                        
                                        <div className="field">
                                            <label className="field-label">"Board" is called...</label>
                                            <input 
                                                type="text" 
                                                value={namingBoard} 
                                                onChange={e => setNamingBoard(e.target.value)} 
                                                placeholder="e.g. Project, Sprint, Portfolio"
                                            />
                                        </div>
                                        
                                        <div className="field">
                                            <label className="field-label">"Label" is called...</label>
                                            <input 
                                                type="text" 
                                                value={namingLabel} 
                                                onChange={e => setNamingLabel(e.target.value)} 
                                                placeholder="e.g. Tag, Category, Group"
                                            />
                                        </div>
                                    </div>
                                </div>
                                </>
                            ) : (
                                <div className="empty-state">Select a board to configure settings</div>
                            )}

                            <div className={`danger-zone${showResetSection ? ' is-open' : ''}`}>
                                <div
                                    className="danger-header"
                                    onClick={() => setShowResetSection(!showResetSection)}
                                    role="button"
                                    aria-expanded={showResetSection}
                                >
                                    <h4><TriangleAlert size={18} aria-hidden="true" /> Global settings reset</h4>
                                    <span className="danger-chevron">{showResetSection ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
                                </div>

                                {showResetSection && (
                                    <div className="danger-body">

                                        <p>
                                            Resetting your settings will remove any locally stored information including dashboard and map configuration for <strong>ALL boards</strong>, as well as decoded geolocations.
                                        </p>
                                        <p>
                                            Your Trello account will NOT be affected, nor will your Trellops subscriptions.
                                        </p>

                                        <div>
                                            <strong className="danger-strong">
                                                The reset will erase all the information stored below; it is recommended that you back up each configuration first.
                                            </strong>
                                            <ul className="danger-list">
                                                {(() => {
                                                    const storedData = JSON.parse(localStorage.getItem('trelloUserData') || '{}');
                                                    // Find all boards that have data in trelloUserData OR have specific keys
                                                    // For simplicity, we scan trelloUserData.user.settings keys and dashboard keys
                                                    const userData = storedData[user?.id] || {};
                                                    const boardsWithLayout = Object.keys(userData.dashboardLayout || {});
                                                    const boardsWithColors = Object.keys(userData.listColors || {});

                                                    const allCachedBoardIds = new Set([...boardsWithLayout, ...boardsWithColors]);

                                                    if (allCachedBoardIds.size === 0) return <li>No cached configurations found.</li>;

                                                    return Array.from(allCachedBoardIds).map(bid => {
                                                        const bName = boards.find(b => b.id === bid)?.name || bid;
                                                        return <li key={bid}>{bName} <span className="danger-id">({bid})</span></li>;
                                                    });
                                                })()}
                                            </ul>
                                        </div>

                                        <button
                                            onClick={() => {
                                                if (confirm(`ARE YOU SURE you want to DELETE ALL LOCAL SETTINGS?\n\nThis cannot be undone.`)) {
                                                    // 1. Clear User Data
                                                    const storedData = JSON.parse(localStorage.getItem('trelloUserData') || '{}');
                                                    if (user?.id) delete storedData[user.id];
                                                    localStorage.setItem('trelloUserData', JSON.stringify(storedData));

                                                    // 2. Clear specific keys (Scanning all keys since we don't track them all perfectly)
                                                    const keysToRemove = [];
                                                    for (let i = 0; i < localStorage.length; i++) {
                                                        const key = localStorage.key(i);
                                                        if (key && (
                                                            key.startsWith('TRELLO_') ||
                                                            key.startsWith('MAP_GEOCODING_CACHE_') ||
                                                            key.startsWith('updateTrelloCoordinates_') ||
                                                            key.startsWith('enableCardMove_') ||
                                                            key.startsWith('enableStreetView_') ||
                                                            key.startsWith('refreshInterval_') // old keys might exist
                                                        )) {
                                                            keysToRemove.push(key);
                                                        }
                                                    }
                                                    keysToRemove.forEach(k => localStorage.removeItem(k));

                                                    alert("All local cache has been reset. The application will reload.");
                                                    window.location.reload();
                                                }
                                            }}
                                            className="button-danger"
                                        >
                                            Reset My Trellops Stored Cache
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}


                {viewMode === 'default' && activeTab === 'billing' && (
                    <div className="tab-content">
                        <BillingPanel boardId={selectedBoardId} boardName={boards.find((b) => b.id === selectedBoardId)?.name} standalone />
                    </div>
                )}

                {
                    viewMode === 'default' && (
                        <div className="actions-container settings-actions">
                            {activeTab !== 'tasks' && (
                                <div className="settings-actions-secondary">
                                    {can('share') ? (
                                        <button className="button-secondary" onClick={() => setShowShareModal(true)} disabled={!selectedBoardId}>Share Configuration</button>
                                    ) : (
                                        <button className="button-secondary" disabled title="Share links are part of Trellops Pro">Share Configuration <ProTag /></button>
                                    )}
                                    <button className="button-secondary" onClick={() => setShowMoreOptions(true)}>More...</button>
                                </div>
                            )}
                            <button className="button-secondary" onClick={onClose}>Cancel</button>
                            <button className="save-layout-button" onClick={handleSave} disabled={!settingsReady}>{settingsReady ? 'Save Settings' : 'Loading...'}</button>
                        </div>
                    )
                }
            </DragDropContext >


            {/* MANAGE TASKS LINK (Default Mode Only) */}
            {
                viewMode === 'default' && (
                    <div className="settings-callout">
                        <div className="settings-callout-inner">
                            <div>
                                <strong>Looking for Task View settings?</strong>
                                <p className="field-hint">
                                    Use the dedicated page to configure your global task dashboard.
                                </p>
                            </div>
                            <a
                                href="/tasks/settings"
                                onClick={(e) => {
                                    window.history.pushState({}, '', '/tasks/settings');
                                    // Use prop if available
                                    if (onManageTasks) onManageTasks();
                                    else window.dispatchEvent(new Event('popstate'));
                                }}
                                className="button-secondary link-as-button"
                            >
                                Manage Tasks View
                            </a>
                        </div>
                    </div>
                )
            }

            {
                viewMode === 'tasks' && (
                    <div className="admin-section" id="section-tasks">
                        <div className="subpanel-head">
                            <h2 className="settings-page-title">{(user.fullName || user.displayName || user.username)} Tasks View Settings</h2>
                        </div>

                        <div>
                            <p className="section-hint">
                                This is a separate feature, independent from the dashboard and map views. Enable a "Bird's Eye View" dashboard to see all your assigned tasks (checklists) and cards across ALL your workspaces and boards in one place.
                            </p>
                            {!can('tasks') && <ProLock feature="tasks" />}
                            <div className={`settings-row toggle-row toggle-row-main${can('tasks') ? '' : ' locked-control'}`} onClick={() => setEnableTaskView(!enableTaskView)}>
                                <ToggleSwitch checked={enableTaskView} onChange={e => setEnableTaskView(e.target.checked)} />
                                <span>Enable Tasks View{!can('tasks') && <ProTag />}</span>
                            </div>

                            {enableTaskView && (
                                <>
                                    <div className="status-line status-success">
                                        <Check size={16} aria-hidden="true" /> A "Tasks View" button will appear in the main navigation footer.
                                    </div>

                                    {/* Workspace Selection */}
                                    <div className="setting-group field">
                                        <label className="setting-label field-label">Workspaces to Include</label>
                                        <div className="field-hint">
                                            Select which workspaces to show tasks from. At least one workspace must be selected.
                                        </div>
                                        <div className="check-list-box" style={{ maxHeight: '180px' }}>
                                            {userOrgs.length === 0 ? <div className="empty-state">Loading workspaces...</div> :
                                                userOrgs.map(org => (
                                                    <div key={org.id} className="check-row">
                                                        <input
                                                            type="checkbox"
                                                            id={`ws-${org.id}`}
                                                            checked={taskViewWorkspaces && taskViewWorkspaces.includes(org.id)}
                                                            onChange={(e) => {
                                                                if (e.target.checked) {
                                                                    setTaskViewWorkspaces([...(taskViewWorkspaces || []), org.id]);
                                                                } else {
                                                                    // Enforce at least one
                                                                    if (taskViewWorkspaces.length > 1) {
                                                                        setTaskViewWorkspaces(taskViewWorkspaces.filter(id => id !== org.id));
                                                                    } else {
                                                                        alert("At least one workspace must be selected.");
                                                                    }
                                                                }
                                                            }}
                                                        />
                                                        <label htmlFor={`ws-${org.id}`}>{org.displayName}</label>
                                                    </div>
                                                ))
                                            }
                                        </div>
                                    </div>

                                    {/* Refresh Interval */}
                                    <div className="setting-group field">
                                        <label className="setting-label field-label">Auto-Refresh Interval</label>
                                        <div className="input-group">
                                            <input
                                                type="number"
                                                min="1"
                                                value={taskViewRefreshInterval.value}
                                                onChange={(e) => setTaskViewRefreshInterval({ ...taskViewRefreshInterval, value: parseInt(e.target.value) || 1 })}
                                                className="input-number"
                                            />
                                            <select
                                                value={taskViewRefreshInterval.unit}
                                                onChange={(e) => setTaskViewRefreshInterval({ ...taskViewRefreshInterval, unit: e.target.value })}
                                            >
                                                <option value="minutes">Minutes</option>
                                                <option value="hours">Hours</option>
                                            </select>
                                        </div>
                                        <div className="field-hint">
                                            Minimum 1 minute.
                                        </div>
                                    </div>
                                </>
                            )}

                            <div className="actions-container">
                                <button className="button-secondary" onClick={onClose}>Cancel</button>
                                <button className="button-primary" onClick={handleSaveTasks} disabled={!settingsReady}>{settingsReady ? 'Save Tasks Settings' : 'Loading...'}</button>
                            </div>
                        </div>
                    </div>
                )
            }

            <div className="settings-footer">
                <div className="settings-version">v4.6.{__BUILD_ID__ || 1000} - November 2026</div>
                <nav className="settings-footer-links">
                    {viewMode === 'default' && (
                        <button type="button" className="settings-footer-link" onClick={requestTour}>Show me around</button>
                    )}
                    <a href="/help.html" target="_blank">User Guide</a>
                    <a href="/privacy.html" target="_blank">Privacy Policy</a>
                    <a href="/releases.html" target="_blank">Release Notes</a>
                </nav>
            </div>

            {
                showShareModal && (
                    <ShareConfigModal
                        enforced={!!entitlements?.enforced}
                        config={getConfigObject()}
                        onClose={() => setShowShareModal(false)}
                        boardName={selectedBoard?.name}
                    />
                )
            }

            {
                showMoreOptions && (
                    <MoreOptionsModal
                        onClose={() => setShowMoreOptions(false)}
                        onReset={handleClearBoardConfig}
                        onExport={handleExportConfig}
                        onImport={handleImportConfig}
                        selectedBoardId={selectedBoardId}
                        boardName={selectedBoard?.name}
                        exportLocked={!can('export')}
                    />
                )
            }
        </div >
    );
};

export default SettingsScreen;
