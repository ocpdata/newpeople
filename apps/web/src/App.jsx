import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, setAuthToken } from "./api";
import { FirstUserSetup, LoginPage, SetPasswordPage } from "./AuthPages";
import AppShell from "./AppShell";

function App() {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [hasUsers, setHasUsers] = useState(true);
  const [token, setToken] = useState(localStorage.getItem("crm_token") || "");
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    boot();
  }, []);

  useEffect(() => {
    setAuthToken(token);
    if (token) {
      localStorage.setItem("crm_token", token);
      fetchMe();
    } else {
      localStorage.removeItem("crm_token");
      setCurrentUser(null);
    }
  }, [token]);

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

  async function fetchMe() {
    try {
      const { data } = await api.get("/api/auth/me");
      setCurrentUser(data);
    } catch {
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

  if (!token || !currentUser) {
    return <LoginPage onLogin={setToken} />;
  }

  return (
    <AppShell
      currentUser={currentUser}
      token={token}
      onLogout={() => setToken("")}
      onRefreshCurrentUser={fetchMe}
    />
  );
}

export default App;
