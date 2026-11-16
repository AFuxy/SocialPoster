interface AppLogoProps {
  className?: string;
}

export function AppLogo({ className }: AppLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="80 80 864 864"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect
        x="84"
        y="84"
        width="856"
        height="856"
        rx="205"
        fill="#18181B"
        stroke="#3F3F46"
        strokeWidth="8"
      />
      <polygon points="752,272 272,460 460,536" fill="#FAFAFA" />
      <polygon points="752,272 488,564 564,752" fill="#FAFAFA" />
      <polygon points="752,272 460,536 488,564" fill="#A1A1AA" />
    </svg>
  );
}
