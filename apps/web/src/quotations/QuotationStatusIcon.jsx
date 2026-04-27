import { getQuotationStatusUiKey } from "./quotationStatusPresentation";

function QuotationStatusIcon({ status }) {
  const uiKey = getQuotationStatusUiKey(status);

  if (uiKey === "draft") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="m4 20 4-.8 9.8-9.8a1.8 1.8 0 0 0 0-2.6l-.6-.6a1.8 1.8 0 0 0-2.6 0L4.8 16 4 20Z" />
        <path d="m13.5 7.5 3 3" />
      </svg>
    );
  }

  if (uiKey === "pending") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v5" />
        <path d="m12 12 3 2" />
      </svg>
    );
  }

  if (uiKey === "approved" || uiKey === "accepted") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="m5 12 4 4L19 6" />
      </svg>
    );
  }

  if (uiKey === "sent") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M4 12h13" />
        <path d="m12 5 7 7-7 7" />
      </svg>
    );
  }

  if (uiKey === "won") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M8 21h8" />
        <path d="M12 17v4" />
        <path d="M7 4h10v3a5 5 0 0 1-10 0V4Z" />
        <path d="M7 6H5a2 2 0 0 0 2 2" />
        <path d="M17 6h2a2 2 0 0 1-2 2" />
      </svg>
    );
  }

  if (uiKey === "rejected") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="8" />
        <path d="m9 9 6 6" />
        <path d="m15 9-6 6" />
      </svg>
    );
  }

  if (uiKey === "lost") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M6 6 18 18" />
        <path d="M18 6 6 18" />
      </svg>
    );
  }

  if (uiKey === "cancelled" || uiKey === "canceled" || uiKey === "inactive") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="8" />
        <path d="M8 12h8" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

export default QuotationStatusIcon;
