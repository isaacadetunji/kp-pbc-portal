import type { ClientDirectory, DirectoryClient, DirectoryContact } from "./types";

/**
 * REST adapter for the firm's client database.
 *
 * Configure with environment variables (see .env.example):
 *   CLIENT_API_BASE_URL      e.g. https://clients.internal.example/api/v1
 *   CLIENT_API_KEY           credential
 *   CLIENT_API_AUTH_HEADER   header name (default "Authorization")
 *   CLIENT_API_AUTH_SCHEME   prefix (default "Bearer"; set "" for raw keys)
 *   CLIENT_API_LIST_PATH     default "/clients"
 *   CLIENT_API_ITEM_PATH     default "/clients/{id}"
 *   CLIENT_API_SEARCH_PARAM  default "search"
 *   CLIENT_API_FIELD_MAP     optional JSON mapping our fields -> their field paths,
 *                            e.g. {"externalId":"clientCode","rcNumber":"cac.rc"}
 *
 * Supported list responses: a JSON array, or an object with the array under
 * `data` / `items` / `results` / `clients`, with optional pagination via
 * `next` (URL) or `page`/`totalPages`.
 */
type Json = Record<string, unknown>;

const DEFAULT_MAP: Record<string, string[]> = {
  externalId: ["externalId", "external_id", "id", "clientId", "client_id", "code", "clientCode"],
  name: ["name", "clientName", "client_name", "companyName", "company_name"],
  rcNumber: ["rcNumber", "rc_number", "rc", "cacNumber", "registrationNumber"],
  tin: ["tin", "taxId", "tax_id", "TIN"],
  industry: ["industry", "sector"],
  natureOfBusiness: ["natureOfBusiness", "nature_of_business", "businessDescription", "description"],
  address: ["address", "registeredAddress", "registered_address"],
  yearEnd: ["yearEnd", "year_end", "financialYearEnd", "fyEnd"],
  yearEndMonth: ["yearEndMonth", "year_end_month"],
  yearEndDay: ["yearEndDay", "year_end_day"],
  email: ["email", "emailAddress"],
  phone: ["phone", "phoneNumber", "telephone"],
  isActive: ["isActive", "is_active", "active", "status"],
  contacts: ["contacts", "contactPersons", "contact_persons"],
  groupName: ["groupName", "group_name", "group", "parentName", "parent_name", "parentCompany"],
};

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Json)[k] : undefined), obj);
}

function str(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v).trim();
}

export class RestClientDirectory implements ClientDirectory {
  readonly mode = "rest" as const;
  private map: Record<string, string[]>;

  constructor(
    private readonly cfg: {
      baseUrl: string;
      apiKey: string;
      authHeader: string;
      authScheme: string;
      timeoutMs: number;
      listPath?: string;
      itemPath?: string;
      searchParam?: string;
      fieldMap?: string;
    },
  ) {
    if (!cfg.baseUrl) throw new Error("CLIENT_API_BASE_URL is not set");
    this.map = { ...DEFAULT_MAP };
    if (cfg.fieldMap) {
      const custom = JSON.parse(cfg.fieldMap) as Record<string, string>;
      for (const [k, v] of Object.entries(custom)) this.map[k] = [v];
    }
  }

