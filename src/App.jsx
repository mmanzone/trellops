import React, { useState, useEffect } from 'react';
import { trelloAuth, trelloFetch } from './api/trello';
import { STORAGE_KEYS } from './utils/constants';
import { getUserData, setUserData, getCurrentUser, setCurrentUser } from './utils/persistence';
import { DarkModeProvider } from './context/DarkModeContext';
import LandingPage from './components/common/LandingPage';
import Dashboard from './components/Dashboard';
import SettingsScreen from './components/SettingsScreen';
const MapView = React.lazy(() => import('./components/MapView'));
import TaskView from './components/TaskView';
import StatisticsView from './components/StatisticsView';
import useWakeLock from './hooks/useWakeLock';
import ErrorBoundary from './components/common/ErrorBoundary';

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

    const [keepScreenOn, setKeepScreenOn] = useState(false);
    const { requestWakeLock, releaseWakeLock } = useWakeLock();

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
        }
    }, [view]);

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
        // If starting from Map, switch to Dashboard view to use persistent map container
        if (view === 'map') {
            setView('dashboard');
            window.history.replaceState({}, '', '/dashboard');
        }
        // Start with the current view if applicable, else dashboard
        // If we were map, we validly want to show map first likely? 
        // Or if we switched to dashboard, we might want to show map?
        // Let's default to dashboard since we just switched context?
        // Or logic: prev was map -> show map? 
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

            // CHECK FOR PENDING CONFIG
            const pendingConfig = localStorage.getItem('PENDING_SHARE_CONFIG');
            if (pendingConfig) {
                try {
                    const decoded = decodeURIComponent(escape(atob(pendingConfig)));
                    const config = JSON.parse(decoded);
                    setImportConfig(config);
                    setView('settings');
                    setPreviousView('dashboard');
                    localStorage.removeItem('PENDING_SHARE_CONFIG');
                    console.log("Loaded pending shared configuration");
                } catch (e) {
                    console.error("Failed to load pending config", e);
                }
            }
        } catch (e) {
            console.error("Login validation failed:", e);
            setError("Failed to validate Trello session. Please log in again.");
            setCurrentUser(null);
            setView('landing');
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
                    <button className="settings-button" onClick={() => { setError(''); setView('landing'); }}>Go to Login</button>
                </div>
            </div>
        );
    }

    if (view === 'map') {
        return (
            <React.Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading Map...</div>}>
                <MapView
                    user={user}
                    settings={settings}
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
                    onStartSlideshow={handleStartSlideshow}
                    onStopSlideshow={slideshowActive ? handleStopSlideshow : null}
                    keepScreenOn={keepScreenOn}
                    onToggleScreenLock={() => setKeepScreenOn(!keepScreenOn)}
                />
            </React.Suspense>
        );
    }

    if (view === 'tasks') {
        return (
            <TaskView
                user={user}
                settings={settings}
                onClose={() => {
                    setView('dashboard');
                    window.history.pushState({}, '', '/dashboard');
                }}
                onMainView={() => { // Alias for onClose/Dashboard
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
                onGoToStats={() => { setPreviousView('settings'); setView('stats'); }}
            />
        );
    }

    if (view === 'stats' && user) {
        return (
            <StatisticsView
                user={user}
                settings={settings}
                onShowSettings={() => { setPreviousView('stats'); setView('settings'); setSettingsTab('statistics'); }}
                onGoToDashboard={() => setView('dashboard')}
                onLogout={handleLogout}
            />
        );
    }

    if (view === 'landing') {
        return <LandingPage />;
    }

    if (view === 'dashboard') {
        return (
            <ErrorBoundary>
                <Dashboard
                    user={user}
                    settings={settings}
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
                    onStartSlideshow={handleStartSlideshow}
                    onStopSlideshow={slideshowActive ? handleStopSlideshow : null}
                    keepScreenOn={keepScreenOn}
                    onToggleScreenLock={() => setKeepScreenOn(!keepScreenOn)}
                />
            </ErrorBoundary>
        );
    }

    if (view === 'settings') {
        return (
            <SettingsScreen
                user={user}
                initialTab={settingsTab}
                onSave={handleSaveSettings}
                onClose={() => {
                    // Start strict redirection checks on logic
                    if (settings?.boardId) {
                        if (previousView === 'map') {
                            setView('map');
                            window.history.pushState({}, '', '/map');
                        } else {
                            setView('dashboard');
                            window.history.pushState({}, '', '/dashboard');
                        }
                    } else {
                        // No board configured -> Go to Landing or reload root
                        window.location.href = '/';
                    }
                }}
                onLogout={handleLogout}
                importedConfig={importConfig}
                onClearImportConfig={() => setImportConfig(null)}

                viewMode="default"
                onManageTasks={() => {
                    setView('tasks-settings');
                    window.history.pushState({}, '', '/tasks/settings');
                }}
                onGoToStats={() => {
                    setPreviousView('settings');
                    setView('stats');
                    window.history.pushState({}, '', '/stats');
                }}
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
                    // Back to Tasks if enabled
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

    return <LandingPage />;
};

export default App;
