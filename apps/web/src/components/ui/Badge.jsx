import React from "react";

export function Badge({ children, tone = "gray", className = "", ...props }) {
  return (
    <span className={`status-pill tone-${tone} ${className}`.trim()} {...props}>
      {children}
    </span>
  );
}
