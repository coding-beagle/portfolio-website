import React, { useState, useCallback, useEffect, useRef, useContext } from 'react';
import { useTheme } from '../../../themes/ThemeProvider';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight, faTimes } from '@fortawesome/free-solid-svg-icons';
import { MobileContext } from "../../../contexts/MobileContext";


const InlineCarousel = ({ images, isVisible, onClose }) => {
  const { theme } = useTheme();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isVisible_internal, setIsVisible_internal] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const carouselRef = useRef(null);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);
  const [imageLoading, setImageLoading] = useState(true);
  const [loadedImages, setLoadedImages] = useState(new Set());

  const mobile = useContext(MobileContext);


  const defaultImages = [
    {
      src: '/splash-screen.gif',
      title: 'nteague.com',
      description: 'React Portfolio Website.'
    },
    {
      src: '/carousel_imgs/betsygif.gif',
      title: 'BET-C',
      description: 'RC hexapod with custom PCB.'
    },
    {
      src: '/carousel_imgs/mandelbrot.png',
      title: 'FPGA Mandelbrot Accelerator',
      description: 'Multiple FPS rendering achieved with a Zynq 7020 board.'
    },
    {
      src: '/carousel_imgs/TeagueProcessingUnit.jpeg',
      title: 'TeagueProcessingUnit',
      description: '16 Bit CPU designed in verilog, running a custom ISA.'
    },
  ];

  const imageList = images || defaultImages;

  // Handle opening/closing animations
  useEffect(() => {
    if (isVisible) {
      setShouldRender(true);
      // Small delay to ensure the element is rendered before animating
      setTimeout(() => setIsVisible_internal(true), 10);
    } else {
      setIsVisible_internal(false);
      // Keep rendered until animation completes
      setTimeout(() => setShouldRender(false), 400);
    }
  }, [isVisible]);

  // Update loading state when current image changes
  useEffect(() => {
    const currentImageSrc = imageList[currentIndex].src;
    const isCurrentImageLoaded = loadedImages.has(currentImageSrc) ||
      Array.from(loadedImages).some(src => src.endsWith(currentImageSrc));
    setImageLoading(!isCurrentImageLoaded);
  }, [currentIndex, loadedImages, imageList]);

  const handleImageLoad = (e) => {
    const loadedImageSrc = e.target.src;
    setLoadedImages(prev => new Set([...prev, loadedImageSrc]));

    // Only update loading state if this is the currently displayed image
    const currentImageSrc = imageList[currentIndex].src;
    if (loadedImageSrc === currentImageSrc || loadedImageSrc.endsWith(currentImageSrc)) {
      setImageLoading(false);
    }
  };

  const handleImageError = (e) => {
    // Only update loading state if this is the currently displayed image
    const errorImageSrc = e.target.src;
    const currentImageSrc = imageList[currentIndex].src;
    if (errorImageSrc === currentImageSrc || errorImageSrc.endsWith(currentImageSrc)) {
      setImageLoading(false);
    }
  };

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

  // Minimum swipe distance (in px)
  const minSwipeDistance = 50;

  const onTouchStart = (e) => {
    setTouchEnd(null); // otherwise the swipe is fired even with usual touch events
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e) => setTouchEnd(e.targetTouches[0].clientX);

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && imageList.length > 1) {
      goToNext();
    }
    if (isRightSwipe && imageList.length > 1) {
      goToPrevious();
    }
  };

  if (!shouldRender) return null;

  return (
    <div
      ref={carouselRef}
      style={{
        width: '100%',
        maxWidth: mobile ? '90%' : '50%',
        margin: '1.5em auto',
        padding: '0 1em',
        zIndex: 100,
        opacity: isVisible_internal ? 1 : 0,
        transform: isVisible_internal
          ? 'translateY(0) scale(1)'
          : 'translateY(-30px) scale(0.95)',
        maxHeight: isVisible_internal ? '50em' : '0',
        overflow: 'hidden',
        transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
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
          transform: isVisible_internal ? 'scale(1)' : 'scale(0.9)',
          transition: 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
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
                transform: `translateY(-50%) ${isVisible_internal ? 'translateX(0)' : 'translateX(-100%)'}`,
                background: `${theme.accent}15`,
                backdropFilter: 'blur(10px)',
                border: `1px solid ${theme.accent}30`,
                color: theme.accent,
                fontSize: '1.2em',
                cursor: isAnimating ? 'not-allowed' : 'pointer',
                padding: '8px 10px',
                borderRadius: '50%',
                transition: 'all 0.3s ease, transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
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
                transform: `translateY(-50%) ${isVisible_internal ? 'translateX(0)' : 'translateX(100%)'}`,
                background: `${theme.accent}15`,
                backdropFilter: 'blur(10px)',
                border: `1px solid ${theme.accent}30`,
                color: theme.accent,
                fontSize: '1.2em',
                cursor: isAnimating ? 'not-allowed' : 'pointer',
                padding: '8px 10px',
                borderRadius: '50%',
                transition: 'all 0.3s ease, transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
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

        {/* Close button */}
        {onClose && (
          <button
            onClick={onClose}
            style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              background: `${theme.accent}15`,
              backdropFilter: 'blur(10px)',
              border: `1px solid ${theme.accent}30`,
              color: theme.accent,
              fontSize: '1.1em',
              cursor: 'pointer',
              padding: '8px 9px',
              borderRadius: '50%',
              transition: 'all 0.3s ease, transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
              opacity: 0.8,
              zIndex: 101,
              transform: isVisible_internal ? 'scale(1)' : 'scale(0)',
            }}
            onMouseEnter={(e) => (e.target.style.opacity = '1')}
            onMouseLeave={(e) => (e.target.style.opacity = '0.8')}
          >
            <FontAwesomeIcon icon={faTimes} />
          </button>
        )}

        {/* Image container */}
        <div
          style={{
            width: '100%',
            height: mobile ? '45vh' : '60vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            transform: isVisible_internal ? 'scale(1)' : 'scale(1.1)',
            transition: 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
            position: 'relative',
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* Loading spinner */}
          {imageLoading && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 102,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <img
                src="/loadcat.gif"
                alt="Loading..."
                style={{
                  width: '40px',
                  height: '40px',
                  objectFit: 'contain',
                }}
              />
              <span
                style={{
                  color: theme.accent,
                  fontSize: '0.9em',
                  opacity: 0.7,
                }}
              >
                Loading...
              </span>
            </div>
          )}

          <img
            src={imageList[currentIndex].src}
            alt={imageList[currentIndex].title}
            onLoad={handleImageLoad}
            onError={handleImageError}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transition: isAnimating ? 'opacity 0.4s ease, transform 0.4s ease' : 'none',
              opacity: imageLoading ? 0.3 : (isAnimating ? 0.7 : 1),
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
            padding: mobile ? '15px 10px 10px' : '20px 15px 15px',
            color: theme.accent,
            transform: isVisible_internal ? 'translateY(0)' : 'translateY(100%)',
            transition: 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
            transitionDelay: isVisible_internal ? '0.2s' : '0s',
          }}
        >
          <h4
            style={{
              margin: '0 0 5px 0',
              fontSize: mobile ? '0.9em' : '1.1em',
              fontWeight: 'bold',
            }}
          >
            {imageList[currentIndex].title}
          </h4>
          <p
            style={{
              margin: 0,
              fontSize: mobile ? '0.75em' : '0.9em',
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
            opacity: isVisible_internal ? 1 : 0,
            transform: isVisible_internal ? 'translateY(0)' : 'translateY(20px)',
            transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
            transitionDelay: isVisible_internal ? '0.3s' : '0s',
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
                transform: isVisible_internal ? 'scale(1)' : 'scale(0)',
                transitionDelay: isVisible_internal ? `${0.4 + index * 0.05}s` : '0s',
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
            opacity: isVisible_internal ? 0.7 : 0,
            transform: isVisible_internal ? 'translateY(0)' : 'translateY(20px)',
            transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
            transitionDelay: isVisible_internal ? '0.4s' : '0s',
          }}
        >
          {currentIndex + 1} / {imageList.length}
        </div>
      )}
    </div>
  );
};

export default InlineCarousel;