  private pick(obj: unknown, field: string): unknown {
    for (const p of this.map[field] ?? []) {
      const v = get(obj, p);
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  }

  private async request(pathOrUrl: string): Promise<unknown> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${this.cfg.baseUrl.replace(/\/$/, "")}${pathOrUrl}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.cfg.apiKey) {
      headers[this.cfg.authHeader] = this.cfg.authScheme ? `${this.cfg.authScheme} ${this.cfg.apiKey}` : this.cfg.apiKey;
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(this.cfg.timeoutMs), cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Client API ${res.status} ${res.statusText} for ${url}`);
    return res.json();
  }

  private extractList(body: unknown): unknown[] {
    if (Array.isArray(body)) return body;
    for (const k of ["data", "items", "results", "clients"]) {
      const v = (body as Json | null)?.[k];
      if (Array.isArray(v)) return v;
    }
    return [];
  }

  toDirectoryClient(raw: unknown): DirectoryClient | null {
    const externalId = str(this.pick(raw, "externalId"));
    const name = str(this.pick(raw, "name"));
    if (!externalId || !name) return null;

    let month = Number(this.pick(raw, "yearEndMonth")) || null;
    let day = Number(this.pick(raw, "yearEndDay")) || null;
    const ye = str(this.pick(raw, "yearEnd"));
    if (ye && (!month || !day)) {
      // accepts "12-31", "31/12", "2025-12-31", "December"
      const iso = ye.match(/(\d{4})-(\d{2})-(\d{2})/);
      const md = ye.match(/^(\d{1,2})[-/](\d{1,2})$/);
      if (iso) { month = Number(iso[2]); day = Number(iso[3]); }
      else if (md) {
        const a = Number(md[1]), b = Number(md[2]);
        if (a > 12) { day = a; month = b; } else { month = a; day = b; }
      }
    }

    const activeRaw = this.pick(raw, "isActive");
    const isActive =
      activeRaw === undefined ? true
      : typeof activeRaw === "boolean" ? activeRaw
      : !/^(inactive|closed|dormant|false|0)$/i.test(String(activeRaw));

    const contactsRaw = this.pick(raw, "contacts");
    const contacts: DirectoryContact[] = Array.isArray(contactsRaw)
      ? contactsRaw
          .map((c): DirectoryContact | null => {
            const email = str(get(c, "email") ?? get(c, "emailAddress"));
            if (!email) return null;
            return {
              externalId: str(get(c, "id") ?? get(c, "externalId")),
              fullName: str(get(c, "fullName") ?? get(c, "name") ?? get(c, "full_name")) ?? email,
              email: email.toLowerCase(),
              phone: str(get(c, "phone") ?? get(c, "phoneNumber")),
              position: str(get(c, "position") ?? get(c, "title") ?? get(c, "role")),
              isPrimary: Boolean(get(c, "isPrimary") ?? get(c, "is_primary") ?? get(c, "primary")),
            };
          })
          .filter((c): c is DirectoryContact => c !== null)
      : [];

    return {
      externalId,
      name,
      rcNumber: str(this.pick(raw, "rcNumber")),
      tin: str(this.pick(raw, "tin")),
      industry: str(this.pick(raw, "industry")),
      natureOfBusiness: str(this.pick(raw, "natureOfBusiness")),
      address: str(this.pick(raw, "address")),
      yearEndMonth: month && month >= 1 && month <= 12 ? month : null,
      yearEndDay: day && day >= 1 && day <= 31 ? day : null,
      email: str(this.pick(raw, "email")),
      phone: str(this.pick(raw, "phone")),
      isActive,
      groupName: str(this.pick(raw, "groupName")),
      contacts,
      raw,
    };
  }

  async listClients(options?: { updatedSince?: string }): Promise<DirectoryClient[]> {
    const listPath = this.cfg.listPath ?? "/clients";
    const out: DirectoryClient[] = [];
    let url: string | null = listPath + (options?.updatedSince ? `${listPath.includes("?") ? "&" : "?"}updatedSince=${encodeURIComponent(options.updatedSince)}` : "");
    let page = 1;
    for (let guard = 0; url && guard < 500; guard++) {
      const body = await this.request(url);
      const rows = this.extractList(body);
      rows.forEach((r) => {
        const c = this.toDirectoryClient(r);
        if (c) out.push(c);
      });
      const b = body as Json | null;
      if (b && typeof b.next === "string" && b.next) url = b.next;
      else if (b && typeof b.totalPages === "number" && page < b.totalPages) {
        page += 1;
        url = `${listPath}${listPath.includes("?") ? "&" : "?"}page=${page}`;
      } else url = null;
    }
    return out;
  }

  async getClient(externalId: string): Promise<DirectoryClient | null> {
    const path = (this.cfg.itemPath ?? "/clients/{id}").replace("{id}", encodeURIComponent(externalId));
    const body = await this.request(path);
    if (!body) return null;
    const raw = (body as Json).data && !Array.isArray((body as Json).data) ? (body as Json).data : body;
    return this.toDirectoryClient(raw);
  }

  async searchClients(query: string): Promise<DirectoryClient[]> {
    const listPath = this.cfg.listPath ?? "/clients";
    const param = this.cfg.searchParam ?? "search";
    const body = await this.request(`${listPath}${listPath.includes("?") ? "&" : "?"}${param}=${encodeURIComponent(query)}`);
    return this.extractList(body).map((r) => this.toDirectoryClient(r)).filter((c): c is DirectoryClient => c !== null);
  }

  async healthCheck() {
    try {
      const body = await this.request(this.cfg.listPath ?? "/clients");
      return { ok: true, message: `Connected. ${this.extractList(body).length} client(s) on the first page.` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
}
