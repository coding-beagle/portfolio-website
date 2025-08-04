import React, { useState, useCallback } from 'react';
import { useTheme } from '../../../themes/ThemeProvider';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';

const InlineCarousel = ({ images, isVisible }) => {
  const { theme } = useTheme();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  // Sample images - you can replace these with your actual images
  const defaultImages = [
    {
      src: '/logo192.png',
      title: 'React Portfolio',
      description: 'Interactive portfolio website built with React'
    },
    {
      src: '/splash-screen.gif',
      title: 'Animated Elements',
      description: 'Dynamic animations and visual effects'
    },
    {
      src: '/favicon.ico',
      title: 'Brand Identity',
      description: 'Custom branding and design elements'
    }
  ];

  const imageList = images || defaultImages;

  const goToNext = useCallback(() => {
    if (isAnimating) return;
    setIsAnimating(true);
    setCurrentIndex((prev) => (prev + 1) % imageList.length);
    setTimeout(() => setIsAnimating(false), 400);
  }, [isAnimating, imageList.length]);

  const goToPrevious = useCallback(() => {
    if (isAnimating) return;
    setIsAnimating(true);
    setCurrentIndex((prev) => (prev - 1 + imageList.length) % imageList.length);
    setTimeout(() => setIsAnimating(false), 400);
  }, [isAnimating, imageList.length]);

  const goToSlide = (index) => {
    if (isAnimating || index === currentIndex) return;
    setIsAnimating(true);
    setCurrentIndex(index);
    setTimeout(() => setIsAnimating(false), 400);
  };

  if (!isVisible) return null;

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '70%',
        margin: '1.5em auto',
        padding: '0 1em',
        zIndex: 100,
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(-20px)',
        transition: 'opacity 0.5s ease, transform 0.5s ease',
      }}
    >
      {/* Main carousel container */}
      <div
        style={{
          position: 'relative',
          borderRadius: '1em',
          overflow: 'hidden',
          boxShadow: `0 8px 32px ${theme.primary === '#ffffff' ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.3)'}`,
          backgroundColor: theme.primary,
          border: `2px solid ${theme.accent}20`,
        }}
      >
        {/* Navigation arrows */}
        {imageList.length > 1 && (
          <>
            <button
              onClick={goToPrevious}
              disabled={isAnimating}
              style={{
                position: 'absolute',
                left: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: `${theme.accent}15`,
                backdropFilter: 'blur(10px)',
                border: `1px solid ${theme.accent}30`,
                color: theme.accent,
                fontSize: '1.2em',
                cursor: isAnimating ? 'not-allowed' : 'pointer',
                padding: '8px 10px',
                borderRadius: '50%',
                transition: 'all 0.3s ease',
                opacity: isAnimating ? 0.5 : 0.8,
                zIndex: 101,
              }}
              onMouseEnter={(e) => !isAnimating && (e.target.style.opacity = '1')}
              onMouseLeave={(e) => !isAnimating && (e.target.style.opacity = '0.8')}
            >
              <FontAwesomeIcon icon={faChevronLeft} />
            </button>

            <button
              onClick={goToNext}
              disabled={isAnimating}
              style={{
                position: 'absolute',
                right: '10px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: `${theme.accent}15`,
                backdropFilter: 'blur(10px)',
                border: `1px solid ${theme.accent}30`,
                color: theme.accent,
                fontSize: '1.2em',
                cursor: isAnimating ? 'not-allowed' : 'pointer',
                padding: '8px 10px',
                borderRadius: '50%',
                transition: 'all 0.3s ease',
                opacity: isAnimating ? 0.5 : 0.8,
                zIndex: 101,
              }}
              onMouseEnter={(e) => !isAnimating && (e.target.style.opacity = '1')}
              onMouseLeave={(e) => !isAnimating && (e.target.style.opacity = '0.8')}
            >
              <FontAwesomeIcon icon={faChevronRight} />
            </button>
          </>
        )}

        {/* Image container */}
        <div
          style={{
            width: '100%',
            height: '30em',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <img
            src={imageList[currentIndex].src}
            alt={imageList[currentIndex].title}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transition: isAnimating ? 'opacity 0.4s ease, transform 0.4s ease' : 'none',
              opacity: isAnimating ? 0.7 : 1,
              transform: isAnimating ? 'scale(1.05)' : 'scale(1)',
            }}
          />
        </div>

        {/* Image info overlay */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            background: `linear-gradient(transparent, ${theme.primary}90)`,
            backdropFilter: 'blur(10px)',
            padding: '20px 15px 15px',
            color: theme.accent,
          }}
        >
          <h4
            style={{
              margin: '0 0 5px 0',
              fontSize: '1.1em',
              fontWeight: 'bold',
            }}
          >
            {imageList[currentIndex].title}
          </h4>
          <p
            style={{
              margin: 0,
              fontSize: '0.9em',
              opacity: 0.8,
            }}
          >
            {imageList[currentIndex].description}
          </p>
        </div>
      </div>

      {/* Dots indicator */}
      {imageList.length > 1 && (
        <div
          style={{
            display: 'flex',
            gap: '8px',
            justifyContent: 'center',
            marginTop: '15px',
          }}
        >
          {imageList.map((_, index) => (
            <button
              key={index}
              onClick={() => goToSlide(index)}
              disabled={isAnimating}
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                border: 'none',
                backgroundColor: index === currentIndex ? theme.accent : `${theme.accent}40`,
                cursor: isAnimating ? 'not-allowed' : 'pointer',
                transition: 'all 0.3s ease',
                opacity: isAnimating ? 0.5 : 1,
              }}
            />
          ))}
        </div>
      )}

      {/* Counter */}
      {imageList.length > 1 && (
        <div
          style={{
            textAlign: 'center',
            marginTop: '10px',
            color: theme.accent,
            fontSize: '0.8em',
            opacity: 0.7,
          }}
        >
          {currentIndex + 1} / {imageList.length}
        </div>
      )}
    </div>
  );
};

export default InlineCarousel;
