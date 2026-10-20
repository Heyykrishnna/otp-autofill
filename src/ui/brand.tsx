export function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </span>
      <span>
        otp<span className="brand-light">autofill</span>
      </span>
    </div>
  )
}

export function Shield() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="m8 12 3 3 5-6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
