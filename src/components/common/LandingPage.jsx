import React, { useEffect, useState } from 'react';
import {
    ArrowRight, Check, Type, Tags, CalendarRange, Link2, FileDown, Monitor,
    HardDrive, Eye, ShieldCheck,
} from 'lucide-react';
import { trelloAuth } from '../../api/trello';
import BoardToDashboard from '../landing/BoardToDashboard';
import { WallboardArt, MapArt, StatsArt, BrandMark } from '../landing/Illustrations';
import '../../styles/site.css';

const ROLES = [
    {
        title: 'Project managers',
        text: 'Group lists into blocks like Backlog, Sprint and Done, and see where work is piling up before stand-up starts.',
        lists: [['Backlog', '#5b6b7f'], ['This sprint', '#0079bf'], ['Blocked', '#d0453f'], ['Ready for QA', '#1f8a70']],
    },
    {
        title: 'Designers',
        text: 'Follow requests from brief to sign-off. Rename cards to “Requests” or “Assets” so the dashboard speaks your studio’s language.',
        lists: [['Requests', '#5b6b7f'], ['In design', '#d9822b'], ['Feedback', '#7a5cc7'], ['Approved', '#1f8a70']],
    },
    {
        title: 'Operations teams',
        text: 'Coordinate jobs across the team, balance the workload, and see at a glance where every request is up to, on the wall screen or on the map.',
        lists: [['New requests', '#5b6b7f'], ['Scheduled', '#0079bf'], ['In the field', '#d9822b'], ['Completed', '#1f8a70']],
    },
];

const DETAILS = [
    { icon: Type, title: 'Your words, not Trello’s', text: 'Rename Board, Card or Label to the terms your team already uses, everywhere in the app.' },
    { icon: Tags, title: 'Icons by label', text: 'Give an urgent label its own icon, on dashboard tiles and on map pins.' },
    { icon: CalendarRange, title: 'Date filters', text: 'Count only the cards created this week or last week to spot a trend early.' },
    { icon: Link2, title: 'Share a setup', text: 'Send a link and colleagues open your exact layout, without rebuilding it.' },
    { icon: FileDown, title: 'Export and import', text: 'Keep your configuration as a file and load it on any browser.' },
    { icon: Monitor, title: 'Made for wall screens', text: 'A large clock, a slideshow between boards and a switch that keeps the screen awake.' },
];

const Point = ({ children }) => (
    <li><Check size={18} strokeWidth={2.4} aria-hidden="true" /><span>{children}</span></li>
);

