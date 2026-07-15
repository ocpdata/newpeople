import { useEffect, useState } from "react";
import { api, getApiErrorMessage } from "./api";
import "./seller-league-tv.css";

function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    page: Math.max(1, Number(params.get("page")) || 1),
    debug: params.get("debug") === "true",
  };
}

const leadCountFormatter = new Intl.NumberFormat("es-MX", {
  maximumFractionDigits: 0,
});

const usdCurrencyFormatter = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const SELLER_LEAGUE_STAGE_ORDER = {
  contacto_inicial: 1,
  identificacion_oportunidad: 2,
  desarrollo: 3,
  cotizacion: 4,
  demostracion: 5,
  negociacion: 6,
  waiting: 7,
};

const SELLER_LEAGUE_STAGE_PALETTES = {
  contacto_inicial: {
    solid: "#0b6bcb",
    soft: "rgba(11, 107, 203, 0.16)",
    border: "rgba(11, 107, 203, 0.32)",
  },
  identificacion_oportunidad: {
    solid: "#2f9e44",
    soft: "rgba(47, 158, 68, 0.16)",
    border: "rgba(47, 158, 68, 0.32)",
  },
  desarrollo: {
    solid: "#f08c00",
    soft: "rgba(240, 140, 0, 0.16)",
    border: "rgba(240, 140, 0, 0.32)",
  },
  cotizacion: {
    solid: "#a61e4d",
    soft: "rgba(166, 30, 77, 0.16)",
    border: "rgba(166, 30, 77, 0.32)",
  },
  demostracion: {
    solid: "#5f3dc4",
    soft: "rgba(95, 61, 196, 0.16)",
    border: "rgba(95, 61, 196, 0.32)",
  },
  negociacion: {
    solid: "#0f766e",
    soft: "rgba(15, 118, 110, 0.16)",
    border: "rgba(15, 118, 110, 0.32)",
  },
  waiting: {
    solid: "#475569",
    soft: "rgba(71, 85, 105, 0.16)",
    border: "rgba(71, 85, 105, 0.32)",
  },
};

function getSellerLeagueStagePalette(stageCode) {
  return (
    SELLER_LEAGUE_STAGE_PALETTES[String(stageCode || "").trim()] || {
      solid: "#64748b",
      soft: "rgba(100, 116, 139, 0.16)",
      border: "rgba(100, 116, 139, 0.32)",
    }
  );
}

function formatLeadCount(value) {
  const numericValue = Math.round(Number(value || 0));
  return leadCountFormatter.format(numericValue);
}

function formatCurrencyUsd(value) {
  return usdCurrencyFormatter.format(Number(value || 0));
}

function calculateRequiredFunnelAmountUsd(gapAmountUsd, conversionRatio) {
  const numericGapAmountUsd = Number(gapAmountUsd || 0);
  const numericConversionRatio = Number(conversionRatio || 0);

  if (numericGapAmountUsd <= 0 || numericConversionRatio <= 0) {
    return null;
  }

  return numericGapAmountUsd / numericConversionRatio;
}

function formatGaugeValue(value, { divisor = 1, maxFractionDigits = 0 } = {}) {
  const numericValue = Number(value || 0);
  const safeDivisor = Number(divisor) > 0 ? Number(divisor) : 1;
  const scaledValue = numericValue / safeDivisor;
  return new Intl.NumberFormat("es-MX", {
    maximumFractionDigits: Math.max(0, Number(maxFractionDigits || 0)),
  }).format(scaledValue);
}

function LeadGauge({
  actual,
  target,
  maxValue,
  valueDivisor = 1,
  valueMaxFractionDigits = 0,
  valueSuffix = "",
  className = "",
}) {
  const numericTarget = Math.max(0, Number(target || 0));
  const explicitMax = Number(maxValue || 0);
  const referenceMax =
    explicitMax > 0
      ? explicitMax
      : numericTarget > 0
        ? numericTarget / 0.75
        : 0;
  const progressRatio =
    referenceMax > 0
      ? Math.max(0, Math.min(Number(actual || 0) / referenceMax, 1))
      : 0;
  const formatValue = (value) =>
    formatGaugeValue(value, {
      divisor: valueDivisor,
      maxFractionDigits: valueMaxFractionDigits,
    });
  const formattedActual = formatValue(actual);
  const formattedTarget = formatValue(target);
  const formattedMax = formatValue(referenceMax);
  const needleRotation = -90 + progressRatio * 180;
  const targetRatio =
    referenceMax > 0
      ? Math.max(0, Math.min(numericTarget / referenceMax, 1))
      : 0;
  const targetAngle = Math.PI - Math.PI * targetRatio;
  const targetRadius = 80;
  const targetCx = 120 + targetRadius * Math.cos(targetAngle);
  const targetCy = 120 - targetRadius * Math.sin(targetAngle);

  return (
    <div
      className={`seller-league-gauge ${className}`.trim()}
      aria-hidden="true"
    >
      <svg
        className="seller-league-gauge-svg"
        viewBox="0 0 240 180"
        role="presentation"
        focusable="false"
      >
        <defs>
          <linearGradient id="leadGaugeTrack" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#e5e7eb" />
            <stop offset="100%" stopColor="#cbd5e1" />
          </linearGradient>
          <linearGradient id="leadGaugeValue" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#19b7a8" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>

        <path
          d="M 40 120 A 80 80 0 0 1 200 120"
          pathLength="100"
          className="seller-league-gauge-track"
        />
        <path
          d="M 40 120 A 80 80 0 0 1 200 120"
          pathLength="100"
          className="seller-league-gauge-value-arc"
          style={{ strokeDasharray: `${progressRatio * 100} 100` }}
        />
        <circle
          cx={targetCx}
          cy={targetCy}
          r="5"
          className="seller-league-gauge-target-dot"
        />
        <text
          x="40"
          y="153"
          className="seller-league-gauge-label seller-league-gauge-label--min"
        >
          {`0${valueSuffix}`}
        </text>
        <text
          x={targetCx}
          y={targetCy - 10}
          textAnchor="middle"
          className="seller-league-gauge-label seller-league-gauge-label--target"
        >
          {`${formattedTarget}${valueSuffix}`}
        </text>
        <text
          x="200"
          y="153"
          textAnchor="end"
          className="seller-league-gauge-label seller-league-gauge-label--max"
        >
          {`${formattedMax}${valueSuffix}`}
        </text>
        <circle cx="120" cy="120" r="10" className="seller-league-gauge-hub" />
        <line
          x1="120"
          y1="120"
          x2="120"
          y2="72"
          className="seller-league-gauge-needle"
          style={{
            transform: `rotate(${needleRotation}deg)`,
            transformOrigin: "120px 120px",
          }}
        />
        <circle
          cx="120"
          cy="120"
          r="12"
          className="seller-league-gauge-hub-outline"
        />
      </svg>

      <div className="seller-league-gauge-center">
        <strong className="seller-league-gauge-value">
          {`${formattedActual}${valueSuffix}`}
        </strong>
      </div>
    </div>
  );
}

