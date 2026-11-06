import { useRef, useState } from "react";
import { api, getApiErrorMessage } from "./api";

export function useInvoiceExchangeRate() {
  const [currency, setCurrency] = useState("USD");
  const [value, setValue] = useState("1");
  const [source, setSource] = useState("manual");
  const [rateDate, setRateDate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  async function load(targetCurrency = currency) {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/api/quotation-invoices/exchange-rate", {
        params: { currency: targetCurrency },
      });
      if (sequence !== requestSequence.current) return;
      const rate = Number(data?.exchangeRate);
      if (data?.baseCurrency !== "USD" || data?.targetCurrency !== targetCurrency ||
          !Number.isFinite(rate) || rate <= 0) {
        throw new Error("La tasa recibida no es valida");
      }
      setValue(String(Number(rate.toFixed(8))));
      setSource("suggested");
      setRateDate(data.rateDate || null);
    } catch (requestError) {
      if (sequence !== requestSequence.current) return;
      setError(getApiErrorMessage(requestError, "No fue posible consultar la ultima tasa disponible. Ingresa el tipo de cambio manualmente."));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }

  function initialize(nextCurrency, stored = null) {
    ++requestSequence.current;
    setCurrency(nextCurrency);
    setLoading(false);
    setError("");
    setSource(stored?.exchangeRateSource || "manual");
    setRateDate(stored?.exchangeRateDate || null);
    setValue(nextCurrency === "USD" ? "1" : stored?.exchangeRate == null ? "" : String(stored.exchangeRate));
    if (nextCurrency && nextCurrency !== "USD" && stored?.exchangeRate == null) void load(nextCurrency);
  }

  function change(nextValue) {
    ++requestSequence.current;
    setLoading(false);
    setValue(nextValue);
    setSource("manual");
    setRateDate(null);
    setError("");
  }

  const number = Number(value);
  const valid = /^[A-Z]{3}$/.test(currency) && value.trim() !== "" && Number.isFinite(number) &&
    number >= 0.00000001 && number < 1e12 &&
    Number(number.toFixed(8)) === number && (currency !== "USD" || number === 1);
  return {
    currency, value, source, rateDate, loading, error, valid, load, initialize, change,
    payload: { currencyCode: currency, exchangeRate: number, exchangeRateSource: source, exchangeRateDate: rateDate },
  };
}
