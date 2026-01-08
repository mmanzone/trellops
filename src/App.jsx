import React, { useState, useEffect } from 'react';
import { trelloAuth, trelloFetch } from './api/trello';
import { STORAGE_KEYS } from './utils/constants';
import { getUserData, setUserData, getCurrentUser, setCurrentUser } from './utils/persistence';
import { DarkModeProvider } from './context/DarkModeContext';
import LandingPage from './components/common/LandingPage';
import Dashboard from './components/Dashboard';
import SettingsScreen from './components/SettingsScreen';
import MapView from './components/MapView';
import TaskView from './components/TaskView';

const App = () => {
    const [user, setUser] = useState(null);
    const [settings, setSettings] = useState(null);
    const [view, setView] = useState('landing'); // 'landing', 'settings', 'dashboard', 'map', 'tasks'
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [settingsTab, setSettingsTab] = useState('dashboard'); // 'dashboard', 'map', 'other'
    const [importConfig, setImportConfig] = useState(null); // NEW: Config to be imported

    const [previousView, setPreviousView] = useState(null);

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

        // 1. Check for Map route first
        if (window.location.pathname === '/map') {
            setView('map');
        }

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
                    if (window.location.pathname !== '/map') setView('landing');
                    setLoading(false);
                }
            } else {
                if (window.location.pathname !== '/map') setView('landing');
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

    const handleLoginSuccess = async (token) => {
        setLoading(true);
        setError('');
        try {
            const member = await trelloFetch('/members/me', token);
            const userData = { id: member.id, username: member.username, token: token };

            // Store user session data
            setUserData(member.id, 'token', token);
            setUserData(member.id, 'username', member.username);
            setCurrentUser(member.id);

            setUser(userData);

            const savedSettings = getUserData(member.id, 'settings');
            // Only switch to dashboard if we aren't already on map view
            if (window.location.pathname !== '/map') {
                if (savedSettings && savedSettings.boardId) {
                    setSettings(savedSettings);
                    setView('dashboard');
                } else {
                    setView('settings');
                }
            } else {
                // If on map view, ensure settings are loaded
                // We don't change view, just state
                if (savedSettings) setSettings(savedSettings);
            }

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
            // Handle clear config or cancel
            setSettings(null);
            if (previousView === 'map') {
                setView('map');
                window.history.pushState({}, '', '/map');
            } else if (previousView === 'tasks') {
                setView('tasks');
                window.history.pushState({}, '', '/tasks');
            } else {
                setView('dashboard');
            }
            return;
        }
        setSettings(newSettings);

        // Return to previous view
        if (previousView === 'map') {
            setView('map');
            window.history.pushState({}, '', '/map');
        } else if (previousView === 'tasks') {
            setView('tasks');
            window.history.pushState({}, '', '/tasks');
        } else {
            setView('dashboard');
            window.history.pushState({}, '', '/');
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
            <MapView
                user={user}
                settings={settings}
                onClose={() => {
                    setView('dashboard');
                    window.history.pushState({}, '', '/');
                }}
                onShowSettings={() => {
                    setPreviousView('map');
                    setSettingsTab('map');
                    setView('settings');
                    window.history.pushState({}, '', '/');
                }}
                onLogout={handleLogout}
                onShowTasks={() => {
                    setPreviousView('map');
                    setView('tasks');
                    window.history.pushState({}, '', '/tasks');
                }}
            />
        );
    }

    if (view === 'tasks') {
        return (
            <TaskView
                user={user}
                settings={settings}
                onClose={() => {
                    setView('dashboard');
                    window.history.pushState({}, '', '/');
                }}
                onShowSettings={() => {
                    setPreviousView('tasks');
                    setSettingsTab('tasks');
                    setView('settings');
                }}
                onLogout={handleLogout}
            />
        );
    }

    if (view === 'landing') {
        return <LandingPage />;
    }

    if (view === 'dashboard') {
        return (
            <Dashboard
                user={user}
                settings={settings}
                onShowSettings={() => {
                    setPreviousView('dashboard');
                    setSettingsTab('dashboard');
                    setView('settings');
                }}
                onLogout={handleLogout}
                onShowTasks={() => {
                    setPreviousView('dashboard');
                    setView('tasks');
                    window.history.pushState({}, '', '/tasks');
                }}
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
                    if (previousView === 'map') {
                        setView('map');
                        window.history.pushState({}, '', '/');
                    } else if (previousView === 'tasks') {
                        setView('tasks');
                        window.history.pushState({}, '', '/tasks');
                    } else {
                        setView('dashboard');
                        window.history.pushState({}, '', '/');
                    }
                }}
                onLogout={handleLogout}
                importedConfig={importConfig}
                onClearImportConfig={() => setImportConfig(null)}
            />
        );
    }

    return <LandingPage />;
};

export default App;
