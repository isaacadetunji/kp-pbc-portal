import type { ClientDirectory, DirectoryClient } from "./types";

/** Fictitious sample clients used until the real client database API is connected. */
const MOCK_CLIENTS: DirectoryClient[] = [
  {
    externalId: "KP-CL-0001",
    name: "Adebayo Foods Plc",
    rcNumber: "RC 104532",
    tin: "01234567-0001",
    industry: "Food & Beverage (FMCG)",
    natureOfBusiness: "Manufacture and distribution of packaged foods and beverages",
    address: "14 Industrial Avenue, Ikeja, Lagos",
    yearEndMonth: 12,
    yearEndDay: 31,
    email: "finance@adebayofoods.example",
    phone: "+234 1 555 0101",
    isActive: true,
    groupName: "Adebayo Group",
    contacts: [
      { externalId: "C-1", fullName: "Chioma Okafor", email: "chioma.okafor@adebayofoods.example", position: "Chief Financial Officer", phone: "+234 803 555 0101", isPrimary: true },
      { externalId: "C-2", fullName: "Tunde Bakare", email: "tunde.bakare@adebayofoods.example", position: "Financial Controller", phone: "+234 805 555 0102" },
    ],
  },
  {
    externalId: "KP-CL-0009",
    name: "Adebayo Agro Processing Ltd",
    rcNumber: "RC 1344210",
    tin: "08901234-0001",
    industry: "Agro-processing",
    natureOfBusiness: "Cassava and maize processing for Adebayo Foods Plc",
    address: "KM 12 Ibadan–Oyo Road, Oyo State",
    yearEndMonth: 12,
    yearEndDay: 31,
    isActive: true,
    groupName: "Adebayo Group",
    contacts: [{ externalId: "C-1", fullName: "Chioma Okafor", email: "chioma.okafor@adebayofoods.example", position: "Group CFO", isPrimary: true }],
  },
  {
    externalId: "KP-CL-0010",
    name: "Adebayo Distribution Ltd",
    rcNumber: "RC 1402277",
    tin: "09012345-0001",
    industry: "Distribution",
    natureOfBusiness: "Distribution of packaged foods to retailers in the South-West",
    address: "22 Oba Akran Avenue, Ikeja, Lagos",
    yearEndMonth: 12,
    yearEndDay: 31,
    isActive: true,
    groupName: "Adebayo Group",
    contacts: [{ externalId: "C-1", fullName: "Chioma Okafor", email: "chioma.okafor@adebayofoods.example", position: "Group CFO", isPrimary: true }],
  },
  {
    externalId: "KP-CL-0002",
    name: "Lekki Harbour Logistics Ltd",
    rcNumber: "RC 889201",
    tin: "02345678-0001",
    industry: "Transport & Logistics",
    natureOfBusiness: "Freight forwarding, haulage and bonded warehousing",
    address: "Plot 7, Harbour Road, Apapa, Lagos",
    yearEndMonth: 12,
    yearEndDay: 31,
    email: "accounts@lekkiharbour.example",
    phone: "+234 1 555 0202",
    isActive: true,
    contacts: [{ externalId: "C-3", fullName: "Ifeoma Nwosu", email: "ifeoma.nwosu@lekkiharbour.example", position: "Head of Finance", isPrimary: true }],
  },
  {
    externalId: "KP-CL-0003",
    name: "Sahel Agritech Cooperative",
    rcNumber: "RC 1203394",
    tin: "03456789-0001",
    industry: "Agriculture",
    natureOfBusiness: "Aggregation and processing of grains; farmer input financing",
    address: "22 Ahmadu Bello Way, Kaduna",
    yearEndMonth: 6,
    yearEndDay: 30,
    email: "finance@sahelagri.example",
    isActive: true,
    contacts: [{ externalId: "C-4", fullName: "Musa Abdullahi", email: "musa.abdullahi@sahelagri.example", position: "Finance Manager", isPrimary: true }],
  },
  {
    externalId: "KP-CL-0004",
    name: "Eko Microfinance Bank Ltd",
    rcNumber: "RC 745120",
    tin: "04567890-0001",
    industry: "Financial Services",
    natureOfBusiness: "Microfinance banking (CBN-licensed, state authorisation)",
    address: "5 Broad Street, Lagos Island, Lagos",
    yearEndMonth: 12,
    yearEndDay: 31,
    email: "fincon@ekomfb.example",
    isActive: true,
    contacts: [
      { externalId: "C-5", fullName: "Kemi Adeyemi", email: "kemi.adeyemi@ekomfb.example", position: "Chief Financial Officer", isPrimary: true },
      { externalId: "C-6", fullName: "Emeka Obi", email: "emeka.obi@ekomfb.example", position: "Head, Internal Control" },
    ],
  },
  {
    externalId: "KP-CL-0005",
    name: "Garki Properties Development Co. Ltd",
    rcNumber: "RC 552781",
    tin: "05678901-0001",
    industry: "Real Estate",
    natureOfBusiness: "Property development and facility management",
    address: "Plot 110, Garki II, Abuja FCT",
    yearEndMonth: 12,
    yearEndDay: 31,
    email: "accounts@garkiprop.example",
    isActive: true,
    contacts: [{ externalId: "C-7", fullName: "Hauwa Bello", email: "hauwa.bello@garkiprop.example", position: "Finance Director", isPrimary: true }],
  },
  {
    externalId: "KP-CL-0006",
    name: "Rivers Crest Energy Services Ltd",
    rcNumber: "RC 330915",
    tin: "06789012-0001",
    industry: "Oil & Gas Services",
    natureOfBusiness: "Oilfield equipment leasing and maintenance",
    address: "18 Trans-Amadi Industrial Layout, Port Harcourt",
    yearEndMonth: 3,
    yearEndDay: 31,
    email: "finance@crestenergy.example",
    isActive: true,
    contacts: [{ externalId: "C-8", fullName: "Ibiso Tamuno", email: "ibiso.tamuno@crestenergy.example", position: "Group Financial Controller", isPrimary: true }],
  },
  {
    externalId: "KP-CL-0007",
    name: "Yaba Tech Hub Ltd",
    rcNumber: "RC 1580044",
    tin: "07890123-0001",
    industry: "Technology",
    natureOfBusiness: "Software development and co-working spaces",
    address: "3 Herbert Macaulay Way, Yaba, Lagos",
    yearEndMonth: 12,
    yearEndDay: 31,
    email: "ops@yabatechhub.example",
    isActive: true,
    contacts: [{ externalId: "C-9", fullName: "Seun Adewale", email: "seun.adewale@yabatechhub.example", position: "COO", isPrimary: true }],
  },
  {
    externalId: "KP-CL-0008",
    name: "Northern Textiles Mills Ltd (dormant)",
    rcNumber: "RC 21007",
    industry: "Manufacturing",
    natureOfBusiness: "Textile manufacturing (dormant)",
    address: "Kakuri Industrial Estate, Kaduna",
    yearEndMonth: 12,
    yearEndDay: 31,
    isActive: false,
    contacts: [],
  },
];

export class MockClientDirectory implements ClientDirectory {
  readonly mode = "mock" as const;

  async listClients(): Promise<DirectoryClient[]> {
    return structuredClone(MOCK_CLIENTS);
  }

  async getClient(externalId: string): Promise<DirectoryClient | null> {
    return structuredClone(MOCK_CLIENTS.find((c) => c.externalId === externalId) ?? null);
  }

  async searchClients(query: string): Promise<DirectoryClient[]> {
    const q = query.trim().toLowerCase();
    return structuredClone(
      MOCK_CLIENTS.filter(
        (c) => c.name.toLowerCase().includes(q) || c.rcNumber?.toLowerCase().includes(q) || c.tin?.includes(q),
      ),
    );
  }

  async healthCheck() {
    return { ok: true, message: `Mock directory with ${MOCK_CLIENTS.length} sample clients` };
  }
}
