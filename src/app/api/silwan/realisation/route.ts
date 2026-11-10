import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import odbc from "odbc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestEntry = {
  key: string;
  code?: string;
  allDocuments?: boolean;
};

type ThirdPartyAggregate = {
  AssociatedAgentCode: string | number;
  Realisation: string | number | null;
};

type TotalAggregate = {
  Realisation: string | number | null;
};

type TransactionAggregate = {
  Recouvrement: string | number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  if (
    !isRecord(body) ||
    typeof body.token !== "string" ||
    !body.token.trim() ||
    !Number.isInteger(body.month) ||
    (body.month as number) < 1 ||
    (body.month as number) > 12 ||
    !Number.isInteger(body.year) ||
    (body.year as number) < 2000 ||
    (body.year as number) > 2200 ||
    !Array.isArray(body.entries) ||
    body.entries.length > 500
  ) {
    return Response.json({ error: "Paramètres de réalisation invalides." }, {
      status: 400,
    });
  }

  const entries: RequestEntry[] = [];
  const keys = new Set<string>();
  for (const entry of body.entries) {
    const allDocuments =
      isRecord(entry) && entry.allDocuments === true;
    if (
      !isRecord(entry) ||
      typeof entry.key !== "string" ||
      !entry.key.trim() ||
      entry.key.length > 128 ||
      (allDocuments
        ? !entry.key.startsWith("workplace:") ||
          (entry.code !== undefined && entry.code !== "")
        : typeof entry.code !== "string" ||
          !entry.code.trim() ||
          entry.code.trim().length > 128) ||
      keys.has(entry.key)
    ) {
      return Response.json({ error: "Code AssociatedAgent invalide." }, {
        status: 400,
      });
    }
    keys.add(entry.key);
    entries.push({
      key: entry.key,
      code:
        typeof entry.code === "string" && entry.code.trim()
          ? entry.code.trim()
          : undefined,
      allDocuments,
    });
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    return Response.json(
      { error: "La connexion au service RH n'est pas configurée." },
      { status: 503 }
    );
  }

  try {
    const convex = new ConvexHttpClient(convexUrl);
    await convex.query(api.workplaces.list, { token: body.token });
  } catch (error) {
    if (
      error instanceof Error &&
      /Session expirée|Accès administrateur requis/.test(error.message)
    ) {
      return Response.json({ error: "Accès administrateur requis." }, {
        status: 403,
      });
    }
    console.error("Silwan admin authorization check failed.");
    return Response.json(
      { error: "Impossible de vérifier l'accès administrateur." },
      { status: 503 }
    );
  }

  if (!entries.length) return Response.json({ results: [] });

  const connectionString = process.env.ODBC_CONNECTION_STRING;
  if (!connectionString?.trim()) {
    return Response.json(
      { error: "La connexion ODBC Silwan n'est pas configurée côté serveur." },
      { status: 503 }
    );
  }

  const codes = [
    ...new Set(
      entries
        .filter((entry) => !entry.allDocuments)
        .map((entry) => entry.code!)
    ),
  ];
  const placeholders = codes.map(() => "?").join(", ");
  const hasCentralTotal = entries.some((entry) => entry.allDocuments);
  const month = body.month as number;
  const year = body.year as number;
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonthYear = month === 12 ? year + 1 : year;
  const endDate = `${nextMonthYear}-${String(nextMonth).padStart(2, "0")}-01`;

  let connection: odbc.Connection | undefined;
  try {
    connection = await odbc.connect(connectionString);
    const byCode = new Map<string, number>();
    const recouvrementByCode = new Map<string, number>();
    if (codes.length) {
      const rows = await connection.query<ThirdPartyAggregate>(
        `
          SELECT tp."AssociatedAgent"::text AS "AssociatedAgentCode",
            COALESCE(
              SUM(
                CASE
                  WHEN d."Type" = 10 THEN COALESCE(d."AmountDiscounted", 0)
                  WHEN d."Type" = 12 THEN -COALESCE(d."AmountDiscounted", 0)
                  ELSE 0
                END
              ),
              0
            ) AS "Realisation"
          FROM "COM_ThirdParty" AS tp
          LEFT JOIN "COM_Document" AS d
            ON d."ThirdParty" = tp."Oid"
            AND d."Type" IN (10, 12)
            AND d."Date" >= ?
            AND d."Date" < ?
          WHERE tp."AssociatedAgent"::text IN (${placeholders})
          GROUP BY tp."AssociatedAgent"::text
        `,
        [startDate, endDate, ...codes]
      );

      for (const row of rows) {
        const code = String(row.AssociatedAgentCode);
        const amount = Number(row.Realisation ?? 0);
        if (!Number.isFinite(amount)) {
          throw new Error("Silwan returned an invalid realization amount.");
        }
        byCode.set(code, (byCode.get(code) ?? 0) + amount);
      }

      const transactionRows = await connection.query<{
        AssociatedAgentCode: string | number;
        Recouvrement: string | number | null;
      }>(
        `
          SELECT tp."AssociatedAgent"::text AS "AssociatedAgentCode",
            COALESCE(
              SUM(COALESCE(t."Credit", 0) - COALESCE(t."Debit", 0)),
              0
            ) AS "Recouvrement"
          FROM "COM_ThirdParty" AS tp
          LEFT JOIN "COM_Transaction" AS t
            ON t."ThirdParty" = tp."Oid"
            AND t."TransactionDate" >= ?
            AND t."TransactionDate" < ?
            AND t."DeletionDate" IS NULL
          WHERE tp."AssociatedAgent"::text IN (${placeholders})
          GROUP BY tp."AssociatedAgent"::text
        `,
        [startDate, endDate, ...codes]
      );
      for (const row of transactionRows) {
        const code = String(row.AssociatedAgentCode);
        const amount = Number(row.Recouvrement ?? 0);
        if (!Number.isFinite(amount)) {
          throw new Error("Silwan returned an invalid transaction total.");
        }
        recouvrementByCode.set(
          code,
          (recouvrementByCode.get(code) ?? 0) + amount
        );
      }
    }

    let centralTotal: number | undefined;
    let centralRecouvrement: number | undefined;
    if (hasCentralTotal) {
      const [row] = await connection.query<TotalAggregate>(
        `
          SELECT COALESCE(
            SUM(
              CASE
                WHEN "Type" = 10 THEN COALESCE("AmountDiscounted", 0)
                WHEN "Type" = 12 THEN -COALESCE("AmountDiscounted", 0)
                ELSE 0
              END
            ),
            0
          ) AS "Realisation"
          FROM "COM_Document"
          WHERE "Type" IN (10, 12)
            AND "Date" >= ?
            AND "Date" < ?
        `,
        [startDate, endDate]
      );
      centralTotal = Number(row?.Realisation ?? 0);
      if (!Number.isFinite(centralTotal)) {
        throw new Error("Silwan returned an invalid central realization amount.");
      }

      const [transactionRow] = await connection.query<TransactionAggregate>(
        `
          SELECT COALESCE(
            SUM(COALESCE("Credit", 0) - COALESCE("Debit", 0)),
            0
          ) AS "Recouvrement"
          FROM "COM_Transaction"
          WHERE "TransactionDate" >= ?
            AND "TransactionDate" < ?
            AND "ThirdParty" IS NOT NULL
            AND "DeletionDate" IS NULL
        `,
        [startDate, endDate]
      );
      centralRecouvrement = Number(transactionRow?.Recouvrement ?? 0);
      if (!Number.isFinite(centralRecouvrement)) {
        throw new Error("Silwan returned an invalid central transaction total.");
      }
    }

    return Response.json({
      results: entries.map((entry) => ({
        key: entry.key,
        code: entry.code ?? "",
        matched: entry.allDocuments || byCode.has(entry.code!),
        totalRealisation: entry.allDocuments
          ? centralTotal ?? 0
          : byCode.get(entry.code!) ?? 0,
        totalRecouvrement: entry.allDocuments
          ? centralRecouvrement ?? 0
          : recouvrementByCode.get(entry.code!) ?? 0,
      })),
    });
  } catch (error) {
    console.error(
      "Silwan realization query failed:",
      error instanceof Error ? error.message : "Unknown ODBC error"
    );
    return Response.json(
      { error: "Impossible de récupérer les réalisations depuis Silwan." },
      { status: 502 }
    );
  } finally {
    if (connection) await connection.close();
  }
}
