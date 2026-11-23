import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

/*
 * Hero animation: the lists of a Kanban board collapse their cards into a
 * count, then each list becomes a tile on a Trellops dashboard. It loops
 * while visible, pauses off screen, and starts on the dashboard without
 * moving for people who prefer reduced motion. Sizes are in container
 * query units (cqw) so the whole scene scales with its width.
 */

const LISTS = [
    { name: 'Briefs', color: '#5b6b7f', count: 12, cards: [{ l: '#d9822b', w: '82%' }, { l: '#7a5cc7', w: '64%' }, { l: '#0079bf', w: '74%' }, { l: '#d9822b', w: '58%' }] },
    { name: 'In design', color: '#d9822b', count: 7, cards: [{ l: '#7a5cc7', w: '70%' }, { l: '#1f8a70', w: '86%' }, { l: '#d0453f', w: '60%' }] },
    { name: 'In review', color: '#7a5cc7', count: 4, cards: [{ l: '#0079bf', w: '76%' }, { l: '#d9822b', w: '62%' }] },
    { name: 'Live', color: '#1f8a70', count: 23, cards: [{ l: '#1f8a70', w: '68%' }, { l: '#0079bf', w: '80%' }, { l: '#7a5cc7', w: '56%' }, { l: '#d0453f', w: '72%' }] },
];

const HEAD = 5.2; // list header height, cqw
const CARD = 8;   // card height, cqw
const GAP = 1.4;  // gap between cards, cqw

const boardRect = (i, list) => {
    const more = list.count > list.cards.length;
    const h = HEAD + list.cards.length * (CARD + GAP) + (more ? 3.6 : 0.4) + 0.6;
    return { left: 3 + i * 24, top: 3.5, width: 22, height: h };
};

const dashRect = (i) => ({
    left: i % 2 === 0 ? 3 : 51,
    top: i < 2 ? 11 : 37.8,
    width: 46,
    height: 24.8,
});

const cqw = (r) => ({ left: `${r.left}cqw`, top: `${r.top}cqw`, width: `${r.width}cqw`, height: `${r.height}cqw` });

// Timings of the loop, in ms
const HOLD_BOARD = 2400;
const COLLECT = 1150;
const HOLD_DASH = 3800;

