import React, { useState, useEffect } from 'react';
import { trelloAuth, trelloFetch } from './api/trello';
import { STORAGE_KEYS } from './utils/constants';
import { getUserData, setUserData, getCurrentUser, setCurrentUser } from './utils/persistence';
import { DarkModeProvider } from './context/DarkModeContext';
import LandingPage from './components/common/LandingPage';
import Dashboard from './components/Dashboard';
import SettingsScreen from './components/SettingsScreen';
import MapView from './components/MapView';

const App = () => {
    const [user, setUser] = useState(null);
    const [settings, setSettings] = useState(null);
    const [view, setView] = useState('landing'); // 'landing', 'settings', 'dashboard', 'map'
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Check for token in URL or existing session
    useEffect(() => {
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
        trelloAuth.logout();
    };

    const handleSaveSettings = (newSettings) => {
        if (!newSettings) {
            setSettings(null);
            setView('dashboard');
            return;
        }
        setSettings(newSettings);
        setView('dashboard');
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
                onClose={() => {
                    setView('dashboard');
                    window.history.pushState({}, '', '/');
                }}
                onShowSettings={() => {
                    setView('settings');
                    window.history.pushState({}, '', '/');
                }}
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
                onShowSettings={() => setView('settings')}
                onLogout={handleLogout}
            />
        );
    }

    if (view === 'settings') {
        return (
            <SettingsScreen
                user={user}
                onSave={handleSaveSettings}
                onBack={() => setView('dashboard')}
                onLogout={handleLogout}
            />
        );
    }

    return <LandingPage />;
};

export default App;
