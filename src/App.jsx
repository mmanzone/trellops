import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { trelloAuth, trelloFetch } from './api/trello';
import { startServerSession, endServerSession, isEmailNoticeDismissed, dismissEmailNotice } from './api/session';
import { fetchEntitlements, registerBoardWithLimit, openShareLink, OPEN_ENTITLEMENTS } from './api/entitlements';
import { EntitlementsProvider } from './context/EntitlementsContext';
import { ProLockScreen, BoardLimitModal, PlanBanner } from './components/common/PlanGate';
import { STORAGE_KEYS } from './utils/constants';
import { getUserData, setUserData, getCurrentUser, setCurrentUser } from './utils/persistence';
import { DarkModeProvider } from './context/DarkModeContext';
import LandingPage from './components/common/LandingPage';
import Dashboard from './components/Dashboard';
// Views other than the dashboard are loaded on demand, so the wall-screen
// dashboard doesn't download Settings (drag-and-drop), Stats (charts, AI SDK),
// the map or tasks code until someone opens them.
const SettingsScreen = lazy(() => import('./components/SettingsScreen'));
const MapView = lazy(() => import('./components/MapView'));
const TaskView = lazy(() => import('./components/TaskView'));
const StatisticsView = lazy(() => import('./components/StatisticsView'));
const AdminView = lazy(() => import('./components/AdminView'));
import useWakeLock from './hooks/useWakeLock';
import { decodeBase64Utf8 } from './utils/helpers';

