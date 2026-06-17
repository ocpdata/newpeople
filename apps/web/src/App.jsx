import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, setAuthToken } from "./api";
import { FirstUserSetup, LoginPage, SetPasswordPage } from "./AuthPages";
import AppShell from "./AppShell";
import { HelpProvider } from "./help/HelpProvider";
import { BusinessTimezoneProvider } from "./business-timezone";

const OAUTH_ERROR_MESSAGES = {
  google_disabled: "El acceso con Google no esta habilitado en este entorno.",
  oauth_start_failed: "No fue posible iniciar el acceso con Google.",
  google_denied: "Se cancelo el acceso con Google.",
  google_invalid_callback: "La respuesta de Google es invalida o incompleta.",
  google_invalid_state:
    "No fue posible validar la sesion de acceso con Google.",
  google_email_missing: "Google no devolvio un correo utilizable.",
  google_user_not_found:
    "Tu correo de Google no esta registrado en NewPeople. Solicita acceso al administrador.",
  google_user_inactive: "Tu usuario esta inactivo. Contacta al administrador.",
  google_callback_failed: "No fue posible completar el acceso con Google.",
  oauth_failed: "No fue posible iniciar sesion con Google.",
};

function App() {
  const location = useLocation();
  const tokenRef = useRef("");
  const [loading, setLoading] = useState(true);
  const [hasUsers, setHasUsers] = useState(true);
  const [token, setToken] = useState(localStorage.getItem("crm_token") || "");
  const [currentUser, setCurrentUser] = useState(null);
  const [oauthError, setOauthError] = useState("");

  useEffect(() => {
    boot();
  }, []);

  useEffect(() => {
    tokenRef.current = token;
    setAuthToken(token);
    if (token) {
      localStorage.setItem("crm_token", token);
      void fetchMe(token);
    } else {
      localStorage.removeItem("crm_token");
    }
  }, [token]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const oauthToken = params.get("oauthToken") || "";
    const oauthErrorCode = params.get("oauthError") || "";

    if (oauthToken) {
      setOauthError("");
      setToken(oauthToken);
      params.delete("oauthToken");
      const nextQuery = params.toString();
      const nextUrl = `${location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
      window.history.replaceState({}, "", nextUrl);
      return;
    }

    if (oauthErrorCode) {
      setOauthError(
        OAUTH_ERROR_MESSAGES[oauthErrorCode] ||
          OAUTH_ERROR_MESSAGES.oauth_failed,
      );
      params.delete("oauthError");
      const nextQuery = params.toString();
      const nextUrl = `${location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
      window.history.replaceState({}, "", nextUrl);
    }
  }, [location.pathname, location.search]);

  async function boot() {
    try {
      const { data } = await api.get("/api/auth/bootstrap-status");
      setHasUsers(data.hasUsers);
    } catch {
      setHasUsers(true);
    } finally {
      setLoading(false);
    }
  }

  async function fetchMe(tokenAtRequestStart = tokenRef.current) {
    try {
      const { data } = await api.get("/api/auth/me");
      if (tokenRef.current !== tokenAtRequestStart) {
        return;
      }
      setCurrentUser(data);
    } catch {
      if (tokenRef.current !== tokenAtRequestStart) {
        return;
      }
      setCurrentUser(null);
      setToken("");
    }
  }

  if (location.pathname === "/set-password") {
    return <SetPasswordPage onDone={setToken} />;
  }

  if (loading) {
    return <div className="centered">Cargando...</div>;
  }

  if (!hasUsers) {
    return (
      <FirstUserSetup
        onDone={(nextToken) => {
          setHasUsers(true);
          setToken(nextToken);
        }}
      />
    );
  }

  if (!token) {
    return <LoginPage onLogin={setToken} initialError={oauthError} />;
  }

  if (!currentUser) {
    return <div className="centered">Cargando...</div>;
  }

  return (
    <BusinessTimezoneProvider initialTimezone={currentUser.businessTimezone}>
      <HelpProvider currentUser={currentUser}>
        <AppShell
          currentUser={currentUser}
          token={token}
          onLogout={() => {
            setCurrentUser(null);
            setToken("");
          }}
          onRefreshCurrentUser={fetchMe}
        />
      </HelpProvider>
    </BusinessTimezoneProvider>
  );
}

export default App;
