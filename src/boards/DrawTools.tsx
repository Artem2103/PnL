import { useEffect, useRef, useState } from 'react';
import { INK_COLORS, INK_WIDTHS, type InkTool } from './drawing';

/**
 * The drawing toolbar, down the left edge like TradingView's: the brush (on/off),
 * colour, line width, and "remove all drawings" (two clicks, like every delete here).
 */

interface Props {
  active: boolean;
  onActive(active: boolean): void;
  tool: InkTool;
  onTool(tool: InkTool): void;
  hasDrawings: boolean;
  onClear(): void;
}

export function DrawTools({ active, onActive, tool, onTool, hasDrawings, onClear }: Props) {
  const [menu, setMenu] = useState<'color' | 'width' | null>(null);
  const [armed, setArmed] = useState(false);
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

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);

  const toggle = (which: 'color' | 'width') => setMenu((m) => (m === which ? null : which));

  return (
    <div ref={rootRef} className="bd-draw" role="toolbar" aria-label="Drawing" aria-orientation="vertical">
      <button
        type="button"
        className={`bd-draw__btn${active ? ' is-active' : ''}`}
        onClick={() => onActive(!active)}
        aria-pressed={active}
        title={active ? 'Stop drawing' : 'Draw'}
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

      <button
        type="button"
        className={`bd-draw__btn bd-draw__clear${armed ? ' is-armed' : ''}`}
        onClick={() => {
          if (!armed) {
            setArmed(true);
            return;
          }
          setArmed(false);
          onClear();
        }}
        disabled={!hasDrawings}
        title={armed ? 'Click again to remove all drawings' : 'Remove all drawings'}
        aria-label={armed ? 'Click again to remove all drawings' : 'Remove all drawings'}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M3.5 5.5h13M8 5.5V3.8h4v1.7M5.2 5.5l.8 11h8l.8-11M8.5 8.5v5M11.5 8.5v5" />
        </svg>
        {armed ? <span className="bd-draw__confirm">Remove all?</span> : null}
      </button>
    </div>
  );
}
