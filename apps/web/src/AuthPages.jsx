import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api, getApiErrorMessage } from "./api";

export function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { data } = await api.post("/api/auth/login", { email, password });
      onLogin(data.token);
    } catch (err) {
      setError(getApiErrorMessage(err, "No fue posible iniciar sesion"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h2>Iniciar sesion</h2>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-mail"
          required
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="Contraseña"
          required
        />
        {error && <p className="error">{error}</p>}
        <button disabled={saving}>{saving ? "Ingresando..." : "Entrar"}</button>
      </form>
    </section>
  );
}

export function FirstUserSetup({ onDone }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mobile, setMobile] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const { data } = await api.post("/api/auth/register-first", {
        fullName,
        email,
        password,
        mobile,
      });
      onDone(data.token);
    } catch (err) {
      setError(
        getApiErrorMessage(
          err,
          "No fue posible crear el administrador inicial",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <h2>Configurar primer Administrador</h2>
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Nombres y Apellidos"
          required
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-mail"
          type="email"
          required
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña"
          type="password"
          required
        />
        <input
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          placeholder="Movil"
        />
        {error && <p className="error">{error}</p>}
        <button disabled={saving}>
          {saving ? "Creando..." : "Crear administrador"}
        </button>
      </form>
    </section>
  );
}

export function SetPasswordPage({ onDone }) {
  const location = useLocation();
  const navigate = useNavigate();
  const setupToken = new URLSearchParams(location.search).get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [contextLoading, setContextLoading] = useState(true);
  const [inviteContext, setInviteContext] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState("");

  const passwordChecks = useMemo(
    () => ({
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /\d/.test(password),
    }),
    [password],
  );

  const completedChecks = Object.values(passwordChecks).filter(Boolean).length;
  const passwordStrength =
    completedChecks <= 1
      ? { label: "Debil", tone: "weak" }
      : completedChecks <= 3
        ? { label: "Media", tone: "medium" }
        : { label: "Fuerte", tone: "strong" };
  const passwordsMatch =
    confirmPassword.length > 0 && password === confirmPassword;
  const formattedInviteExpiration = inviteContext?.expiresAt
    ? new Intl.DateTimeFormat("es-MX", {
        dateStyle: "long",
        timeStyle: "short",
      }).format(new Date(inviteContext.expiresAt))
    : "";
  const canSubmit =
    !contextLoading &&
    !saving &&
    Boolean(setupToken) &&
    completedChecks === 4 &&
    password.length > 0 &&
    password === confirmPassword;

  useEffect(() => {
    let cancelled = false;

    async function loadContext() {
      if (!setupToken) {
        setInviteContext(null);
        setContextLoading(false);
        setError("El enlace no es válido o está incompleto.");
        return;
      }

      setContextLoading(true);
      setError("");

      try {
        const { data } = await api.get("/api/auth/set-password-context", {
          params: { token: setupToken },
        });

        if (cancelled) return;
        setInviteContext(data);
      } catch (err) {
        if (cancelled) return;
        setInviteContext(null);
        setError(getApiErrorMessage(err, "No fue posible validar el enlace"));
      } finally {
        if (!cancelled) {
          setContextLoading(false);
        }
      }
    }

    loadContext();

    return () => {
      cancelled = true;
    };
  }, [setupToken]);

  useEffect(() => {
    if (!success) return undefined;

    const timeoutId = window.setTimeout(() => {
      navigate("/", { replace: true });
    }, 1400);

    return () => window.clearTimeout(timeoutId);
  }, [navigate, success]);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    if (password !== confirmPassword) {
      setSaving(false);
      setError("Las contraseñas no coinciden");
      return;
    }

    try {
      const { data } = await api.post("/api/auth/set-password", {
        token: setupToken,
        password,
      });
      setSuccess(data?.message || "Contraseña configurada correctamente");
      onDone(data.token);
    } catch (err) {
      setError(
        getApiErrorMessage(err, "No fue posible configurar la contraseña"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="auth-wrap auth-wrap-password">
      <div className="password-setup-shell">
        <aside className="password-setup-hero">
          <p className="password-setup-eyebrow">Acceso seguro</p>
          <h1>Activa tu cuenta con una contraseña clara y fuerte.</h1>
          <p className="password-setup-copy">
            Este paso deja tu acceso listo. Usa una contraseña fácil de recordar
            para ti y dificil de adivinar para otros.
          </p>
          <div className="password-setup-points">
            <div className="password-setup-point">
              <strong>Más rápido</strong>
              <span>
                Ve al grano con un formulario corto y una guia visual inmediata.
              </span>
            </div>
            <div className="password-setup-point">
              <strong>Más claro</strong>
              <span>Revisamos en vivo los requisitos antes de enviar.</span>
            </div>
            <div className="password-setup-point">
              <strong>Más seguro</strong>
              <span>
                La fortaleza de la contraseña se muestra mientras escribes.
              </span>
            </div>
          </div>
        </aside>

        <form className="auth-card password-setup-card" onSubmit={submit}>
          <div className="password-setup-header">
            <h2>Configurar contraseña</h2>
            <p className="auth-copy">
              Define la contraseña con la que vas a entrar al sistema y te
              redirigiremos al dashboard.
            </p>
          </div>

          {contextLoading ? (
            <div className="password-setup-context-card is-loading">
              <strong>Validando enlace...</strong>
              <span>Estamos comprobando que el acceso siga vigente.</span>
            </div>
          ) : inviteContext ? (
            <div className="password-setup-context-card">
              <strong>{inviteContext.fullName}</strong>
              <span>{inviteContext.email}</span>
              <p>
                Este enlace corresponde a una
                {inviteContext.purpose === "reset"
                  ? " recuperacion"
                  : " activacion"}
                de acceso.
              </p>
              {formattedInviteExpiration ? (
                <p className="password-setup-expiration">
                  Vigente hasta el {formattedInviteExpiration}.
                </p>
              ) : null}
            </div>
          ) : null}

          <label className="auth-field">
            <span>Nueva contraseña</span>
            <div className="password-input-wrap">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Crea una contraseña segura"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button
                className="password-toggle"
                type="button"
                onClick={() => setShowPassword((current) => !current)}
              >
                {showPassword ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </label>

          <div className="password-strength-box">
            <div className="password-strength-head">
              <span>Fortaleza</span>
              <strong
                className={`strength-pill strength-pill-${passwordStrength.tone}`}
              >
                {passwordStrength.label}
              </strong>
            </div>
            <div className="password-strength-track" aria-hidden="true">
              <span
                className={`password-strength-fill password-strength-fill-${passwordStrength.tone}`}
                style={{ width: `${(completedChecks / 4) * 100}%` }}
              />
            </div>
            <div className="password-checklist">
              <p className={passwordChecks.length ? "is-valid" : ""}>
                Minimo 8 caracteres
              </p>
              <p className={passwordChecks.uppercase ? "is-valid" : ""}>
                Al menos una mayuscula
              </p>
              <p className={passwordChecks.lowercase ? "is-valid" : ""}>
                Al menos una minuscula
              </p>
              <p className={passwordChecks.number ? "is-valid" : ""}>
                Al menos un numero
              </p>
            </div>
          </div>

          <label className="auth-field">
            <span>Confirmar contraseña</span>
            <div className="password-input-wrap">
              <input
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repite tu contraseña"
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <button
                className="password-toggle"
                type="button"
                onClick={() => setShowConfirmPassword((current) => !current)}
              >
                {showConfirmPassword ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </label>

          <p
            className={`password-match ${
              confirmPassword.length === 0
                ? ""
                : passwordsMatch
                  ? "is-valid"
                  : "is-invalid"
            }`}
          >
            {confirmPassword.length === 0
              ? "Confirma la contraseña para validar que coincide."
              : passwordsMatch
                ? "Las contraseñas coinciden."
                : "Las contraseñas no coinciden."}
          </p>

          {error && <p className="error">{error}</p>}
          {success && (
            <p className="success-inline">
              {success}. Redirigiendo al dashboard...
            </p>
          )}

          <button disabled={!canSubmit}>
            {saving ? "Guardando..." : "Guardar contraseña"}
          </button>

          <p className="auth-hint password-setup-note">
            Cuando guardes, tu sesion quedara lista y entraras directo al
            sistema.
          </p>
        </form>
      </div>
    </section>
  );
}