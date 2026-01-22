import React, { useState, useRef, useEffect } from 'react';

const HamburgerMenu = ({ children }) => {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef(null);

    const toggleMenu = () => setIsOpen(!isOpen);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    return (
        <div className="hamburger-menu-container" ref={menuRef}>
            <button className="hamburger-button" onClick={toggleMenu} aria-label="Menu">
                ☰
            </button>
            {isOpen && (
                <div className="hamburger-dropdown">
                    {children}
                </div>
            )}
        </div>
    );
};

export default HamburgerMenu;
