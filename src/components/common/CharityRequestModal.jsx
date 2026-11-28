import React, { useState } from 'react';
import { X, CircleCheck } from 'lucide-react';
import { submitCompRequest, CHARITY_TYPES } from '../../api/session';

// Form for charities and NGOs asking for a free Board plan on one board.
// Requests are reviewed by hand in the admin dashboard.
const CharityRequestModal = ({ boardId, boardName, onClose }) => {
    const [form, setForm] = useState({
        charityName: '',
        charityType: '',
        intendedUse: '',
        country: '',
        justification: '',
    });
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const [sent, setSent] = useState(false);

    const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSending(true);
        setError('');
        const result = await submitCompRequest({ ...form, boardId });
        setSending(false);
        if (result.ok) setSent(true);
        else setError(result.error);
    };

    return (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="charity-request-title">
            <div className="modal-content charity-modal">
                <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
                    <X size={18} aria-hidden="true" />
                </button>
                {sent ? (
                    <div className="charity-sent">
                        <CircleCheck size={28} aria-hidden="true" />
                        <h3 id="charity-request-title">Request sent</h3>
                        <p>Thanks. We review every request by hand and will reply by email to the address on your Trello account.</p>
                        <div className="modal-actions">
                            <button type="button" className="button-primary" onClick={onClose}>Close</button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} noValidate>
                        <h3 id="charity-request-title">Request a free board plan</h3>
                        <p className="field-hint">
                            Charities and NGOs can use Trellops on one board for free, for everyone who is a member of that board.
                        </p>

                        <label className="charity-field">
                            <span>Board</span>
                            <input type="text" value={boardName ? `${boardName} (${boardId})` : boardId} readOnly />
                        </label>
                        <label className="charity-field">
                            <span>Name of the organisation</span>
                            <input type="text" value={form.charityName} onChange={update('charityName')} maxLength={160} required />
                        </label>
                        <label className="charity-field">
                            <span>Type of organisation</span>
                            <select value={form.charityType} onChange={update('charityType')} required>
                                <option value="">Choose one</option>
                                {CHARITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </label>
                        <label className="charity-field">
                            <span>Country or location</span>
                            <input type="text" value={form.country} onChange={update('country')} maxLength={120} required />
                        </label>
                        <label className="charity-field">
                            <span>How do you plan to use Trellops?</span>
                            <textarea rows={3} value={form.intendedUse} onChange={update('intendedUse')} maxLength={2000} required />
                        </label>
                        <label className="charity-field">
                            <span>Why do you need the free plan?</span>
                            <textarea rows={3} value={form.justification} onChange={update('justification')} maxLength={2000} required />
                        </label>

                        {error && <div className="notice notice-danger" role="alert">{error}</div>}

                        <div className="modal-actions">
                            <button type="button" className="button-secondary" onClick={onClose}>Cancel</button>
                            <button type="submit" className="button-primary" disabled={sending}>
                                {sending ? 'Sending...' : 'Send request'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default CharityRequestModal;
