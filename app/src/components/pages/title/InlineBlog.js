import React, { useState, useCallback, useEffect, useRef, useContext, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTheme } from '../../../themes/ThemeProvider';
import { faChevronLeft, faTimes } from '@fortawesome/free-solid-svg-icons';
import PanelButton, { PanelButtonStyles } from './PanelButton';
import { MobileContext } from '../../../contexts/MobileContext';

const PUBLIC_URL = process.env.PUBLIC_URL || '';

// Dates come out of the frontmatter as plain YYYY-MM-DD strings; parsing them
// as local components avoids the UTC shift that `new Date("2026-08-27")` gives.
const formatDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!match) return value || '';
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString(
    undefined,
    { year: 'numeric', month: 'long', day: 'numeric' }
  );
};

// Image paths in a post can be written three ways: an absolute URL, a path from
// the public root ("/carousel_imgs/x.png"), or a bare name sitting next to the
// post itself ("diagram.png"). The last one is the one people reach for, and it
// would otherwise resolve against the site root rather than the posts folder.
const resolveAsset = (src, base = 'posts/') => {
  if (!src) return src;
  if (/^(https?:)?\/\//.test(src) || src.startsWith('data:')) return src;
  if (src.startsWith('/')) return `${PUBLIC_URL}${src}`;
  return `${PUBLIC_URL}/${base}${src}`;
};

// The directory a post lives in, so its colocated images can be found.
const assetBaseFor = (file) => {
  const cut = (file || '').lastIndexOf('/');
  return cut === -1 ? 'posts/' : `${file.slice(0, cut + 1)}`;
};

// The post body arrives with the frontmatter block still attached; it is only
// there for the index generator, so strip it before rendering.
const stripFrontmatter = (source) => source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

const InlineBlog = ({ isVisible, onClose, initialSlug = null }) => {
  const { theme } = useTheme();
  const mobile = useContext(MobileContext);

  const [isVisible_internal, setIsVisible_internal] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  const [posts, setPosts] = useState([]);
  const [indexError, setIndexError] = useState(null);
  const [indexLoading, setIndexLoading] = useState(true);

  const [activeSlug, setActiveSlug] = useState(initialSlug);
  const [postBody, setPostBody] = useState('');
  const [postLoading, setPostLoading] = useState(false);
  const [postError, setPostError] = useState(null);

  const scrollRef = useRef(null);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);

  const activePost = useMemo(
    () => posts.find((post) => post.slug === activeSlug) || null,
    [posts, activeSlug]
  );

  const assetBase = useMemo(() => assetBaseFor(activePost?.file), [activePost]);

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

  // A deep link (?post=slug) can land after the panel has already mounted, and
  // the hash router keeps this component alive across those changes — so
  // dropping the param has to fall back to the list rather than stick.
  useEffect(() => {
    setActiveSlug(initialSlug);
  }, [initialSlug]);

  // The index is one small file listing every post's metadata, so the list can
  // render without downloading a single body.
  useEffect(() => {
    if (!shouldRender) return undefined;

    let cancelled = false;
    setIndexLoading(true);

    fetch(`${PUBLIC_URL}/posts/index.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        setPosts(Array.isArray(data) ? data : []);
        setIndexError(null);
      })
      .catch(() => {
        if (!cancelled) setIndexError("Couldn't load the post list.");
      })
      .finally(() => {
        if (!cancelled) setIndexLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [shouldRender]);

  // Bodies are fetched lazily, one at a time, as posts are opened.
  useEffect(() => {
    if (!activePost) {
      setPostBody('');
      return undefined;
    }

    let cancelled = false;
    setPostLoading(true);
    setPostError(null);

    fetch(`${PUBLIC_URL}/${activePost.file}`)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status}`);
        return response.text();
      })
      .then((text) => {
        if (cancelled) return;
        setPostBody(stripFrontmatter(text));
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      })
      .catch(() => {
        if (!cancelled) setPostError("Couldn't load this post.");
      })
      .finally(() => {
        if (!cancelled) setPostLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activePost]);

  const goBack = useCallback(() => setActiveSlug(null), []);

  useEffect(() => {
    if (!shouldRender || !isVisible) return undefined;

    const handleKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      // Escape steps back through the panel rather than jumping straight out.
      if (activeSlug) {
        goBack();
      } else if (onClose) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shouldRender, isVisible, activeSlug, goBack, onClose]);

  // Minimum swipe distance (in px)
  const minSwipeDistance = 50;

  const onTouchStart = (e) => {
    if (!mobile) return;
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e) => {
    if (!mobile) return;
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!mobile || !touchStart || !touchEnd) return;
    // Swipe right inside a post is "back to the list", matching the carousel's
    // swipe handling on the same surface.
    if (touchEnd - touchStart > minSwipeDistance && activeSlug) goBack();
  };

  const markdownComponents = useMemo(() => {
    const heading = (size, weight) => ({ children }) => (
      <div
        style={{
          fontSize: size,
          fontWeight: weight,
          margin: '1.2em 0 0.4em',
          lineHeight: 1.25,
        }}
      >
        {children}
      </div>
    );

    return {
      h1: heading(mobile ? '1.5em' : '1.8em', 'bold'),
      h2: heading(mobile ? '1.25em' : '1.4em', 'bold'),
      h3: heading(mobile ? '1.1em' : '1.15em', 'bold'),
      h4: heading('1em', 'bold'),
      p: ({ children }) => (
        <p style={{ margin: '0 0 1em', lineHeight: 1.65 }}>{children}</p>
      ),
      a: ({ href, children }) => (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: theme.secondary, textDecoration: 'underline' }}
        >
          {children}
        </a>
      ),
      ul: ({ children }) => (
        <ul style={{ margin: '0 0 1em', paddingLeft: '1.4em', lineHeight: 1.65 }}>
          {children}
        </ul>
      ),
      ol: ({ children }) => (
        <ol style={{ margin: '0 0 1em', paddingLeft: '1.4em', lineHeight: 1.65 }}>
          {children}
        </ol>
      ),
      li: ({ children }) => <li style={{ margin: '0.25em 0' }}>{children}</li>,
      blockquote: ({ children }) => (
        <blockquote
          style={{
            margin: '0 0 1em',
            padding: '0.25em 0 0.25em 1em',
            borderLeft: `3px solid ${theme.secondary}80`,
            opacity: 0.85,
            fontStyle: 'italic',
          }}
        >
          {children}
        </blockquote>
      ),
      // react-markdown v10 renders fenced blocks as <pre><code class="language-*">,
      // so the pill styling below is gated on that class rather than an `inline` prop.
      code: ({ className, children }) => {
        const isBlock = /language-/.test(className || '');
        return (
          <code
            className={className}
            style={
              isBlock
                ? { fontFamily: 'monospace', fontSize: '0.9em' }
                : {
                  fontFamily: 'monospace',
                  fontSize: '0.9em',
                  background: `${theme.accent}18`,
                  border: `1px solid ${theme.accent}25`,
                  borderRadius: '0.3em',
                  padding: '0.1em 0.35em',
                }
            }
          >
            {children}
          </code>
        );
      },
      pre: ({ children }) => (
        <pre
          style={{
            margin: '0 0 1em',
            padding: '0.9em 1em',
            background: `${theme.accent}12`,
            border: `1px solid ${theme.accent}25`,
            borderRadius: '0.6em',
            overflowX: 'auto',
            fontSize: '0.9em',
            lineHeight: 1.5,
          }}
        >
          {children}
        </pre>
      ),
      hr: () => (
        <hr
          style={{
            border: 'none',
            borderTop: `1px solid ${theme.accent}30`,
            margin: '1.5em 0',
          }}
        />
      ),
      img: ({ src, alt }) => (
        <img
          src={resolveAsset(src, assetBase)}
          alt={alt}
          style={{
            maxWidth: '100%',
            borderRadius: '0.5em',
            display: 'block',
            margin: '0 auto 1em',
          }}
        />
      ),
      table: ({ children }) => (
        <div style={{ overflowX: 'auto', margin: '0 0 1em' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.95em' }}>
            {children}
          </table>
        </div>
      ),
      th: ({ children }) => (
        <th
          style={{
            textAlign: 'left',
            padding: '0.5em 0.75em',
            borderBottom: `2px solid ${theme.accent}30`,
            fontWeight: 'bold',
          }}
        >
          {children}
        </th>
      ),
      td: ({ children }) => (
        <td
          style={{
            padding: '0.5em 0.75em',
            borderBottom: `1px solid ${theme.accent}20`,
          }}
        >
          {children}
        </td>
      ),
    };
  }, [theme, mobile, assetBase]);

  if (!shouldRender) return null;

  const contentHeight = mobile ? '45vh' : '60vh';

  const spinner = (label) => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        minHeight: '8em',
      }}
    >
      <img
        src={`${PUBLIC_URL}/loadcat.gif`}
        alt="Loading..."
        style={{ width: '40px', height: '40px', objectFit: 'contain' }}
      />
      <span style={{ color: theme.accent, fontSize: '0.9em', opacity: 0.7 }}>{label}</span>
    </div>
  );

  const message = (text) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '8em',
        opacity: 0.7,
        textAlign: 'center',
        padding: '1em',
      }}
    >
      {text}
    </div>
  );

  return (
    <div
      id="blogPanel"
      style={{
        width: '100%',
        maxWidth: mobile ? '90%' : '50%',
        margin: '1.5em auto',
        padding: '0 1em',
        // Positioned so the z-index applies, and above the scenes' value-changer
        // overlays: those wrappers are flex items of the same container carrying
        // zIndex 3000, which counts even though they are position:static. At the
        // carousel's zIndex 100 they paint over this panel's top-left corner and
        // swallow the back button. Still below the mobile options sheet (11001+),
        // which should stay on top when it is open.
        position: 'relative',
        zIndex: 4000,
        opacity: isVisible_internal ? 1 : 0,
        transform: isVisible_internal
          ? 'translateY(0) scale(1)'
          : 'translateY(-30px) scale(0.95)',
        maxHeight: isVisible_internal ? '50em' : '0',
        overflow: 'hidden',
        transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
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
        {/* Back button, only once a post is open */}
        <PanelButton
          icon={faChevronLeft}
          label="Back to all posts"
          onClick={goBack}
          baseTransform={activeSlug && isVisible_internal ? 'translateX(0)' : 'translateX(-150%)'}
          style={{
            top: '10px',
            left: '10px',
            opacity: activeSlug ? 1 : 0,
            pointerEvents: activeSlug ? 'auto' : 'none',
          }}
        />

        {/* Close button */}
        {onClose && (
          <PanelButton
            icon={faTimes}
            label="Close blog"
            onClick={onClose}
            style={{
              top: '10px',
              right: '10px',
              opacity: isVisible_internal ? 1 : 0,
            }}
          />
        )}

        {/* Panel header */}
        <div
          style={{
            padding: mobile ? '0.9em 3.2em' : '1em 3.4em',
            borderBottom: `1px solid ${theme.accent}20`,
            textAlign: 'center',
            transform: isVisible_internal ? 'translateY(0)' : 'translateY(-100%)',
            transition: 'transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <h4
            style={{
              margin: 0,
              fontSize: mobile ? '0.95em' : '1.1em',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {activePost ? activePost.title : 'Blog'}
          </h4>
          <p style={{ margin: '3px 0 0', fontSize: mobile ? '0.7em' : '0.8em', opacity: 0.7 }}>
            {activePost
              ? formatDate(activePost.date)
              : `${posts.length} post${posts.length === 1 ? '' : 's'}`}
          </p>
        </div>

        {/* Scrollable content */}
        <div
          ref={scrollRef}
          style={{
            maxHeight: contentHeight,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: mobile ? '1em' : '1.25em 1.5em',
            color: theme.accent,
            opacity: isVisible_internal ? 1 : 0,
            transition: 'opacity 0.4s ease',
            WebkitOverflowScrolling: 'touch',
          }}
          {...(mobile && {
            onTouchStart,
            onTouchMove,
            onTouchEnd,
          })}
        >
          {activePost ? (
            postLoading ? (
              spinner('Loading post...')
            ) : postError ? (
              message(postError)
            ) : (
              <div
                style={{
                  fontSize: mobile ? '0.9em' : '1em',
                  animation: 'blogFadeIn 0.4s ease',
                }}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {postBody}
                </ReactMarkdown>
              </div>
            )
          ) : indexLoading ? (
            spinner('Loading posts...')
          ) : indexError ? (
            message(indexError)
          ) : posts.length === 0 ? (
            message('No posts yet. Check back soon.')
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75em',
                animation: 'blogFadeIn 0.4s ease',
              }}
            >
              {posts.map((post, index) => (
                <PostCard
                  key={post.slug}
                  post={post}
                  index={index}
                  mobile={mobile}
                  visible={isVisible_internal}
                  onOpen={() => setActiveSlug(post.slug)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <PanelButtonStyles />
      <style>{`
        @keyframes blogFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};

const PostCard = ({ post, index, mobile, visible, onOpen }) => {
  const { theme } = useTheme();
  const [isHover, setIsHover] = useState(false);

  return (
    <button
      onClick={onOpen}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: isHover ? `${theme.accent}12` : 'transparent',
        border: `1px solid ${isHover ? `${theme.secondary}60` : `${theme.accent}25`}`,
        borderRadius: '0.75em',
        color: theme.accent,
        // Comfortably past the 44px tap target the icon row uses.
        padding: mobile ? '0.85em' : '1em',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'background 0.3s ease, border-color 0.3s ease, transform 0.3s ease, opacity 0.4s ease',
        transform: visible ? `scale(${isHover ? 1.015 : 1})` : 'scale(0.97)',
        opacity: visible ? 1 : 0,
        transitionDelay: visible ? `${0.1 + index * 0.05}s` : '0s',
      }}
    >
      {post.cover && (
        <img
          src={resolveAsset(post.cover, assetBaseFor(post.file))}
          alt=""
          style={{
            width: '100%',
            height: mobile ? '7em' : '9em',
            objectFit: 'cover',
            borderRadius: '0.5em',
            marginBottom: '0.7em',
            display: 'block',
          }}
        />
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '0.75em',
        }}
      >
        <span
          style={{
            fontWeight: 'bold',
            fontSize: mobile ? '0.95em' : '1.05em',
            color: isHover ? theme.secondary : theme.accent,
            transition: 'color 0.3s ease',
          }}
        >
          {post.title}
        </span>
        <span style={{ fontSize: '0.75em', opacity: 0.6, whiteSpace: 'nowrap' }}>
          {formatDate(post.date)}
        </span>
      </div>
      {post.summary && (
        <p
          style={{
            margin: '0.4em 0 0',
            fontSize: mobile ? '0.8em' : '0.88em',
            opacity: 0.75,
            lineHeight: 1.5,
          }}
        >
          {post.summary}
        </p>
      )}
      {post.tags && post.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4em', marginTop: '0.7em' }}>
          {post.tags.map((tag) => (
            <span
              key={tag}
              style={{
                fontSize: '0.7em',
                padding: '0.2em 0.6em',
                borderRadius: '1em',
                background: `${theme.secondary}20`,
                border: `1px solid ${theme.secondary}40`,
                opacity: 0.9,
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </button>
  );
};

export default InlineBlog;
