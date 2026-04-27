import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import QuotationPrintDocument from "./quotations/QuotationPrintDocument";
import {
  deleteQuotationPrintJob,
  readQuotationPrintJob,
} from "./quotations/quotationPrintStorage";
import "./quotations/quotation-print.css";

function getQuotationPrintPageTitle(model) {
  const proposalName = String(model?.header?.proposalName || "").trim();
  return proposalName
    ? `Vista previa - ${proposalName}`
    : "Vista previa de cotizacion";
}

export default function QuotationPrintPage() {
  const [searchParams] = useSearchParams();
  const jobId = searchParams.get("job") || "";
  const model = useMemo(() => readQuotationPrintJob(jobId), [jobId]);

  const disposePrintJob = useCallback(() => {
    deleteQuotationPrintJob(jobId);
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
    document.title = getQuotationPrintPageTitle(model);

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

  if (!model) {
    return (
      <main className="quotation-print-page quotation-print-page-empty">
        <section className="quotation-print-page-status-card">
          <h1>No fue posible preparar la impresion</h1>
          <p>
            El documento ya no esta disponible. Regresa a la cotizacion y vuelve
            a intentar.
          </p>
          <div className="quotation-print-page-toolbar">
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
    <main className="quotation-print-page">
      <div className="quotation-print-page-toolbar screen-only">
        <span className="quotation-print-page-preview-label">
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

      <div className="quotation-print-page-shell">
        <QuotationPrintDocument model={model} />
      </div>
    </main>
  );
}
