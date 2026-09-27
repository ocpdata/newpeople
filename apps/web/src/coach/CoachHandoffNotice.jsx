import { useState } from "react";

export function CoachHandoffNotice({ token, handoff, loading, error, cancel }) {
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");

  if (!token) return null;

  async function handleDiscard() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Se descartará este borrador del Coach. Los datos que ya hayas guardado en el módulo no se eliminarán. ¿Quieres continuar?",
      )
    ) {
      return;
    }
    setCancelling(true);
    setCancelError("");
    try {
      await cancel("Descartado por el vendedor desde el módulo de destino");
    } catch (requestError) {
      setCancelError(
        requestError?.response?.data?.message ||
          "No fue posible descartar el borrador del Coach",
      );
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div
      className={`toast ${error || cancelError ? "toast-error" : "toast-success"}`}
    >
      <span>
        {loading
          ? "Recuperando borrador del Coach..."
          : error ||
            cancelError ||
            (handoff
              ? "Borrador del Coach cargado. Revisa y guarda en este módulo."
              : "Borrador del Coach procesado.")}
      </span>
      {handoff ? (
        <button
          type="button"
          className="btn-secondary"
          disabled={cancelling}
          onClick={handleDiscard}
        >
          {cancelling ? "Descartando..." : "Descartar borrador"}
        </button>
      ) : null}
    </div>
  );
}
