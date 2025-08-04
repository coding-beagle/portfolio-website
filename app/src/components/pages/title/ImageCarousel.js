import React, { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight, faTimes } from '@fortawesome/free-solid-svg-icons';

const ImageCarousel = ({ isOpen, onClose, images }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  // Sample images - you can replace these with your actual images
  const defaultImages = [
    {
      src: '/logo192.png',
      title: 'Project 1',
      description: 'React Portfolio Website'
    },
    {
      src: '/splash-screen.gif',
      title: 'Project 2', 
      description: 'Animated Splash Screen'
    },
    {
      src: '/favicon.ico',
      title: 'Project 3',
      description: 'Brand Identity'
    }
  ];

  const imageList = images || defaultImages;

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const goToNext = useCallback(() => {
    if (isAnimating) return;
    setIsAnimating(true);
    setCurrentIndex((prev) => (prev + 1) % imageList.length);
    setTimeout(() => setIsAnimating(false), 300);
  }, [isAnimating, imageList.length]);

  const goToPrevious = useCallback(() => {
    if (isAnimating) return;
    setIsAnimating(true);
    setCurrentIndex((prev) => (prev - 1 + imageList.length) % imageList.length);
    setTimeout(() => setIsAnimating(false), 300);
  }, [isAnimating, imageList.length]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return;
      
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        goToPrevious();
      } else if (e.key === 'ArrowRight') {
        goToNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, goToNext, goToPrevious]);

  const goToSlide = (index) => {
    if (isAnimating || index === currentIndex) return;
    setIsAnimating(true);
    setCurrentIndex(index);
    setTimeout(() => setIsAnimating(false), 300);
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fadeIn 0.3s ease',
      }}
      onClick={onClose}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          background: 'none',
          border: 'none',
          color: 'white',
          fontSize: '2em',
          cursor: 'pointer',
          zIndex: 10001,
          padding: '10px',
          borderRadius: '50%',
          transition: 'background-color 0.3s ease',
        }}
        onMouseEnter={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.1)'}
        onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
      >
        <FontAwesomeIcon icon={faTimes} />
      </button>

      {/* Main carousel container */}
      <div
        style={{
          width: '90%',
          maxWidth: '800px',
          height: '80%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Navigation arrows */}
        {imageList.length > 1 && (
          <>
            <button
              onClick={goToPrevious}
              disabled={isAnimating}
              style={{
                position: 'absolute',
                left: '20px',
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                color: 'white',
                fontSize: '2em',
                cursor: isAnimating ? 'not-allowed' : 'pointer',
                padding: '15px',
                borderRadius: '50%',
                transition: 'all 0.3s ease',
                opacity: isAnimating ? 0.5 : 1,
              }}
              onMouseEnter={(e) => !isAnimating && (e.target.style.backgroundColor = 'rgba(255,255,255,0.2)')}
              onMouseLeave={(e) => !isAnimating && (e.target.style.backgroundColor = 'rgba(255,255,255,0.1)')}
            >
              <FontAwesomeIcon icon={faChevronLeft} />
            </button>

            <button
              onClick={goToNext}
              disabled={isAnimating}
              style={{
                position: 'absolute',
                right: '20px',
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                color: 'white',
                fontSize: '2em',
                cursor: isAnimating ? 'not-allowed' : 'pointer',
                padding: '15px',
                borderRadius: '50%',
                transition: 'all 0.3s ease',
                opacity: isAnimating ? 0.5 : 1,
              }}
              onMouseEnter={(e) => !isAnimating && (e.target.style.backgroundColor = 'rgba(255,255,255,0.2)')}
              onMouseLeave={(e) => !isAnimating && (e.target.style.backgroundColor = 'rgba(255,255,255,0.1)')}
            >
              <FontAwesomeIcon icon={faChevronRight} />
            </button>
          </>
        )}

        {/* Image container */}
        <div
          style={{
            width: '100%',
            height: '70%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '20px',
          }}
        >
          <img
            src={imageList[currentIndex].src}
            alt={imageList[currentIndex].title}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: '8px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
              transition: isAnimating ? 'opacity 0.3s ease, transform 0.3s ease' : 'none',
              opacity: isAnimating ? 0.7 : 1,
              transform: isAnimating ? 'scale(0.95)' : 'scale(1)',
            }}
          />
        </div>

        {/* Image info */}
        <div
          style={{
            textAlign: 'center',
            color: 'white',
            marginBottom: '20px',
          }}
        >
          <h3
            style={{
              margin: '0 0 10px 0',
              fontSize: '1.5em',
              fontWeight: 'bold',
            }}
          >
            {imageList[currentIndex].title}
          </h3>
          <p
            style={{
              margin: 0,
              fontSize: '1em',
              opacity: 0.8,
            }}
          >
            {imageList[currentIndex].description}
          </p>
        </div>

        {/* Dots indicator */}
        {imageList.length > 1 && (
          <div
            style={{
              display: 'flex',
              gap: '10px',
              justifyContent: 'center',
            }}
          >
            {imageList.map((_, index) => (
              <button
                key={index}
                onClick={() => goToSlide(index)}
                disabled={isAnimating}
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  border: 'none',
                  backgroundColor: index === currentIndex ? 'white' : 'rgba(255,255,255,0.4)',
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
              position: 'absolute',
              bottom: '20px',
              left: '50%',
              transform: 'translateX(-50%)',
              color: 'white',
              fontSize: '0.9em',
              opacity: 0.7,
            }}
          >
            {currentIndex + 1} / {imageList.length}
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </div>
  );
};

export default ImageCarousel;