const prefersReducedMotion = () =>
    typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const useClock = () => {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 15000);
        return () => clearInterval(id);
    }, []);
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const BoardToDashboard = () => {
    const reduced = useRef(prefersReducedMotion());
    const [phase, setPhase] = useState(reduced.current ? 'dash' : 'board'); // board | collect | dash
    const [playing, setPlaying] = useState(!reduced.current);
    const [visible, setVisible] = useState(true);
    const [shown, setShown] = useState(() => LISTS.map((l) => (reduced.current ? l.count : 0))); // tile numbers
    const [collected, setCollected] = useState(0); // how many cards have landed, for the badge bump
    const rootRef = useRef(null);
    const time = useClock();

    // Pause while the hero is off screen or the tab is hidden
    useEffect(() => {
        const el = rootRef.current;
        if (!el || !('IntersectionObserver' in window)) return undefined;
        const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.2 });
        io.observe(el);
        return () => io.disconnect();
    }, []);

    // Drive the loop
    useEffect(() => {
        if (!playing || !visible) return undefined;
        const wait = phase === 'board' ? HOLD_BOARD : phase === 'collect' ? COLLECT : HOLD_DASH;
        const next = phase === 'board' ? 'collect' : phase === 'collect' ? 'dash' : 'board';
        const id = setTimeout(() => setPhase(next), wait);
        return () => clearTimeout(id);
    }, [phase, playing, visible]);

    // Badge bump as cards fly into the header
    useEffect(() => {
        if (phase !== 'collect') { setCollected(0); return undefined; }
        const ids = [0, 1, 2, 3].map((k) => setTimeout(() => setCollected(k + 1), 300 + k * 140));
        return () => ids.forEach(clearTimeout);
    }, [phase]);

    // Count the tile numbers up once the tiles have formed
    useEffect(() => {
        if (phase !== 'dash') { setShown(LISTS.map(() => 0)); return undefined; }
        if (reduced.current || !playing) { setShown(LISTS.map((l) => l.count)); return undefined; }
        let raf;
        let start;
        const delay = 550;
        const dur = 900;
        const tick = (t) => {
            if (start === undefined) start = t;
            const p = Math.min(1, Math.max(0, (t - start - delay) / dur));
            const eased = 1 - Math.pow(1 - p, 3);
            setShown(LISTS.map((l) => Math.round(l.count * eased)));
            if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [phase, playing]);

    const show = (target) => {
        setPlaying(false);
        setPhase(target);
    };

    const isDash = phase === 'dash';
    const cls = `morph ${isDash ? 'is-dash' : ''} ${phase === 'collect' ? 'is-collect' : ''}`;

    return (
        <figure className={cls} ref={rootRef} style={{ margin: 0 }}>
            <div className="morph-window">
                <div className="morph-bar" aria-hidden="true">
                    <i /><i /><i />
                    <div className="morph-title">
                        <span className="t-board">Trello board <b>Spring campaign</b></span>
                        <span className="t-dash">Trellops dashboard <b>Spring campaign</b></span>
                    </div>
                </div>
                <div
                    className="morph-stage"
                    role="img"
                    aria-label={isDash
                        ? 'A Trellops dashboard with four coloured tiles: Briefs 12, In design 7, In review 4, Live 23.'
                        : 'A Trello board with four lists of cards: Briefs, In design, In review and Live.'}
                >
                    <div className="morph-chrome" aria-hidden="true">
                        <h4>Spring campaign</h4>
                        <span className="morph-clock">{time}</span>
                    </div>
                    {LISTS.map((list, i) => {
                        const rect = isDash ? dashRect(i) : boardRect(i, list);
                        const more = list.count - list.cards.length;
                        const bump = phase === 'collect' && collected > 0 && collected <= list.cards.length;
                        return (
                            <div key={list.name} className="morph-list" style={{ ...cqw(rect), '--tile': list.color }} aria-hidden="true">
                                <div className="morph-head">
                                    <span>{list.name}</span>
                                    <span className={`morph-badge ${bump ? 'bump' : ''}`}>{list.count}</span>
                                </div>
                                {list.cards.map((c, k) => {
                                    const top = HEAD + k * (CARD + GAP);
                                    const delay = phase === 'collect'
                                        ? `${(list.cards.length - 1 - k) * 110 + i * 40}ms`
                                        : phase === 'board' ? `${900 + k * 70 + i * 40}ms` : '0ms';
                                    return (
                                        <div
                                            key={k}
                                            className="morph-card"
                                            style={{ top: `${top}cqw`, '--label': c.l, '--w': c.w, '--fly': `${-(top - 0.5)}cqw`, transitionDelay: delay }}
                                        />
                                    );
                                })}
                                {more > 0 && (
                                    <div
                                        className="morph-more"
                                        style={{ top: `${HEAD + list.cards.length * (CARD + GAP) + 0.4}cqw`, transitionDelay: phase === 'board' ? '1.1s' : '0s' }}
                                    >
                                        + {more} more
                                    </div>
                                )}
                                <div className="morph-face">
                                    <strong>{shown[i]}</strong>
                                    <span>{list.name}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            <figcaption className="morph-controls">
                <span className="morph-caption">
                    {isDash ? 'Each list becomes a live tile.' : 'Your board, exactly as it is in Trello.'}
                </span>
                <span className="morph-right">
                    <span className="morph-seg" role="group" aria-label="View">
                        <button type="button" aria-pressed={!isDash} onClick={() => show('board')}>Board</button>
                        <button type="button" aria-pressed={isDash} onClick={() => show('dash')}>Dashboard</button>
                    </span>
                    <button
                        type="button"
                        className="morph-pause"
                        onClick={() => setPlaying((p) => !p)}
                        aria-label={playing ? 'Pause animation' : 'Play animation'}
                        title={playing ? 'Pause animation' : 'Play animation'}
                    >
                        {playing ? <Pause size={14} strokeWidth={2.4} /> : <Play size={14} strokeWidth={2.4} />}
                    </button>
                </span>
            </figcaption>
        </figure>
    );
};

export default BoardToDashboard;
