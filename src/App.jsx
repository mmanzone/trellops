import React, { useState, useEffect } from 'react';
import { trelloAuth, trelloFetch } from './api/trello';
import { STORAGE_KEYS } from './utils/constants';
import { getUserData, setUserData, getCurrentUser, setCurrentUser } from './utils/persistence';
import { DarkModeProvider } from './context/DarkModeContext';
import LandingPage from './components/common/LandingPage';
import Dashboard from './components/Dashboard';
import SettingsScreen from './components/SettingsScreen';

const App = () => {
    const [user, setUser] = useState(null);
    const [settings, setSettings] = useState(null);
    const [view, setView] = useState('landing'); // 'landing', 'settings', 'dashboard'
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Check for token in URL on initial load or existing session
    useEffect(() => {
        const tokenFromUrl = trelloAuth.getTokenFromUrl();
        if (tokenFromUrl) {
            handleLoginSuccess(tokenFromUrl);
        } else {
            // If no token in URL, check if a user is already logged in
            const loggedInUserId = getCurrentUser();
            if (loggedInUserId) {
                const userData = JSON.parse(localStorage.getItem(STORAGE_KEYS.USER_DATA)) || {};
                const userSession = userData[loggedInUserId];
                if (userSession && userSession.token) {
                    handleLoginSuccess(userSession.token);
                } else {
                    setView('landing');
                    setLoading(false);
                }
            } else {
                setView('landing');
                setLoading(false);
            }
        }
    }, []);

    // Check if settings should be opened on load (from map view)
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
            if (savedSettings && savedSettings.boardId) {
                setSettings(savedSettings);
                setView('dashboard');
            } else {
                setView('settings');
            }
        } catch (e) {
            console.error("Login validation failed:", e);
            setError("Failed to validate Trello session. Please log in again.");
            setCurrentUser(null); // Clear invalid user session
            setView('landing');
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = () => {
        if (user) {
            setUserData(user.id, 'token', null); // Invalidate the stored token
        }
        setCurrentUser(null);
        setUser(null);
        setSettings(null);
        setView('landing');
        trelloAuth.logout();
    };

    const handleSaveSettings = (newSettings) => {
        // If settings are cleared (optional feature), handle gracefully
        if (!newSettings) {
            setSettings(null);
            setView('dashboard'); // Will likely redirect or show empty state if not handled in Dashboard
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
