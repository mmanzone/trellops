import React, { useEffect, useState } from 'react';
import { ChevronDown, CircleHelp, Moon, ArrowLeft, ArrowRight } from 'lucide-react';
import { dashboardStep } from '../../tour/tours';

// A static model of the dashboard with hotspots. The explanations come from
// the in-app tour (src/tour/tours.js), so the guide and the app agree.

const ORDER = ['block', 'tile', 'labels', 'period', 'stats', 'map', 'settings', 'replay'];

const BLOCKS = [
    {
        name: 'Pipeline',
        tiles: [
            { n: 3, name: 'Inbox', color: '#1d4e5f' },
            { n: 10, name: 'Triage', color: '#4a1d4f' },
            { n: 8, name: 'In progress', color: '#1f6b2a' },
            { n: 6, name: 'Waiting on client', color: '#4b3a73' },
        ],
    },
    {
        name: 'Delivery',
        tiles: [
            { n: 4, name: 'Review', color: '#26395a' },
            { n: 11, name: 'Scheduled', color: '#3d3550' },
            { n: 9, name: 'Done this week', color: '#2c6a24' },
            { n: 7, name: 'Blocked', color: '#2f2a57' },
        ],
    },
];

const Hotspot = ({ id, active, onSelect }) => {
    const step = dashboardStep(id);
    return (
        <button
            type="button"
            className={`dx-hotspot${active === id ? ' is-active' : ''}`}
            aria-label={`What is this: ${step.title}`}
            aria-pressed={active === id}
            onClick={(e) => { e.stopPropagation(); onSelect(id); }}
        />
    );
};

const Zone = ({ id, active, onSelect, className = '', children, as: Tag = 'div' }) => (
    <Tag
        className={`dx-zone ${className}${active === id ? ' is-active' : ''}`}
        onClick={() => onSelect(id)}
    >
        {children}
        <Hotspot id={id} active={active} onSelect={onSelect} />
    </Tag>
);

const useClock = () => {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(t);
    }, []);
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
};

const DashboardExplorer = () => {
    const [active, setActive] = useState('tile');
    const clock = useClock();
    const index = ORDER.indexOf(active);
    const step = dashboardStep(active);
    const go = (delta) => setActive(ORDER[(index + delta + ORDER.length) % ORDER.length]);
    const zone = { active, onSelect: setActive };

    return (
        <div className="dx">
            <div className="dx-screen" aria-label="Example Trellops dashboard">
                <div className="dx-header">
                    <div className="dx-title">
                        <span className="dx-clock">{clock}</span>
                        <span className="dx-board">Operations board <span>All time</span></span>
                    </div>
                    <div className="dx-actions">
                        <Zone id="labels" {...zone} className="dx-control">Labels <ChevronDown size={14} aria-hidden="true" /></Zone>
                        <Zone id="period" {...zone} className="dx-control dx-select">All time <ChevronDown size={14} aria-hidden="true" /></Zone>
                        <Zone id="stats" {...zone} className="dx-control">Stats</Zone>
                        <Zone id="replay" {...zone} className="dx-control dx-icon"><CircleHelp size={15} aria-hidden="true" /></Zone>
                        <span className="dx-control dx-icon dx-static" aria-hidden="true"><Moon size={15} /></span>
                    </div>
                </div>

                <div className="dx-body">
                    {BLOCKS.map((block, bi) => (
                        <div className="dx-block" key={block.name}>
                            {bi === 0 ? (
                                <Zone id="block" {...zone} className="dx-block-head">
                                    <span>{block.name}</span>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                                </Zone>
                            ) : (
                                <div className="dx-block-head dx-static">
                                    <span>{block.name}</span>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                                </div>
                            )}
                            <div className="dx-tiles">
                                {block.tiles.map((t, ti) => {
                                    const inner = (
                                        <>
                                            <span className="dx-count">{t.n}</span>
                                            <span className="dx-name">{t.name}</span>
                                        </>
                                    );
                                    return bi === 0 && ti === 0 ? (
                                        <Zone key={t.name} id="tile" {...zone} className="dx-tile">
                                            <span className="dx-tile-fill" style={{ background: t.color }}>{inner}</span>
                                        </Zone>
                                    ) : (
                                        <div key={t.name} className="dx-tile dx-static">
                                            <span className="dx-tile-fill" style={{ background: t.color }}>{inner}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="dx-footer">
                    <span className="dx-control dx-static">Refresh 58s</span>
                    <Zone id="map" {...zone} className="dx-control">Map view</Zone>
                    <Zone id="settings" {...zone} className="dx-control">Settings</Zone>
                    <span className="dx-control dx-static">Log out</span>
                </div>
            </div>

            <div className="dx-explain" aria-live="polite">
                <div>
                    <p className="dx-explain-count">{index + 1} of {ORDER.length}</p>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                </div>
                <div className="dx-explain-nav">
                    <button type="button" className="s-btn s-btn-ghost s-btn-sm" onClick={() => go(-1)} aria-label="Previous part">
                        <ArrowLeft size={16} aria-hidden="true" />
                    </button>
                    <button type="button" className="s-btn s-btn-ghost s-btn-sm" onClick={() => go(1)} aria-label="Next part">
                        <ArrowRight size={16} aria-hidden="true" />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DashboardExplorer;
