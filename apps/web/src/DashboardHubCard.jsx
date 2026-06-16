import { Link } from "react-router-dom";

export default function DashboardHubCard({
  badge,
  title,
  description,
  to,
  cta = "Abrir",
  meta,
  tone = "default",
}) {
  const body = (
    <>
      {badge ? <span className="dashboard-hub-card-badge">{badge}</span> : null}
      <strong>{title}</strong>
      <p>{description}</p>
      <div className="dashboard-hub-card-footer">
        {meta ? <span className="dashboard-hub-card-meta">{meta}</span> : <span />}
        {to ? <span className="dashboard-hub-card-cta">{cta}</span> : null}
      </div>
    </>
  );

  if (!to) {
    return <article className={`dashboard-hub-card is-${tone}`}>{body}</article>;
  }

  return (
    <Link to={to} className={`dashboard-hub-card is-${tone}`}>
      {body}
    </Link>
  );
}
