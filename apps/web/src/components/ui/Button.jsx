import React from "react";

export function Button({ 
  children, 
  variant = "secondary", 
  size = "default", 
  tone, 
  className = "", 
  disabled, 
  ...props 
}) {
  const baseClass = {
    primary: "primary-button",
    secondary: "secondary-button",
    outline: "primary-outline",
    ghost: "ghost-button",
    link: "link-button",
    field: "field-button",
    icon: "icon-button"
  }[variant] || "secondary-button";

  const sizeClass = size === "compact" ? "compact" : size === "small" ? "small" : "";
  const toneClass = tone === "danger" ? "danger-link" : "";
  
  return (
    <button 
      className={`${baseClass} ${sizeClass} ${toneClass} ${className}`.trim().replace(/\s+/g, " ")} 
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