const App = () => {
    const [user, setUser] = useState(null);
    const [settings, setSettings] = useState(null);
    const [view, setView] = useState('landing'); // 'landing', 'settings', 'dashboard', 'map', 'tasks'
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [settingsTab, setSettingsTab] = useState('dashboard'); // 'dashboard', 'map', 'other'
    const [importConfig, setImportConfig] = useState(null); // NEW: Config to be imported

    const [previousView, setPreviousView] = useState(null);
    const [slideshowActive, setSlideshowActive] = useState(false);
    const [slideshowView, setSlideshowView] = useState(null); // 'dashboard' or 'map'

    const [serverSession, setServerSession] = useState(null); // Answer from /api/session
    const [isAdmin, setIsAdmin] = useState(false);
    const [emailNoticeDismissed, setEmailNoticeDismissed] = useState(isEmailNoticeDismissed);
    const [retryToken, setRetryToken] = useState(null); // Set when startup failed for a non-auth reason
    const [keepScreenOn, setKeepScreenOn] = useState(false);
    const { requestWakeLock, releaseWakeLock } = useWakeLock();

    // --- Plans and entitlements (see src/api/entitlements.js) ---
    const [entitlements, setEntitlements] = useState(OPEN_ENTITLEMENTS);
    const [entitlementsReady, setEntitlementsReady] = useState(false);
    const [memberBoards, setMemberBoards] = useState([]);
    const [boardPlanBoards, setBoardPlanBoards] = useState([]);
    const [boardLimit, setBoardLimit] = useState(null); // { boardLimit, boards, boardId? } while the limit dialog is open
    const [planNotice, setPlanNotice] = useState(null); // Top banner, e.g. a share link that needs Pro
    const lastFetch = useRef(0);
    const askedBoardIds = useRef([]);

    const can = useCallback((feature) => entitlements.features.includes(feature), [entitlements]);

    const refreshEntitlements = useCallback(async (opts = {}) => {
        if (!user || !serverSession?.sessions) return;
        if (opts.boardIds) askedBoardIds.current = opts.boardIds;
        lastFetch.current = Date.now();
        const { me, entitlements: ent } = await fetchEntitlements({
            boardId: settings?.boardId,
            token: user.token,
            boardIds: askedBoardIds.current,
        });
        setEntitlements(ent);
        setEntitlementsReady(true);
        if (me) {
            setIsAdmin(!!me.admin);
            setMemberBoards(me.boards || []);
            setBoardPlanBoards(me.boardPlanBoards || []);
        }
    }, [user, serverSession, settings?.boardId]);

    // Without a server session (sessions not configured) the app stays fully open.
    useEffect(() => {
        if (serverSession && !serverSession.sessions) setEntitlementsReady(true);
    }, [serverSession]);

    // Register the board (id only) and check the board limit; then load entitlements for it.
    useEffect(() => {
        if (!serverSession?.sessions || !user) return;
        let alive = true;
        (async () => {
            if (settings?.boardId) {
                const result = await registerBoardWithLimit(settings.boardId, user.token);
                if (!alive) return;
                if (!result.ok) setBoardLimit(result.limit);
            }
            refreshEntitlements();
        })();
        return () => { alive = false; };
    }, [serverSession, user, settings?.boardId, refreshEntitlements]);

    // Re-check when the window regains focus (at most once a minute), e.g. after an upgrade.
    useEffect(() => {
        const onFocus = () => { if (Date.now() - lastFetch.current > 60000) refreshEntitlements(); };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [refreshEntitlements]);

    // Over the board limit on the current board (for example after a trial ends): pick boards to keep.
    useEffect(() => {
        if (entitlements.board && entitlements.board.allowed === false && !boardLimit) {
            setBoardLimit({ boardLimit: entitlements.boardLimit, boards: memberBoards, boardId: null });
        }
    }, [entitlements, memberBoards, boardLimit]);

    useEffect(() => {
        if (boardLimit && !boardLimit.boardId && entitlements.board?.allowed !== false) setBoardLimit(null);
    }, [entitlements, boardLimit]);

    // Stop Pro-only modes when the plan does not include them.
    useEffect(() => {
        if (!can('keepScreenOn') && keepScreenOn) setKeepScreenOn(false);
        if (!can('slideshow') && slideshowActive) { setSlideshowActive(false); setSlideshowView(null); }
    }, [can, keepScreenOn, slideshowActive]);

    // Shared configurations: wait until the plan is known, then import or warn.
    useEffect(() => {
        if (!user || !entitlementsReady) return;
        const shareId = localStorage.getItem('PENDING_SHARE_ID');
        const pendingConfig = localStorage.getItem('PENDING_SHARE_CONFIG');
        if (!shareId && !pendingConfig) return;
        localStorage.removeItem('PENDING_SHARE_ID');
        localStorage.removeItem('PENDING_SHARE_CONFIG');
        const readOnlyWarning = {
            tone: 'warning',
            title: 'This shared dashboard needs Trellops Pro',
            text: 'Opening shared configurations is part of Pro, so nothing was imported. Your own dashboard is unchanged.',
        };
        const openImport = (config) => {
            setImportConfig(config);
            setPreviousView('dashboard');
            setView('settings');
            window.history.replaceState({}, '', '/settings');
        };
        if (shareId) {
            openShareLink(shareId).then((res) => {
                if (res?.allowed && res.config) openImport(res.config);
                else if (res?.code === 'NEEDS_PRO' || res?.allowed === false && !res?.error) setPlanNotice(readOnlyWarning);
                else setPlanNotice({ tone: 'warning', title: 'This share link could not be opened', text: res?.error || '' });
            });
            return;
        }
        if (!can('share')) { setPlanNotice(readOnlyWarning); return; }
        try {
            openImport(JSON.parse(decodeBase64Utf8(pendingConfig)));
        } catch (e) {
            console.error('Failed to load pending config', e);
        }
    }, [user, entitlementsReady, can]);

    // Wake Lock Effect
    useEffect(() => {
        if (slideshowActive || keepScreenOn) {
            requestWakeLock();
        } else {
            releaseWakeLock();
        }
    }, [slideshowActive, keepScreenOn, requestWakeLock, releaseWakeLock]);

    // Check for token in URL or existing session
    useEffect(() => {
        // 0. Check for Config Share URL
        const params = new URLSearchParams(window.location.search);
        const configParam = params.get('config');
        const shareParam = params.get('share') || (window.location.pathname.match(/^\/s\/([A-Za-z0-9]{10,16})$/) || [])[1];
        if (shareParam && /^[A-Za-z0-9]{10,16}$/.test(shareParam)) {
            localStorage.setItem('PENDING_SHARE_ID', shareParam);
            window.history.replaceState({}, document.title, '/');
        }
        if (configParam) {
            try {
                // Validate generic structure (decode)
                atob(configParam);
                localStorage.setItem('PENDING_SHARE_CONFIG', configParam);
                // Clean URL
                window.history.replaceState({}, document.title, window.location.pathname);
            } catch (e) {
                console.error("Invalid config param in URL");
            }
        }

        // 1. Initial Route check
        const path = window.location.pathname;
        if (path === '/map') setView('map');
        else if (path === '/tasks') setView('tasks');
        else if (path === '/tasks/settings') setView('tasks-settings');
        else if (path === '/stats') setView('stats');
        else if (path === '/settings') setView('settings');
        else if (path === '/admin') setView('admin');
        // else default to landing (or dashboard if logged in logic below decides)

        const tokenFromUrl = trelloAuth.getTokenFromUrl();
        if (tokenFromUrl) {
            handleLoginSuccess(tokenFromUrl);
        } else {
            const loggedInUserId = getCurrentUser();
            if (loggedInUserId) {
                const userData = JSON.parse(localStorage.getItem(STORAGE_KEYS.USER_DATA)) || {};
                const userSession = userData[loggedInUserId];
                if (userSession && userSession.token) {
                    handleLoginSuccess(userSession.token);
                } else {
                    // Not logged in
                    if (path !== '/map') setView('landing');
                    // Note: forcing landing if not map. Maybe map needs public access? 
                    // Current logic implies Map can be viewed? No, Map requires login usually.
                    // But existing code allowed Map to set View 'map'. 
                    // Let's keep existing behavior for Map but apply for logical routes.
                    setLoading(false);
                }
            } else {
                if (path !== '/map') setView('landing');
                setLoading(false);
            }
        }
    }, []);

    // Check if settings should be opened on load
    useEffect(() => {
        if (view === 'dashboard' && localStorage.getItem('openSettingsOnLoad') === 'true') {
            localStorage.removeItem('openSettingsOnLoad');
            setPreviousView('dashboard');
            setView('settings');
            window.history.replaceState({}, '', '/settings');
        }
    }, [view]);

    // Browser Back/Forward: every navigation pushes a URL, so map the URL back
    // to its view when the user moves through history.
    useEffect(() => {
        const handlePopState = () => {
            if (!user) return; // Not signed in: stay on the landing page
            const path = window.location.pathname;
            if (path === '/map') setView('map');
            else if (path === '/tasks') setView('tasks');
            else if (path === '/tasks/settings') setView('tasks-settings');
            else if (path === '/stats') setView('stats');
            else if (path === '/settings') setView('settings');
            else if (path === '/admin') setView('admin');
            else setView(settings?.boardId ? 'dashboard' : 'settings');
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [user, settings]);

        // Retry startup after a network error
    useEffect(() => {
        if (!retryToken) return;
        const timer = setTimeout(() => {
            const token = retryToken;
            setRetryToken(null);
            handleLoginSuccess(token);
        }, 30000);
        return () => clearTimeout(timer);
    }, [retryToken]);

    // Slideshow Effect
    useEffect(() => {
        let interval;
        if (slideshowActive) {
            const time = (settings?.slideshowInterval || 10) * 1000;
            interval = setInterval(() => {
                setSlideshowView(prev => prev === 'dashboard' ? 'map' : 'dashboard');
            }, time);
        }
        return () => clearInterval(interval);
    }, [slideshowActive, settings]);

    const handleStartSlideshow = () => {
        setSlideshowActive(true);
        // Start with the current view if applicable, else dashboard
        setSlideshowView(view === 'map' ? 'map' : 'dashboard');
    };

    const handleStopSlideshow = () => {
        setSlideshowActive(false);
        setSlideshowView(null);
    };

    const handleLoginSuccess = async (token) => {
        setLoading(true);
        setError('');
        try {
            const member = await trelloFetch('/members/me', token);
            // STORE FULL NAME
            const userData = { id: member.id, username: member.username, fullName: member.fullName, token: token };

            // Store user session data
            setUserData(member.id, 'token', token);
            setUserData(member.id, 'username', member.username);
            setCurrentUser(member.id);

            setUser(userData);

            // Register the sign-in with Trellops' server (non-blocking).
            startServerSession(token).then((info) => setServerSession(info || { sessions: false }));

            const savedSettings = getUserData(member.id, 'settings');

            // ROUTING LOGIC POST-LOGIN
            const path = window.location.pathname;

            // Helper: Check if Task View is enabled in saved settings
            const isTaskViewEnabled = savedSettings && savedSettings.enableTaskView;
            // Helper: Check if Board is configured
            const isBoardConfigured = savedSettings && savedSettings.boardId;

            // 1. Tasks Routes
            if (path === '/tasks' || path === '/tasks/settings') {
                if (path === '/tasks' && !isTaskViewEnabled) {
                    console.log("Task View disabled, redirecting to /tasks/settings");
                    setView('tasks-settings');
                    window.history.replaceState({}, '', '/tasks/settings');
                } else if (path === '/tasks/settings') {
                    setView('tasks-settings');
                } else {
                    setView('tasks');
                }
            }
            // 2. Map Route
            else if (path === '/map') {
                if (!isBoardConfigured) {
                    console.log("No board configured, redirecting to /settings");
                    setView('settings');
                    window.history.replaceState({}, '', '/settings');
                } else {
                    if (savedSettings) setSettings(savedSettings);
                    setView('map');
                }
            }
            // Admin dashboard (access is checked by the server)
            else if (path === '/admin') {
                if (savedSettings) setSettings(savedSettings);
                setView('admin');
            }
            // 3. Settings Route
            else if (path === '/settings') {
                if (savedSettings) setSettings(savedSettings);
                setView('settings');
            }
            // 4. Stats Route
            else if (path === '/stats') {
                if (isBoardConfigured) {
                    if (savedSettings) setSettings(savedSettings);
                    setView('stats');
                } else {
                    setView('settings'); // Redirect if no board
                    window.history.replaceState({}, '', '/settings');
                }
            }
            // 5. Default / Dashboard
            else {
                if (isBoardConfigured) {
                    setSettings(savedSettings);
                    setView('dashboard');
                    if (path !== '/dashboard') window.history.replaceState({}, '', '/dashboard');
                } else {
                    // No board configured -> Go to Settings
                    setView('settings');
                    window.history.replaceState({}, '', '/settings');
                }
            }

            if (savedSettings) setSettings(savedSettings);

            // Pending shared configurations are handled once the plan is known (see above).
        } catch (e) {
            console.error("Login validation failed:", e);
            if (e.status === 401) {
                // Token revoked or expired: the user has to sign in again.
                setError("Your Trello session has expired. Please log in again.");
                setRetryToken(null);
                setCurrentUser(null);
                setView('landing');
            } else {
                // Network blip or Trello outage: keep the session and retry, so a
                // wall display recovers on its own instead of sitting on the login page.
                setError("Couldn't reach Trello. Retrying automatically in 30 seconds...");
                setRetryToken(token);
            }
        } finally {
            setLoading(false);
        }
    };


    const handleLogout = () => {
        if (user) {
            setUserData(user.id, 'token', null);
        }
        setCurrentUser(null);
        setUser(null);
        setServerSession(null);
        setIsAdmin(false);
        setEntitlements(OPEN_ENTITLEMENTS);
        setEntitlementsReady(false);
        setBoardLimit(null);
        endServerSession();
        setSettings(null);
        setView('landing');
        setPreviousView(null);
        trelloAuth.logout();
    };

    const handleSaveSettings = (newSettings) => {
        if (!newSettings) {
            // Handle clear config or cancel -> behave like close
            // Fallthrough to navigate back
        } else {
            setSettings(newSettings);
        }

        // Return to previous view
        // Return to previous view logic
        if (view === 'tasks-settings') {
            // If we were in tasks settings, check if we enabled it?
            if (newSettings && newSettings.enableTaskView) {
                // If enabled, maybe go to tasks?
                // Or just stay? 
                // Let's go to /tasks to show the result
                setView('tasks');
                window.history.pushState({}, '', '/tasks');
                return;
            }
        }

        if (previousView === 'map' && newSettings?.boardId) {
            setView('map');
            window.history.pushState({}, '', '/map');
        } else if (previousView === 'tasks' && newSettings?.enableTaskView) {
            setView('tasks');
            window.history.pushState({}, '', '/tasks');
        } else if (newSettings?.boardId) {
            setView('dashboard');
            window.history.pushState({}, '', '/dashboard');
        } else {
            // Fallback if nothing configured
            setView('settings');
            window.history.pushState({}, '', '/settings');
        }
    };

    if (loading) {
        return <div className="container" style={{ textAlign: 'center', marginTop: '50px' }}>Initializing Trellops...</div>;
    }

    if (error) {
        return (
            <div className="container">
                <div className="error" style={{ textAlign: 'center', marginTop: '50px' }}>{error}</div>
                <div style={{ textAlign: 'center', marginTop: '20px' }}>
                    {retryToken ? (
                        <button className="settings-button" onClick={() => { const token = retryToken; setRetryToken(null); handleLoginSuccess(token); }}>Retry now</button>
                    ) : (
                        <button className="settings-button" onClick={() => { setError(''); setView('landing'); }}>Go to Login</button>
                    )}
                </div>
            </div>
        );
    }

    // Members whose Trello token predates the email permission are asked to
    // reconnect once. Shown on the settings screen only, never on a wall display.
    const accountNotice = {
        show: !!serverSession && serverSession.emailScope === false && !emailNoticeDismissed,
        onReconnect: async () => {
            const scopes = user?.token ? await trelloAuth.checkTokenScopes(user.token) : [];
            trelloAuth.login(scopes.includes('write') ? 'read,write,account' : 'read,account');
        },
        onDismiss: () => {
            dismissEmailNotice();
            setEmailNoticeDismissed(true);
        },
    };

    // Settings as the views should see them: Pro-only views are switched off
    // when the plan does not include them (the saved settings are kept).
    const viewSettings = !settings ? settings : {
        ...settings,
        enableMapView: can('map') ? settings.enableMapView : false,
        enableTaskView: can('tasks') ? settings.enableTaskView : false,
        statistics: { ...(settings.statistics || {}), enabled: can('stats') ? settings.statistics?.enabled : false },
    };
    const startSlideshow = can('slideshow') ? handleStartSlideshow : undefined;
    const toggleScreenLock = can('keepScreenOn') ? () => setKeepScreenOn(!keepScreenOn) : null;
    const backToDashboard = () => {
        const next = settings?.boardId ? 'dashboard' : 'settings';
        setView(next);
        window.history.pushState({}, '', `/${next}`);
    };

    const entitlementsValue = {
        entitlements,
        can,
        refresh: refreshEntitlements,
        boards: memberBoards,
        boardPlanBoards,
        requestBoardLimit: setBoardLimit,
    };

    const renderView = () => {
        const lockedFeature = { map: 'map', stats: 'stats', tasks: 'tasks' }[view];
        if (user && lockedFeature && !can(lockedFeature)) {
            return <ProLockScreen feature={lockedFeature} onBack={backToDashboard} />;
        }

        if (view === 'map') {
            return (
                <MapView
                    user={user}
                    settings={viewSettings}
                    minRefreshSeconds={entitlements.minRefreshSeconds}
                    onClose={() => {
                        setView('dashboard');
                        window.history.pushState({}, '', '/dashboard');
                    }}
                    onShowSettings={() => {
                        setPreviousView('map');
                        setSettingsTab('map');
                        setView('settings');
                        window.history.pushState({}, '', '/settings');
                    }}
                    onLogout={handleLogout}
                    onShowTasks={() => {
                        setPreviousView('map');
                        setView('tasks');
                        window.history.pushState({}, '', '/tasks');
                    }}
                    onShowDashboard={() => {
                        setView('dashboard');
                        window.history.pushState({}, '', '/dashboard');
                    }}
                    slideshowContent={slideshowActive ? slideshowView : null}
                    onStartSlideshow={startSlideshow}
                    onStopSlideshow={slideshowActive ? handleStopSlideshow : null}
                    keepScreenOn={keepScreenOn}
                    onToggleScreenLock={toggleScreenLock}
                />
            );
        }

        if (view === 'tasks') {
            return (
                <TaskView
                    user={user}
                    settings={viewSettings}
                    onClose={() => {
                        setView('dashboard');
                        window.history.pushState({}, '', '/dashboard');
                    }}
                    onMainView={() => {
                        setView('dashboard');
                        window.history.pushState({}, '', '/dashboard');
                    }}
                    onShowSettings={() => {
                        setPreviousView('tasks');
                        setSettingsTab('tasks');
                        setView('tasks-settings');
                        window.history.pushState({}, '', '/tasks/settings');
                    }}
                    onShowMap={() => {
                        setPreviousView('tasks');
                        setView('map');
                        window.history.pushState({}, '', '/map');
                    }}
                    onLogout={handleLogout}
                    onGoToStats={() => { setPreviousView('tasks'); setView('stats'); window.history.pushState({}, '', '/stats'); }}
                />
            );
        }

        if (view === 'admin' && user) {
            return (
                <AdminView
                    onClose={() => {
                        const next = settings?.boardId ? 'dashboard' : 'settings';
                        setView(next);
                        window.history.pushState({}, '', `/${next}`);
                    }}
                />
            );
        }

        if (view === 'stats' && user) {
            return (
                <StatisticsView
                    user={user}
                    settings={viewSettings}
                    onShowSettings={() => { setPreviousView('stats'); setView('settings'); setSettingsTab('statistics'); window.history.pushState({}, '', '/settings'); }}
                    onGoToDashboard={() => { setView('dashboard'); window.history.pushState({}, '', '/dashboard'); }}
                    onLogout={handleLogout}
                    keepScreenOn={keepScreenOn}
                    onToggleScreenLock={toggleScreenLock}
                />
            );
        }

        if (view === 'dashboard') {
            return (
                <Dashboard
                    user={user}
                    settings={viewSettings}
                    minRefreshSeconds={entitlements.minRefreshSeconds}
                    onShowSettings={() => {
                        setPreviousView('dashboard');
                        setSettingsTab('dashboard');
                        setView('settings');
                        window.history.pushState({}, '', '/settings');
                    }}
                    onLogout={handleLogout}
                    onShowTasks={() => {
                        setPreviousView('dashboard');
                        setView('tasks');
                        window.history.pushState({}, '', '/tasks');
                    }}
                    onShowMap={() => {
                        setPreviousView('dashboard');
                        setView('map');
                        window.history.pushState({}, '', '/map');
                    }}
                    slideshowContent={slideshowActive ? slideshowView : null}
                    onStartSlideshow={startSlideshow}
                    onStopSlideshow={slideshowActive ? handleStopSlideshow : null}
                    keepScreenOn={keepScreenOn}
                    onToggleScreenLock={toggleScreenLock}
                />
            );
        }

        if (view === 'settings') {
            return (
                <SettingsScreen
                    user={user}
                    initialTab={settingsTab}
                    onSave={handleSaveSettings}
                    onClose={() => {
                        if (settings?.boardId) {
                            if (previousView === 'map') {
                                setView('map');
                                window.history.pushState({}, '', '/map');
                            } else {
                                setView('dashboard');
                                window.history.pushState({}, '', '/dashboard');
                            }
                        } else {
                            window.location.href = '/';
                        }
                    }}
                    onLogout={handleLogout}
                    importedConfig={importConfig}
                    onClearImportConfig={() => setImportConfig(null)}
                    viewMode="default"
                    accountNotice={accountNotice}
                    isAdmin={isAdmin}
                    onOpenAdmin={() => {
                        setView('admin');
                        window.history.pushState({}, '', '/admin');
                    }}
                    onManageTasks={() => {
                        setView('tasks-settings');
                        window.history.pushState({}, '', '/tasks/settings');
                    }}
                    onGoToStats={() => {
                        setPreviousView('settings');
                        setView('stats');
                        window.history.pushState({}, '', '/stats');
                    }}
                    onOpenTour={undefined}
                />
            );
        }

        if (view === 'tasks-settings') {
            return (
                <SettingsScreen
                    user={user}
                    initialTab="tasks"
                    onSave={handleSaveSettings}
                    onClose={() => {
                        if (settings?.enableTaskView) {
                            setView('tasks');
                            window.history.pushState({}, '', '/tasks');
                        } else if (settings?.boardId) {
                            setView('dashboard');
                            window.history.pushState({}, '', '/dashboard');
                        } else {
                            window.location.href = '/';
                        }
                    }}
                    onLogout={handleLogout}
                    viewMode="tasks"
                />
            );
        }

        // Fallback: landing
        return <LandingPage />;
    };

    return (
        <EntitlementsProvider value={entitlementsValue}>
            <Suspense fallback={<div className="container" style={{ textAlign: 'center', marginTop: '50px' }}>Loading...</div>}>
                {renderView()}
            </Suspense>
            <PlanBanner notice={planNotice} onDismiss={() => setPlanNotice(null)} />
            {boardLimit && user && (boardLimit.boardId || !['settings', 'tasks-settings', 'admin'].includes(view)) && (
                <BoardLimitModal
                    limit={boardLimit}
                    token={user.token}
                    onResolved={() => {
                        const pending = boardLimit.boardId;
                        setBoardLimit(null);
                        if (pending) registerBoardWithLimit(pending, user.token).then((r) => (r.ok ? refreshEntitlements() : setBoardLimit(r.limit)));
                        else refreshEntitlements();
                    }}
                    onClose={boardLimit.boardId ? () => setBoardLimit(null) : null}
                    onChooseBoard={boardLimit.boardId ? null : () => {
                        setBoardLimit(null);
                        setPreviousView('dashboard');
                        setSettingsTab('dashboard');
                        setView('settings');
                        window.history.pushState({}, '', '/settings');
                    }}
                />
            )}
        </EntitlementsProvider>
    );
};

export default App;
