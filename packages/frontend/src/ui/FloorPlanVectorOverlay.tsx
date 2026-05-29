import type { Room, Wall } from '@he/shared';

/**
 * SVG overlay that renders a floor's walls + rooms inside the existing
 * `.floor-plan` container (G12).
 *
 * The SVG uses `viewBox="0 0 10000 10000" preserveAspectRatio="none"` so
 * it stretches to fill whatever aspect ratio the underlay enforces (image
 * or 1:1 default). This means walls + rooms visually distort when the
 * underlay changes aspect — the same trade-off the pin coords accept. See
 * CLAUDE.md.
 *
 * Read-only: tap handlers / endpoint dragging / corner dragging are layered
 * by callers via a separate interactive SVG above this one.
 *
 * Room labels render as SVG `<text>` centered in the rectangle. The
 * font-size is in viewbox units (300 = ~3% of canvas), which scales with
 * zoom — the standard SVG approach. Don't try to do per-zoom px sizing.
 */
export type FloorPlanVectorOverlayProps = {
  walls: readonly Wall[];
  rooms?: readonly Room[];
  selectedWallId?: string | null;
  selectedRoomId?: string | null;
  ghostWall?: { x1: number; y1: number; x2: number; y2: number } | null;
  ghostRoom?: { x: number; y: number; w: number; h: number } | null;
  /** Optional SVG transform attribute to apply to the geometry group —
   *  used by the G15 desktop canvas to pan + zoom. Units are viewbox
   *  units (0-10000), not pixels. See useViewport. */
  transform?: string;
};

export const FloorPlanVectorOverlay = ({
  walls,
  rooms = [],
  selectedWallId,
  selectedRoomId,
  ghostWall,
  ghostRoom,
  transform,
}: FloorPlanVectorOverlayProps): JSX.Element => {
  const content = (
    <>
      {/* Rooms render BEHIND walls so wall strokes stay crisp on top of
         room fills. Labels render inside their room <g> at the center. */}
      {rooms.map((r) => {
        // Label sits at the bbox center (cheap + stable for both rectangles
        // and arbitrary wall-loop polygons). The shape itself is the polygon.
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        const isSelected = selectedRoomId === r.id;
        const ptStr = r.points.map((p) => `${p.x},${p.y}`).join(' ');
        return (
          <g
            key={r.id}
            className={isSelected ? 'floor-plan__room floor-plan__room--selected' : 'floor-plan__room'}
          >
            <polygon points={ptStr} className="floor-plan__room-rect" />
            {/* Center text label — SVG <text> scales with the viewbox.
             *  Font-size + letter-spacing live in styles.css; mobile shrinks
             *  the font further so long names fit in narrow rooms. */}
            <text
              x={cx}
              y={cy}
              className="floor-plan__room-label"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {r.name}
            </text>
          </g>
        );
      })}
      {ghostRoom && (
        <rect
          x={ghostRoom.x}
          y={ghostRoom.y}
          width={ghostRoom.w}
          height={ghostRoom.h}
          className="floor-plan__room-rect floor-plan__room-rect--ghost"
        />
      )}
      {walls.map((w) => (
        <line
          key={w.id}
          x1={w.x1}
          y1={w.y1}
          x2={w.x2}
          y2={w.y2}
          className={
            selectedWallId === w.id
              ? 'floor-plan__wall floor-plan__wall--selected'
              : 'floor-plan__wall'
          }
        />
      ))}
      {ghostWall && (
        <line
          x1={ghostWall.x1}
          y1={ghostWall.y1}
          x2={ghostWall.x2}
          y2={ghostWall.y2}
          className="floor-plan__wall floor-plan__wall--ghost"
        />
      )}
    </>
  );
  return (
    <svg
      className="floor-plan__vector"
      viewBox="0 0 10000 10000"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {transform !== undefined ? <g transform={transform}>{content}</g> : content}
    </svg>
  );
};
