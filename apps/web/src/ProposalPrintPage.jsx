import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import ProposalPrintDocument from "./proposals/ProposalPrintDocument";
import {
  deleteProposalPrintJob,
  readProposalPrintJob,
} from "./proposals/proposalPrintStorage";
import "./proposals/proposal-print.css";

function getProposalPrintPageTitle(model) {
  const proposalTitle = String(model?.title || "").trim();
  return proposalTitle
    ? `Vista previa - ${proposalTitle}`
    : "Vista previa de propuesta";
}

export default function ProposalPrintPage() {
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get("job") || "";
  const autoPrint = searchParams.get("autoprint") === "1";
  const model = useMemo(() => readProposalPrintJob(jobId), [jobId]);

  const disposePrintJob = useCallback(() => {
    deleteProposalPrintJob(jobId);
  }, [jobId]);

  const handleClose = useCallback(() => {
    disposePrintJob();
    window.close();
  }, [disposePrintJob]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const previousTitle = document.title;
    document.title = getProposalPrintPageTitle(model);

    return () => {
      document.title = previousTitle;
    };
  }, [model]);

  useEffect(() => {
    if (typeof window === "undefined" || !jobId || !model) {
      return undefined;
    }

    const handleAfterPrint = () => {
      disposePrintJob();
    };

    const handlePageHide = () => {
      disposePrintJob();
    };

    window.addEventListener("afterprint", handleAfterPrint);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("afterprint", handleAfterPrint);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [disposePrintJob, jobId, model]);

  useEffect(() => {
    if (typeof window === "undefined" || !autoPrint || !model) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      window.print();
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [autoPrint, model]);

  if (!model) {
    return (
      <main className="proposal-print-page proposal-print-page-empty">
        <section className="proposal-print-page-status-card">
          <h1>No fue posible preparar la impresion</h1>
          <p>
            El documento ya no esta disponible. Regresa a la propuesta y vuelve
            a intentar.
          </p>
          <div className="proposal-print-page-toolbar">
            <button
              type="button"
              className="btn-secondary"
              onClick={handleClose}
            >
              Cerrar
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="proposal-print-page">
      <div className="proposal-print-page-toolbar screen-only">
        <span className="proposal-print-page-preview-label">
          Vista previa de impresion
        </span>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => window.print()}
        >
          Imprimir
        </button>
        <button type="button" className="btn-secondary" onClick={handleClose}>
          Cerrar
        </button>
      </div>

      <div className="proposal-print-page-shell">
        <ProposalPrintDocument model={model} />
      </div>
    </main>
  );
}
