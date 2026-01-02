import React from 'react';
import { trelloAuth } from '../../api/trello';

const LandingPage = () => {
    const handleLogin = (e) => {
        e.preventDefault();
        trelloAuth.login();
    };

    return (
        <div className="landing-page">
            <div className="hero-section">
                <div className="landing-container">
                    <img src="powerupicon2.png" alt="Trellops Logo" className="logo" />
                    <h1>Trellops</h1>
                    <p>Transform Your Trello Boards into Real-Time Operational Dashboards.</p>
                    <a href="#" className="cta-button" onClick={handleLogin}>Try Trellops Now!</a>
                    <p className="tagline">Simple. Powerful. Visible.</p>
                </div>
            </div>

            <div className="value-prop-section">
                <div className="landing-container">
                    <div className="value-grid">
                        <div className="value-item">
                            <div className="icon">📊</div>
                            <h3>Real-Time Wallboard</h3>
                            <p>See instant, close-to-realtime workload metrics for any Trello list. Perfect for wall screens and command centers.</p>
                        </div>
                        <div className="value-item">
                            <div className="icon">✨</div>
                            <h3>Uncluttered Simplicity</h3>
                            <p>Go beyond cluttered lists. Display only essential card counts in a clean, customizable tile-based interface.</p>
                        </div>
                        <div className="value-item">
                            <div className="icon">🔒</div>
                            <h3>Secure & Private</h3>
                            <p>We only require READ access to your Trello boards. All your layout settings are stored locally on your computer.</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="features-section">
                <div className="landing-container">
                    <h2 style={{ color: '#ffffff' }}>Your Trello Data, Your Rules</h2>
                    <div className="features-grid">
                        <div className="feature-item">
                            <h4>Custom Tile Sections</h4>
                            <p>Group lists into collapsible Sections to organize your dashboard and focus on what matters most.</p>
                        </div>
                        <div className="feature-item">
                            <h4>Time Filtered Counts</h4>
                            <p>Filter card totals based on creation date to see trends and monitor recent activity.</p>
                        </div>
                        <div className="feature-item">
                            <h4>Skip Description Cards</h4>
                            <p>Automatically exclude the first card in a list from the total, so you can use it for instructions without skewing your metrics.</p>
                        </div>
                        <div className="feature-item">
                            <h4>Effortless Sharing</h4>
                            <p>Easily export and import dashboard layouts to share your setup with your team or across different computers.</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="final-cta-section">
                <div className="landing-container">
                    <p>Ready to level up your operational visibility? Trellops is the dedicated Trello dashboard you've been waiting for.</p>
                    <a href="#" className="cta-button" onClick={handleLogin}>Login with Trello</a>
                    <p style={{ fontSize: '0.8em', marginTop: '30px' }}>
                        <a href="privacy.html" style={{ color: 'white' }}>Privacy Disclaimer</a>
                        &nbsp;&nbsp;|&nbsp;&nbsp;
                        <a href="help.html" style={{ color: 'white' }}>Trellops Use Guide</a>
                    </p>
                </div>
            </div>
        </div>
    );
};

export default LandingPage;