const LandingPage = () => {
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 8);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    useEffect(() => {
        const prev = document.title;
        document.title = 'Trellops: turn Trello boards into live dashboards';
        return () => { document.title = prev; };
    }, []);

    const handleLogin = (e) => {
        e.preventDefault();
        trelloAuth.login();
    };

    const connect = (small) => (
        <a href="#login" id={small ? undefined : 'login-button'} className={`s-btn s-btn-primary ${small ? 's-btn-sm' : ''}`} onClick={handleLogin}>
            Connect Trello {!small && <ArrowRight size={18} strokeWidth={2.2} aria-hidden="true" />}
        </a>
    );

    return (
        <div className="site">
            <a className="site-skip" href="#main">Skip to content</a>
            <header className={`site-header ${scrolled ? 'is-scrolled' : ''}`}>
                <div className="site-wrap">
                    <a className="site-brand" href="/"><BrandMark />Trellops</a>
                    <nav className="site-nav" aria-label="Main">
                        <a className="site-nav-link" href="#features">Features</a>
                        <a className="site-nav-link" href="help.html">User guide</a>
                        <a className="site-nav-link" href="privacy.html">Privacy</a>
                        {connect(true)}
                    </nav>
                </div>
            </header>

            <main id="main">
                <section className="home-hero">
                    <div className="site-wrap">
                        <div>
                            <p className="site-eyebrow">Live dashboards for Trello</p>
                            <h1>Your board, <em>read at a glance.</em></h1>
                            <p className="home-lede">
                                Trellops counts every list, pins every card on a map and summarises the week, so the whole team sees the state of the work without opening a single card.
                            </p>
                            <div className="home-actions">
                                {connect(false)}
                                <a className="s-btn s-btn-ghost" href="help.html">Read the guide</a>
                            </div>
                            <ul className="home-assurance">
                                <li><Check size={16} strokeWidth={2.6} aria-hidden="true" />Works with the boards you have</li>
                                <li><Check size={16} strokeWidth={2.6} aria-hidden="true" />Read-only by default</li>
                                <li><Check size={16} strokeWidth={2.6} aria-hidden="true" />Setup stays in your browser</li>
                            </ul>
                        </div>
                        <BoardToDashboard />
                    </div>
                </section>

                <section className="home-section home-roles" aria-labelledby="roles-title">
                    <div className="site-wrap">
                        <div className="home-section-head">
                            <p className="site-eyebrow">Who it’s for</p>
                            <h2 id="roles-title">Made for the people who keep the board moving.</h2>
                            <p>Trellops doesn’t change how you use Trello. It gives your board a second face, one you can read from across the room.</p>
                        </div>
                        <div className="roles">
                            {ROLES.map((r) => (
                                <article className="role" key={r.title}>
                                    <h3>{r.title}</h3>
                                    <p>{r.text}</p>
                                    <ul className="role-lists" aria-label={`Example lists for ${r.title.toLowerCase()}`}>
                                        {r.lists.map(([name, color]) => <li key={name} style={{ '--dot': color }}>{name}</li>)}
                                    </ul>
                                </article>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="home-section" id="features" aria-labelledby="features-title" style={{ paddingTop: 0 }}>
                    <div className="site-wrap">
                        <div className="home-section-head">
                            <p className="site-eyebrow">What you get</p>
                            <h2 id="features-title">One board, three ways to see it.</h2>
                        </div>

                        <article className="feature">
                            <div className="feature-copy">
                                <p className="site-eyebrow">Wallboard</p>
                                <h3>Put the board on the wall.</h3>
                                <p>Every list becomes a coloured tile with a live count. Arrange tiles into blocks, add a large clock, keep the screen awake, and the dashboard runs all day on the office TV.</p>
                                <ul className="feature-points">
                                    <Point><strong>Drag and drop</strong> lists into blocks and reorder them.</Point>
                                    <Point><strong>Colours and icons</strong> for each list, or driven by labels.</Point>
                                    <Point><strong>Refreshes on its own</strong>, so nobody has to touch it.</Point>
                                </ul>
                            </div>
                            <div className="feature-art"><WallboardArt /></div>
                        </article>

                        <article className="feature is-flipped">
                            <div className="feature-copy">
                                <p className="site-eyebrow">Map view</p>
                                <h3>See where the work is.</h3>
                                <p>Cards with an address or coordinates are pinned on a map and coloured by list. Field teams, site visits and event venues finally get a view that fits.</p>
                                <ul className="feature-points">
                                    <Point><strong>Reads addresses</strong> straight from card descriptions.</Point>
                                    <Point><strong>Marks your office</strong> so distances make sense.</Point>
                                    <Point><strong>Moves cards</strong> to another list from the map, asking for write access only then.</Point>
                                </ul>
                            </div>
                            <div className="feature-art"><MapArt /></div>
                        </article>

                        <article className="feature">
                            <div className="feature-copy">
                                <p className="site-eyebrow">Statistics</p>
                                <h3>Know what changed this week.<span className="s-tag">AI beta</span></h3>
                                <p>Compare cards created and completed over any period, then ask for a plain-English summary of what moved, what stalled and where the time went.</p>
                                <ul className="feature-points">
                                    <Point><strong>Any date range</strong>, from today to last quarter.</Point>
                                    <Point><strong>Your own prompt</strong> to shape the summary, like a Monday briefing.</Point>
                                    <Point><strong>Only on request</strong>: nothing is summarised until you ask.</Point>
                                </ul>
                            </div>
                            <div className="feature-art"><StatsArt /></div>
                        </article>
                    </div>
                </section>

                <section className="home-section home-details" aria-labelledby="details-title">
                    <div className="site-wrap">
                        <div className="home-section-head">
                            <p className="site-eyebrow">Details</p>
                            <h2 id="details-title">Small settings that make it yours.</h2>
                        </div>
                        <ul className="details-grid">
                            {DETAILS.map(({ icon: Icon, title, text }) => (
                                <li key={title}>
                                    <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
                                    <h3>{title}</h3>
                                    <p>{text}</p>
                                </li>
                            ))}
                        </ul>
                    </div>
                </section>

                <section className="home-section home-privacy" aria-labelledby="privacy-title">
                    <div className="site-wrap">
                        <div className="home-section-head" style={{ marginBottom: 0 }}>
                            <p className="site-eyebrow">Privacy</p>
                            <h2 id="privacy-title">Your data stays where it is.</h2>
                            <p>Trellops runs in your browser and reads from Trello. There is no new account to create and nothing to migrate.</p>
                            <p><a href="privacy.html">Read how we handle data <ArrowRight size={15} style={{ verticalAlign: '-2px' }} aria-hidden="true" /></a></p>
                        </div>
                        <ul className="privacy-facts">
                            <li>
                                <HardDrive size={22} strokeWidth={1.8} aria-hidden="true" />
                                <div><strong>Settings stay on your device</strong><span>Your layout lives in your browser’s local storage.</span></div>
                            </li>
                            <li>
                                <Eye size={22} strokeWidth={1.8} aria-hidden="true" />
                                <div><strong>Read-only by default</strong><span>Write access is requested only if you move cards on the map.</span></div>
                            </li>
                            <li>
                                <ShieldCheck size={22} strokeWidth={1.8} aria-hidden="true" />
                                <div><strong>Shared links hold layout only</strong><span>Sharing stores block names and board IDs, never card content.</span></div>
                            </li>
                        </ul>
                    </div>
                </section>

                <section className="home-cta" aria-labelledby="cta-title">
                    <div className="site-wrap">
                        <h2 id="cta-title">Your board already knows. Let everyone see it.</h2>
                        <p>Connect Trello, pick a board, and your lists become tiles straight away.</p>
                        <div className="home-actions">
                            {connect(false)}
                            <a className="s-btn s-btn-ghost" href="help.html">Read the guide</a>
                        </div>
                    </div>
                </section>
            </main>

            <footer className="site-footer">
                <div className="site-wrap">
                    <a className="site-brand" href="/"><BrandMark size={20} />Trellops</a>
                    <nav aria-label="Footer">
                        <a href="help.html">User guide</a>
                        <a href="privacy.html">Privacy</a>
                        <a href="releases.html">Release notes</a>
                    </nav>
                    <small>© 2026 Trellops. Version 4.6, November 2026.</small>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;
