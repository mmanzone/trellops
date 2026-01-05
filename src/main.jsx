import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { DarkModeProvider } from './context/DarkModeContext';
import './styles/index.css';
import PreviewBanner from './components/common/PreviewBanner';

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <DarkModeProvider>
            <PreviewBanner />
            <App />
        </DarkModeProvider>
    </React.StrictMode>
);
