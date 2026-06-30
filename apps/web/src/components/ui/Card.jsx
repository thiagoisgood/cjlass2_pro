import React from "react";

export function Card({ children, className = "", ...props }) {
  return (
    <div className={`panel ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "", ...props }) {
  return (
    <div className={`panel-title ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className = "", ...props }) {
  return (
    <h2 className={`${className}`.trim()} {...props}>
      {children}
    </h2>
  );
}

export function CardContent({ children, className = "", ...props }) {
  return (
    <div className={`${className}`.trim()} {...props}>
      {children}
    </div>
  );
}
