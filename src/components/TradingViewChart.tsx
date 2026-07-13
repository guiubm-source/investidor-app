"use client";

import { useEffect, useRef } from "react";

/**
 * Gráfico avançado do TradingView embutido via widget oficial. Recria o
 * widget sempre que `symbol` muda, pois o script não suporta trocar de
 * símbolo depois de montado.
 */
export default function TradingViewChart({ symbol }: { symbol: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = "";

    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    widgetDiv.style.height = "100%";
    widgetDiv.style.width = "100%";

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval: "D",
      timezone: "America/Sao_Paulo",
      theme: "dark",
      style: "1",
      locale: "br",
      allow_symbol_change: false,
      hide_top_toolbar: false,
      save_image: false,
      support_host: "https://www.tradingview.com",
    });

    container.appendChild(widgetDiv);
    container.appendChild(script);
  }, [symbol]);

  return (
    <div
      className="tradingview-widget-container rounded-md overflow-hidden border border-border"
      ref={containerRef}
      style={{ height: 480 }}
    />
  );
}
