import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { trelloFetch } from '../../api/trello';
import { useDarkMode } from '../../context/DarkModeContext';
import { getLabelTextColor } from '../../utils/helpers';
import { getTerminology } from '../../utils/terminology';

const CardDetailsModal = ({ listId, listName, color, token, onClose, sectionsLayout, ignoreTemplateCards, ignoreNoDescCards, enableIgnoreKeywords, ignoreKeywords, settings }) => {
    const [cards, setCards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const { theme } = useDarkMode();
    
    const terms = getTerminology(settings);
    const CardsTerm = terms.cards;

    // Determine if the first card should be ignored based on block settings
    const section = sectionsLayout.find(s => s.listIds.includes(listId));
    const shouldIgnoreFirst = section?.ignoreFirstCard || false;


    useEffect(() => {
        setLoading(true);
        setError('');
        trelloFetch(`/lists/${listId}/cards?fields=id,name,shortUrl,labels,isTemplate,desc`, token)
            .then(data => {
                let cardsToDisplay = data;
                if (ignoreTemplateCards) {
                    cardsToDisplay = cardsToDisplay.filter(card => !card.isTemplate);
                }
                // Conditionally filter the first card based on setting
                const filteredCards = shouldIgnoreFirst ? cardsToDisplay.slice(1) : cardsToDisplay;
                setCards(filteredCards);
            })
            .catch(e => {
                console.error("Card fetch error:", e);
                setError(`Failed to load cards for this list: ${e.message}`);
            })
            .finally(() => setLoading(false));
    }, [listId, token, shouldIgnoreFirst, ignoreTemplateCards]);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <button type="button" className="modal-close icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
                <h3 style={{ color: color, borderColor: color }}>{CardsTerm} in: {listName} ({cards.length})</h3>

                {loading && <p>Loading {CardsTerm.toLowerCase()}...</p>}
                {error && <p className="error">{error}</p>}

                {!loading && cards.length === 0 && <p>No {CardsTerm.toLowerCase()} found in this list.</p>}

                {!loading && cards.length > 0 && (
                    <div>
                        {cards.map(card => {
                            const keywords = enableIgnoreKeywords && ignoreKeywords ? ignoreKeywords.split(',').map(k => k.trim().toLowerCase()).filter(k => k) : [];
                            const isIgnoredByKeyword = keywords.length > 0 && keywords.some(k => card.name.toLowerCase().includes(k));
                            const isIgnoredByDesc = ignoreNoDescCards && (!card.desc || !card.desc.trim());
                            const isIgnored = isIgnoredByDesc || isIgnoredByKeyword;
                            const itemStyle = isIgnored ? { color: 'lightgrey', fontStyle: 'italic' } : {};

                            return (
                                <div key={card.id} className="card-list-item" style={itemStyle}>
                                    {/* Display Trello Labels */}
                                    {card.labels?.map(label => (
                                        <span
                                            key={label.id}
                                            className="card-label"
                                            style={{
                                                backgroundColor: label.color || '#999',
                                                color: getLabelTextColor(theme),
                                                opacity: isIgnored ? 0.6 : 1
                                            }}
                                        >
                                            {label.name || label.color}
                                        </span>
                                    ))}

                                    <a
                                        href={card.shortUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title={card.name}
                                        style={itemStyle}
                                    >
                                        {card.name} 
                                        {isIgnoredByDesc && !isIgnoredByKeyword && <span style={{ fontSize: '0.8em' }}> (no description)</span>}
                                        {isIgnoredByKeyword && <span style={{ fontSize: '0.8em' }}> (ignored)</span>}
                                    </a>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CardDetailsModal;
