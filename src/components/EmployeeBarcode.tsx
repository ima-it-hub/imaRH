"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

type EmployeeBarcodeProps = {
  value: string;
  name?: string;
  className?: string;
  showPrint?: boolean;
};

export function EmployeeBarcode({
  value,
  name,
  className = "",
  showPrint = true,
}: EmployeeBarcodeProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !value) return;
    try {
      JsBarcode(svgRef.current, value, {
        format: "CODE128",
        displayValue: true,
        fontSize: 14,
        height: 60,
        margin: 8,
        background: "#ffffff",
        lineColor: "#111111",
      });
    } catch {
      // invalid barcode value
    }
  }, [value]);

  if (!value) {
    return (
      <p className="text-sm text-zinc-500">Aucun code-barres généré.</p>
    );
  }

  function handlePrint() {
    const svg = svgRef.current;
    if (!svg) return;
    const win = window.open("", "_blank", "width=480,height=360");
    if (!win) return;
    win.document.write(`<!doctype html><html><head><title>Badge ${value}</title>
      <style>
        body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
        .card{border:1px solid #ddd;padding:24px;text-align:center;border-radius:12px}
        h1{font-size:16px;margin:0 0 12px}
      </style></head><body>
      <div class="card">
        ${name ? `<h1>${name}</h1>` : ""}
        ${svg.outerHTML}
        <p style="margin-top:8px;font-size:12px;color:#666">IMA Plomberie — Pointage journalier</p>
      </div>
      <script>window.onload=()=>{window.print();}</script>
      </body></html>`);
    win.document.close();
  }

  return (
    <div className={`rounded-xl border border-zinc-200 bg-white p-3 ${className}`}>
      <div className="flex flex-col items-center gap-2">
        {name ? (
          <p className="text-sm font-medium text-zinc-800">{name}</p>
        ) : null}
        <svg ref={svgRef} />
        {showPrint ? (
          <button
            type="button"
            onClick={handlePrint}
            className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Imprimer le badge
          </button>
        ) : null}
      </div>
    </div>
  );
}
