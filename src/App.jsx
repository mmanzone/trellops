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

        // 1. Initial Route check
        const path = window.location.pathname;
        if (path === '/map') setView('map');
        else if (path === '/tasks') setView('tasks');
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

            // If explicit route, honour it
            if (path === '/map') {
                if (savedSettings && savedSettings.boardId) setSettings(savedSettings); // Load settings if avail
                setView('map');
            } else if (path === '/tasks') {
                if (savedSettings && savedSettings.boardId) setSettings(savedSettings);
                setView('tasks');
            } else if (path === '/settings') {
                if (savedSettings && savedSettings.boardId) setSettings(savedSettings);
                setView('settings');
            } else {
                // Default handling for Root '/' or unknown
                if (savedSettings && savedSettings.boardId) {
                    setSettings(savedSettings);
                    setView('dashboard');
                    // Ensure URL reflects dashboard if implicit
                    // window.history.replaceState({}, '', '/dashboard'); // Optional: User wants explicit URL?
                } else {
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
    if (previousView === 'map') {
        setView('map');
        window.history.pushState({}, '', '/map');
    } else if (previousView === 'tasks') {
        setView('tasks');
        window.history.pushState({}, '', '/tasks');
    } else {
        setView('dashboard');
        window.history.pushState({}, '', '/dashboard');
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
                window.history.pushState({}, '', '/dashboard');
            }}
            onMainView={() => { // Alias for onClose/Dashboard
                setView('dashboard');
                window.history.pushState({}, '', '/dashboard');
            }}
            onShowSettings={() => {
                setPreviousView('tasks');
                setSettingsTab('tasks');
                setView('settings');
                window.history.pushState({}, '', '/settings');
            }}
            onShowMap={() => {
                setPreviousView('tasks');
                setView('map');
                window.history.pushState({}, '', '/map');
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
                    window.history.pushState({}, '', '/map');
                } else if (previousView === 'tasks') {
                    setView('tasks');
                    window.history.pushState({}, '', '/tasks');
                } else {
                    setView('dashboard');
                    window.history.pushState({}, '', '/dashboard');
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
