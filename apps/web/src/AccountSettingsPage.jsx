import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, getApiErrorMessage } from "./api";
import "./account-settings.css";

export default function AccountSettingsPage({ currentUser, onRefreshCurrentUser }) {
  const [searchParams] = useSearchParams();
  const [googleMailStatus, setGoogleMailStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    // Verificar si el usuario acaba de conectar Google
    const googleConnected = searchParams.get("googleConnected");
    if (googleConnected === "true") {
      setMessage("Tu cuenta de Google ha sido conectada correctamente.");
      window.history.replaceState({}, document.title, window.location.pathname);
      // Limpiar el mensaje después de 5 segundos
      const timeout = setTimeout(() => setMessage(""), 5000);
      return () => clearTimeout(timeout);
    }
    
    loadGoogleMailStatus();
  }, [searchParams]);

  async function loadGoogleMailStatus() {
    try {
      setIsLoading(true);
      const { data } = await api.get("/api/auth/google-mail/status");
      setGoogleMailStatus(data);
      setError("");
    } catch (err) {
      setError(getApiErrorMessage(err));
      setGoogleMailStatus(null);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleConnectGoogle() {
    try {
      setIsConnecting(true);
      const returnTo = encodeURIComponent("/account-settings?googleConnected=true");
      const { data } = await api.get(
        `/api/auth/google-mail/start?mode=json&returnTo=${returnTo}`
      );
      const startUrl = String(data?.url || data?.startUrl || "").trim();
      if (!startUrl) {
        setError("No se pudo obtener la URL de autenticación");
        return;
      }
      // Redirigir a Google OAuth
      window.location.href = startUrl;
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleDisconnectGoogle() {
    if (!confirm("¿Estás seguro de que deseas desconectar tu cuenta de Google? Ya no podrás enviar correos desde tus registros.")) {
      return;
    }

    try {
      setIsDisconnecting(true);
      setError("");
      await api.post("/api/auth/google-mail/disconnect");
      setMessage("Tu cuenta de Google ha sido desconectada correctamente.");
      await loadGoogleMailStatus();
      await onRefreshCurrentUser?.();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsDisconnecting(false);
    }
  }

  const isGoogleConnected = Boolean(
    googleMailStatus?.connected
  );
  const lastError = googleMailStatus?.lastError;
  const errorCode = googleMailStatus?.lastErrorCode || googleMailStatus?.needsReconnect
    ? "Necesita reconectar"
    : null;

  return (
    <div className="account-settings-page">
      <div className="page-header">
        <h1>Configuración de Cuenta</h1>
        <p>Gestiona tus conexiones y preferencias de correo electrónico</p>
      </div>

      <div className="settings-container">
        {/* Información del Usuario */}
        <section className="settings-section">
          <h2>Información Personal</h2>
          <div className="settings-grid">
            <div className="setting-item">
              <label>Nombre</label>
              <div className="setting-value">{currentUser?.full_name || "-"}</div>
            </div>
            <div className="setting-item">
              <label>Email</label>
              <div className="setting-value">{currentUser?.email || "-"}</div>
            </div>
          </div>
        </section>

        {/* Google Mail Connection */}
        <section className="settings-section">
          <h2>Conexión con Google Mail</h2>
          <p className="settings-description">
            Conecta tu cuenta de Google para enviar confirmaciones y correos directamente desde tu email.
          </p>

          {error && <div className="settings-error">{error}</div>}
          {message && <div className="settings-success">{message}</div>}

          {isLoading ? (
            <div className="settings-loading">Cargando estado de conexión...</div>
          ) : (
            <div className="google-mail-status">
              <div className="status-card">
                <div className="status-header">
                  <div className="status-indicator">
                    <span
                      className={`status-dot ${
                        isGoogleConnected ? "status-connected" : "status-disconnected"
                      }`}
                    />
                    <span className="status-text">
                      {isGoogleConnected ? "Conectado" : "No conectado"}
                    </span>
                  </div>
                </div>

                {isGoogleConnected && (
                  <div className="status-details">
                    <div className="detail-row">
                      <label>Email de Google:</label>
                      <span>{googleMailStatus?.googleEmail || "-"}</span>
                    </div>
                    {googleMailStatus?.lastConnectedAt && (
                      <div className="detail-row">
                        <label>Conectado desde:</label>
                        <span>
                          {new Date(googleMailStatus.lastConnectedAt).toLocaleDateString(
                            "es-MX",
                            {
                              year: "numeric",
                              month: "long",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            }
                          )}
                        </span>
                      </div>
                    )}
                    {googleMailStatus?.missingScope && (
                      <div className="detail-row error">
                        <label>Permisos:</label>
                        <span>Permisos insuficientes - Reconectar requerido</span>
                      </div>
                    )}
                    {googleMailStatus?.needsReconnect && (
                      <div className="detail-row error">
                        <label>Estado:</label>
                        <span>Se requiere reconectar la cuenta</span>
                      </div>
                    )}
                  </div>
                )}

                <div className="status-actions">
                  {!isGoogleConnected ? (
                    <button
                      className="btn btn-primary"
                      onClick={handleConnectGoogle}
                      disabled={isConnecting}
                    >
                      {isConnecting ? "Conectando..." : "Conectar Google Mail"}
                    </button>
                  ) : (
                    <>
                      {googleMailStatus?.needsReconnect && (
                        <button
                          className="btn btn-warning"
                          onClick={handleConnectGoogle}
                          disabled={isConnecting}
                        >
                          {isConnecting ? "Reconectando..." : "Reconectar Google"}
                        </button>
                      )}
                      <button
                        className="btn btn-danger"
                        onClick={handleDisconnectGoogle}
                        disabled={isDisconnecting}
                      >
                        {isDisconnecting ? "Desconectando..." : "Desconectar Google Mail"}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {isGoogleConnected && (
                <div className="status-permissions">
                  <h3>Permisos Autorizados</h3>
                  <ul>
                    <li>✓ Enviar correos desde tu cuenta de Google</li>
                    <li>✓ Acceder a tu información de email</li>
                  </ul>
                  <p className="permissions-note">
                    Puedes revocar estos permisos en cualquier momento haciendo clic en el botón
                    "Desconectar Google Mail" o directamente en tu cuenta de Google.
                  </p>
                </div>
              )}

              <div className="status-info">
                <h3>¿Por qué conectar Google Mail?</h3>
                <ul>
                  <li>Enviar confirmaciones de registro desde tus landing pages</li>
                  <li>Respuestas a los correos que lleguen directamente a tu buzón</li>
                  <li>Control total sobre tus comunicaciones con clientes</li>
                </ul>
              </div>
            </div>
          )}
        </section>

        {/* Seguridad */}
        <section className="settings-section">
          <h2>Seguridad</h2>
          <p className="settings-description">
            Tu cuenta está protegida con los siguientes mecanismos de seguridad:
          </p>
          <ul className="security-features">
            <li>✓ Autenticación con token JWT encriptado</li>
            <li>✓ Contraseña segura y encriptada</li>
            <li>✓ Auditoría de acciones (cuando está configurada)</li>
            <li>✓ Conexiones OAuth2 encriptadas</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