function SellerStageFunnel({
  stages,
  totalAmountUsd,
  requiredAmountUsd = null,
}) {
  const normalizedStages = Array.isArray(stages)
    ? [...stages].sort(
        (left, right) =>
          Number(
            SELLER_LEAGUE_STAGE_ORDER[left.stageCode] ?? left.stageOrder ?? 9999,
          ) -
          Number(
            SELLER_LEAGUE_STAGE_ORDER[right.stageCode] ??
              right.stageOrder ??
              9999,
          ),
      )
    : [];
  const numericRequiredAmountUsd = Number(requiredAmountUsd || 0);
  const numericTotalAmountUsd = Number(totalAmountUsd || 0);
  const comparisonBase = Math.max(
    numericTotalAmountUsd,
    numericRequiredAmountUsd,
    0,
  );
  const actualWidthPct =
    comparisonBase > 0 && numericTotalAmountUsd > 0
      ? Math.max((numericTotalAmountUsd / comparisonBase) * 100, 1)
      : 0;
  const requiredWidthPct =
    comparisonBase > 0 && numericRequiredAmountUsd > 0
      ? Math.max((numericRequiredAmountUsd / comparisonBase) * 100, 1)
      : 0;

  if (!normalizedStages.length || Number(totalAmountUsd || 0) <= 0) {
    return (
      <div className="seller-league-funnel-empty">Sin funnel abierto.</div>
    );
  }

  return (
    <div className="seller-league-funnel-wrap">
      {numericRequiredAmountUsd > 0 ? (
        <div className="seller-league-funnel-required">
          <div className="seller-league-funnel-required-head">
            <strong>Funnel requerido</strong>
            <span>{formatCurrencyUsd(numericRequiredAmountUsd)}</span>
          </div>
          <div className="seller-league-funnel-required-track">
            <div
              className="seller-league-funnel-required-fill"
              style={{ width: `${requiredWidthPct}%` }}
            />
          </div>
        </div>
      ) : null}
      <div className="seller-league-funnel-track-scale" aria-hidden="true">
        <div
          className="seller-league-funnel-track"
          style={{ width: `${actualWidthPct}%` }}
        >
          {normalizedStages.map((stage) => {
            const palette = getSellerLeagueStagePalette(stage.stageCode);
            return (
              <div
                key={stage.stageCode}
                className="seller-league-funnel-segment"
                style={{
                  width: `${Math.max(Number(stage.stageSharePct || 0), 1)}%`,
                  backgroundColor: palette.solid,
                }}
                title={`${stage.stageName}: ${formatCurrencyUsd(stage.openAmountUsd)} (${formatLeadCount(stage.opportunityCount)} opps)`}
              />
            );
          })}
        </div>
      </div>
      <div className="seller-league-funnel-meta">
        <strong>{formatCurrencyUsd(totalAmountUsd)}</strong>
        <span>Monto abierto</span>
      </div>
      <div className="seller-league-funnel-legend">
        {normalizedStages.slice(0, 4).map((stage) => (
          <span key={`legend-${stage.stageCode}`}>
            {stage.stageName} · {formatLeadCount(stage.opportunityCount)}
          </span>
        ))}
      </div>
    </div>
  );
}

