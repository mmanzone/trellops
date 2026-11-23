import { marked } from 'marked';
import DOMPurify from 'dompurify';

// Open links from rendered Markdown in a new tab, without giving the new page
// access to this window.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
    }
});

// Render untrusted Markdown (Trello card descriptions, AI output) to safe HTML.
// marked does not sanitise, so its output must never reach the DOM directly.
export const renderMarkdown = (text) => {
    if (!text) return '';
    return DOMPurify.sanitize(marked.parse(text));
};
