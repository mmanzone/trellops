import React from 'react';
import ReactDOM from 'react-dom/client';
import DashboardExplorer from './components/landing/DashboardExplorer';

// The user guide is a static page; only the interactive dashboard is React.
const mount = document.getElementById('dashboard-explorer');
if (mount) ReactDOM.createRoot(mount).render(<DashboardExplorer />);
