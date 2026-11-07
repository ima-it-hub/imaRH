"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { ArrowLeft, LogIn, LogOut, ScanLine } from "lucide-react";
import { api } from "../../../convex/_generated/api";

function scanErrorMessage(err: unknown): string {
  if (err instanceof ConvexError) {
    const data = err.data;
    if (typeof data === "string" && data.trim()) return data;
  }
  if (err instanceof Error) {
    // Convex wraps: "... Server Error\n\nActual message" or ends with the message
    const raw = err.message;
    const afterServer = raw.split(/Server Error\s*/i).pop()?.trim();
    if (afterServer && afterServer !== "Called by client") {
      return afterServer.replace(/^Called by client\s*/i, "").trim() || raw;
    }
    return raw;
  }
  return "Scan échoué";
}

type ScanDisplay = {
  name: string;
  time: string;
  difference: string;
  timeLabel: string;
  action: "clock_in" | "clock_out";
  workedMinutes: number;
  delayAmount: number;
  scanCount: number;
};

const LOCK_SECONDS = 5;

export default function PublicScanPage() {
  const clockByBarcode = useMutation(api.attendance.clockByBarcodePublic);
  const inputRef = useRef<HTMLInputElement>(null);
  const lockedRef = useRef(false);
  const busyRef = useRef(false);

  const [code, setCode] = useState("");
  const [locked, setLocked] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [display, setDisplay] = useState<ScanDisplay | null>(null);
  const [error, setError] = useState("");
  const [clock, setClock] = useState("");

  lockedRef.current = locked;

  useEffect(() => {
    const tick = () => {
      setClock(
        new Date().toLocaleTimeString("fr-DZ", {
          timeZone: "Africa/Algiers",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const focusInput = () => {
      if (!lockedRef.current) inputRef.current?.focus();
    };
    focusInput();
    window.addEventListener("click", focusInput);
    return () => window.removeEventListener("click", focusInput);
  }, []);

  useEffect(() => {
    if (!locked || countdown <= 0) return;
    const t = window.setTimeout(() => {
      setCountdown((c) => {
        if (c <= 1) {
          setLocked(false);
          lockedRef.current = false;
          setDisplay(null);
          setError("");
          window.setTimeout(() => inputRef.current?.focus(), 50);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => window.clearTimeout(t);
  }, [locked, countdown]);

  async function handleScan(raw: string) {
    const barcode = raw.trim();
    if (!barcode || lockedRef.current || busyRef.current) return;

    busyRef.current = true;
    setError("");
    setCode("");

    try {
      const result = await clockByBarcode({ barcode });
      setDisplay({
        name: result.employee.name,
        time: result.displayTime,
        difference: result.difference,
        timeLabel: result.timeLabel,
        action: result.action,
        workedMinutes: result.workedMinutes,
        delayAmount: result.delayAmount,
        scanCount: result.scanCount,
      });
      setLocked(true);
      lockedRef.current = true;
      setCountdown(LOCK_SECONDS);
    } catch (err) {
      setError(scanErrorMessage(err));
      setDisplay(null);
      setLocked(true);
      lockedRef.current = true;
      setCountdown(LOCK_SECONDS);
    } finally {
      busyRef.current = false;
    }
  }

  const accent =
    display?.action === "clock_out"
      ? {
          bar: "from-[#1A2744] to-[#2A3D66]",
          badge: "bg-[#1A2744]",
          icon: LogOut,
          label: "Sortie enregistrée",
        }
      : {
          bar: "from-[#0088E8] to-[#006FCB]",
          badge: "bg-[#0088E8]",
          icon: LogIn,
          label: "Entrée enregistrée",
        };

  const StatusIcon = accent.icon;
  const progress = locked ? ((LOCK_SECONDS - countdown) / LOCK_SECONDS) * 100 : 0;

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-[#0B1528] text-white">
      {/* Atmosphere */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 top-0 h-[420px] w-[420px] rounded-full bg-[#0088E8]/20 blur-[120px]" />
        <div className="absolute -right-20 bottom-0 h-[380px] w-[380px] rounded-full bg-white/5 blur-[100px]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03)_0%,transparent_30%,transparent_70%,rgba(0,0,0,0.35)_100%)]" />
      </div>

      <div className="relative z-10 flex min-h-screen w-full flex-col">
        <header className="flex items-center justify-between px-5 py-5 sm:px-10">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 backdrop-blur transition hover:border-white/20 hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Connexion RH
          </Link>

          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
              IMA RH
            </p>
            <p className="mt-0.5 font-mono text-lg tabular-nums text-white/90">
              {clock}
            </p>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 pb-16">
          <div className="w-full overflow-hidden rounded-[28px] border border-white/10 bg-white shadow-[0_40px_100px_rgba(0,0,0,0.45)]">
            {/* Brand strip */}
            <div className={`h-1.5 w-full bg-gradient-to-r ${accent.bar}`} />

            <div className="px-6 pb-8 pt-8 sm:px-10 sm:pt-10">
              <div className="flex flex-col items-center text-center">
                <div className="rounded-2xl bg-[#fafafa] p-4 ring-1 ring-zinc-100">
                  <Image
                    src="/ima-logo.jpg"
                    alt="IMA Plomberie"
                    width={220}
                    height={120}
                    className="object-contain"
                    style={{ width: 190, height: "auto" }}
                    priority
                  />
                </div>

                <div className="mt-5 flex items-center gap-2">
                  <span className="h-px w-8 bg-[#0088E8]/40" />
                  <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#0088E8]">
                    Pointage
                  </p>
                  <span className="h-px w-8 bg-[#0088E8]/40" />
                </div>

                {/* Result / idle state */}
                <div className="mt-8 flex min-h-[140px] w-full flex-col items-center justify-center">
                  {display ? (
                    <div className="scan-fade-up flex w-full flex-col items-center">
                      <div
                        className={`mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-white ${accent.badge}`}
                      >
                        <StatusIcon className="h-3.5 w-3.5" />
                        {accent.label}
                      </div>
                      <p className="text-3xl font-semibold tracking-tight text-[#111111] sm:text-4xl">
                        {display.name}
                      </p>
                    </div>
                  ) : error ? (
                    <div className="scan-fade-up">
                      <p className="text-xl font-semibold text-red-600">
                        {error}
                      </p>
                      {/introuvable|badge/i.test(error) ? (
                        <p className="mt-2 text-sm text-zinc-500">
                          Vérifiez le badge et réessayez
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <div className="scan-pulse relative mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-[#0088E8]/8 ring-1 ring-[#0088E8]/20">
                        <ScanLine className="h-8 w-8 text-[#0088E8]" />
                      </div>
                      <p className="text-xl font-medium text-zinc-800">
                        Scannez votre badge
                      </p>
                      <p className="mt-2 max-w-xs text-sm leading-relaxed text-zinc-400">
                        Placez le code-barres devant le lecteur pour enregistrer
                        votre présence
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Metrics */}
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <MetricCard
                  labelFr="Heure"
                  labelAr={display?.timeLabel ?? "وقت الدخول"}
                  value={display?.time}
                  active={Boolean(display)}
                />
                <MetricCard
                  labelFr="Retard"
                  labelAr="التأخير"
                  value={display?.difference}
                  active={Boolean(display)}
                  emphasize
                />
              </div>
              {display ? (
                <p className="mt-3 text-center text-xs text-zinc-400">
                  Scan #{display.scanCount} · travaillé {display.workedMinutes}{" "}
                  min
                </p>
              ) : null}

              {/* Lock progress */}
              <div className="mt-8 flex flex-col items-center">
                {locked ? (
                  <div className="flex w-full max-w-xs flex-col items-center gap-3">
                    <div className="relative h-14 w-14">
                      <svg className="h-14 w-14 -rotate-90" viewBox="0 0 40 40">
                        <circle
                          cx="20"
                          cy="20"
                          r="16"
                          fill="none"
                          stroke="#eee"
                          strokeWidth="3"
                        />
                        <circle
                          cx="20"
                          cy="20"
                          r="16"
                          fill="none"
                          stroke="#0088E8"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeDasharray="100"
                          strokeDashoffset={100 - progress}
                          className="transition-[stroke-dashoffset] duration-1000 linear"
                        />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-[#111111]">
                        {countdown}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-500">
                      Prochain scan dans {countdown}s
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-full bg-zinc-50 px-4 py-2 text-xs font-medium text-zinc-500 ring-1 ring-zinc-100">
                    <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    Prêt · scans illimités · entrée / sortie en alternance
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

      <input
        ref={inputRef}
        value={code}
        onChange={(e) => {
          if (lockedRef.current) return;
          setCode(e.target.value);
        }}
        onKeyDown={(e) => {
          if (lockedRef.current) {
            e.preventDefault();
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            void handleScan(code);
          }
        }}
        disabled={locked}
        autoComplete="off"
        autoFocus
        aria-label="Scan code-barres"
        className="fixed bottom-0 left-0 h-px w-px opacity-0"
      />
    </div>
  );
}

function MetricCard({
  labelFr,
  labelAr,
  value,
  active,
  emphasize,
}: {
  labelFr: string;
  labelAr: string;
  value?: string;
  active?: boolean;
  emphasize?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border px-5 py-4 transition ${
        active
          ? "border-zinc-200 bg-[#fafafa]"
          : "border-zinc-100 bg-zinc-50/80"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
          {labelFr}
        </p>
        <p className="text-sm font-medium text-zinc-500" dir="rtl">
          {labelAr}
        </p>
      </div>
      <p
        className={`mt-3 text-2xl font-semibold tracking-tight ${
          emphasize && active ? "text-[#0088E8]" : "text-[#111111]"
        }`}
      >
        {value || <span className="text-zinc-300">—</span>}
      </p>
    </div>
  );
}
