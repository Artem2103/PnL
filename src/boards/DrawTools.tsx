import { useEffect, useRef, useState } from 'react';
import { INK_COLORS, INK_WIDTHS, type InkTool } from './drawing';

/**
 * The drawing toolbar, down the left edge like TradingView's: the cursor (move
 * the canvas, open positions), the brush, colour, line width, and a trash menu:
 * "Delete all drawings" / "Delete all photos". The board and the position
 * viewer each show one; the photos item appears only where photos exist.
 */

interface Props {
  active: boolean;
  onActive(active: boolean): void;
  tool: InkTool;
  onTool(tool: InkTool): void;
  hasDrawings: boolean;
  onClearDrawings(): void;
  hasPhotos?: boolean;
  onClearPhotos?: () => void;
  hidden?: boolean;
  className?: string;
}

export function DrawTools({ active, onActive, tool, onTool, hasDrawings, onClearDrawings, hasPhotos = false, onClearPhotos, hidden, className }: Props) {
  const [menu, setMenu] = useState<'color' | 'width' | 'clear' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // A click anywhere else closes an open menu.
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  // Hidden behind the viewer: a menu left open would come back with it.
  useEffect(() => {
    if (hidden) setMenu(null);
  }, [hidden]);

  const toggle = (which: 'color' | 'width' | 'clear') => setMenu((m) => (m === which ? null : which));

  return (
    <div
      ref={rootRef}
      className={`bd-draw${className ? ` ${className}` : ''}`}
      role="toolbar"
      aria-label="Drawing"
      aria-orientation="vertical"
      hidden={hidden}
    >
      <button
        type="button"
        className={`bd-draw__btn${active ? '' : ' is-active'}`}
        onClick={() => onActive(false)}
        aria-pressed={!active}
        title="Cursor"
        aria-label="Cursor"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5.5 3.2v12.6l3.2-3.1 2.2 4.9 2.1-.9-2.2-4.8h4.5z" />
        </svg>
      </button>

      <button
        type="button"
        className={`bd-draw__btn${active ? ' is-active' : ''}`}
        onClick={() => onActive(true)}
        aria-pressed={active}
        title="Draw"
        aria-label="Brush"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M14.2 2.8l3 3-8.6 8.6-3.6.6.6-3.6z" />
          <path d="M12.2 4.8l3 3" />
          <path d="M3 17.5c1.6.4 3.2-.2 4-1.6" />
        </svg>
      </button>

      <div className="bd-draw__item">
        <button
          type="button"
          className={`bd-draw__btn${menu === 'color' ? ' is-open' : ''}`}
          onClick={() => toggle('color')}
          title="Colour"
          aria-label="Colour"
          aria-expanded={menu === 'color'}
        >
          <span className="bd-draw__swatch" style={{ background: tool.color }} />
        </button>
        {menu === 'color' ? (
          <div className="bd-draw__menu bd-draw__menu--colors">
            {INK_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                className={`bd-draw__color${tool.color.toLowerCase() === color ? ' is-active' : ''}`}
                style={{ background: color }}
                onClick={() => {
                  onTool({ ...tool, color });
                  onActive(true);
                  setMenu(null);
                }}
                aria-label={color}
              />
            ))}
            <label className="bd-draw__custom" title="Custom colour">
              <input
                type="color"
                value={tool.color}
                onChange={(event) => {
                  onTool({ ...tool, color: event.target.value });
                  onActive(true);
                }}
                aria-label="Custom colour"
              />
              <span aria-hidden="true">+</span>
            </label>
          </div>
        ) : null}
      </div>

      <div className="bd-draw__item">
        <button
          type="button"
          className={`bd-draw__btn${menu === 'width' ? ' is-open' : ''}`}
          onClick={() => toggle('width')}
          title="Line width"
          aria-label={`Line width, ${tool.width}px`}
          aria-expanded={menu === 'width'}
        >
          <span className="bd-draw__line" style={{ height: tool.width }} />
          <span className="bd-draw__px">{tool.width}px</span>
        </button>
        {menu === 'width' ? (
          <div className="bd-draw__menu bd-draw__menu--widths">
            {INK_WIDTHS.map((width) => (
              <button
                key={width}
                type="button"
                className={`bd-draw__width${tool.width === width ? ' is-active' : ''}`}
                onClick={() => {
                  onTool({ ...tool, width });
                  onActive(true);
                  setMenu(null);
                }}
              >
                <span className="bd-draw__line" style={{ height: width }} />
                <span>{width}px</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <span className="bd-draw__sep" aria-hidden="true" />

      <div className="bd-draw__item">
        <button
          type="button"
          className={`bd-draw__btn bd-draw__clear${menu === 'clear' ? ' is-open' : ''}`}
          onClick={() => toggle('clear')}
          disabled={!hasDrawings && !(onClearPhotos && hasPhotos)}
          title="Delete…"
          aria-label="Delete…"
          aria-expanded={menu === 'clear'}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M3.5 5.5h13M8 5.5V3.8h4v1.7M5.2 5.5l.8 11h8l.8-11M8.5 8.5v5M11.5 8.5v5" />
          </svg>
        </button>
        {menu === 'clear' ? (
          <div className="bd-draw__menu bd-draw__menu--clear">
            <button
              type="button"
              className="bd-draw__danger"
              disabled={!hasDrawings}
              onClick={() => {
                onClearDrawings();
                setMenu(null);
              }}
            >
              Delete all drawings
            </button>
            {onClearPhotos ? (
              <button
                type="button"
                className="bd-draw__danger"
                disabled={!hasPhotos}
                onClick={() => {
                  onClearPhotos();
                  setMenu(null);
                }}
              >
                Delete all photos
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
