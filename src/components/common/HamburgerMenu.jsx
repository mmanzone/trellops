import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

const HamburgerMenu = ({ children }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [position, setPosition] = useState({ top: 0, right: 0 });
    const buttonRef = useRef(null);
    const menuRef = useRef(null);

    const toggleMenu = (e) => {
        e.stopPropagation();
        if (!isOpen) {
            // Calculate position before opening
            if (buttonRef.current) {
                const rect = buttonRef.current.getBoundingClientRect();
                setPosition({
                    top: rect.bottom + 5,
                    right: window.innerWidth - rect.right
                });
            }
        }
        setIsOpen(!isOpen);
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            // Check if click is inside the menu (portal) or the button
            if (
                menuRef.current && !menuRef.current.contains(event.target) &&
                buttonRef.current && !buttonRef.current.contains(event.target)
            ) {
                setIsOpen(false);
            }
        };

        const handleResize = () => {
            if (isOpen && buttonRef.current) {
                const rect = buttonRef.current.getBoundingClientRect();
                setPosition({
                    top: rect.bottom + 5,
                    right: window.innerWidth - rect.right
                });
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            window.addEventListener('resize', handleResize);
            window.addEventListener('scroll', handleResize, true); // Capture scroll too
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('scroll', handleResize, true);
        };
    }, [isOpen]);

    return (
        <div className="hamburger-menu-container">
            <button
                ref={buttonRef}
                className="hamburger-button"
                onClick={toggleMenu}
                aria-label="Menu"
            >
                ☰
            </button>
            {isOpen && createPortal(
                <div
                    ref={menuRef}
                    className="hamburger-dropdown"
                    style={{
                        position: 'fixed',
                        top: `${position.top}px`,
                        right: `${position.right}px`,
                        zIndex: 10000,
                        maxHeight: '80vh',
                        overflowY: 'auto'
                    }}
                >
                    {children}
                </div>,
                document.body
            )}
        </div>
    );
};

export default HamburgerMenu;