function LeadsAssignedWeeklyChart({
  series,
  variantClassName = "",
  yAxisLabel = "Días",
}) {
  const safeSeries = Array.isArray(series)
    ? series
        .slice(-10)
        .map((value) =>
          value === null || value === undefined
            ? null
            : Math.max(0, Number(value || 0)),
        )
    : [];
  const normalizedSeries =
    safeSeries.length === 10
      ? safeSeries
      : Array.from({ length: 10 }, (_, index) => safeSeries[index] ?? null);

  const width = 240;
  const height = 120;
  const padding = { top: 8, right: 10, bottom: 26, left: 30 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const numericValues = normalizedSeries.filter((value) => value !== null);
  const yMaxRaw = Math.max(...numericValues, 1);
  const yMax = Math.ceil(yMaxRaw / 5) * 5;

  const points = normalizedSeries.map((value, index) => {
    const x =
      padding.left + (innerWidth * index) / Math.max(normalizedSeries.length - 1, 1);
    const y =
      value === null ? null : padding.top + innerHeight - (value / yMax) * innerHeight;
    return { x, y, value };
  });

  const linePath = points.reduce((path, point) => {
    if (point.y === null) {
      return path;
    }
    if (!path.length || path.endsWith("Z")) {
      return `${path}${path.length ? " " : ""}M ${point.x} ${point.y}`;
    }
    return `${path} L ${point.x} ${point.y}`;
  }, "");

  const yTicks = [0, Math.round(yMax / 2), yMax];

  return (
    <div
      className={`seller-detail-line-chart-wrap ${variantClassName}`.trim()}
      aria-hidden="true"
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="seller-detail-line-chart"
        role="presentation"
        focusable="false"
      >
        <line
          x1={padding.left}
          y1={padding.top + innerHeight}
          x2={padding.left + innerWidth}
          y2={padding.top + innerHeight}
          className="seller-detail-line-chart-axis"
        />
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={padding.top + innerHeight}
          className="seller-detail-line-chart-axis"
        />

        {yTicks.map((tick) => {
          const y = padding.top + innerHeight - (tick / yMax) * innerHeight;
          return (
            <g key={`tick-${tick}`}>
              <line
                x1={padding.left}
                y1={y}
                x2={padding.left + innerWidth}
                y2={y}
                className="seller-detail-line-chart-grid"
              />
              <text
                x={padding.left - 6}
                y={y + 4}
                textAnchor="end"
                className="seller-detail-line-chart-label"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {linePath ? (
          <path d={linePath} className="seller-detail-line-chart-series" />
        ) : null}

        {points.map((point, index) =>
          point.y === null ? null : (
            <circle
              key={`point-${index}`}
              cx={point.x}
              cy={point.y}
              r="2.4"
              className="seller-detail-line-chart-point"
            />
          ),
        )}

        <text
          x={padding.left + innerWidth / 2}
          y={height - 4}
          textAnchor="middle"
          className="seller-detail-line-chart-axis-title"
        >
          Semana
        </text>

        <text
          x={10}
          y={padding.top + innerHeight / 2}
          textAnchor="middle"
          transform={`rotate(-90 10 ${padding.top + innerHeight / 2})`}
          className="seller-detail-line-chart-axis-title"
        >
          {yAxisLabel}
        </text>

        {Array.from({ length: 10 }, (_, index) => {
          const x = padding.left + (innerWidth * index) / Math.max(10 - 1, 1);
          return (
            <text
              key={`week-label-${index + 1}`}
              x={x}
              y={padding.top + innerHeight + 14}
              textAnchor={
                index === 0 ? "start" : index === 9 ? "end" : "middle"
              }
              className="seller-detail-line-chart-label seller-detail-line-chart-label--x"
            >
              {`S${index + 1}`}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function getCurrentWeekCount(series) {
  if (!Array.isArray(series)) {
    return 0;
  }

  const currentWeekValue = Number(series[series.length - 1]);
  return Number.isFinite(currentWeekValue) && currentWeekValue >= 0
    ? currentWeekValue
    : 0;
}

function normalizeConversionPctValue(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return 0;
  }

  // Accept both ratio scale (0..1) and percentage scale (0..100).
  return numericValue <= 1 ? numericValue * 100 : numericValue;
}

function normalizeWeeklyCountSeries(series) {
  const safeSeries = Array.isArray(series)
    ? series.slice(-10).map((value) => {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) && numericValue > 0
          ? numericValue
          : 0;
      })
    : [];

  return safeSeries.length === 10
    ? safeSeries
    : Array.from({ length: 10 }, (_, index) => safeSeries[index] ?? 0);
}

function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

const QUOTA_PROBABILITY_STAGE_TIME_FACTORS = {
  contacto_inicial: 1,
  identificacion_oportunidad: 0.8,
  desarrollo: 0.6,
  cotizacion: 0.4,
  demostracion: 0.3,
  negociacion: 0.2,
  waiting: 0.1,
};

function getAverageLastWeeks(series, size = 4) {
  const values = Array.isArray(series)
    ? series
        .slice(-size)
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0)
    : [];

  if (!values.length) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildCurrentQuarterAttainmentIndicator(seller, quarterContext) {
  const daysRemaining = Math.max(
    0,
    Number(quarterContext?.current?.daysRemaining || 0),
  );
  const weeksRemaining = Math.max(
    0,
    Number(quarterContext?.current?.weeksRemaining || daysRemaining / 7 || 0),
  );
  const quotaAmountUsd = Number(seller.quotaAmountUsd || 0);
  const wonAmountUsd = Number(seller.wonAmountUsd || 0);
  const funnelOpenAmountUsd = Number(seller.funnelOpenAmountUsd || 0);
  const opportunityToWinRatio = clamp(
    Number(
      seller.opportunityToWinEffectiveRatio ??
        seller.opportunityToWinCurrentRatio ??
        0,
    ),
    0,
    1,
  );
  const configuredBaseDays = Math.max(
    0,
    Number(
      seller.opportunityToWinConfiguredDays ??
        seller.averageOpportunityToWinDays ??
        0,
    ),
  );
  const hasValidBaseDays = configuredBaseDays > 0;
  const funnelByStage = Array.isArray(seller.funnelByStage)
    ? seller.funnelByStage
    : [];

  let closablePipelineUsd = 0;
  if (hasValidBaseDays) {
    if (funnelByStage.length) {
      closablePipelineUsd = funnelByStage.reduce((sum, stage) => {
        const openAmountUsd = Math.max(0, Number(stage.openAmountUsd || 0));
        if (openAmountUsd <= 0) {
          return sum;
        }

        const stageCode = String(stage.stageCode || "");
        const stageFactor =
          QUOTA_PROBABILITY_STAGE_TIME_FACTORS[stageCode] ?? 1;
        const stageDays = Math.max(1, configuredBaseDays * stageFactor);
        const stageTimeFactor = clamp(daysRemaining / stageDays, 0, 1);
        return sum + openAmountUsd * opportunityToWinRatio * stageTimeFactor;
      }, 0);
    } else {
      // Fallback when stage detail is unavailable: treat as initial-contact timing.
      const fallbackTimeFactor = clamp(
        daysRemaining / configuredBaseDays,
        0,
        1,
      );
      closablePipelineUsd =
        funnelOpenAmountUsd * opportunityToWinRatio * fallbackTimeFactor;
    }
  }

  const projectedCloseUsd = wonAmountUsd + closablePipelineUsd;
  const projectedAttainmentRatio =
    quotaAmountUsd > 0 ? projectedCloseUsd / quotaAmountUsd : 0;
  const projectedGapUsd = Math.max(0, quotaAmountUsd - projectedCloseUsd);
  const requiredWeeklyCloseUsd =
    weeksRemaining > 0 ? projectedGapUsd / weeksRemaining : projectedGapUsd;

  let status = "Comprometido";
  let tone = "critical";
  if (projectedAttainmentRatio >= 1) {
    status = "En ruta";
    tone = "positive";
  } else if (projectedAttainmentRatio >= 0.7) {
    status = "En riesgo";
    tone = "warning";
  }

  if (
    status === "En ruta" &&
    (Number(seller.overdueRate || 0) > 35 ||
      Number(seller.noNextStepRate || 0) > 30)
  ) {
    status = "En riesgo";
    tone = "warning";
  }

  const secondaryLine =
    projectedGapUsd > 0
      ? `Brecha: ${formatCurrencyUsd(projectedGapUsd)}`
      : `Superávit: ${formatCurrencyUsd(Math.max(0, projectedCloseUsd - quotaAmountUsd))}`;

  return {
    title: "Probabilidad de cumplir cuota",
    subtitle: "Trimestre actual",
    valuePct: Math.round(projectedAttainmentRatio * 100),
    status,
    tone,
    secondaryLine,
  };
}

function buildNextQuarterReadinessIndicator(seller, quarterContext) {
  const daysRemaining = Math.max(
    0,
    Number(quarterContext?.current?.daysRemaining || 0),
  );
  const now = new Date();
  const quarterEndDateRaw = String(quarterContext?.current?.endDate || "");
  const quarterEndDate = quarterEndDateRaw
    ? new Date(`${quarterEndDateRaw}T23:59:59`)
    : null;
  const millisecondsPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeksRemainingFromNow =
    quarterEndDate && Number.isFinite(quarterEndDate.getTime())
      ? Math.max(
          0,
          (quarterEndDate.getTime() - now.getTime()) / millisecondsPerWeek,
        )
      : null;
  const weeksRemaining =
    weeksRemainingFromNow !== null
      ? weeksRemainingFromNow
      : Math.max(
          0,
          Number(
            quarterContext?.current?.weeksRemaining || daysRemaining / 7 || 0,
          ),
        );
  const quotaAmountUsd = Number(seller.quotaAmountUsd || 0);
  const nextQuarterQuotaAmountUsd = Number(
    seller.nextQuarterQuotaAmountUsd || 0,
  );
  const hasRealNextQuarterTarget = nextQuarterQuotaAmountUsd > 0;
  const opportunityToWinRatio = clamp(
    Number(
      seller.opportunityToWinEffectiveRatio ??
        seller.opportunityToWinCurrentRatio ??
        0,
    ),
    0,
    1,
  );
  const leadToOpportunityRatio = clamp(
    Number(
      seller.leadToOpportunityCurrentRatio ??
        seller.leadToOpportunityDisplayRatio ??
        0,
    ),
    0,
    1,
  );
  const leadToOpportunityDays = Math.max(
    1,
    Number(seller.leadToOpportunityDays ?? 20),
  );
  const timeBuildFactor = clamp(daysRemaining / leadToOpportunityDays, 0, 1);
  const leadsPerWeek = getAverageLastWeeks(seller.leadsPerWeekWeeklyCounts, 4);
  const averageSaleTicketAmount = Number(seller.averageSaleTicketAmount || 0);
  const buildableOpportunities =
    leadsPerWeek * weeksRemaining * leadToOpportunityRatio * timeBuildFactor;
  const buildableFunnelUsd = buildableOpportunities * averageSaleTicketAmount;
  const existingNextQuarterFunnelUsd = hasRealNextQuarterTarget
    ? Number(seller.nextQuarterOpenPipelineUsd || 0)
    : Number(seller.funnelOpenAmountUsd || 0);
  const projectedAvailableFunnelUsd =
    existingNextQuarterFunnelUsd + buildableFunnelUsd;
  const requiredFunnelUsd =
    (hasRealNextQuarterTarget ? nextQuarterQuotaAmountUsd : quotaAmountUsd) /
    Math.max(opportunityToWinRatio, 0.0001);
  const readinessRatio =
    requiredFunnelUsd > 0 ? projectedAvailableFunnelUsd / requiredFunnelUsd : 0;
  const funnelGapUsd = Math.max(
    0,
    requiredFunnelUsd - projectedAvailableFunnelUsd,
  );
  const requiredWeeklyBuildUsd =
    weeksRemaining > 0 ? funnelGapUsd / weeksRemaining : funnelGapUsd;

  let status;
  let tone;
  if (hasRealNextQuarterTarget) {
    if (readinessRatio >= 1) {
      status = "Listo";
      tone = "positive";
    } else if (readinessRatio >= 0.8) {
      status = "Justo";
      tone = "warning";
    } else {
      status = "Insuficiente";
      tone = "critical";
    }
  } else if (readinessRatio >= 1) {
    status = "Alta";
    tone = "positive";
  } else if (readinessRatio >= 0.75) {
    status = "Media";
    tone = "warning";
  } else {
    status = "Baja";
    tone = "critical";
  }

  const secondaryLine = hasRealNextQuarterTarget
    ? funnelGapUsd > 0
      ? `Brecha de funnel: ${formatCurrencyUsd(funnelGapUsd)}`
      : `Funnel proyectado: ${formatCurrencyUsd(projectedAvailableFunnelUsd)}`
    : `Capacidad estimada: ${formatCurrencyUsd(projectedAvailableFunnelUsd)}`;

  return {
    title: hasRealNextQuarterTarget
      ? "Probabilidad de cumplir funnel siguiente Q"
      : "Capacidad de construir funnel",
    subtitle: hasRealNextQuarterTarget
      ? "Próximo trimestre"
      : "Hacia el próximo trimestre",
    valuePct: Math.round(readinessRatio * 100),
    status,
    tone,
    secondaryLine,
  };
}

function buildNextQuarterFunnelComparison(seller) {
  const openPipelineUsd = Number(
    seller.nextQuarterOpenPipelineUsd || seller.funnelOpenAmountUsd || 0,
  );
  const requiredFunnelAmountUsd = calculateRequiredFunnelAmountUsd(
    seller.gapAmountUsd,
    seller.opportunityToWinCurrentRatio,
  );

  return {
    openPipelineAmountUsd: openPipelineUsd,
    requiredAmountUsd: requiredFunnelAmountUsd,
    stages: [
      {
        stageCode: "next-quarter-funnel",
        stageName: "Funnel Q siguiente",
        stageOrder: 1,
        opportunityCount: 0,
        openAmountUsd: openPipelineUsd,
        stageSharePct: 100,
      },
    ],
    note:
      requiredFunnelAmountUsd && openPipelineUsd >= requiredFunnelAmountUsd
        ? "Cobertura suficiente para el siguiente Q."
        : "Aún falta pipeline para cubrir el siguiente Q.",
  };
}

function FunnelComparisonCard({ comparison }) {
  return (
    <article className="seller-detail-metric-card seller-detail-funnel-compare-card">
      <div className="seller-detail-metric-card-head">
        <span className="seller-detail-metric-card-title">
          Funnel para Q siguiente
        </span>
      </div>

      <SellerStageFunnel
        stages={comparison.stages}
        totalAmountUsd={comparison.openPipelineAmountUsd}
        requiredAmountUsd={comparison.requiredAmountUsd}
      />

      <p className="seller-detail-funnel-compare-note">{comparison.note}</p>
    </article>
  );
}

function IndicatorCard({ indicator }) {
  return (
    <article
      className={`seller-detail-metric-card seller-detail-indicator-card seller-detail-indicator-card--${indicator.tone}`}
    >
      <div className="seller-detail-indicator-card-head">
        <span className="seller-detail-indicator-card-title">
          {indicator.title}
        </span>
        <span className="seller-detail-indicator-card-subtitle">
          {indicator.subtitle}
        </span>
      </div>

      <div className="seller-detail-indicator-card-body">
        <strong className="seller-detail-indicator-card-value">
          {`${indicator.valuePct}%`}
        </strong>
        <span
          className={`seller-detail-indicator-card-status seller-detail-indicator-card-status--${indicator.tone}`}
        >
          {indicator.status}
        </span>
      </div>

      <p className="seller-detail-indicator-card-secondary">
        {indicator.secondaryLine}
      </p>
    </article>
  );
}

function SellerDetailPage({ seller, onNavigate, quarterContext }) {
  if (!seller) {
    return (
      <section className="seller-detail-page seller-league-page--fullscreen">
        <div className="seller-detail-content">
          <p style={{ textAlign: "center", color: "#888", marginTop: "2rem" }}>
            Vendedor no encontrado
          </p>
        </div>
      </section>
    );
  }

  const opportunitiesPerWeekActual = getCurrentWeekCount(
    seller.opportunitiesPerWeekWeeklyCounts,
  );
  const leadsPerWeekActual = getCurrentWeekCount(
    seller.leadsPerWeekWeeklyCounts,
  );
  const leadToOpportunityWeeklyConversionPct = Array.isArray(
    seller.leadToOpportunityWeeklyConversionPct,
  )
    ? seller.leadToOpportunityWeeklyConversionPct.map(
        normalizeConversionPctValue,
      )
    : [];
  const opportunityToWinWeeklyConversionPctRaw = Array.isArray(
    seller.opportunityToWinWeeklyConversionPct,
  )
    ? seller.opportunityToWinWeeklyConversionPct.map(
        normalizeConversionPctValue,
      )
    : [];
  const opportunityToWinWeeklyConversionPct =
    opportunityToWinWeeklyConversionPctRaw.length === 10
      ? opportunityToWinWeeklyConversionPctRaw
      : Array.from(
          { length: 10 },
          (_, index) => opportunityToWinWeeklyConversionPctRaw[index] ?? 0,
        );
  const leadsPerWeekSeries = normalizeWeeklyCountSeries(
    seller.leadsPerWeekWeeklyCounts,
  );
  const opportunitiesPerWeekSeries = normalizeWeeklyCountSeries(
    seller.opportunitiesPerWeekWeeklyCounts,
  );
  const leadToOpportunityCurrentWeekPct = getCurrentWeekCount(
    leadToOpportunityWeeklyConversionPct,
  );
  const leadToOpportunityCurrentWeekRatio =
    leadToOpportunityCurrentWeekPct > 0
      ? leadToOpportunityCurrentWeekPct / 100
      : 0;
  const funnelRequiredAmountUsd = calculateRequiredFunnelAmountUsd(
    seller.gapAmountUsd,
    seller.opportunityToWinCurrentRatio,
  );
  const nextQuarterFunnelComparison = buildNextQuarterFunnelComparison(seller);
  const currentQuarterIndicator = buildCurrentQuarterAttainmentIndicator(
    seller,
    quarterContext,
  );
  const nextQuarterIndicator = buildNextQuarterReadinessIndicator(
    seller,
    quarterContext,
  );
  return (
    <section className="seller-detail-page seller-league-page--fullscreen">
      <div className="seller-detail-header">
        <h1 className="seller-detail-name">{seller.sellerUserName}</h1>
      </div>

      <div className="seller-detail-sections">
        {/* Pipeline para siguiente Q */}
        <section className="seller-detail-section seller-detail-section--pipeline">
          <div className="seller-detail-section-header">
            <h2 className="seller-detail-section-title">
              Pipeline para siguiente Q
            </h2>
          </div>

          <div className="seller-detail-metrics-grid seller-detail-metrics-grid--pipeline">
            <article className="seller-detail-metric-card seller-detail-metric-card--opportunities-compact">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">Leads/Q</span>
              </div>
              <div className="seller-detail-gauge-wrap">
                <LeadGauge
                  actual={seller.leadActualCount}
                  target={seller.leadTargetCount}
                />
              </div>
            </article>

            <article className="seller-detail-metric-card">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Oportunidades/Q
                </span>
              </div>
              <div className="seller-detail-gauge-wrap">
                <LeadGauge
                  actual={seller.opportunityCreatedActualCount}
                  target={seller.opportunityCreatedTargetCount}
                />
              </div>
            </article>

            <article className="seller-detail-metric-card">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Conversión L→O %
                </span>
              </div>
              <div className="seller-detail-gauge-wrap">
                <LeadGauge
                  actual={Number(
                    seller.leadToOpportunityDisplayRatio ??
                      seller.leadToOpportunityCurrentRatio ??
                      0,
                  )}
                  target={0.5}
                  maxValue={1}
                  valueDivisor={0.01}
                  valueMaxFractionDigits={0}
                  className="seller-league-gauge--conversion"
                />
              </div>
              <LeadsAssignedWeeklyChart
                variantClassName="seller-detail-line-chart-wrap--opportunities"
                yAxisLabel="Conversión %"
                series={leadToOpportunityWeeklyConversionPct}
              />
            </article>

            <article className="seller-detail-metric-card">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Ticket promedio venta
                </span>
              </div>
              <div className="seller-detail-ticket-value-wrap">
                <strong className="seller-detail-ticket-value">
                  {formatCurrencyUsd(seller.averageSaleTicketAmount)}
                </strong>
                <span className="seller-detail-ticket-meta">US$ por venta</span>
              </div>
            </article>

            <article className="seller-detail-metric-card">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Leads/Semana
                </span>
              </div>
              <div className="seller-detail-gauge-wrap">
                <LeadGauge
                  actual={leadsPerWeekActual}
                  target={Math.round((seller.leadTargetCount || 0) / 13)}
                />
              </div>
              <span className="seller-detail-required-quarter-note">
                Requeridos trimestre: {Number(seller.leadTargetCount || 0)} leads
              </span>
              <LeadsAssignedWeeklyChart
                variantClassName="seller-detail-line-chart-wrap--opportunities"
                yAxisLabel="Leads"
                series={leadsPerWeekSeries}
              />
            </article>

            <article className="seller-detail-metric-card">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Oportunidades/Semana
                </span>
              </div>
              <div className="seller-detail-gauge-wrap">
                <LeadGauge
                  actual={opportunitiesPerWeekActual}
                  target={Math.round(
                    (seller.opportunityCreatedTargetCount || 0) / 13,
                  )}
                />
              </div>
              <LeadsAssignedWeeklyChart
                variantClassName="seller-detail-line-chart-wrap--opportunities"
                yAxisLabel="Oportunidades"
                series={opportunitiesPerWeekSeries}
              />
            </article>

            <article className="seller-detail-metric-card seller-detail-metric-card--otv-compact">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Tiempo O→V
                </span>
              </div>
              <div className="seller-detail-metric-value-wrap">
                <strong className="seller-detail-metric-value">
                  {seller.opportunityToWinDays === null ||
                  seller.opportunityToWinDays === undefined
                    ? "-"
                    : seller.opportunityToWinDays}
                </strong>
                <span className="seller-detail-metric-unit">
                  {seller.opportunityToWinDays === null ||
                  seller.opportunityToWinDays === undefined
                    ? ""
                    : "días"}
                </span>
              </div>
              <LeadsAssignedWeeklyChart
                variantClassName="seller-detail-line-chart-wrap--otv"
                series={seller.opportunityToWinWeeklyDays || []}
              />
            </article>

            <article className="seller-detail-metric-card seller-detail-metric-card--lto-compact">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Tiempo L→O
                </span>
              </div>
              <div className="seller-detail-metric-value-wrap">
                <strong className="seller-detail-metric-value">
                  {seller.leadToOpportunityDays === null ||
                  seller.leadToOpportunityDays === undefined
                    ? "-"
                    : seller.leadToOpportunityDays}
                </strong>
                <span className="seller-detail-metric-unit">
                  {seller.leadToOpportunityDays === null ||
                  seller.leadToOpportunityDays === undefined
                    ? ""
                    : "días"}
                </span>
              </div>
              <LeadsAssignedWeeklyChart
                variantClassName="seller-detail-line-chart-wrap--lto"
                series={seller.leadToOpportunityWeeklyDays || []}
              />
            </article>

            <article className="seller-detail-metric-card seller-detail-metric-card--leads-assigned-compact">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Tiempo Leads sin calificar
                </span>
              </div>
              <div className="seller-detail-metric-value-wrap">
                <strong className="seller-detail-metric-value">
                  {seller.leadsAssignedDays || 0}
                </strong>
                <span className="seller-detail-metric-unit">días</span>
              </div>
              <LeadsAssignedWeeklyChart
                series={seller.leadsAssignedWeeklyDays || []}
              />
            </article>
          </div>
        </section>

        {/* Cumplimiento Q actual */}
        <section className="seller-detail-section">
          <div className="seller-detail-section-header">
            <h2 className="seller-detail-section-title">
              Cumplimiento Q actual
            </h2>
          </div>

          <div className="seller-detail-metrics-grid seller-detail-metrics-grid--compliance">
            <article className="seller-detail-metric-card">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Cuota (M US$)
                </span>
              </div>
              <div className="seller-detail-gauge-wrap">
                <LeadGauge
                  actual={seller.wonAmountUsd}
                  target={seller.quotaAmountUsd}
                  valueDivisor={1000000}
                  valueMaxFractionDigits={2}
                />
              </div>
            </article>

            <article className="seller-detail-metric-card">
              <div className="seller-detail-metric-card-head">
                <span className="seller-detail-metric-card-title">
                  Conversión O→V %
                </span>
              </div>
              <div className="seller-detail-gauge-wrap">
                <LeadGauge
                  actual={Number(seller.opportunityToWinCurrentRatio ?? 0)}
                  target={Number(seller.opportunityToWinConfiguredRatio || 0)}
                  maxValue={1}
                  valueDivisor={0.01}
                  valueMaxFractionDigits={0}
                  className="seller-league-gauge--conversion"
                />
              </div>
              <LeadsAssignedWeeklyChart
                variantClassName="seller-detail-line-chart-wrap--opportunities"
                yAxisLabel="Conversión %"
                series={opportunityToWinWeeklyConversionPct}
              />
            </article>
          </div>
        </section>

        {/* Avance Q actual y siguiente */}
        <section className="seller-detail-section seller-detail-section--advance">
          <div className="seller-detail-section-header">
            <h2 className="seller-detail-section-title">
              Avance Q actual y siguiente
            </h2>
          </div>

          <div className="seller-detail-metrics-grid seller-detail-metrics-grid--compliance">
            <div className="seller-detail-compliance-funnel-row">
              <article className="seller-detail-metric-card seller-detail-funnel-stage-card">
                <div className="seller-detail-metric-card-head">
                  <span className="seller-detail-metric-card-title">
                    Funnel para Q actual
                  </span>
                </div>
                <SellerStageFunnel
                  stages={seller.funnelByStage}
                  totalAmountUsd={seller.funnelOpenAmountUsd}
                  requiredAmountUsd={funnelRequiredAmountUsd}
                />
              </article>

              <FunnelComparisonCard comparison={nextQuarterFunnelComparison} />
            </div>

            <div className="seller-detail-compliance-indicators-row">
              <IndicatorCard indicator={currentQuarterIndicator} />
              <IndicatorCard indicator={nextQuarterIndicator} />
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

export default function SellerLeagueTvPage({ showPageControls = true }) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [isDebugMode, setIsDebugMode] = useState(false);

  async function loadDashboard() {
    try {
      const { data } = await api.get(
        "/api/commercial-tracking/seller-league-tv",
      );
      setPayload(data || null);
      setError("");
    } catch (requestError) {
      setError(
        getApiErrorMessage(
          requestError,
          "No fue posible cargar el ritmo comercial",
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    const configuredMinutes = Number(payload?.screenDisplayMinutes || 1);
    const refreshMinutes = Number.isInteger(configuredMinutes)
      ? Math.max(1, Math.min(configuredMinutes, 60))
      : 1;

    const refreshId = window.setInterval(() => {
      loadDashboard();
    }, refreshMinutes * 60 * 1000);

    return () => {
      window.clearInterval(refreshId);
    };
  }, [payload?.screenDisplayMinutes]);

  // Initialize from URL parameters
  useEffect(() => {
    const { debug } = getUrlParams();
    // TV view stays pinned to summary page only.
    setCurrentPage(1);
    setIsDebugMode(debug);
  }, [showPageControls]);

  // Auto-rotation timer
  useEffect(() => {
    // Summary-only TV mode: no page rotation to seller detail screens.
    if (!showPageControls || isDebugMode || !payload?.leaderboard?.length) {
      return;
    }
    return;
  }, [
    showPageControls,
    isDebugMode,
    payload?.leaderboard?.length,
    payload?.screenDisplayMinutes,
  ]);

  function handleNavigate(direction) {
    void direction;
    if (!showPageControls) {
      return;
    }

    setCurrentPage(1);
    window.history.replaceState(null, "", "?page=1&debug=true");
  }

  const leaderboard = Array.isArray(payload?.leaderboard)
    ? payload.leaderboard
    : [];
  const sellerCount = Math.max(leaderboard.length, 1);
  const gridColumns = Math.max(1, Math.ceil(Math.sqrt(sellerCount)));
  const gridRows = Math.max(1, Math.ceil(sellerCount / gridColumns));

  const activePage = 1;
  const maxPage = 1;
  const sellerRequiredFunnelAmountUsd = (row) =>
    calculateRequiredFunnelAmountUsd(
      row?.gapAmountUsd,
      row?.opportunityToWinCurrentRatio,
    );

  return (
    <>
      {showPageControls ? (
        <div className="seller-league-debug-navbar">
          <button
            className="seller-league-debug-btn"
            onClick={() => handleNavigate(-1)}
          >
            ← Anterior
          </button>
          <div className="seller-league-debug-info">
            Página {currentPage}/{maxPage}
          </div>
          <button
            className="seller-league-debug-btn"
            onClick={() => handleNavigate(1)}
          >
            Siguiente →
          </button>
        </div>
      ) : null}

      <section
        className="seller-league-page seller-league-page--fullscreen"
        style={{
          "--seller-count": sellerCount,
          "--seller-columns": gridColumns,
          "--seller-rows": gridRows,
        }}
      >
        {error ? <p className="form-error">{error}</p> : null}

        {loading ? (
          <div className="seller-league-empty">Cargando ritmo comercial...</div>
        ) : null}

        {!loading && !leaderboard.length ? (
          <div className="seller-league-empty">
            No hay vendedores disponibles para mostrar.
          </div>
        ) : null}

        {!loading
          ? leaderboard.map((row) => {
                const nextQuarterReadiness = buildNextQuarterReadinessIndicator(
                  row,
                  payload?.quarterContext,
                );
                const currentQuarterIndicator =
                  buildCurrentQuarterAttainmentIndicator(
                    row,
                    payload?.quarterContext,
                  );

                return (
                  <section
                    key={row.sellerUserId || row.sellerUserName}
                    className="seller-league-seller-section"
                  >
                    <div className="seller-league-seller-card">
                      <div className="seller-league-seller-name-wrap">
                        <h2 className="seller-league-seller-name">
                          {row.sellerUserName || "Vendedor sin nombre"}
                        </h2>
                      </div>

                      <div className="seller-league-seller-panels">
                        <section className="seller-league-panel">
                          <div className="seller-league-panel-header seller-league-panel-header--with-value">
                            <h3 className="seller-league-panel-title">
                              Pipeline siguiente Q
                            </h3>
                            <span
                              className={`seller-league-panel-title-value seller-league-panel-title-value--${nextQuarterReadiness?.tone || "critical"}`}
                            >
                              {Number(nextQuarterReadiness?.valuePct || 0)}%
                            </span>
                          </div>

                          <div className="seller-league-metrics-grid seller-league-metrics-grid--pipeline">
                            <article className="seller-league-metric-card seller-league-metric-card--wide seller-league-metric-card--leads-weekly">
                              <div className="seller-league-metric-card-head">
                                <span className="seller-league-metric-card-title">
                                  Leads/Semana
                                </span>
                              </div>

                              <div className="seller-league-gauge-wrap">
                                <LeadGauge
                                  actual={getCurrentWeekCount(
                                    row.leadsPerWeekWeeklyCounts,
                                  )}
                                  target={Math.round(
                                    Number(row.leadTargetCount || 0) / 13,
                                  )}
                                />
                              </div>
                              <span className="seller-league-required-quarter-note">
                                Req. trim: {Number(row.leadTargetCount || 0)} leads
                              </span>
                            </article>

                            <article className="seller-league-metric-card seller-league-metric-card--wide seller-league-metric-card--opps-weekly">
                              <div className="seller-league-metric-card-head">
                                <span className="seller-league-metric-card-title">
                                  Ops/Semana
                                </span>
                              </div>

                              <div className="seller-league-gauge-wrap">
                                <LeadGauge
                                  actual={getCurrentWeekCount(
                                    row.opportunitiesPerWeekWeeklyCounts,
                                  )}
                                  target={Math.ceil(
                                    Number(
                                      row.opportunityCreatedTargetCount || 0,
                                    ) / 13,
                                  )}
                                />
                              </div>
                              <span className="seller-league-required-quarter-note">
                                Req. trim: {Math.ceil(Number(row.opportunityCreatedTargetCount || 0))} opps
                              </span>
                            </article>

                            <article className="seller-league-metric-card seller-league-metric-card--wide">
                              <div className="seller-league-metric-card-head">
                                <span className="seller-league-metric-card-title">
                                  Conversión L→O %
                                </span>
                              </div>

                              <div className="seller-league-gauge-wrap">
                                <LeadGauge
                                  actual={
                                    Math.ceil(
                                      Number(
                                        row.leadToOpportunityDisplayRatio ??
                                          row.leadToOpportunityCurrentRatio ??
                                          0,
                                      ) * 100,
                                    ) / 100
                                  }
                                  target={0.5}
                                  maxValue={1}
                                  valueDivisor={0.01}
                                  valueMaxFractionDigits={0}
                                  className="seller-league-gauge--conversion"
                                />
                              </div>
                            </article>

                            <article className="seller-league-metric-card seller-league-metric-card--wide">
                              <div className="seller-league-metric-card-head">
                                <span className="seller-league-metric-card-title">
                                  Ticket promedio venta
                                </span>
                              </div>

                              <div className="seller-league-ticket-value-wrap">
                                <strong className="seller-league-ticket-value">
                                  {formatCurrencyUsd(
                                    row.averageSaleTicketAmount,
                                  )}
                                </strong>
                                <span className="seller-league-ticket-meta">
                                  US$ por venta
                                </span>
                              </div>
                            </article>
                          </div>
                        </section>

                        <section className="seller-league-panel">
                          <div className="seller-league-panel-header seller-league-panel-header--with-value">
                            <h3 className="seller-league-panel-title">
                              Cumplimiento Q actual
                            </h3>
                            <span
                              className={`seller-league-panel-title-value seller-league-panel-title-value--${currentQuarterIndicator?.tone || "critical"}`}
                            >
                              {Number(currentQuarterIndicator?.valuePct || 0)}%
                            </span>
                          </div>
                          <div className="seller-league-metrics-grid seller-league-metrics-grid--compliance">
                            <article className="seller-league-metric-card seller-league-metric-card--wide">
                              <div className="seller-league-metric-card-head">
                                <span className="seller-league-metric-card-title">
                                  Cuota (M US$)
                                </span>
                              </div>

                              <div className="seller-league-gauge-wrap">
                                <LeadGauge
                                  actual={row.wonAmountUsd}
                                  target={row.quotaAmountUsd}
                                  valueDivisor={1000000}
                                  valueMaxFractionDigits={2}
                                />
                              </div>
                            </article>

                            <article className="seller-league-metric-card seller-league-metric-card--wide">
                              <div className="seller-league-metric-card-head">
                                <span className="seller-league-metric-card-title">
                                  Conversión O→V %
                                </span>
                              </div>

                              <div className="seller-league-gauge-wrap">
                                <LeadGauge
                                  actual={
                                    Math.ceil(
                                      Number(
                                        row.opportunityToWinEffectiveRatio ??
                                          row.opportunityToWinCurrentRatio ??
                                          0,
                                      ) * 100,
                                    ) / 100
                                  }
                                  target={Number(
                                    row.opportunityToWinConfiguredRatio || 0,
                                  )}
                                  maxValue={1}
                                  valueDivisor={0.01}
                                  valueMaxFractionDigits={0}
                                  className="seller-league-gauge--conversion"
                                />
                              </div>
                            </article>

                            <article className="seller-league-metric-card seller-league-metric-card--wide seller-league-metric-card--full">
                              <div className="seller-league-metric-card-head">
                                <span className="seller-league-metric-card-title">
                                  Funnel por etapa
                                </span>
                              </div>
                              <SellerStageFunnel
                                stages={row.funnelByStage}
                                totalAmountUsd={row.funnelOpenAmountUsd}
                                requiredAmountUsd={sellerRequiredFunnelAmountUsd(
                                  row,
                                )}
                              />
                            </article>
                          </div>
                        </section>
                      </div>
                    </div>
                  </section>
                );
              })
          : null}
      </section>
    </>
  );
}
