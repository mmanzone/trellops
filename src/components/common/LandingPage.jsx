import React from 'react';
import { trelloAuth } from '../../api/trello';

const LandingPage = () => {
    const handleLogin = (e) => {
        e.preventDefault();
        trelloAuth.login();
    };

    return (
        <div className="landing-page">
            <header className="landing-header">
                <div className="logo">Trellops</div>
                <img src="powerupicon2.png" alt="Trellops Logo" style={{ width: '120px', height: '120px', marginBottom: '20px' }} />
                <h1>Transform Your Trello Boards into Real-Time Operational Dashboards.</h1>
                <p className="subtitle">From Kanban to Command Centre. Visualize your workload on a Wallboard or a Map.</p>
                <a href="#login" className="cta-button" onClick={handleLogin}>Try Trellops Now!</a>
            </header>

            <section className="features">
                <div className="feature-card">
                    <div className="icon">📊</div>
                    <h3>Real-Time Wallboard</h3>
                    <p>See instant, close-to-realtime workload metrics. Perfect for office wall screens and operations centres. Group lists into custom blocks to focus on what matters.</p>
                </div>

                <div className="feature-card">
                    <div className="icon">🗺️</div>
                    <h3>Live Map View</h3>
                    <p><strong>New!</strong> Visualize your cards geographically. Trellops automatically plots cards based on their address description or coordinates. Track field ops at a glance.</p>
                </div>

                <div className="feature-card">
                    <div className="icon">🖱️</div>
                    <h3>Drag-and-Drop Control</h3>
                    <p><strong>New!</strong> Organise your dashboard in seconds. Simply drag lists between blocks and reorder your view with an intuitive new interface.</p>
                </div>

                <div className="feature-card">
                    <div className="icon">🔒</div>
                    <h3>Privacy by Design</h3>
                    <p>We believe in "Local First." Your dashboard configuration lives on your device. Server storage is only used if you explicitly choose to share a configuration link with a colleague.</p>
                </div>
            </section>

            <section className="details">
                <h2>Why Trellops?</h2>
                <ul>
                    <li><strong>Custom Icons:</strong> Assign specific icons to blocks or override them based on Trello labels.</li>
                    <li><strong>Smart Filters:</strong> Filter card totals by creation date to spot trends.</li>
                    <li><strong>Actionable Map:</strong> Move cards to different lists directly from the map interface (requires write permission).</li>
                    <li><strong>Effortless Sharing:</strong> Share your exact setup with your team via a unique, secure link.</li>
                </ul>
            </section>

            <footer>
                <button id="login-btn" onClick={handleLogin}>Login with Trello</button>
                <p><a href="help.html">User Guide</a> | <a href="privacy.html">Privacy Disclaimer</a></p>
            </footer>
        </div>
    );
};

export default LandingPage;
