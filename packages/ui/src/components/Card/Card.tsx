import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../../utils/cx";
import "./Card.css";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padded?: boolean;
}

/** PC-08 core set — surface container. Composes with CardHeader/CardFooter
 * slots below; plain children are enough for the common case. */
export function Card({ children, padded = true, className, ...rest }: CardProps) {
  return (
    <div className={cx("ps-card", padded && "ps-card--padded", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("ps-card__header", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("ps-card__footer", className)} {...rest}>
      {children}
    </div>
  );
}
