import { cx } from "../../utils/cx";
import { ProductThumb } from "./ProductThumb";
import type { ProductFamily } from "../../tokens";

export interface GalleryImage {
  url: string;
  alt: string;
}

export interface GalleryProps {
  images: readonly GalleryImage[];
  /** Drawn when there are no photographs — most of the catalogue. */
  family: ProductFamily;
  grade: string;
  /** Names the group; a datasheet has other lists on it. */
  label: string;
  className?: string;
}

/** The product's pictures on a datasheet.
 *
 * The first image is the large one and the rest sit under it as a strip; no
 * lightbox, no thumbnail-swapping state, because the whole thing has to work
 * as server-rendered HTML and a customer comparing three views of a bottle is
 * served perfectly well by three visible images.
 *
 * With no photographs at all — nineteen of the twenty-three SKUs — it is the
 * family/grade placeholder at full size rather than an empty frame. */
export function Gallery({ images, family, grade, label, className }: GalleryProps) {
  const [lead, ...rest] = images;

  if (!lead) {
    return (
      <div className={cx("ps-gallery", className)}>
        <ProductThumb alt="" family={family} grade={grade} size="lg" />
      </div>
    );
  }

  return (
    <div className={cx("ps-gallery", className)}>
      <div className="ps-gallery__lead">
        <img className="ps-gallery__img" src={lead.url} alt={lead.alt} />
      </div>
      {rest.length > 0 ? (
        <ul className="ps-gallery__strip" aria-label={label}>
          {rest.map((image) => (
            <li className="ps-gallery__item" key={image.url}>
              <img className="ps-gallery__img" src={image.url} alt={image.alt} loading="lazy" />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
