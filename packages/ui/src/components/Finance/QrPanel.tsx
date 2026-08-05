import type { ReactNode } from "react";
import qrcode from "qrcode-generator";
import { cx } from "../../utils/cx";
import { Icon } from "../../icons";
import { Ltr } from "../Data/Ltr";

export interface QrPanelProps {
  /** The ZATCA Phase-2 TLV payload, base64, exactly as `credit.invoices.qr_tlv`
   * holds it. Null until the invoice has been cleared. */
  payload: string | null;
  /** `zatca_uuid`. The text alternative, and the reason this panel is not
   * just a picture: an invoice's clearance identity has to be readable,
   * selectable, searchable and printable, not only scannable. */
  uuid: string | null;
  title: string;
  /** What the code is for, in words. */
  hint: ReactNode;
  uuidLabel: string;
  /** Introduces the text alternative — "if the code cannot be scanned". */
  altLabel: string;
  /** Shown instead of everything else when there is no cleared invoice yet. */
  missingLabel: string;
  /** A `CopyButton`, so the identifier can be quoted to an accountant. */
  copyControl?: ReactNode;
  className?: string;
}

/** How many modules to fit in the drawn square, plus the quiet zone the
 * standard requires on all four sides. Four modules, not "a bit of padding" —
 * a QR without its quiet zone fails to scan against a busy background. */
const QUIET_ZONE = 4;

/**
 * The ZATCA verification QR on a wholesale invoice, with its identifier
 * written out beside it.
 *
 * The code is drawn as inline SVG from the module matrix rather than through
 * the library's own `createSvgTag()`, for two repo-specific reasons: that
 * helper emits an `xmlns` attribute, and `scripts/parity-grep.mjs` fails the
 * build on any URL in a `.tsx` — including an SVG namespace URI; and it
 * returns a string that would have to be dangerouslySetInnerHTML'd, which
 * puts third-party output straight into the DOM for no gain.
 *
 * The text alternative is not a fallback. SP-04 requires it outright, and it
 * is the half that survives a photocopy, a screen reader and a phone call to
 * the finance team.
 */
export function QrPanel({
  payload,
  uuid,
  title,
  hint,
  uuidLabel,
  altLabel,
  missingLabel,
  copyControl,
  className
}: QrPanelProps) {
  const matrix = buildMatrix(payload);

  return (
    <section className={cx("ps-qr", className)}>
      <h3 className="ps-qr__title">{title}</h3>

      {matrix ? (
        <div className="ps-qr__code">
          <svg
            className="ps-qr__svg"
            viewBox={`0 0 ${matrix.size + QUIET_ZONE * 2} ${matrix.size + QUIET_ZONE * 2}`}
            role="img"
            aria-label={title}
            shapeRendering="crispEdges"
          >
            <rect
              className="ps-qr__quiet"
              x="0"
              y="0"
              width={matrix.size + QUIET_ZONE * 2}
              height={matrix.size + QUIET_ZONE * 2}
            />
            <path className="ps-qr__modules" d={matrix.path} />
          </svg>
        </div>
      ) : (
        <p className="ps-qr__missing">
          <Icon name="info" size="sm" />
          <span>{missingLabel}</span>
        </p>
      )}

      <p className="ps-qr__hint">{hint}</p>

      {uuid ? (
        <div className="ps-qr__alt">
          <p className="ps-qr__alt-label">{altLabel}</p>
          <dl className="ps-qr__uuid">
            <dt>{uuidLabel}</dt>
            <dd>
              <Ltr as="code">{uuid}</Ltr>
              {copyControl}
            </dd>
          </dl>
        </div>
      ) : null}
    </section>
  );
}

/** The module matrix as one SVG path — one `<path>` of ~1,000 `M…h1v1h-1z`
 * subpaths beats ~1,000 `<rect>` elements for both parse time and DOM size,
 * and renders identically. */
function buildMatrix(payload: string | null): { size: number; path: string } | null {
  if (!payload) return null;
  try {
    // Error correction M is what ZATCA's own specification calls for, and
    // type 0 lets the library pick the smallest version the payload fits.
    const qr = qrcode(0, "M");
    qr.addData(payload, "Byte");
    qr.make();
    const size = qr.getModuleCount();
    let path = "";
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        if (qr.isDark(row, col)) {
          path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
        }
      }
    }
    return { size, path };
  } catch {
    // A payload too long for even a version-40 symbol throws. A missing code
    // with a written reason beats a half-drawn one that will not scan.
    return null;
  }
}
